#!/bin/bash

# Set backup directory
BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="neo4j_backup_${TIMESTAMP}"

# Create backup directory if it doesn't exist
mkdir -p ${BACKUP_DIR}

# Use neo4j-admin backup for online backup
neo4j-admin database backup --from-path=/data/databases --to-path=${BACKUP_DIR}/${BACKUP_NAME}

# Compress the backup
cd ${BACKUP_DIR}
tar -czf ${BACKUP_NAME}.tar.gz ${BACKUP_NAME}
rm -rf ${BACKUP_NAME}

# Keep only last 7 days of backups
find ${BACKUP_DIR} -name "neo4j_backup_*.tar.gz" -mtime +7 -delete 