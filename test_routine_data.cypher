// Check if we have any routines
MATCH (r:Goal)
WHERE r.goal_type = 'routine'
RETURN r.name as routine_name, id(r) as routine_id, r.user_id as user_id
LIMIT 10;

// Check if routines have events
MATCH (r:Goal)-[:HAS_EVENT]->(e:Goal)
WHERE r.goal_type = 'routine'
AND e.goal_type = 'event'
RETURN r.name as routine_name, id(r) as routine_id, count(e) as event_count
LIMIT 10;

// Check sample events for routines
MATCH (r:Goal)-[:HAS_EVENT]->(e:Goal)
WHERE r.goal_type = 'routine'
AND e.goal_type = 'event'
RETURN r.name as routine_name, 
       e.name as event_name,
       e.scheduled_timestamp as timestamp,
       e.completed as completed
LIMIT 20; 