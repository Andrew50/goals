#!/bin/bash
set -e

# Configuration
NUM_WORKERS=${NUM_WORKERS:-4}

echo "🧹 Cleaning up parallel test environment with $NUM_WORKERS workers"
echo "======================================================"

# Function to cleanup a worker environment
cleanup_worker() {
    local worker_id=$1
    
    echo "🗑️ Cleaning up worker $worker_id..."
    
    if [[ -f "docker-compose.worker-${worker_id}.yaml" ]]; then
        # Stop and remove containers, networks, and volumes
        docker compose -f docker-compose.worker-${worker_id}.yaml down -v --remove-orphans || echo "⚠️ Failed to cleanup worker $worker_id (may already be stopped)"
        
        # Remove the compose file
        rm -f docker-compose.worker-${worker_id}.yaml
        
        echo "✅ Worker $worker_id cleaned up"
    else
        echo "⚠️ Worker $worker_id compose file not found"
    fi
}

# Cleanup all workers in parallel
echo "🔄 Cleaning up $NUM_WORKERS workers in parallel..."
for worker_id in $(seq 0 $((NUM_WORKERS - 1))); do
    cleanup_worker $worker_id &
done

# Wait for all cleanup to finish
echo "⏳ Waiting for all cleanup to complete..."
wait

# Additional cleanup - remove any dangling resources
echo "🧽 Removing any dangling Docker resources..."
docker system prune -f --volumes || echo "⚠️ Docker system prune failed (may not be necessary)"

echo ""
echo "✅ All workers cleaned up successfully!"
echo "🎉 Parallel test environment cleanup complete!" 