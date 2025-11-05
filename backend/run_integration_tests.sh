#!/bin/bash
set -e

echo "🧪 Running Backend Integration Tests"
echo "===================================="

# Ensure expected test port configuration is in place
TEST_DB_BOLT_PORT=${TEST_DB_BOLT_PORT:-7688}

# Check if test database is running
echo "🔍 Checking test database connectivity..."
if ! docker compose -f ../docker-compose.dev.yaml -f ../docker-compose.test.yaml exec -T goals_db_test /var/lib/neo4j/bin/cypher-shell -a bolt://localhost:${TEST_DB_BOLT_PORT} -u neo4j -p password123 "RETURN 1;" &> /dev/null; then
    echo "❌ Test database not available. Starting it..."
    docker compose -f ../docker-compose.dev.yaml -f ../docker-compose.test.yaml up -d goals_db_test
    
    # Wait for database to be ready
    echo "⏳ Waiting for test database to be ready..."
    for i in {1..30}; do
        if docker compose -f ../docker-compose.dev.yaml -f ../docker-compose.test.yaml exec -T goals_db_test /var/lib/neo4j/bin/cypher-shell -a bolt://localhost:${TEST_DB_BOLT_PORT} -u neo4j -p password123 "RETURN 1;" &> /dev/null; then
            echo "✅ Test database is ready!"
            break
        fi
        echo "⏳ Waiting for test database... ($i/30)"
        sleep 2
    done
else
    echo "✅ Test database is already running"
fi

# Set test environment variables
export NEO4J_TEST_URI="bolt://localhost:${TEST_DB_BOLT_PORT}"
export NEO4J_TEST_USERNAME="neo4j" 
export NEO4J_TEST_PASSWORD="password123"

echo "🧪 Running routine integration tests..."
cargo test --test routine_integration_test -- --ignored --nocapture --test-threads=1

echo "🎉 Integration tests completed!" 