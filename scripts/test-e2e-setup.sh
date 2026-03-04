#!/bin/bash

# Ensure we are in the project root
cd "$(dirname "$0")/.."

set -e

echo "🧪 E2E Test Setup Validation Script"
echo "=================================="

# Check if required files exist
echo "📋 Checking required files..."
required_files=(
    "docker-compose.dev.yaml"
    "docker-compose.test.yaml"
    "db/seed_test_db.sh"
    "frontend/playwright.config.ts"
    "frontend/package.json"
    ".env"
)

for file in "${required_files[@]}"; do
    if [[ -f "$file" ]]; then
        echo "✅ $file exists"
    else
        echo "❌ $file is missing"
        exit 1
    fi
done

# Check if .env has required variables
echo "📋 Checking .env file..."
required_env_vars=(
    "JWT_SECRET"
    "REACT_APP_API_URL"
)

for var in "${required_env_vars[@]}"; do
    if grep -q "^$var=" .env; then
        echo "✅ $var is set in .env"
    else
        echo "⚠️  $var is missing from .env (will use default)"
    fi
done

# Check if frontend dependencies are installed
echo "📋 Checking frontend dependencies..."
if [[ -d "frontend/node_modules" ]]; then
    echo "✅ Frontend node_modules exists"
else
    echo "❌ Frontend dependencies not installed. Run: cd frontend && npm install"
    cd frontend && npm install
fi

# Check if Playwright is installed
echo "📋 Checking Playwright installation..."
if [[ -f "frontend/node_modules/.bin/playwright" ]]; then
    echo "✅ Playwright is installed"
else
    echo "❌ Playwright not found. Installing..."
    cd frontend && npx playwright install --with-deps chromium
    cd ..
fi

# Start test environment
echo "🚀 Starting test environment..."
docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml up -d

# Wait for services
echo "⏳ Waiting for services to start..."
sleep 45

# Test database connection
echo "🔍 Testing database connection..."
max_attempts=30
attempt=1
while [[ $attempt -le $max_attempts ]]; do
    if docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml exec -T goals_db_test /var/lib/neo4j/bin/cypher-shell -a bolt://localhost:7687 -u neo4j -p password123 "RETURN 1;" &> /dev/null; then
        echo "✅ Neo4j test database is ready!"
        break
    fi
    echo "⏳ Waiting for Neo4j test database... ($attempt/$max_attempts)"
    ((attempt++))
    sleep 3
done

if [[ $attempt -gt $max_attempts ]]; then
    echo "❌ Neo4j test database failed to start"
    docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml logs goals_db_test
    exit 1
fi

# Test backend connection
echo "🔍 Testing backend connection..."
if curl --retry 10 --retry-delay 5 --retry-connrefused http://localhost:5057/health &> /dev/null; then
    echo "✅ Backend is responding"
else
    echo "⚠️  Backend health check failed (this might be expected if no health endpoint exists)"
fi

# Seed database
echo "🌱 Seeding test database..."
if docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml exec -T goals_db_test /data/seed_test_db.sh; then
    echo "✅ Test database seeded successfully"
else
    echo "❌ Failed to seed test database"
    exit 1
fi

# Test frontend start
echo "🔍 Testing frontend startup..."
cd frontend
timeout 60s npm start &
FRONTEND_PID=$!
sleep 30

if curl --retry 5 --retry-delay 2 --retry-connrefused http://localhost:3031 &> /dev/null; then
    echo "✅ Frontend is responding"
    kill $FRONTEND_PID 2>/dev/null || true
else
    echo "❌ Frontend failed to start or respond"
    kill $FRONTEND_PID 2>/dev/null || true
    cd ..
    exit 1
fi

cd ..

# Run a simple test to validate
echo "🧪 Running basic Playwright validation..."
cd frontend
timeout 120s npx playwright test --reporter=line --max-failures=1 || {
    echo "⚠️  Some tests failed, but setup appears to be working"
}
cd ..

echo "🎉 E2E test setup validation completed!"
echo ""
echo "To run the full test suite:"
echo "  cd frontend && npx playwright test"
echo ""
echo "To cleanup:"
echo "  docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml down -v" 