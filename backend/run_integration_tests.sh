#!/bin/bash
set -e

echo "🧪 Running Backend Integration Tests"
echo "===================================="

# Check if test database is running
echo "🔍 Checking test database connectivity..."
if ! docker compose -f ../docker-compose.yaml -f ../docker-compose.test.yaml exec -T goals_db_test /var/lib/neo4j/bin/cypher-shell -a bolt://localhost:7687 -u neo4j -p password123 "RETURN 1;" &> /dev/null; then
    echo "❌ Test database not available. Starting it..."
    docker compose -f ../docker-compose.yaml -f ../docker-compose.test.yaml up -d goals_db_test
    
    # Wait for database to be ready
    echo "⏳ Waiting for test database to be ready..."
    for i in {1..30}; do
        if docker compose -f ../docker-compose.yaml -f ../docker-compose.test.yaml exec -T goals_db_test /var/lib/neo4j/bin/cypher-shell -a bolt://localhost:7687 -u neo4j -p password123 "RETURN 1;" &> /dev/null; then
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
export NEO4J_TEST_URI="bolt://localhost:7688"
export NEO4J_TEST_USERNAME="neo4j" 
export NEO4J_TEST_PASSWORD="password123"

echo "🧪 Running routine integration tests..."
cargo test --test routine_integration_test -- --ignored --nocapture --test-threads=1

echo "🎉 Integration tests completed!" 