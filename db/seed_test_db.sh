#!/bin/bash
set -e

# Variables
NEO4J_URI=${NEO4J_URI:-bolt://localhost:7687}
NEO4J_USER=${NEO4J_USER:-neo4j}
NEO4J_PASSWORD=${NEO4J_PASSWORD:-password123}

# Wait for Neo4j to be available
echo "Waiting for Neo4j to be available..."
for i in {1..30}; do
  if /var/lib/neo4j/bin/cypher-shell -a $NEO4J_URI -u $NEO4J_USER -p $NEO4J_PASSWORD "RETURN 1;" &> /dev/null; then
    echo "Neo4j is available!"
    break
  fi
  echo "Waiting for Neo4j... ($i/30)"
  sleep 2
done

# Clear existing data
echo "Clearing existing data..."
/var/lib/neo4j/bin/cypher-shell -a $NEO4J_URI -u $NEO4J_USER -p $NEO4J_PASSWORD "MATCH (n) DETACH DELETE n;"

# Create test user
echo "Creating test user..."
/var/lib/neo4j/bin/cypher-shell -a $NEO4J_URI -u $NEO4J_USER -p $NEO4J_PASSWORD "
CREATE (u:User {
  id: 1,
  username: 'testuser',
  password_hash: '\$2b\$10\$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  created_at: datetime()
})
RETURN u;
"

# Create some test goals
echo "Creating test calendar items..."
/var/lib/neo4j/bin/cypher-shell -a $NEO4J_URI -u $NEO4J_USER -p $NEO4J_PASSWORD "
// Create a few tasks
CREATE (g1:Goal {
  id: 101,
  user_id: 1,
  name: 'Test Task 1',
  goal_type: 'task',
  description: 'This is a test task',
  priority: 'medium',
  duration: 60, // 60 minutes duration - required for tasks
  scheduled_timestamp: null // Unscheduled to satisfy test expectations
})

CREATE (g2:Goal {
  id: 102,
  user_id: 1,
  name: 'Test Task 2',
  goal_type: 'task',
  description: 'This is another test task',
  priority: 'high',
  duration: 30, // 30 minutes duration - required for tasks
  scheduled_timestamp: null // Still unscheduled
})

CREATE (g3:Goal {
  id: 103,
  user_id: 1,
  name: 'Test Routine',
  goal_type: 'routine',
  description: 'This is a test routine',
  priority: 'medium',
  frequency: '1D', // Required for routines to match tests
  start_timestamp: timestamp(), // Required for routines
  routine_time: timestamp(), // Today
  duration: 60 // Duration needed so events inherit duration
})

CREATE (g4:Goal {
  id: 104,
  user_id: 1,
  name: 'Test Achievement',
  goal_type: 'achievement',
  description: 'This is a test achievement',
  priority: 'medium',
  start_timestamp: timestamp() // Required for achievements
})

// Create relationships
CREATE (g1)-[:DEPENDS_ON]->(g2)
CREATE (g4)-[:CHILD]->(g2)

RETURN g1, g2, g3, g4;
"

# Generate events for the test routine to match test expectations
echo "Generating routine events..."
/var/lib/neo4j/bin/cypher-shell -a $NEO4J_URI -u $NEO4J_USER -p $NEO4J_PASSWORD "
// Generate some events for the Test Routine to meet test expectations
MATCH (r:Goal {goal_type: 'routine', name: 'Test Routine'})
WITH r
// Create events for today and tomorrow to meet the >= 2 events expectation
CREATE (e1:Goal {
    name: r.name,
    goal_type: 'event',
    scheduled_timestamp: timestamp(), // Today
    duration: 60, // Fixed duration for tests
    parent_id: id(r),
    parent_type: 'routine',
    routine_instance_id: toString(id(r)) + '-' + toString(timestamp()),
    user_id: r.user_id,
    priority: r.priority,
    description: r.description,
    completed: false,
    is_deleted: false
})
CREATE (e2:Goal {
    name: r.name,
    goal_type: 'event',
    scheduled_timestamp: timestamp() + 86400000, // Tomorrow
    duration: 60, // Fixed duration for tests
    parent_id: id(r),
    parent_type: 'routine',
    routine_instance_id: toString(id(r)) + '-' + toString(timestamp()),
    user_id: r.user_id,
    priority: r.priority,
    description: r.description,
    completed: false,
    is_deleted: false
})
CREATE (r)-[:HAS_EVENT]->(e1)
CREATE (r)-[:HAS_EVENT]->(e2)
RETURN e1.name as event1_name, e2.name as event2_name;
"

echo "Test database seeded successfully!"