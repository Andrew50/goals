#!/bin/bash
# db/backup.sh
set -euo pipefail

BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FINAL_DUMP="${BACKUP_DIR}/neo4j_dump_${TIMESTAMP}.dump"
TMP_DIR="${BACKUP_DIR}/tmp_${TIMESTAMP}"

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
DB_WAS_STOPPED_BY_SCRIPT="false"

start_db_best_effort() {
    if [ "${DB_WAS_STOPPED_BY_SCRIPT}" != "true" ]; then
        return 0
    fi
    if [ -z "${CYPHER_SHELL_BIN-}" ] || [ ! -x "${CYPHER_SHELL_BIN}" ]; then
        return 0
    fi
    echo "[$(date)] Starting database '${DB_NAME}'..."
    "${CYPHER_SHELL_BIN}" -a "${NEO4J_BOLT_URI}" -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" -d system \
        "START DATABASE \`${DB_NAME}\` WAIT 120 SECONDS;" >/dev/null 2>&1 || true
}

stop_db_for_offline_dump_or_fail() {
    if [ -z "${CYPHER_SHELL_BIN-}" ] || [ ! -x "${CYPHER_SHELL_BIN}" ]; then
        echo "[$(date)] cypher-shell not found; cannot stop database '${DB_NAME}' for offline dump"
        return 1
    fi

    echo "[$(date)] Stopping database '${DB_NAME}' for offline dump..."

    # Prefer WAIT syntax; fall back to older syntax. Treat "already stopped" as non-fatal by checking status.
    if "${CYPHER_SHELL_BIN}" -a "${NEO4J_BOLT_URI}" -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" -d system \
        "STOP DATABASE \`${DB_NAME}\` WAIT 120 SECONDS;" >/dev/null 2>&1; then
        DB_WAS_STOPPED_BY_SCRIPT="true"
    elif "${CYPHER_SHELL_BIN}" -a "${NEO4J_BOLT_URI}" -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" -d system \
        "STOP DATABASE \`${DB_NAME}\`;" >/dev/null 2>&1; then
        DB_WAS_STOPPED_BY_SCRIPT="true"
    else
        if "${CYPHER_SHELL_BIN}" -a "${NEO4J_BOLT_URI}" -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" -d system \
            "SHOW DATABASES YIELD name, currentStatus WHERE name = '${DB_NAME}' RETURN currentStatus;" 2>/dev/null \
            | tr -d '\r' | grep -qi 'offline'; then
            DB_WAS_STOPPED_BY_SCRIPT="true"
        else
            echo "[$(date)] Failed to stop database '${DB_NAME}'"
            return 1
        fi
    fi

    # Wait briefly for the DB to report offline so the store lock is released.
    for _ in {1..60}; do
        if "${CYPHER_SHELL_BIN}" -a "${NEO4J_BOLT_URI}" -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" -d system \
            "SHOW DATABASES YIELD name, currentStatus WHERE name = '${DB_NAME}' RETURN currentStatus;" 2>/dev/null \
            | tr -d '\r' | grep -qi 'offline'; then
            return 0
        fi
        sleep 2
    done

    echo "[$(date)] Warning: database '${DB_NAME}' did not report status=offline; attempting dump anyway"
    return 0
}

# Determine path to neo4j-admin (works for Neo4j 4.x and 5.x official images)
NEO4J_ADMIN_BIN="${NEO4J_HOME:-/var/lib/neo4j}/bin/neo4j-admin"
if [ ! -x "${NEO4J_ADMIN_BIN}" ]; then
    if command -v neo4j-admin >/dev/null 2>&1; then
        NEO4J_ADMIN_BIN="$(command -v neo4j-admin)"
    else
        echo "[$(date)] neo4j-admin binary not found in PATH or at ${NEO4J_HOME:-/var/lib/neo4j}/bin/neo4j-admin"
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
CYPHER_SHELL_BIN="${NEO4J_HOME:-/var/lib/neo4j}/bin/cypher-shell"
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

    DATA_DIR="${NEO4J_server_directories_data-${NEO4J_HOME:-/var/lib/neo4j}/data}"
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
# Always try to start the DB back up if we stopped it.
trap 'start_db_best_effort' EXIT

if ! stop_db_for_offline_dump_or_fail; then
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
    ls -la "${NEO4J_HOME:-/var/lib/neo4j}/data" 2>/dev/null || true
    ls -la "${NEO4J_HOME:-/var/lib/neo4j}/data/databases" 2>/dev/null || true
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