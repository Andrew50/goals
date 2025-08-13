#!/bin/bash
# db/backup.sh
set -euo pipefail

BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FINAL_DUMP="${BACKUP_DIR}/neo4j_dump_${TIMESTAMP}.dump"
TMP_DIR="${BACKUP_DIR}/tmp_${TIMESTAMP}"

echo "----------------------------------------"
echo "[$(date)] Starting backup process"
echo "[$(date)] Backup directory: ${BACKUP_DIR}"
echo "[$(date)] Final dump path: ${FINAL_DUMP}"

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"
echo "[$(date)] Backup directory created/verified"

# List current files in backup directory
echo "[$(date)] Current files in backup directory:"
ls -l "${BACKUP_DIR}" || true

echo "[$(date)] Creating temporary dump directory: ${TMP_DIR}"
mkdir -p "${TMP_DIR}"

echo "[$(date)] Starting database dump to temporary directory..."
# In Neo4j 5, --to-path must be a directory. The dump file will be named neo4j.dump inside that directory.
if neo4j-admin database dump neo4j --to-path="${TMP_DIR}" --overwrite-destination; then
    echo "[$(date)] Database dump completed successfully"
else
    echo "[$(date)] Database dump failed"
    rm -rf "${TMP_DIR}"
    exit 1
fi

# Move and timestamp the dump file
if [ -f "${TMP_DIR}/neo4j.dump" ]; then
    if [ -e "${FINAL_DUMP}" ]; then
        echo "[$(date)] Warning: ${FINAL_DUMP} already exists; appending a suffix to avoid overwrite"
        FINAL_DUMP="${FINAL_DUMP%.dump}_dup_$$.dump"
    fi
    mv "${TMP_DIR}/neo4j.dump" "${FINAL_DUMP}"
    echo "[$(date)] Moved dump to ${FINAL_DUMP}"
else
    echo "[$(date)] Expected dump file not found at ${TMP_DIR}/neo4j.dump"
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