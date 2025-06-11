use crate::tools::goal::Goal;
use chrono::Utc;
use neo4rs::{query, Graph};

// Migration state tracking
#[derive(Debug)]
pub struct MigrationState {
    pub created_events: Vec<i64>,
    #[allow(dead_code)]
    pub deleted_relationships: Vec<(i64, i64)>,
    pub modified_tasks: Vec<i64>,
    pub created_indexes: Vec<String>,
}

impl Default for MigrationState {
    fn default() -> Self {
        Self::new()
    }
}

impl MigrationState {
    pub fn new() -> Self {
        Self {
            created_events: Vec::new(),
            deleted_relationships: Vec::new(),
            modified_tasks: Vec::new(),
            created_indexes: Vec::new(),
        }
    }
}

pub async fn migrate_to_events(graph: &Graph) -> Result<(), String> {
    println!("Starting migration to event-based system...");

    // Check if migration has already been run
    if check_migration_already_run(graph).await? {
        return Err(
            "Migration has already been completed. Use --force to override this check.".to_string(),
        );
    }

    let mut migration_state = MigrationState::new();

    // Step 0: Clean up any existing events and relationships from previous migration attempts
    cleanup_existing_events(graph).await?;

    // Step 1: Create necessary indexes for performance FIRST
    create_performance_indexes(graph, &mut migration_state).await?;

    // Step 2: Validate existing data before migration
    validate_pre_migration_data(graph).await?;

    // Step 3: Migrate tasks that are children of routines to events
    migrate_routine_child_tasks(graph, &mut migration_state).await?;

    // Step 4: Migrate standalone scheduled tasks to events
    migrate_scheduled_tasks(graph, &mut migration_state).await?;

    // Step 5: Migrate remaining standalone tasks to events (if they should be schedulable)
    migrate_remaining_tasks(graph, &mut migration_state).await?;

    // Step 6: Handle existing CHILD relationships properly
    migrate_existing_child_relationships(graph, &mut migration_state).await?;

    // Step 7: Generate initial routine events (for future occurrences)
    generate_routine_events(graph, &mut migration_state).await?;

    // Step 8: Update relationships and clean up orphaned data
    update_relationships(graph, &mut migration_state).await?;

    // Step 9: Create EventMove tracking infrastructure
    create_event_move_tracking(graph, &mut migration_state).await?;

    // Step 10: Add bidirectional completion logic
    add_bidirectional_completion_logic(graph).await?;

    // Step 11: Validate post-migration data integrity
    validate_post_migration_data(graph).await?;

    // Step 12: Mark migration as completed
    mark_migration_completed(graph).await?;

    println!("Migration completed successfully!");
    println!("Migration summary:");
    println!(
        "  - Created {} events",
        migration_state.created_events.len()
    );
    println!(
        "  - Modified {} tasks",
        migration_state.modified_tasks.len()
    );
    println!(
        "  - Created {} indexes",
        migration_state.created_indexes.len()
    );

    Ok(())
}

// Force migration that bypasses the status check
pub async fn migrate_to_events_force(graph: &Graph) -> Result<(), String> {
    println!("Starting FORCED migration to event-based system...");
    println!("⚠️ Bypassing migration status check as requested");

    let mut migration_state = MigrationState::new();

    // Step 0: Clean up any existing events and relationships from previous migration attempts
    cleanup_existing_events(graph).await?;

    // Step 1: Create necessary indexes for performance FIRST
    create_performance_indexes(graph, &mut migration_state).await?;

    // Step 2: Validate existing data before migration
    validate_pre_migration_data(graph).await?;

    // Step 3: Migrate tasks that are children of routines to events
    migrate_routine_child_tasks(graph, &mut migration_state).await?;

    // Step 4: Migrate standalone scheduled tasks to events
    migrate_scheduled_tasks(graph, &mut migration_state).await?;

    // Step 5: Migrate remaining standalone tasks to events (if they should be schedulable)
    migrate_remaining_tasks(graph, &mut migration_state).await?;

    // Step 6: Handle existing CHILD relationships properly
    migrate_existing_child_relationships(graph, &mut migration_state).await?;

    // Step 7: Generate initial routine events (for future occurrences)
    generate_routine_events(graph, &mut migration_state).await?;

    // Step 8: Update relationships and clean up orphaned data
    update_relationships(graph, &mut migration_state).await?;

    // Step 9: Create EventMove tracking infrastructure
    create_event_move_tracking(graph, &mut migration_state).await?;

    // Step 10: Add bidirectional completion logic
    add_bidirectional_completion_logic(graph).await?;

    // Step 11: Validate post-migration data integrity
    validate_post_migration_data(graph).await?;

    // Step 12: Mark migration as completed
    mark_migration_completed(graph).await?;

    println!("FORCED migration completed successfully!");
    println!("Migration summary:");
    println!(
        "  - Created {} events",
        migration_state.created_events.len()
    );
    println!(
        "  - Modified {} tasks",
        migration_state.modified_tasks.len()
    );
    println!(
        "  - Created {} indexes",
        migration_state.created_indexes.len()
    );

    Ok(())
}

async fn check_migration_already_run(graph: &Graph) -> Result<bool, String> {
    println!("Checking if migration has already been run...");

    let check_query = "
        MATCH (m:MigrationStatus {migration_name: 'event_system_migration'})
        WHERE m.completed = true
        RETURN count(m) as migration_count, m.completed_at as completed_at
    ";

    let mut result = graph
        .execute(query(check_query))
        .await
        .map_err(|e| format!("Failed to check migration status: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let migration_count: i64 = row.get("migration_count").unwrap_or(0);
        if migration_count > 0 {
            let completed_at: Option<i64> = row.get("completed_at").ok();
            if let Some(timestamp) = completed_at {
                let datetime = chrono::DateTime::from_timestamp(timestamp / 1000, 0)
                    .unwrap_or_else(chrono::Utc::now);
                println!(
                    "Migration was already completed on: {}",
                    datetime.format("%Y-%m-%d %H:%M:%S UTC")
                );
            }
            return Ok(true);
        }
    }

    println!("No previous migration found, proceeding...");
    Ok(false)
}

async fn mark_migration_completed(graph: &Graph) -> Result<(), String> {
    println!("Marking migration as completed...");

    let completed_timestamp = chrono::Utc::now().timestamp_millis();

    let mark_query = query(
        "MERGE (m:MigrationStatus {migration_name: 'event_system_migration'})
         SET m.completed = true,
             m.completed_at = $timestamp,
             m.version = '1.0.0'
         RETURN m.migration_name as name",
    )
    .param("timestamp", completed_timestamp);

    let mut result = graph
        .execute(mark_query)
        .await
        .map_err(|e| format!("Failed to mark migration as completed: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let name: String = row.get("name").unwrap_or_default();
        println!(
            "Migration '{}' marked as completed at timestamp {}",
            name, completed_timestamp
        );
    }

    Ok(())
}

// Function to force reset migration status (for development/testing)
#[allow(dead_code)]
pub async fn reset_migration_status(graph: &Graph) -> Result<(), String> {
    println!("Resetting migration status...");

    let reset_query = "
        MATCH (m:MigrationStatus {migration_name: 'event_system_migration'})
        DELETE m
        RETURN count(m) as deleted_count
    ";

    let mut result = graph
        .execute(query(reset_query))
        .await
        .map_err(|e| format!("Failed to reset migration status: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let deleted_count: i64 = row.get("deleted_count").unwrap_or(0);
        println!("Deleted {} migration status records", deleted_count);
    }

    Ok(())
}

async fn cleanup_existing_events(graph: &Graph) -> Result<(), String> {
    println!("Cleaning up existing events from previous migration attempts...");

    // Remove all existing events and their relationships, but preserve MigrationStatus nodes
    let cleanup_query = "
        MATCH (e:Goal {goal_type: 'event'})
        DETACH DELETE e
        RETURN count(e) as deleted_count
    ";

    let mut result = graph
        .execute(query(cleanup_query))
        .await
        .map_err(|e| format!("Failed to cleanup existing events: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let deleted_count: i64 = row.get("deleted_count").unwrap_or(0);
        if deleted_count > 0 {
            println!("Cleaned up {} existing events", deleted_count);
        }
    }

    // Also remove any orphaned HAS_EVENT relationships, but not relationships to MigrationStatus
    let cleanup_relationships_query = "
        MATCH ()-[r:HAS_EVENT]->()
        DELETE r
        RETURN count(r) as deleted_relationships
    ";

    let mut result = graph
        .execute(query(cleanup_relationships_query))
        .await
        .map_err(|e| format!("Failed to cleanup HAS_EVENT relationships: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let deleted_count: i64 = row.get("deleted_relationships").unwrap_or(0);
        if deleted_count > 0 {
            println!(
                "Cleaned up {} orphaned HAS_EVENT relationships",
                deleted_count
            );
        }
    }

    println!("Cleanup completed (MigrationStatus preserved)");
    Ok(())
}

async fn create_performance_indexes(
    graph: &Graph,
    state: &mut MigrationState,
) -> Result<(), String> {
    println!("Creating performance indexes...");

    let indexes = vec![
        // Primary event query indexes
        ("goal_type_scheduled_idx", "CREATE INDEX goal_type_scheduled_idx IF NOT EXISTS FOR (g:Goal) ON (g.goal_type, g.scheduled_timestamp)"),
        ("parent_relationship_idx", "CREATE INDEX parent_relationship_idx IF NOT EXISTS FOR (g:Goal) ON (g.parent_id, g.parent_type)"),
        ("routine_instance_idx", "CREATE INDEX routine_instance_idx IF NOT EXISTS FOR (g:Goal) ON (g.routine_instance_id)"),
        ("user_goal_type_idx", "CREATE INDEX user_goal_type_idx IF NOT EXISTS FOR (g:Goal) ON (g.user_id, g.goal_type)"),
        ("event_completion_idx", "CREATE INDEX event_completion_idx IF NOT EXISTS FOR (g:Goal) ON (g.goal_type, g.completed, g.is_deleted)"),
        ("task_date_range_idx", "CREATE INDEX task_date_range_idx IF NOT EXISTS FOR (g:Goal) ON (g.goal_type, g.start_timestamp, g.end_timestamp)"),
        ("calendar_query_idx", "CREATE INDEX calendar_query_idx IF NOT EXISTS FOR (g:Goal) ON (g.user_id, g.goal_type, g.scheduled_timestamp, g.is_deleted)"),
        // EventMove tracking index (moved here for proper ordering)
        ("event_move_user_time", "CREATE INDEX event_move_user_time IF NOT EXISTS FOR (em:EventMove) ON (em.user_id, em.move_timestamp)"),
    ];

    for (name, index_query) in indexes {
        graph
            .run(neo4rs::query(index_query))
            .await
            .map_err(|e| format!("Failed to create index {}: {}", name, e))?;

        state.created_indexes.push(name.to_string());
        println!("  ✓ Created index: {}", name);
    }

    println!("Performance indexes created successfully");
    Ok(())
}

async fn validate_pre_migration_data(graph: &Graph) -> Result<(), String> {
    println!("Validating pre-migration data...");

    // Check for tasks with invalid scheduled_timestamp values
    let invalid_tasks_query = "
        MATCH (t:Goal)
        WHERE t.goal_type = 'task'
        AND t.scheduled_timestamp IS NOT NULL
        AND (t.scheduled_timestamp < 0 OR t.scheduled_timestamp > 32503680000000)  // Year 3000
        RETURN count(t) as invalid_count
    ";

    let mut result = graph
        .execute(query(invalid_tasks_query))
        .await
        .map_err(|e| format!("Failed to validate tasks: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let invalid_count: i64 = row.get("invalid_count").unwrap_or(0);
        if invalid_count > 0 {
            return Err(format!("Found {} tasks with invalid scheduled_timestamp values. Please fix these before migration.", invalid_count));
        }
    }

    // Check for routines missing required fields
    let invalid_routines_query = "
        MATCH (r:Goal)
        WHERE r.goal_type = 'routine'
        AND (r.frequency IS NULL OR r.start_timestamp IS NULL)
        RETURN count(r) as invalid_count
    ";

    let mut result = graph
        .execute(query(invalid_routines_query))
        .await
        .map_err(|e| format!("Failed to validate routines: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let invalid_count: i64 = row.get("invalid_count").unwrap_or(0);
        if invalid_count > 0 {
            return Err(format!("Found {} routines missing frequency or start_timestamp. Please fix these before migration.", invalid_count));
        }
    }

    println!("Pre-migration validation passed");
    Ok(())
}

async fn migrate_routine_child_tasks(
    graph: &Graph,
    state: &mut MigrationState,
) -> Result<(), String> {
    println!("Migrating routine child tasks to events...");

    let query_str = "
        MATCH (r:Goal)-[:CHILD]->(t:Goal)
        WHERE r.goal_type = 'routine' 
        AND t.goal_type = 'task'
        AND coalesce(t.is_deleted, false) <> true
        WITH r, t
        // Validate against task date ranges if they exist
        OPTIONAL MATCH (parent_task:Goal)-[:CHILD]->(t)
        WHERE parent_task.goal_type = 'task'
        AND (parent_task.start_timestamp IS NOT NULL OR parent_task.end_timestamp IS NOT NULL)
        WITH r, t, parent_task,
             coalesce(t.scheduled_timestamp, t.start_timestamp, r.start_timestamp) as event_timestamp
        WHERE parent_task IS NULL OR (
            (parent_task.start_timestamp IS NULL OR event_timestamp >= parent_task.start_timestamp) AND
            (parent_task.end_timestamp IS NULL OR event_timestamp <= parent_task.end_timestamp)
        )
        CREATE (e:Goal {
            name: t.name,
            goal_type: 'event',
            scheduled_timestamp: event_timestamp,
            duration: t.duration,
            completed: coalesce(t.completed, false),
            parent_id: id(r),
            parent_type: 'routine',
            user_id: t.user_id,
            priority: t.priority,
            description: t.description,
            is_deleted: false,
            routine_instance_id: toString(id(r)) + '-' + toString(timestamp())
        })
        CREATE (r)-[:HAS_EVENT]->(e)
        WITH r, t, e
        MATCH (r)-[old_rel:CHILD]->(t)
        DELETE old_rel
        SET t.is_deleted = true,
            t.scheduled_timestamp = null,
            t.duration = null,
            t.completion_date = null,
            t.next_timestamp = null
        RETURN id(e) as event_id, id(t) as task_id, count(e) as migrated_count
    ";

    let mut result = graph
        .execute(query(query_str))
        .await
        .map_err(|e| format!("Failed to migrate routine child tasks: {}", e))?;

    let mut count = 0;
    while let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let event_id: i64 = row.get("event_id").unwrap_or(0);
        let task_id: i64 = row.get("task_id").unwrap_or(0);

        state.created_events.push(event_id);
        state.modified_tasks.push(task_id);
        count += 1;
    }

    println!("Migrated {} routine child tasks to events", count);
    Ok(())
}

async fn migrate_scheduled_tasks(graph: &Graph, state: &mut MigrationState) -> Result<(), String> {
    println!("Migrating standalone scheduled tasks to events...");

    let query_str = "
        MATCH (t:Goal)
        WHERE t.goal_type = 'task' 
        AND t.scheduled_timestamp IS NOT NULL
        AND NOT EXISTS {
            MATCH (r:Goal {goal_type: 'routine'})-[:CHILD]->(t)
        }
        AND coalesce(t.is_deleted, false) <> true
        WITH t,
             // Validate against task date range
             CASE 
                WHEN t.start_timestamp IS NOT NULL AND t.scheduled_timestamp < t.start_timestamp THEN false
                WHEN t.end_timestamp IS NOT NULL AND t.scheduled_timestamp > t.end_timestamp THEN false
                ELSE true
             END as is_valid_timestamp
        WHERE is_valid_timestamp = true
        CREATE (e:Goal {
            name: t.name,
            goal_type: 'event',
            scheduled_timestamp: t.scheduled_timestamp,
            duration: coalesce(t.duration, 60),  // Default to 60 minutes if no duration
            completed: coalesce(t.completed, false),
            parent_id: id(t),
            parent_type: 'task',
            user_id: t.user_id,
            priority: t.priority,
            description: t.description,
            is_deleted: false
        })
        CREATE (t)-[:HAS_EVENT]->(e)
        SET t.completed = false,  // Reset task completion - events handle completion now
            t.scheduled_timestamp = null,
            t.duration = null,
            t.completion_date = null,
            t.next_timestamp = null
        RETURN id(e) as event_id, id(t) as task_id, count(e) as migrated_count
    ";

    let mut result = graph
        .execute(query(query_str))
        .await
        .map_err(|e| format!("Failed to migrate scheduled tasks: {}", e))?;

    let mut count = 0;
    while let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let event_id: i64 = row.get("event_id").unwrap_or(0);
        let task_id: i64 = row.get("task_id").unwrap_or(0);

        state.created_events.push(event_id);
        state.modified_tasks.push(task_id);
        count += 1;
    }

    // Handle tasks with invalid timestamps separately
    let invalid_tasks_query = "
        MATCH (t:Goal)
        WHERE t.goal_type = 'task' 
        AND t.scheduled_timestamp IS NOT NULL
        AND NOT EXISTS {
            MATCH (r:Goal {goal_type: 'routine'})-[:CHILD]->(t)
        }
        AND coalesce(t.is_deleted, false) <> true
        WITH t,
             CASE 
                WHEN t.start_timestamp IS NOT NULL AND t.scheduled_timestamp < t.start_timestamp THEN 'before_start'
                WHEN t.end_timestamp IS NOT NULL AND t.scheduled_timestamp > t.end_timestamp THEN 'after_end'
                ELSE 'valid'
             END as validation_status
        WHERE validation_status <> 'valid'
        SET t.scheduled_timestamp = null  // Clear invalid scheduled timestamps
        RETURN count(t) as invalid_count, collect(t.name) as invalid_names
    ";

    let mut invalid_result = graph
        .execute(query(invalid_tasks_query))
        .await
        .map_err(|e| format!("Failed to check invalid tasks: {}", e))?;

    if let Some(row) = invalid_result.next().await.map_err(|e| e.to_string())? {
        let invalid_count: i64 = row.get("invalid_count").unwrap_or(0);
        if invalid_count > 0 {
            let invalid_names: Vec<String> = row.get("invalid_names").unwrap_or_default();
            println!(
                "Cleared scheduled timestamps for {} tasks with invalid date ranges: {:?}",
                invalid_count, invalid_names
            );
        }
    }

    println!("Migrated {} standalone scheduled tasks to events", count);
    Ok(())
}

async fn migrate_remaining_tasks(graph: &Graph, state: &mut MigrationState) -> Result<(), String> {
    println!("Migrating remaining standalone tasks to events...");

    let query_str = "
        MATCH (t:Goal)
        WHERE t.goal_type = 'task' 
        AND t.scheduled_timestamp IS NULL
        AND NOT EXISTS {
            MATCH (r:Goal {goal_type: 'routine'})-[:CHILD]->(t)
        }
        AND NOT EXISTS((t)-[:HAS_EVENT]->(:Goal))  // Don't already have events
        AND coalesce(t.completed, false) <> true
        AND coalesce(t.is_deleted, false) <> true
        CREATE (e:Goal {
            name: t.name,
            goal_type: 'event',
            scheduled_timestamp: null,  // Will be scheduled later by user
            duration: coalesce(t.duration, 30),  // Default 30 minutes if no duration
            completed: false,
            parent_id: id(t),
            parent_type: 'task',
            user_id: t.user_id,
            priority: t.priority,
            description: t.description,
            is_deleted: false
        })
        CREATE (t)-[:HAS_EVENT]->(e)
        SET t.duration = null,  // Remove duration from task as it's now on the event
            t.completion_date = null,
            t.next_timestamp = null
        RETURN id(e) as event_id, id(t) as task_id, count(e) as migrated_count
    ";

    let mut result = graph
        .execute(query(query_str))
        .await
        .map_err(|e| format!("Failed to migrate remaining tasks: {}", e))?;

    let mut count = 0;
    while let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let event_id: i64 = row.get("event_id").unwrap_or(0);
        let task_id: i64 = row.get("task_id").unwrap_or(0);

        state.created_events.push(event_id);
        state.modified_tasks.push(task_id);
        count += 1;
    }

    println!("Migrated {} remaining tasks to events", count);
    Ok(())
}

async fn migrate_existing_child_relationships(
    graph: &Graph,
    _state: &mut MigrationState,
) -> Result<(), String> {
    println!("Migrating existing CHILD relationships...");

    // Handle CHILD relationships between tasks and projects/directives
    let query_str = "
        MATCH (parent:Goal)-[rel:CHILD]->(child:Goal)
        WHERE parent.goal_type IN ['project', 'directive', 'achievement']
        AND child.goal_type = 'task'
        AND coalesce(child.is_deleted, false) <> true
        // Preserve these relationships as they are still valid
        RETURN count(rel) as preserved_count
    ";

    let mut result = graph
        .execute(query(query_str))
        .await
        .map_err(|e| format!("Failed to check child relationships: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let preserved_count: i64 = row.get("preserved_count").unwrap_or(0);
        println!(
            "Preserved {} existing CHILD relationships between tasks and higher-level goals",
            preserved_count
        );
    }

    Ok(())
}

async fn generate_routine_events(graph: &Graph, state: &mut MigrationState) -> Result<(), String> {
    println!("Generating routine events...");

    // Generate 3 months of events for each routine
    let three_months_ms = 90 * 24 * 60 * 60 * 1000;
    let now = chrono::Utc::now().timestamp_millis();
    let end_time = now + three_months_ms;

    let query_str = "
        MATCH (r:Goal)
        WHERE r.goal_type = 'routine'
        AND r.start_timestamp IS NOT NULL
        AND r.frequency IS NOT NULL
        AND coalesce(r.is_deleted, false) <> true
        RETURN r, id(r) as routine_id
    ";

    let mut result = graph
        .execute(query(query_str))
        .await
        .map_err(|e| format!("Failed to fetch routines: {}", e))?;

    let mut routine_count = 0;
    while let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let routine: Goal = row
            .get("r")
            .map_err(|e| format!("Failed to get routine: {}", e))?;
        let routine_id: i64 = row
            .get("routine_id")
            .map_err(|e| format!("Failed to get routine_id: {}", e))?;

        // Use standardized routine event generation logic
        let created_events =
            create_routine_events_in_db(graph, &routine, routine_id, now, end_time).await?;
        state.created_events.extend(created_events);
        routine_count += 1;
    }

    println!("Generated events for {} routines", routine_count);
    Ok(())
}

async fn create_routine_events_in_db(
    graph: &Graph,
    routine: &Goal,
    routine_id: i64,
    start_time: i64,
    end_time: i64,
) -> Result<Vec<i64>, String> {
    let frequency = routine
        .frequency
        .as_ref()
        .ok_or("Routine missing frequency")?;

    // Standardized instance ID format to match runtime generation
    let instance_id = format!("{}-{}", routine_id, Utc::now().timestamp_millis());

    let mut current_time = routine.start_timestamp.unwrap_or(start_time);
    let mut event_count = 0;
    let mut created_event_ids = Vec::new();

    while current_time <= end_time {
        // Skip if in the past
        if current_time >= start_time {
            let create_query = query(
                "MATCH (r:Goal)
                 WHERE id(r) = $routine_id
                 CREATE (e:Goal {
                     name: r.name,
                     goal_type: 'event',
                     scheduled_timestamp: $timestamp,
                     duration: r.duration,
                     parent_id: $routine_id,
                     parent_type: 'routine',
                     routine_instance_id: $instance_id,
                     user_id: r.user_id,
                     priority: r.priority,
                     description: r.description,
                     completed: false,
                     is_deleted: false
                 })
                 CREATE (r)-[:HAS_EVENT]->(e)
                 RETURN id(e) as event_id",
            )
            .param("routine_id", routine_id)
            .param("timestamp", current_time)
            .param("instance_id", instance_id.clone());

            let mut result = graph
                .execute(create_query)
                .await
                .map_err(|e| format!("Failed to create routine event: {}", e))?;

            if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
                let event_id: i64 = row.get("event_id").unwrap_or(0);
                created_event_ids.push(event_id);
            }

            event_count += 1;
        }

        // Calculate next occurrence based on frequency
        current_time = calculate_next_occurrence(current_time, frequency)?;
    }

    println!(
        "Created {} events for routine {}",
        event_count, routine.name
    );
    Ok(created_event_ids)
}

fn calculate_next_occurrence(current_time: i64, frequency: &str) -> Result<i64, String> {
    // Parse frequency and calculate next occurrence
    let ms_per_day = 24 * 60 * 60 * 1000;

    let next_time = match frequency.to_lowercase().as_str() {
        "daily" => current_time + ms_per_day,
        "weekly" => current_time + (7 * ms_per_day),
        "monthly" => {
            // Simplified monthly calculation - add 30 days
            current_time + (30 * ms_per_day)
        }
        _ => {
            // Try to parse custom frequency like "every 2 days" or "1D", "2W", etc.
            if frequency.starts_with("every ") {
                let parts: Vec<&str> = frequency.split_whitespace().collect();
                if parts.len() >= 3 {
                    let number = parts[1]
                        .parse::<i64>()
                        .map_err(|_| format!("Invalid frequency number: {}", parts[1]))?;

                    match parts[2] {
                        "day" | "days" => current_time + (number * ms_per_day),
                        "week" | "weeks" => current_time + (number * 7 * ms_per_day),
                        _ => return Err(format!("Unknown frequency unit: {}", parts[2])),
                    }
                } else {
                    return Err(format!("Invalid frequency format: {}", frequency));
                }
            } else if frequency.ends_with('D') || frequency.ends_with('d')
            {
                // Handle formats like "1D", "2d", etc.
                let number_str = &frequency[..frequency.len() - 1];
                let number = number_str
                    .parse::<i64>()
                    .map_err(|_| format!("Invalid frequency number: {}", number_str))?;
                current_time + (number * ms_per_day)
            } else if frequency.ends_with('W') || frequency.ends_with('w')
            {
                // Handle formats like "1W", "2w", etc.
                let number_str = &frequency[..frequency.len() - 1];
                let number = number_str
                    .parse::<i64>()
                    .map_err(|_| format!("Invalid frequency number: {}", number_str))?;
                current_time + (number * 7 * ms_per_day)
            } else if frequency.ends_with('M') || frequency.ends_with('m')
            {
                // Handle formats like "1M", "2m", etc.
                let number_str = &frequency[..frequency.len() - 1];
                let number = number_str
                    .parse::<i64>()
                    .map_err(|_| format!("Invalid frequency number: {}", number_str))?;
                current_time + (number * 30 * ms_per_day) // Simplified monthly calculation
            } else {
                return Err(format!("Unknown frequency: {}", frequency));
            }
        }
    };

    Ok(next_time)
}

async fn update_relationships(graph: &Graph, _state: &mut MigrationState) -> Result<(), String> {
    println!("Updating relationships and cleaning up orphaned data...");

    // Clean up any orphaned CHILD relationships that should have been removed
    let cleanup_query = "
        MATCH (r:Goal)-[rel:CHILD]->(t:Goal)
        WHERE r.goal_type = 'routine' 
        AND t.goal_type = 'task'
        AND t.is_deleted = true
        DELETE rel
        RETURN count(rel) as cleaned_count
    ";

    let mut result = graph
        .execute(query(cleanup_query))
        .await
        .map_err(|e| format!("Failed to clean up orphaned relationships: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let cleaned_count: i64 = row.get("cleaned_count").unwrap_or(0);
        if cleaned_count > 0 {
            println!("Cleaned up {} orphaned CHILD relationships", cleaned_count);
        }
    }

    // Ensure consistency in soft delete flags
    let consistency_query = "
        MATCH (e:Goal)
        WHERE e.goal_type = 'event'
        AND e.is_deleted IS NULL
        SET e.is_deleted = false
        RETURN count(e) as updated_count
    ";

    let mut result = graph
        .execute(query(consistency_query))
        .await
        .map_err(|e| format!("Failed to update consistency flags: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let updated_count: i64 = row.get("updated_count").unwrap_or(0);
        if updated_count > 0 {
            println!(
                "Updated {} events with missing is_deleted flags",
                updated_count
            );
        }
    }

    Ok(())
}

async fn create_event_move_tracking(
    graph: &Graph,
    _state: &mut MigrationState,
) -> Result<(), String> {
    println!("Creating EventMove tracking infrastructure...");

    // Note: Index was already created in create_performance_indexes
    // Just verify it exists
    let verify_query = "
        SHOW INDEXES
        YIELD name, labelsOrTypes, properties
        WHERE name = 'event_move_user_time'
        RETURN count(*) as index_exists
    ";

    match graph.execute(query(verify_query)).await {
        Ok(mut result) => {
            if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
                let index_exists: i64 = row.get("index_exists").unwrap_or(0);
                if index_exists > 0 {
                    println!("EventMove tracking index verified");
                } else {
                    println!("Warning: EventMove index may not have been created properly");
                }
            }
        }
        Err(_) => {
            // Fallback for older Neo4j versions that don't support SHOW INDEXES
            println!("EventMove tracking infrastructure assumed to be created");
        }
    }

    Ok(())
}

async fn add_bidirectional_completion_logic(graph: &Graph) -> Result<(), String> {
    println!("Adding bidirectional completion logic...");

    // Create trigger-like constraints to maintain completion consistency
    // Note: This is implemented in the application logic, but we can add data consistency checks

    // Check for any inconsistent completion states
    let inconsistency_query = "
        MATCH (t:Goal)-[:HAS_EVENT]->(e:Goal)
        WHERE t.goal_type = 'task'
        AND e.goal_type = 'event'
        AND t.completed = true
        AND e.completed = false
        AND (e.is_deleted IS NULL OR e.is_deleted = false)
        RETURN count(e) as inconsistent_events, collect(DISTINCT t.name) as task_names
    ";

    let mut result = graph
        .execute(query(inconsistency_query))
        .await
        .map_err(|e| format!("Failed to check completion consistency: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let inconsistent_count: i64 = row.get("inconsistent_events").unwrap_or(0);
        if inconsistent_count > 0 {
            let task_names: Vec<String> = row.get("task_names").unwrap_or_default();
            println!(
                "Warning: Found {} events with inconsistent completion state in tasks: {:?}",
                inconsistent_count, task_names
            );

            // Optionally fix the inconsistency
            let fix_query = "
                MATCH (t:Goal)-[:HAS_EVENT]->(e:Goal)
                WHERE t.goal_type = 'task'
                AND e.goal_type = 'event'
                AND t.completed = true
                AND e.completed = false
                AND (e.is_deleted IS NULL OR e.is_deleted = false)
                SET e.completed = true
                RETURN count(e) as fixed_count
            ";

            let mut fix_result = graph
                .execute(query(fix_query))
                .await
                .map_err(|e| format!("Failed to fix completion consistency: {}", e))?;

            if let Some(row) = fix_result.next().await.map_err(|e| e.to_string())? {
                let fixed_count: i64 = row.get("fixed_count").unwrap_or(0);
                println!("Fixed completion state for {} events", fixed_count);
            }
        }
    }

    println!("Bidirectional completion logic verification completed");
    Ok(())
}

async fn validate_post_migration_data(graph: &Graph) -> Result<(), String> {
    println!("Validating post-migration data integrity...");

    // Check that all scheduled tasks now have corresponding events
    let orphaned_scheduled_tasks_query = "
        MATCH (t:Goal)
        WHERE t.goal_type = 'task'
        AND t.scheduled_timestamp IS NOT NULL
        AND NOT EXISTS((t)-[:HAS_EVENT]->(:Goal))
        AND coalesce(t.is_deleted, false) <> true
        RETURN count(t) as orphaned_count, collect(t.name) as orphaned_names
    ";

    let mut result = graph
        .execute(query(orphaned_scheduled_tasks_query))
        .await
        .map_err(|e| format!("Failed to validate orphaned tasks: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let orphaned_count: i64 = row.get("orphaned_count").unwrap_or(0);
        if orphaned_count > 0 {
            let orphaned_names: Vec<String> = row.get("orphaned_names").unwrap_or_default();
            return Err(format!("Migration validation failed: {} tasks still have scheduled_timestamp but no events: {:?}", 
                              orphaned_count, orphaned_names));
        }
    }

    // Check that all events have valid parents
    let orphaned_events_query = "
        MATCH (e:Goal)
        WHERE e.goal_type = 'event'
        AND e.parent_id IS NOT NULL
        AND coalesce(e.is_deleted, false) <> true
        OPTIONAL MATCH (p:Goal)-[:HAS_EVENT]->(e)
        WHERE id(p) = e.parent_id
        WITH e, p
        WHERE p IS NULL
        RETURN count(e) as orphaned_events, collect(e.name)[0..5] as sample_names, collect(e.parent_id)[0..5] as sample_parent_ids
    ";

    let mut result = graph
        .execute(query(orphaned_events_query))
        .await
        .map_err(|e| format!("Failed to validate orphaned events: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let orphaned_count: i64 = row.get("orphaned_events").unwrap_or(0);
        if orphaned_count > 0 {
            let sample_names: Vec<String> = row.get("sample_names").unwrap_or_default();
            let sample_parent_ids: Vec<i64> = row.get("sample_parent_ids").unwrap_or_default();
            return Err(format!(
                "Migration validation failed: {} events have invalid parent relationships. Sample events: {:?}, Sample parent IDs: {:?}",
                orphaned_count, sample_names, sample_parent_ids
            ));
        }
    }

    // Verify index creation
    let index_count_query = "
        SHOW INDEXES
        YIELD name
        WHERE name IN ['goal_type_scheduled_idx', 'parent_relationship_idx', 'routine_instance_idx', 
                       'user_goal_type_idx', 'event_completion_idx', 'task_date_range_idx', 
                       'calendar_query_idx', 'event_move_user_time']
        RETURN count(name) as created_indexes
    ";

    match graph.execute(query(index_count_query)).await {
        Ok(mut result) => {
            if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
                let created_indexes: i64 = row.get("created_indexes").unwrap_or(0);
                println!("Verified {} performance indexes created", created_indexes);
                if created_indexes < 8 {
                    println!(
                        "Warning: Expected 8 indexes, but only {} were verified",
                        created_indexes
                    );
                }
            }
        }
        Err(_) => {
            println!("Index verification skipped (older Neo4j version)");
        }
    }

    println!("Post-migration validation completed successfully");
    Ok(())
}

// Rollback function for partial migration failures
#[allow(dead_code)]
pub async fn rollback_migration(graph: &Graph, state: &MigrationState) -> Result<(), String> {
    println!("Rolling back migration...");

    // Delete created events
    if !state.created_events.is_empty() {
        let delete_events_query = format!(
            "MATCH (e:Goal) WHERE id(e) IN [{}] DELETE e",
            state
                .created_events
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        );

        graph
            .run(query(&delete_events_query))
            .await
            .map_err(|e| format!("Failed to delete created events during rollback: {}", e))?;

        println!("Deleted {} created events", state.created_events.len());
    }

    // Restore modified tasks
    for task_id in &state.modified_tasks {
        let restore_query = query(
            "MATCH (t:Goal)
             WHERE id(t) = $task_id
             SET t.is_deleted = false",
        )
        .param("task_id", *task_id);

        graph
            .run(restore_query)
            .await
            .map_err(|e| format!("Failed to restore task {} during rollback: {}", task_id, e))?;
    }

    println!("Restored {} modified tasks", state.modified_tasks.len());
    println!("Migration rollback completed");
    Ok(())
}

// Migration verification endpoint
pub async fn verify_migration_integrity(graph: &Graph) -> Result<serde_json::Value, String> {
    println!("Verifying migration integrity...");

    // Comprehensive integrity checks
    let checks = vec![
        ("scheduled_tasks_without_events", "MATCH (t:Goal) WHERE t.goal_type = 'task' AND t.scheduled_timestamp IS NOT NULL AND NOT EXISTS((t)-[:HAS_EVENT]->(:Goal)) AND coalesce(t.is_deleted, false) <> true RETURN count(t) as count"),
        ("events_without_parents", "MATCH (e:Goal) WHERE e.goal_type = 'event' AND e.parent_id IS NOT NULL AND NOT EXISTS { MATCH (p:Goal)-[:HAS_EVENT]->(ev:Goal) WHERE id(p) = e.parent_id AND id(ev) = id(e) } AND coalesce(e.is_deleted, false) <> true RETURN count(e) as count"),
        ("orphaned_child_relationships", "MATCH (r:Goal)-[rel:CHILD]->(t:Goal) WHERE r.goal_type = 'routine' AND t.goal_type = 'task' AND t.is_deleted = true RETURN count(rel) as count"),
        ("total_events", "MATCH (e:Goal) WHERE e.goal_type = 'event' AND coalesce(e.is_deleted, false) <> true RETURN count(e) as count"),
        ("total_tasks_with_events", "MATCH (t:Goal)-[:HAS_EVENT]->(e:Goal) WHERE t.goal_type = 'task' AND e.goal_type = 'event' RETURN count(DISTINCT t) as count"),
        ("total_routines_with_events", "MATCH (r:Goal)-[:HAS_EVENT]->(e:Goal) WHERE r.goal_type = 'routine' AND e.goal_type = 'event' RETURN count(DISTINCT r) as count"),
    ];

    let mut results = serde_json::Map::new();

    for (check_name, check_query) in checks {
        let mut result = graph
            .execute(query(check_query))
            .await
            .map_err(|e| format!("Failed to run check {}: {}", check_name, e))?;

        if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
            let count: i64 = row.get("count").unwrap_or(0);
            results.insert(
                check_name.to_string(),
                serde_json::Value::Number(serde_json::Number::from(count)),
            );
        }
    }

    // Check if migration appears complete
    let scheduled_tasks_without_events: i64 = results
        .get("scheduled_tasks_without_events")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let events_without_parents: i64 = results
        .get("events_without_parents")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let orphaned_relationships: i64 = results
        .get("orphaned_child_relationships")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    let is_healthy = scheduled_tasks_without_events == 0
        && events_without_parents == 0
        && orphaned_relationships == 0;

    results.insert(
        "migration_healthy".to_string(),
        serde_json::Value::Bool(is_healthy),
    );
    results.insert(
        "timestamp".to_string(),
        serde_json::Value::Number(serde_json::Number::from(Utc::now().timestamp())),
    );

    Ok(serde_json::Value::Object(results))
}
