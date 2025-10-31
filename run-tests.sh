#!/bin/bash

# Test runner script for Goals app
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🧪 Goals App Test Runner${NC}"
echo ""

# Function to check if port is available
wait_for_port() {
    local port=$1
    local service=$2
    echo -e "${YELLOW}Waiting for $service on port $port...${NC}"
    for i in {1..30}; do
        if nc -z localhost $port 2>/dev/null; then
            echo -e "${GREEN}✓ $service is ready${NC}"
            return 0
        fi
        sleep 2
    done
    echo -e "${RED}✗ $service failed to start on port $port${NC}"
    return 1
}

# Parse command line arguments
SKIP_BACKEND=false
SKIP_FRONTEND=false
KEEP_STACK=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-backend)
            SKIP_BACKEND=true
            shift
            ;;
        --skip-frontend)
            SKIP_FRONTEND=true
            shift
            ;;
        --keep-stack)
            KEEP_STACK=true
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --skip-backend    Skip backend integration tests"
            echo "  --skip-frontend   Skip frontend E2E tests"
            echo "  --keep-stack      Keep docker stack running after tests"
            echo "  --help            Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Start test stack
echo -e "${YELLOW}Starting test stack...${NC}"
docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml up -d --build

# Wait for services
wait_for_port 6060 "Backend API" || exit 1
wait_for_port 3031 "Frontend" || exit 1
wait_for_port 7688 "Neo4j Test DB" || exit 1

echo ""
echo -e "${GREEN}All services are ready!${NC}"
echo ""

# Run backend tests
if [ "$SKIP_BACKEND" = false ]; then
    echo -e "${YELLOW}Running backend integration tests...${NC}"
    cd backend
    export NEO4J_TEST_URI=bolt://localhost:7688
    export NEO4J_TEST_USERNAME=neo4j
    export NEO4J_TEST_PASSWORD=password123
    
    if cargo test --test routine_integration_test -- --nocapture; then
        echo -e "${GREEN}✓ Backend tests passed${NC}"
    else
        echo -e "${RED}✗ Backend tests failed${NC}"
        cd ..
        if [ "$KEEP_STACK" = false ]; then
            docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml down -v
        fi
        exit 1
    fi
    cd ..
    echo ""
fi

# Run frontend tests
if [ "$SKIP_FRONTEND" = false ]; then
    echo -e "${YELLOW}Running frontend E2E tests...${NC}"
    cd frontend
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo "Installing frontend dependencies..."
        npm ci
    fi
    
    # Install Playwright browsers if needed (avoid --with-deps to prevent sudo prompt)
    if [ ! -d "$HOME/.cache/ms-playwright" ]; then
        echo "Installing Playwright browsers..."
        npx playwright install chromium
    fi
    
    export PLAYWRIGHT_BASE_URL=http://localhost:3031
    
    if npx playwright test tests/routine --project=chromium; then
        echo -e "${GREEN}✓ Frontend tests passed${NC}"
    else
        echo -e "${RED}✗ Frontend tests failed${NC}"
        echo "View the report with: npx playwright show-report"
        cd ..
        if [ "$KEEP_STACK" = false ]; then
            docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml down -v
        fi
        exit 1
    fi
    cd ..
    echo ""
fi

# Clean up
if [ "$KEEP_STACK" = false ]; then
    echo -e "${YELLOW}Stopping test stack...${NC}"
    docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml down -v
    echo -e "${GREEN}✓ Test stack stopped${NC}"
else
    echo -e "${YELLOW}Test stack is still running. Stop it with:${NC}"
    echo "docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml down -v"
fi

echo ""
echo -e "${GREEN}🎉 All tests completed successfully!${NC}"

