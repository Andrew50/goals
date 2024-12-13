#!/bin/bash

echo "[$(date)] Setting up cron environment..."
mkdir -p /var/run/cron
touch /var/run/crond.pid
chown root:root /var/run/cron /var/run/crond.pid
chmod 755 /var/run/cron
chmod 644 /var/run/crond.pid

echo "[$(date)] Starting cron service..."
service cron start
if [ $? -eq 0 ]; then
    echo "[$(date)] Cron service started successfully"
else
    echo "[$(date)] Failed to start cron service - exiting"
    exit 1
fi
