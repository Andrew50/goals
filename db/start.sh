#!/bin/bash
set -euo pipefail

# Keep path detection consistent with `db/backup.sh`.
NEO4J_HOME="${NEO4J_HOME:-/var/lib/neo4j}"
NEO4J_BIN="${NEO4J_HOME}/bin/neo4j"
if [ ! -x "${NEO4J_BIN}" ] && command -v neo4j >/dev/null 2>&1; then
  NEO4J_BIN="$(command -v neo4j)"
fi

CYPHER_SHELL_BIN="${NEO4J_HOME}/bin/cypher-shell"
if [ ! -x "${CYPHER_SHELL_BIN}" ] && command -v cypher-shell >/dev/null 2>&1; then
  CYPHER_SHELL_BIN="$(command -v cypher-shell)"
fi

NEO4J_USER="${NEO4J_USER:-neo4j}"
NEO4J_PASSWORD="${NEO4J_PASSWORD:-password123}"
NEO4J_BOLT_URI="${NEO4J_BOLT_URI:-bolt://localhost:7687}"

STARTUP_OK=0
cleanup_on_failure() {
  # If we haven't reached the "tail logs" exec, we're exiting due to a startup error.
  if [ "${STARTUP_OK}" -eq 1 ]; then
    return 0
  fi

  echo "[$(date)] Startup failed; attempting best-effort cleanup..." >&2

  if [ -x "${NEO4J_BIN}" ]; then
    "${NEO4J_BIN}" stop >/dev/null 2>&1 || true
  fi

  service cron stop >/dev/null 2>&1 || true
}
trap cleanup_on_failure EXIT

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
if [ -x "${NEO4J_BIN}" ]; then
  "${NEO4J_BIN}" status >/dev/null 2>&1
fi

# Best-effort wait until cypher-shell can connect (covers slow startup / store recovery).
if [ -x "${CYPHER_SHELL_BIN}" ]; then
  for i in {1..60}; do
    if "${CYPHER_SHELL_BIN}" -a "${NEO4J_BOLT_URI}" -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" "RETURN 1;" >/dev/null 2>&1; then
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
STARTUP_OK=1
exec tail -F /logs/neo4j.log
