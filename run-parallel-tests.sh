#!/bin/bash
set -e

# Configuration
NUM_WORKERS=${NUM_WORKERS:-4}

echo "🧪 Running E2E tests with $NUM_WORKERS parallel workers"
echo "=================================================="

# Check if parallel test environment is running
echo "🔍 Checking if parallel test environment is running..."

all_workers_ready=true
for worker_id in $(seq 0 $((NUM_WORKERS - 1))); do
    frontend_port=$((3031 + worker_id))
    if ! curl -s http://localhost:$frontend_port > /dev/null; then
        echo "❌ Worker $worker_id frontend (port $frontend_port) is not responding"
        all_workers_ready=false
    else
        echo "✅ Worker $worker_id frontend is ready"
    fi
done

if [ "$all_workers_ready" = false ]; then
    echo ""
    echo "⚠️  Not all workers are ready. Please run:"
    echo "   ./start-parallel-test-env.sh"
    echo ""
    exit 1
fi

echo ""
echo "✅ All workers are ready! Starting tests..."

# Function to run tests for a specific worker
run_worker_tests() {
    local worker_id=$1
    local frontend_port=$((3031 + worker_id))
    local backend_port=$((5057 + worker_id))
    
    echo "🧪 Starting tests for worker $worker_id (Frontend: $frontend_port, Backend: $backend_port)"
    
    cd frontend
    
    # Set environment variables for this worker
    export TEST_WORKER_INDEX=$worker_id
    export PLAYWRIGHT_BASE_URL="http://localhost:$frontend_port"
    export REACT_APP_API_URL="http://localhost:$backend_port"
    
    # Run tests with a single worker to avoid conflicts
    TEST_WORKER_INDEX=$worker_id \
    PLAYWRIGHT_BASE_URL="http://localhost:$frontend_port" \
    REACT_APP_API_URL="http://localhost:$backend_port" \
    npx playwright test \
        --workers=1 \
        --reporter=line \
        --output=test-results-worker-$worker_id \
        2>&1 | sed "s/^/[Worker $worker_id] /"
    
    cd ..
    
    echo "✅ Worker $worker_id tests completed"
}

# Run tests on all workers in parallel
echo "🔄 Running tests on $NUM_WORKERS workers in parallel..."
for worker_id in $(seq 0 $((NUM_WORKERS - 1))); do
    run_worker_tests $worker_id &
done

# Wait for all test runs to complete
echo "⏳ Waiting for all test runs to complete..."
wait

echo ""
echo "🎉 All parallel tests completed!"
echo ""
echo "📊 Test results are available in:"
for worker_id in $(seq 0 $((NUM_WORKERS - 1))); do
    echo "  Worker $worker_id: frontend/test-results-worker-$worker_id/"
done

echo ""
echo "To view combined results, run:"
echo "  npx playwright show-report frontend/test-results-worker-0/" 