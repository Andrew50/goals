#!/bin/bash

# Docker Compose Environment Manager for Goals App

set -e

DEV_BACKEND_PORT=5059
DEV_FRONTEND_PORT=3030
DEV_DB_HTTP_PORT=7474
DEV_DB_BOLT_PORT=7687

TEST_BACKEND_PORT=6060
TEST_FRONTEND_PORT=3031
TEST_DB_HTTP_PORT=7475
TEST_DB_BOLT_PORT=7688

free_port() {
    local port="$1"
    # Find any containers publishing the given port and remove them
    local ids
    ids=$(docker ps -q --filter "publish=$port" || true)
    if [ -n "$ids" ]; then
        echo "⚠️  Detected containers using port $port. Removing: $ids"
        docker rm -f $ids >/dev/null 2>&1 || true
    fi
}

preflight() {
    # Ensure dev ports are free to avoid bind conflicts
    free_port "$DEV_FRONTEND_PORT"
    free_port "$DEV_BACKEND_PORT"
}

preflight_test() {
    free_port "$TEST_FRONTEND_PORT"
    free_port "$TEST_BACKEND_PORT"
    free_port "$TEST_DB_HTTP_PORT"
    free_port "$TEST_DB_BOLT_PORT"
}

case "$1" in
    "dev")
        echo "🚀 Starting development environment..."
        preflight
        GOALS_BACKEND_PORT=$DEV_BACKEND_PORT \
        GOALS_FRONTEND_PORT=$DEV_FRONTEND_PORT \
        GOALS_DB_HTTP_PORT=$DEV_DB_HTTP_PORT \
        GOALS_DB_BOLT_PORT=$DEV_DB_BOLT_PORT \
        docker compose -f docker-compose.dev.yaml up -d --remove-orphans
        echo "✅ Development environment running on:"
        echo "   Frontend: http://localhost:${DEV_FRONTEND_PORT}"
        echo "   Backend: http://localhost:${DEV_BACKEND_PORT}"
        echo "   Neo4j: http://localhost:${DEV_DB_HTTP_PORT}"
        echo "📜 Streaming logs (Ctrl-C to stop streaming)..."
        docker compose -f docker-compose.dev.yaml logs -f --tail=50
        ;;
    "test")
        echo "🧪 Starting test environment..."
        preflight
        preflight_test
        GOALS_BACKEND_PORT=$TEST_BACKEND_PORT \
        GOALS_FRONTEND_PORT=$TEST_FRONTEND_PORT \
        GOALS_DB_HTTP_PORT=$DEV_DB_HTTP_PORT \
        GOALS_DB_BOLT_PORT=$DEV_DB_BOLT_PORT \
        docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml up -d --remove-orphans
        echo "✅ Test environment running on:"
        echo "   Frontend: http://localhost:${TEST_FRONTEND_PORT}"
        echo "   Backend: http://localhost:${TEST_BACKEND_PORT}"
        echo "   Neo4j: http://localhost:${TEST_DB_HTTP_PORT}"
        echo "   Test DB: http://localhost:${TEST_DB_HTTP_PORT}"
        echo "📜 Streaming test logs (Ctrl-C to stop streaming)..."
        docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml logs -f --tail=50
        ;;
    "logs")
        # Stream logs for dev or test
        if [ "$2" = "test" ]; then
            echo "📜 Streaming test logs (Ctrl-C to stop streaming)..."
            GOALS_BACKEND_PORT=$TEST_BACKEND_PORT \
            GOALS_FRONTEND_PORT=$TEST_FRONTEND_PORT \
            GOALS_DB_HTTP_PORT=$DEV_DB_HTTP_PORT \
            GOALS_DB_BOLT_PORT=$DEV_DB_BOLT_PORT \
            docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml logs -f --tail=50
        else
            echo "📜 Streaming dev logs (Ctrl-C to stop streaming)..."
            GOALS_BACKEND_PORT=$DEV_BACKEND_PORT \
            GOALS_FRONTEND_PORT=$DEV_FRONTEND_PORT \
            GOALS_DB_HTTP_PORT=$DEV_DB_HTTP_PORT \
            GOALS_DB_BOLT_PORT=$DEV_DB_BOLT_PORT \
            docker compose -f docker-compose.dev.yaml logs -f --tail=50
        fi
        ;;
    "down")
        echo "🛑 Shutting down all environments..."
        GOALS_BACKEND_PORT=$TEST_BACKEND_PORT \
        GOALS_FRONTEND_PORT=$TEST_FRONTEND_PORT \
        GOALS_DB_HTTP_PORT=$DEV_DB_HTTP_PORT \
        GOALS_DB_BOLT_PORT=$DEV_DB_BOLT_PORT \
        docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml down --remove-orphans 2>/dev/null || true
        GOALS_BACKEND_PORT=$DEV_BACKEND_PORT \
        GOALS_FRONTEND_PORT=$DEV_FRONTEND_PORT \
        GOALS_DB_HTTP_PORT=$DEV_DB_HTTP_PORT \
        GOALS_DB_BOLT_PORT=$DEV_DB_BOLT_PORT \
        docker compose -f docker-compose.dev.yaml down --remove-orphans 2>/dev/null || true
        echo "✅ All environments stopped"
        ;;
    "clean")
        echo "🧹 Cleaning up orphaned containers..."
        GOALS_BACKEND_PORT=$DEV_BACKEND_PORT \
        GOALS_FRONTEND_PORT=$DEV_FRONTEND_PORT \
        GOALS_DB_HTTP_PORT=$DEV_DB_HTTP_PORT \
        GOALS_DB_BOLT_PORT=$DEV_DB_BOLT_PORT \
        docker compose -f docker-compose.dev.yaml down --remove-orphans 2>/dev/null || true
        GOALS_BACKEND_PORT=$TEST_BACKEND_PORT \
        GOALS_FRONTEND_PORT=$TEST_FRONTEND_PORT \
        GOALS_DB_HTTP_PORT=$DEV_DB_HTTP_PORT \
        GOALS_DB_BOLT_PORT=$DEV_DB_BOLT_PORT \
        docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml down --remove-orphans 2>/dev/null || true
        # Also remove any containers that are binding our dev ports
        preflight
        preflight_test
        docker container prune -f
        echo "✅ Cleanup complete"
        ;;
    "status")
        echo "📊 Environment Status:"
        GOALS_BACKEND_PORT=$DEV_BACKEND_PORT \
        GOALS_FRONTEND_PORT=$DEV_FRONTEND_PORT \
        GOALS_DB_HTTP_PORT=$DEV_DB_HTTP_PORT \
        GOALS_DB_BOLT_PORT=$DEV_DB_BOLT_PORT \
        docker compose -f docker-compose.dev.yaml ps 2>/dev/null || echo "   Dev environment: Not running"
        echo ""
        GOALS_BACKEND_PORT=$TEST_BACKEND_PORT \
        GOALS_FRONTEND_PORT=$TEST_FRONTEND_PORT \
        GOALS_DB_HTTP_PORT=$DEV_DB_HTTP_PORT \
        GOALS_DB_BOLT_PORT=$DEV_DB_BOLT_PORT \
        docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml ps 2>/dev/null || echo "   Test environment: Not running"
        ;;
    *)
        echo "🎯 Goals App Environment Manager"
        echo ""
        echo "Usage: $0 {dev|test|down|clean|status}"
        echo ""
        echo "Commands:"
        echo "  dev     - Start development environment"
        echo "  test    - Start test environment"
        echo "  logs    - Stream logs (add 'test' to stream test logs)"
        echo "  down    - Stop all environments"
        echo "  clean   - Clean up orphaned containers"
        echo "  status  - Show current status"
        echo ""
        exit 1
        ;;
esac