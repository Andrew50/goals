#!/bin/bash

# Docker Compose Environment Manager for Goals App

set -e

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
    free_port 3030
    free_port 5059
}

case "$1" in
    "dev")
        echo "🚀 Starting development environment..."
        preflight
        docker compose -f docker-compose.dev.yaml up -d --remove-orphans
        echo "✅ Development environment running on:"
        echo "   Frontend: http://localhost:3030"
        echo "   Backend: http://localhost:5059"
        echo "   Neo4j: http://localhost:7474"
        echo "📜 Streaming logs (Ctrl-C to stop streaming)..."
        docker compose -f docker-compose.dev.yaml logs -f --tail=50
        ;;
    "test")
        echo "🧪 Starting test environment..."
        preflight
        docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml up -d --remove-orphans
        echo "✅ Test environment running on:"
        echo "   Frontend: http://localhost:3031"
        echo "   Backend: http://localhost:5057"
        echo "   Neo4j: http://localhost:7475"
        echo "   Test DB: http://localhost:7475"
        echo "📜 Streaming test logs (Ctrl-C to stop streaming)..."
        docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml logs -f --tail=50
        ;;
    "logs")
        # Stream logs for dev or test
        if [ "$2" = "test" ]; then
            echo "📜 Streaming test logs (Ctrl-C to stop streaming)..."
            docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml logs -f --tail=50
        else
            echo "📜 Streaming dev logs (Ctrl-C to stop streaming)..."
            docker compose -f docker-compose.dev.yaml logs -f --tail=50
        fi
        ;;
    "down")
        echo "🛑 Shutting down all environments..."
        docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml down --remove-orphans 2>/dev/null || true
        docker compose -f docker-compose.dev.yaml down --remove-orphans 2>/dev/null || true
        echo "✅ All environments stopped"
        ;;
    "clean")
        echo "🧹 Cleaning up orphaned containers..."
        docker compose -f docker-compose.dev.yaml down --remove-orphans 2>/dev/null || true
        docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml down --remove-orphans 2>/dev/null || true
        # Also remove any containers that are binding our dev ports
        preflight
        docker container prune -f
        echo "✅ Cleanup complete"
        ;;
    "status")
        echo "📊 Environment Status:"
        docker compose -f docker-compose.dev.yaml ps 2>/dev/null || echo "   Dev environment: Not running"
        echo ""
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