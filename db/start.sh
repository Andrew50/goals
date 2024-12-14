#!/bin/bash

# Create directories and set permissions before starting services
echo "[$(date)] Setting up cron environment..."
mkdir -p /var/run/cron
touch /var/run/crond.pid
chown root:root /var/run/cron /var/run/crond.pid
chmod 755 /var/run/cron
chmod 644 /var/run/crond.pid

echo "[$(date)] Starting cron service..."
service cron start
if [ $? -ne 0 ]; then
    echo "[$(date)] Failed to start cron service"
    exit 1
fi
echo "[$(date)] Cron service started successfully"

# Start Neo4j
echo "[$(date)] Starting Neo4j..."
# Use the correct path to neo4j entrypoint
exec /startup/docker-entrypoint.sh neo4j
