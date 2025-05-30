use neo4rs::{query, Graph};
use crate::tools::goal::Goal;
use chrono::Utc;

pub async fn migrate_to_events(graph: &Graph) -> Result<(), String> {
    println!("Starting migration to event-based system...");
    
    // Step 1: Migrate scheduled tasks to events
    migrate_scheduled_tasks(graph).await?;
    
    // Step 2: Generate initial routine events
    generate_routine_events(graph).await?;
    
    // Step 3: Update relationships
    update_relationships(graph).await?;
    
    println!("Migration completed successfully!");
    Ok(())
}

async fn migrate_scheduled_tasks(graph: &Graph) -> Result<(), String> {
    println!("Migrating scheduled tasks to events...");
    
    let query_str = "
        MATCH (t:Goal)
        WHERE t.goal_type = 'task' 
        AND t.scheduled_timestamp IS NOT NULL
        CREATE (e:Goal {
            name: t.name,
            goal_type: 'event',
            scheduled_timestamp: t.scheduled_timestamp,
            duration: t.duration,
            completed: t.completed,
            parent_id: id(t),
            parent_type: 'task',
            user_id: t.user_id,
            priority: t.priority,
            description: t.description,
            is_deleted: false
        })
        CREATE (t)-[:HAS_EVENT]->(e)
        SET t.completed = false,  // Reset task completion
            t.scheduled_timestamp = null,
            t.duration = null
        RETURN count(e) as migrated_count
    ";
    
    let mut result = graph.execute(query(query_str)).await
        .map_err(|e| format!("Failed to migrate tasks: {}", e))?;
    
    if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let count: i64 = row.get("migrated_count").unwrap_or(0);
        println!("Migrated {} scheduled tasks to events", count);
    }
    
    Ok(())
}

async fn generate_routine_events(graph: &Graph) -> Result<(), String> {
    println!("Generating routine events...");
    
    // Generate 3 months of events for each routine
    let three_months_ms = 90 * 24 * 60 * 60 * 1000;
    let now = chrono::Utc::now().timestamp_millis();
    let end_time = now + three_months_ms;
    
    let query_str = "
        MATCH (r:Goal)
        WHERE r.goal_type = 'routine'
        AND r.start_timestamp IS NOT NULL
        RETURN r, id(r) as routine_id
    ";
    
    let mut result = graph.execute(query(query_str)).await
        .map_err(|e| format!("Failed to fetch routines: {}", e))?;
    
    let mut routine_count = 0;
    while let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let routine: Goal = row.get("r")
            .map_err(|e| format!("Failed to get routine: {}", e))?;
        let routine_id: i64 = row.get("routine_id")
            .map_err(|e| format!("Failed to get routine_id: {}", e))?;
        
        // Use existing routine event generation logic
        // but CREATE nodes instead of returning data
        create_routine_events_in_db(graph, &routine, routine_id, now, end_time).await?;
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
) -> Result<(), String> {
    let frequency = routine.frequency.as_ref()
        .ok_or("Routine missing frequency")?;
    
    let instance_id = format!("{}-{}", routine_id, Utc::now().timestamp_millis());
    
    // Calculate event timestamps based on frequency
    let mut current_time = routine.start_timestamp.unwrap_or(start_time);
    let mut event_count = 0;
    
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
                     parent_id: id(r),
                     parent_type: 'routine',
                     routine_instance_id: $instance_id,
                     user_id: r.user_id,
                     priority: r.priority,
                     description: r.description,
                     completed: false,
                     is_deleted: false
                 })
                 CREATE (r)-[:HAS_EVENT]->(e)"
            )
            .param("routine_id", routine_id)
            .param("timestamp", current_time)
            .param("instance_id", instance_id.clone());
            
            graph.run(create_query).await
                .map_err(|e| format!("Failed to create routine event: {}", e))?;
            
            event_count += 1;
        }
        
        // Calculate next occurrence based on frequency
        current_time = calculate_next_occurrence(current_time, frequency)?;
    }
    
    println!("Created {} events for routine {}", event_count, routine.name);
    Ok(())
}

fn calculate_next_occurrence(current_time: i64, frequency: &str) -> Result<i64, String> {
    // Parse frequency and calculate next occurrence
    // This is a simplified version - you might want to reuse existing frequency parsing logic
    let ms_per_day = 24 * 60 * 60 * 1000;
    
    let next_time = match frequency.to_lowercase().as_str() {
        "daily" => current_time + ms_per_day,
        "weekly" => current_time + (7 * ms_per_day),
        "monthly" => {
            // Simplified monthly calculation - add 30 days
            current_time + (30 * ms_per_day)
        }
        _ => {
            // Try to parse custom frequency like "every 2 days"
            if frequency.starts_with("every ") {
                let parts: Vec<&str> = frequency.split_whitespace().collect();
                if parts.len() >= 3 {
                    let number = parts[1].parse::<i64>()
                        .map_err(|_| format!("Invalid frequency number: {}", parts[1]))?;
                    
                    match parts[2] {
                        "day" | "days" => current_time + (number * ms_per_day),
                        "week" | "weeks" => current_time + (number * 7 * ms_per_day),
                        _ => return Err(format!("Unknown frequency unit: {}", parts[2]))
                    }
                } else {
                    return Err(format!("Invalid frequency format: {}", frequency))
                }
            } else {
                return Err(format!("Unknown frequency: {}", frequency))
            }
        }
    };
    
    Ok(next_time)
}

async fn update_relationships(_graph: &Graph) -> Result<(), String> {
    println!("Updating relationships...");
    
    // Update any other necessary relationships
    // This is a placeholder for any additional relationship updates needed
    
    Ok(())
} 