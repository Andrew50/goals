#!/bin/bash
# db/backup.sh
set -euo pipefail

# Keep `NEO4J_HOME` explicit and consistent with other scripts/CI.
NEO4J_HOME="${NEO4J_HOME:-/var/lib/neo4j}"

BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FINAL_DUMP="${BACKUP_DIR}/neo4j_dump_${TIMESTAMP}.dump"
TMP_DIR="${BACKUP_DIR}/tmp_${TIMESTAMP}"

# Detect neo4j CLI binary (used for Community Edition backups where DB admin commands are unsupported)
NEO4J_BIN="${NEO4J_HOME}/bin/neo4j"
if [ ! -x "${NEO4J_BIN}" ] && command -v neo4j >/dev/null 2>&1; then
    NEO4J_BIN="$(command -v neo4j)"
fi

# Helper: best-effort wait for Neo4j to become queryable (so the data dir is initialized and SHOW DATABASES works).
wait_for_neo4j_ready() {
    local cypher_shell_bin="$1"
    local bolt_uri="$2"
    local user="$3"
    local pass="$4"
    local attempts="${5:-60}"
    local sleep_s="${6:-2}"

    if [ -z "${cypher_shell_bin}" ] || [ ! -x "${cypher_shell_bin}" ]; then
        return 0
    fi

    local i=1
    while [ "${i}" -le "${attempts}" ]; do
        if "${cypher_shell_bin}" -a "${bolt_uri}" -u "${user}" -p "${pass}" "RETURN 1;" >/dev/null 2>&1; then
            return 0
        fi
        sleep "${sleep_s}"
        i=$((i + 1))
    done
    return 1
}

# NOTE: `neo4j-admin database dump` requires the target database to be stopped (Neo4j Community has no online backup).
# We'll stop the target database via cypher-shell (connected to the `system` database), perform the dump, then start it again.
STOP_MODE="none" # none | database | server

neo4j_server_is_queryable() {
    if [ -n "${CYPHER_SHELL_BIN-}" ] && [ -x "${CYPHER_SHELL_BIN}" ]; then
        if "${CYPHER_SHELL_BIN}" -a "${NEO4J_BOLT_URI}" -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" "RETURN 1;" >/dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

start_best_effort() {
    case "${STOP_MODE}" in
        server)
            if [ -x "${NEO4J_BIN}" ]; then
                echo "[$(date)] Starting Neo4j server (daemon)..."
                "${NEO4J_BIN}" start >/dev/null 2>&1 || true
                # Best-effort wait for readiness again
                wait_for_neo4j_ready "${CYPHER_SHELL_BIN-}" "${NEO4J_BOLT_URI}" "${NEO4J_USER}" "${NEO4J_PASSWORD}" 60 2 || true
            fi
            ;;
        database)
            if [ -n "${CYPHER_SHELL_BIN-}" ] && [ -x "${CYPHER_SHELL_BIN}" ]; then
                echo "[$(date)] Starting database '${DB_NAME}'..."
                # Syntax differs slightly across versions; try explicit units first, then fall back. Suppress errors so we don't fail the backup on restart issues.
                "${CYPHER_SHELL_BIN}" -a "${NEO4J_BOLT_URI}" -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" --database system \
                    "START DATABASE \`${DB_NAME}\` WAIT 120 SECONDS;" >/dev/null 2>&1 || \
                    "${CYPHER_SHELL_BIN}" -a "${NEO4J_BOLT_URI}" -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" --database system \
                        "START DATABASE \`${DB_NAME}\` WAIT 120;" >/dev/null 2>&1 || true
            fi
            ;;
        *)
            ;;
    esac
}

stop_for_offline_dump_or_fail() {
    # If the server isn't queryable, assume we're already offline (e.g., running in a helper container) and proceed.
    if ! neo4j_server_is_queryable; then
        echo "[$(date)] Neo4j is not queryable at ${NEO4J_BOLT_URI}; assuming offline mode (no stop required)"
        STOP_MODE="none"
        return 0
    fi

    # Try database-level stop via Cypher first (works in Neo4j editions that support admin commands).
    if [ -n "${CYPHER_SHELL_BIN-}" ] && [ -x "${CYPHER_SHELL_BIN}" ]; then
        echo "[$(date)] Attempting database stop via Cypher (system database)..."
        local out=""
        out="$("${CYPHER_SHELL_BIN}" -a "${NEO4J_BOLT_URI}" -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" --database system \
            "STOP DATABASE \`${DB_NAME}\` WAIT 120 SECONDS;" 2>&1)" || true

        # Some versions don't accept the "SECONDS" keyword. Retry without units if we got a parse/syntax style error.
        if echo "${out}" | grep -qiE 'invalid input|syntax|parse|expected|seconds'; then
            local out2=""
            out2="$("${CYPHER_SHELL_BIN}" -a "${NEO4J_BOLT_URI}" -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" --database system \
                "STOP DATABASE \`${DB_NAME}\` WAIT 120;" 2>&1)" || true
            out="${out}"$'\n'"${out2}"
        fi

        if echo "${out}" | grep -qi 'Unsupported administration command'; then
            echo "[$(date)] Database admin commands not supported (Neo4j Community). Will stop the server process instead."
        else
            # If stop succeeded, we're good; if not, fall back to server stop if possible.
            if echo "${out}" | tr -d '\r' | grep -qiE 'stopped|offline|completed|success|database.*stopped'; then
                STOP_MODE="database"
                return 0
            fi
            # Some versions print nothing on success; verify with SHOW DATABASES when possible.
            if "${CYPHER_SHELL_BIN}" -a "${NEO4J_BOLT_URI}" -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" --database system \
                "SHOW DATABASES YIELD name, currentStatus WHERE name = '${DB_NAME}' RETURN currentStatus;" 2>/dev/null \
                | tr -d '\r' | grep -qi 'offline'; then
                STOP_MODE="database"
                return 0
            fi
            echo "[$(date)] Cypher stop did not succeed; output was:"
            echo "${out}" | sed 's/^/  /'
        fi
    fi

    # Community Edition: stop the server daemon (requires the container entrypoint to keep running while Neo4j is stopped).
    if [ -x "${NEO4J_BIN}" ]; then
        echo "[$(date)] Stopping Neo4j server (daemon) for offline dump..."
        if "${NEO4J_BIN}" stop >/dev/null 2>&1; then
            STOP_MODE="server"
        else
            echo "[$(date)] Failed to stop Neo4j server via '${NEO4J_BIN} stop'"
            "${NEO4J_BIN}" status 2>&1 | sed 's/^/  /' || true
            return 1
        fi

        # Wait for server to stop so the store lock is released.
        for _ in {1..60}; do
            if ! neo4j_server_is_queryable; then
                return 0
            fi
            sleep 2
        done
        echo "[$(date)] Warning: Neo4j still appears queryable; attempting dump anyway"
        return 0
    fi

    echo "[$(date)] Cannot stop database/server for offline dump (missing cypher-shell/neo4j CLI)"
    return 1
}

# Determine path to neo4j-admin (works for Neo4j 4.x and 5.x official images)
NEO4J_ADMIN_BIN="${NEO4J_HOME}/bin/neo4j-admin"
if [ ! -x "${NEO4J_ADMIN_BIN}" ]; then
    if command -v neo4j-admin >/dev/null 2>&1; then
        NEO4J_ADMIN_BIN="$(command -v neo4j-admin)"
    else
        echo "[$(date)] neo4j-admin binary not found in PATH or at ${NEO4J_HOME}/bin/neo4j-admin"
        exit 1
    fi
fi

# Resolve Neo4j data directory. In official Docker images, data is stored at /data
# but the default config uses $NEO4J_HOME/data unless overridden. We prefer /data when present.
NEO4J_DATA_DIR_CANDIDATE="/data"
if [ -d "${NEO4J_DATA_DIR_CANDIDATE}/databases" ]; then
    export NEO4J_server_directories_data="${NEO4J_DATA_DIR_CANDIDATE}"
    echo "[$(date)] Using data directory: ${NEO4J_server_directories_data}"
else
    echo "[$(date)] /data not found; falling back to default data directory"
fi

# Resolve cypher-shell + credentials early so we can wait for readiness and/or query SHOW DATABASES.
CYPHER_SHELL_BIN="${NEO4J_HOME}/bin/cypher-shell"
if [ ! -x "${CYPHER_SHELL_BIN}" ] && command -v cypher-shell >/dev/null 2>&1; then
    CYPHER_SHELL_BIN="$(command -v cypher-shell)"
fi

# Parse credentials from NEO4J_AUTH=user/password if present
NEO4J_USER="${NEO4J_USER-}"
NEO4J_PASSWORD="${NEO4J_PASSWORD-}"
if [ -z "${NEO4J_USER}" ] || [ -z "${NEO4J_PASSWORD}" ]; then
    if [ -n "${NEO4J_AUTH-}" ] && echo "${NEO4J_AUTH}" | grep -q '/'; then
        NEO4J_USER="${NEO4J_AUTH%%/*}"
        NEO4J_PASSWORD="${NEO4J_AUTH#*/}"
    fi
fi
NEO4J_USER="${NEO4J_USER:-neo4j}"
NEO4J_PASSWORD="${NEO4J_PASSWORD:-password123}"
NEO4J_BOLT_URI="${NEO4J_BOLT_URI:-bolt://localhost:7687}"

# If we're running inside the Neo4j container right after startup, the TCP port can be open
# before the database is fully initialized on disk. Wait briefly so dumps can succeed reliably.
if ! wait_for_neo4j_ready "${CYPHER_SHELL_BIN}" "${NEO4J_BOLT_URI}" "${NEO4J_USER}" "${NEO4J_PASSWORD}" 60 2; then
    echo "[$(date)] Warning: cypher-shell did not become ready at ${NEO4J_BOLT_URI}; continuing with filesystem-based detection"
fi

# Resolve database name:
# - Respect NEO4J_DATABASE if explicitly set
# - Otherwise prefer asking the running server (SHOW DATABASES) for the default/non-system database
# - Fallback: auto-detect by looking under the configured data directory's "databases" folder
DB_NAME="${NEO4J_DATABASE-}"
if [ -z "${DB_NAME}" ]; then
    # Try to query the running server for the default database
    if [ -x "${CYPHER_SHELL_BIN}" ]; then
        # Prefer the default database; otherwise pick the first online non-system database.
        DB_NAME="$("${CYPHER_SHELL_BIN}" -a "${NEO4J_BOLT_URI}" -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" \
            "SHOW DATABASES YIELD name, default, currentStatus WHERE name <> 'system' AND currentStatus = 'online' RETURN 'DB=' + name AS out ORDER BY default DESC, name ASC LIMIT 1;" 2>/dev/null \
            | tr -d '\r' | grep -o 'DB=[^[:space:]]\\+' | head -n 1 | cut -d= -f2 || true)"
    fi

    DATA_DIR="${NEO4J_server_directories_data-${NEO4J_HOME}/data}"
    # Some versions can take a moment to create the databases/ directories. Wait briefly before giving up.
    if [ ! -d "${DATA_DIR}/databases" ] && [ -d "/data/databases" ]; then
        DATA_DIR="/data"
    fi
    if [ -d "${DATA_DIR}/databases" ]; then
        if [ -z "${DB_NAME}" ]; then
            for i in {1..15}; do
                # Pick the first non-system database directory
                DB_NAME="$(find "${DATA_DIR}/databases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | grep -v '^system$' | head -n 1 || true)"
                if [ -n "${DB_NAME}" ]; then
                    break
                fi
                sleep 2
            done
        fi
    fi
fi
DB_NAME="${DB_NAME:-neo4j}"

echo "----------------------------------------"
echo "[$(date)] Starting backup process"
echo "[$(date)] Backup directory: ${BACKUP_DIR}"
echo "[$(date)] Final dump path: ${FINAL_DUMP}"
echo "[$(date)] Target database: ${DB_NAME}"

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"
echo "[$(date)] Backup directory created/verified"

# List current files in backup directory
echo "[$(date)] Current files in backup directory:"
ls -l "${BACKUP_DIR}" || true

echo "[$(date)] Creating temporary dump directory: ${TMP_DIR}"
mkdir -p "${TMP_DIR}"

echo "[$(date)] Starting database dump to temporary directory..."
# Always try to start the DB/server back up if we stopped it.
trap 'start_best_effort' EXIT

if ! stop_for_offline_dump_or_fail; then
    echo "[$(date)] Cannot perform offline dump because database could not be stopped"
    rm -rf "${TMP_DIR}"
    exit 1
fi
# In Neo4j 5, --to-path must be a directory. The dump file will be named neo4j.dump inside that directory.
if "${NEO4J_ADMIN_BIN}" database dump "${DB_NAME}" --to-path="${TMP_DIR}" --overwrite-destination; then
    echo "[$(date)] Database dump completed successfully"
else
    echo "[$(date)] Database dump failed"
    echo "[$(date)] Debug: databases as seen by the running server (if available):"
    if [ -n "${CYPHER_SHELL_BIN-}" ] && [ -x "${CYPHER_SHELL_BIN}" ]; then
        "${CYPHER_SHELL_BIN}" -a "${NEO4J_BOLT_URI:-bolt://localhost:7687}" -u "${NEO4J_USER:-neo4j}" -p "${NEO4J_PASSWORD:-password123}" \
            "SHOW DATABASES;" 2>&1 || true
    else
        echo "[$(date)] cypher-shell not found; skipping SHOW DATABASES"
    fi
    echo "[$(date)] Debug: data directory candidates:"
    ls -la /data 2>/dev/null || true
    ls -la /data/databases 2>/dev/null || true
    ls -la "${NEO4J_HOME}/data" 2>/dev/null || true
    ls -la "${NEO4J_HOME}/data/databases" 2>/dev/null || true
    rm -rf "${TMP_DIR}"
    exit 1
fi

# Move and timestamp the dump file
DUMP_FILE="${TMP_DIR}/${DB_NAME}.dump"
if [ ! -f "${DUMP_FILE}" ]; then
    # Fallback: pick the first *.dump generated (helps if Neo4j changes naming conventions)
    DUMP_FILE="$(ls -1 "${TMP_DIR}"/*.dump 2>/dev/null | head -n 1 || true)"
fi

if [ -n "${DUMP_FILE}" ] && [ -f "${DUMP_FILE}" ]; then
    if [ -e "${FINAL_DUMP}" ]; then
        echo "[$(date)] Warning: ${FINAL_DUMP} already exists; appending a suffix to avoid overwrite"
        FINAL_DUMP="${FINAL_DUMP%.dump}_dup_$$.dump"
    fi
    mv "${DUMP_FILE}" "${FINAL_DUMP}"
    echo "[$(date)] Moved dump to ${FINAL_DUMP}"
else
    echo "[$(date)] Expected dump file not found in ${TMP_DIR} (looked for ${TMP_DIR}/${DB_NAME}.dump)"
    echo "[$(date)] Contents of ${TMP_DIR}:"
    ls -la "${TMP_DIR}" || true
    rm -rf "${TMP_DIR}"
    exit 1
fi

# Cleanup temporary directory
rm -rf "${TMP_DIR}"

echo "[$(date)] Cleaning up old backups (older than 7 days)..."
find "${BACKUP_DIR}" -type f -name "neo4j_dump_*.dump" -mtime +7 -print -delete || true

echo "[$(date)] Final backup directory contents:"
ls -l "${BACKUP_DIR}" || true
echo "[$(date)] Backup process completed"
echo "----------------------------------------"