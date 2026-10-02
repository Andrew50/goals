#!/bin/bash
# db/verify_restore.sh
# Load a Neo4j offline dump into a throwaway volume and query it.
# Usage: verify_restore.sh <host-dump-file> <neo4j-image> [canary-token]
set -euo pipefail

# Git Bash rewrites leading-/ arguments into Windows paths before docker sees them.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
    echo "Usage: $0 <host-dump-file> <neo4j-image> [canary-token]" >&2
    exit 2
fi

DUMP_FILE="$1"
IMAGE="$2"
CANARY="${3:-}"
NEO4J_USER="${NEO4J_USER:-neo4j}"
NEO4J_PASSWORD="${NEO4J_PASSWORD:-password123}"

if [ ! -s "${DUMP_FILE}" ]; then
    echo "[verify_restore] Dump file missing or empty: ${DUMP_FILE}" >&2
    exit 1
fi

if [ -n "${CANARY}" ] && ! [[ "${CANARY}" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "[verify_restore] Canary token must match [A-Za-z0-9_-]+" >&2
    exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "[verify_restore] docker is required" >&2
    exit 1
fi

# Git Bash passes /c/... paths; Docker Desktop on Windows needs a Windows path.
to_docker_path() {
    local p="$1"
    if command -v cygpath >/dev/null 2>&1; then
        cygpath -w "${p}"
    else
        printf '%s' "${p}"
    fi
}

DOCKER_DUMP_FILE="$(to_docker_path "${DUMP_FILE}")"

SUFFIX="$(date +%Y%m%d%H%M%S)-$$-${RANDOM:-0}"
CONTAINER="goals_restore_${SUFFIX}"
VOLUME="goals_restore_${SUFFIX}"

cleanup() {
    local status=$?
    docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
    docker volume rm -f "${VOLUME}" >/dev/null 2>&1 || true
    exit "${status}"
}
trap cleanup EXIT

echo "[verify_restore] Dump: ${DUMP_FILE}"
echo "[verify_restore] Image: ${IMAGE}"
if [ -n "${CANARY}" ]; then
    echo "[verify_restore] Canary token: ${CANARY}"
fi

docker volume create "${VOLUME}" >/dev/null

echo "[verify_restore] Loading dump into throwaway volume ${VOLUME}"
# neo4j-admin database load --from-path is a directory. The archive inside it
# must be named <database>.dump, so stage the timestamped file as neo4j.dump.
docker run --rm \
    --user root \
    -v "${VOLUME}:/data" \
    -v "${DOCKER_DUMP_FILE}:/incoming/source.dump:ro" \
    --entrypoint bash \
    "${IMAGE}" \
    -c '
        set -euo pipefail
        export NEO4J_HOME="${NEO4J_HOME:-/var/lib/neo4j}"
        export NEO4J_server_directories_data=/data
        mkdir -p /tmp/dump
        cp /incoming/source.dump /tmp/dump/neo4j.dump
        "${NEO4J_HOME}/bin/neo4j-admin" database load neo4j \
            --from-path=/tmp/dump \
            --overwrite-destination=true
        chown -R neo4j:neo4j /data
    '

echo "[verify_restore] Starting throwaway Neo4j ${CONTAINER}"
# A database dump does not include the system database, where users live.
# set-initial-password accepts any character in the password. Leave NEO4J_AUTH
# empty so the entrypoint does not parse it or set the password again.
# Heap and page cache stay at 512m so this can run beside the live database.
docker run -d --name "${CONTAINER}" \
    -v "${VOLUME}:/data" \
    -e "RESTORE_PASSWORD=${NEO4J_PASSWORD}" \
    -e NEO4J_AUTH= \
    -e NEO4J_server_memory_heap_initial__size=512m \
    -e NEO4J_server_memory_heap_max__size=512m \
    -e NEO4J_server_memory_pagecache_size=512m \
    --entrypoint bash \
    "${IMAGE}" \
    -c 'set -euo pipefail; export PATH="${NEO4J_HOME:-/var/lib/neo4j}/bin:$PATH"; export NEO4J_server_directories_data=/data; "${NEO4J_HOME:-/var/lib/neo4j}/bin/neo4j-admin" dbms set-initial-password "$RESTORE_PASSWORD"; /startup/docker-entrypoint.sh neo4j start; touch /logs/neo4j.log; exec tail -F /logs/neo4j.log'

echo "[verify_restore] Waiting for Bolt"
ready=0
for _ in $(seq 1 180); do
    if err="$(docker exec \
        -e NEO4J_USERNAME="${NEO4J_USER}" \
        -e NEO4J_PASSWORD="${NEO4J_PASSWORD}" \
        -e NEO4J_ADDRESS=bolt://localhost:7687 \
        "${CONTAINER}" \
        /var/lib/neo4j/bin/cypher-shell --non-interactive --format plain 'RETURN 1 AS ok;' 2>&1)"; then
        ready=1
        break
    fi
    if printf '%s\n' "${err}" | grep -qiE 'authentication failure|unauthorized|incorrect authentication'; then
        echo "[verify_restore] Bolt rejected ${NEO4J_USER} credentials" >&2
        printf '%s\n' "${err}" >&2
        docker logs "${CONTAINER}" >&2 || true
        exit 1
    fi
    state="$(docker inspect -f '{{.State.Status}}' "${CONTAINER}" 2>/dev/null || echo missing)"
    if [ "${state}" != "running" ]; then
        echo "[verify_restore] Throwaway container exited (${state})" >&2
        docker logs "${CONTAINER}" >&2 || true
        exit 1
    fi
    sleep 2
done

if [ "${ready}" -ne 1 ]; then
    echo "[verify_restore] Throwaway Neo4j did not become queryable" >&2
    docker logs "${CONTAINER}" >&2 || true
    exit 1
fi

if [ -n "${CANARY}" ]; then
    query='MATCH (c:BackupCanary {token: $token}) RETURN count(c) AS c;'
    out="$(docker exec \
        -e NEO4J_USERNAME="${NEO4J_USER}" \
        -e NEO4J_PASSWORD="${NEO4J_PASSWORD}" \
        -e NEO4J_ADDRESS=bolt://localhost:7687 \
        "${CONTAINER}" \
        /var/lib/neo4j/bin/cypher-shell --non-interactive --format plain \
            -P "{token: '${CANARY}'}" \
            "${query}")"
else
    query='MATCH (n) RETURN count(n) AS c;'
    out="$(docker exec \
        -e NEO4J_USERNAME="${NEO4J_USER}" \
        -e NEO4J_PASSWORD="${NEO4J_PASSWORD}" \
        -e NEO4J_ADDRESS=bolt://localhost:7687 \
        "${CONTAINER}" \
        /var/lib/neo4j/bin/cypher-shell --non-interactive --format plain \
            "${query}")"
fi

echo "[verify_restore] Query output:"
printf '%s\n' "${out}"

count="$(printf '%s\n' "${out}" | tr -d '\r' | awk 'NF && $0 ~ /^[0-9]+$/ {line=$0} END {print line}')"
echo "[verify_restore] Restore query result: ${count}"

if [ -n "${CANARY}" ] && [ "${count}" != "1" ]; then
    echo "[verify_restore] Expected canary count 1, got '${count}'" >&2
    exit 1
fi

echo "[verify_restore] Restore check passed"
