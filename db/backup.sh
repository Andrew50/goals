#db/backup.sh
#!/bin/bash
BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DUMP_NAME="neo4j_dump_${TIMESTAMP}.dump"

echo "----------------------------------------"
echo "[$(date)] Starting backup process"
echo "[$(date)] Backup directory: ${BACKUP_DIR}"
echo "[$(date)] Dump name: ${DUMP_NAME}"

# Ensure backup directory exists
mkdir -p ${BACKUP_DIR}
echo "[$(date)] Backup directory created/verified"

# List current files in backup directory
echo "[$(date)] Current files in backup directory:"
ls -l ${BACKUP_DIR}

echo "[$(date)] Starting database dump..."
# Use neo4j-admin dump command
neo4j-admin database dump neo4j --to-path=${BACKUP_DIR}/${DUMP_NAME}
if [ $? -eq 0 ]; then
    echo "[$(date)] Database dump completed successfully"
else
    echo "[$(date)] Database dump failed"
    exit 1
fi

echo "[$(date)] Cleaning up old backups..."
# Clean up old backups (older than 7 days)
find ${BACKUP_DIR} -name "neo4j_dump_*.dump" -mtime +7 -delete

echo "[$(date)] Final backup directory contents:"
ls -l ${BACKUP_DIR}
echo "[$(date)] Backup process completed"
echo "----------------------------------------" 