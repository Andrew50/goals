#!/bin/bash
set -euo pipefail

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

# Start Neo4j as a daemon so `/scripts/backup.sh` can stop/start it for offline dumps (Neo4j Community).
echo "[$(date)] Starting Neo4j (daemon)..."
/startup/docker-entrypoint.sh neo4j start

# Validate Neo4j actually started (avoid "container looks healthy but DB is down").
if [ -x /var/lib/neo4j/bin/neo4j ]; then
  /var/lib/neo4j/bin/neo4j status >/dev/null 2>&1
fi

# Best-effort wait until cypher-shell can connect (covers slow startup / store recovery).
if [ -x /var/lib/neo4j/bin/cypher-shell ]; then
  for i in {1..60}; do
    if /var/lib/neo4j/bin/cypher-shell -a bolt://localhost:7687 -u neo4j -p "${NEO4J_PASSWORD:-password123}" "RETURN 1;" >/dev/null 2>&1; then
      echo "[$(date)] Neo4j is queryable"
      break
    fi
    if [ "$i" -eq 60 ]; then
      echo "[$(date)] Neo4j did not become queryable in time" >&2
      echo "[$(date)] Last 200 lines of neo4j.log:" >&2
      tail -n 200 /logs/neo4j.log 2>/dev/null >&2 || true
      exit 1
    fi
    sleep 2
  done
fi

# Keep container alive; Neo4j logs are under /logs (and /var/lib/neo4j/logs is a symlink).
echo "[$(date)] Tailing Neo4j logs..."
touch /logs/neo4j.log 2>/dev/null || true
exec tail -F /logs/neo4j.log
