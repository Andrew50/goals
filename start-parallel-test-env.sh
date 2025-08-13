#!/bin/bash
set -e

# Configuration
NUM_WORKERS=${NUM_WORKERS:-4}
BASE_FRONTEND_PORT=3031
BASE_BACKEND_PORT=5057
BASE_DB_BOLT_PORT=7688
BASE_DB_WEB_PORT=7475

echo "🚀 Starting parallel test environment with $NUM_WORKERS workers"
echo "=================================="

# Create .env file for tests
echo "📋 Creating test .env file..."
cat > .env << EOF
GOALS_CLOUDFLARED_TOKEN=test_token
BACKUP_PATH=/tmp/backups
GOALS_GEMINI_API_KEY=test_api_key
JWT_SECRET=test_jwt_secret
JWT_EXPIRATION=86400
EOF

# Function to start a worker environment
start_worker() {
    local worker_id=$1
    local frontend_port=$((BASE_FRONTEND_PORT + worker_id))
    local backend_port=$((BASE_BACKEND_PORT + worker_id))
    local db_bolt_port=$((BASE_DB_BOLT_PORT + worker_id))
    local db_web_port=$((BASE_DB_WEB_PORT + worker_id))
    
    echo "📦 Starting worker $worker_id (Frontend: $frontend_port, Backend: $backend_port, DB: $db_bolt_port)"
    
    # Create worker-specific compose file
    cat > docker-compose.worker-${worker_id}.yaml << EOF
services:
  goals_backend_worker_${worker_id}:
    image: goals_backend:dev
    ports:
      - "${backend_port}:5059"
    volumes:
      - ./backend/:/usr/src/app
      - /usr/src/app/target
    environment:
      - NEO4J_URI=bolt://goals_db_test_worker_${worker_id}:7687
      - NEO4J_USERNAME=neo4j
      - NEO4J_PASSWORD=password123
      - TEST_MODE=true
      - WORKER_ID=${worker_id}
    env_file:
      - .env
    networks:
      - test_network_worker_${worker_id}
    depends_on:
      - goals_db_test_worker_${worker_id}

  goals_frontend_worker_${worker_id}:
    image: goals_frontend:dev
    ports:
      - "${frontend_port}:3030"
    volumes:
      - ./frontend:/app
      - /app/node_modules
    environment:
      - CHOKIDAR_USEPOLLING=true
      - REACT_APP_API_URL=http://localhost:${backend_port}
      - WORKER_ID=${worker_id}
    env_file:
      - .env
    networks:
      - test_network_worker_${worker_id}
    depends_on:
      - goals_backend_worker_${worker_id}

  goals_db_test_worker_${worker_id}:
    image: goals_db:dev
    ports:
      - "${db_web_port}:7474"
      - "${db_bolt_port}:7687"
    volumes:
      - goal_db_test_worker_${worker_id}:/data
      - ./db/seed_test_db.sh:/data/seed_test_db.sh
    environment:
      - NEO4J_AUTH=neo4j/password123
    networks:
      - test_network_worker_${worker_id}

volumes:
  goal_db_test_worker_${worker_id}:

networks:
  test_network_worker_${worker_id}:
    driver: bridge
EOF

    # Start the worker environment
    docker compose -f docker-compose.worker-${worker_id}.yaml up -d
    
    # Wait for database to be ready
    echo "⏳ Waiting for worker $worker_id database to be ready..."
    for i in {1..30}; do
        if docker compose -f docker-compose.worker-${worker_id}.yaml exec -T goals_db_test_worker_${worker_id} /var/lib/neo4j/bin/cypher-shell -a bolt://localhost:7687 -u neo4j -p password123 "RETURN 1;" &> /dev/null; then
            echo "✅ Worker $worker_id database is ready!"
            break
        fi
        echo "⏳ Waiting for worker $worker_id database... ($i/30)"
        sleep 3
    done
    
    # Seed the database
    echo "🌱 Seeding worker $worker_id database..."
    docker compose -f docker-compose.worker-${worker_id}.yaml exec -T goals_db_test_worker_${worker_id} /data/seed_test_db.sh
    
    # Health check backend
    echo "🔍 Health checking worker $worker_id backend..."
    curl --retry 10 --retry-delay 2 --retry-connrefused http://localhost:${backend_port}/health &> /dev/null || echo "⚠️ Backend health check failed for worker $worker_id"
    
    echo "✅ Worker $worker_id is ready!"
}

# Start all workers in parallel
echo "🔄 Starting $NUM_WORKERS workers in parallel..."
for worker_id in $(seq 0 $((NUM_WORKERS - 1))); do
    start_worker $worker_id &
done

# Wait for all workers to start
echo "⏳ Waiting for all workers to be ready..."
wait

echo ""
echo "🎉 All $NUM_WORKERS workers are ready!"
echo "Workers running on:"
for worker_id in $(seq 0 $((NUM_WORKERS - 1))); do
    frontend_port=$((BASE_FRONTEND_PORT + worker_id))
    backend_port=$((BASE_BACKEND_PORT + worker_id))
    db_bolt_port=$((BASE_DB_BOLT_PORT + worker_id))
    echo "  Worker $worker_id: Frontend http://localhost:$frontend_port, Backend http://localhost:$backend_port, DB bolt://localhost:$db_bolt_port"
done
echo ""
echo "🧪 Run tests with: cd frontend && npm run test:e2e:parallel" 