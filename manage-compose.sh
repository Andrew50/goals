#!/bin/bash

# Docker Compose Environment Manager for Goals App

set -e

case "$1" in
    "dev")
        echo "🚀 Starting development environment..."
        docker compose -f docker-compose.dev.yaml up -d --remove-orphans
        echo "✅ Development environment running on:"
        echo "   Frontend: http://localhost:3030"
        echo "   Backend: http://localhost:5059"
        echo "   Neo4j: http://localhost:7474"
        ;;
    "test")
        echo "🧪 Starting test environment..."
        docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml up -d --remove-orphans
        echo "✅ Test environment running on:"
        echo "   Frontend: http://localhost:3031"
        echo "   Backend: http://localhost:5057"
        echo "   Neo4j: http://localhost:7475"
        echo "   Test DB: http://localhost:7475"
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
        echo "  down    - Stop all environments"
        echo "  clean   - Clean up orphaned containers"
        echo "  status  - Show current status"
        echo ""
        exit 1
        ;;
esac 