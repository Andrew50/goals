use chrono::{Utc, Duration, TimeZone};
use neo4rs::{query, Graph};
use crate::tools::goal::Goal;

pub async fn generate_future_routine_events(graph: &Graph) -> Result<(), String> {
    let now = Utc::now().timestamp_millis();
    let three_months = Duration::days(90).num_milliseconds();
    let horizon = now + three_months;
    
    // Find routines that need more events generated
    let query_str = "
        MATCH (r:Goal)
        WHERE r.goal_type = 'routine'
        AND (r.end_timestamp IS NULL OR r.end_timestamp > $now)
        WITH r
        OPTIONAL MATCH (r)-[:HAS_EVENT]->(e:Goal)
        WHERE e.is_deleted <> true
        WITH r, max(e.scheduled_timestamp) as last_event_time
        WHERE last_event_time < $horizon OR last_event_time IS NULL
        RETURN r, id(r) as routine_id, last_event_time
    ";
    
    let mut result = graph.execute(
        query(query_str)
            .param("now", now)
            .param("horizon", horizon)
    ).await
        .map_err(|e| format!("Failed to query routines: {}", e))?;
    
    let mut routine_count = 0;
    while let Some(row) = result.next().await
        .map_err(|e| format!("Error fetching row: {}", e))? {
        let routine: Goal = row.get("r")
            .map_err(|e| format!("Failed to get routine: {}", e))?;
        let routine_id: i64 = row.get("routine_id")
            .map_err(|e| format!("Failed to get routine_id: {}", e))?;
        let last_event_time: Option<i64> = row.get("last_event_time").ok();
        
        let start_from = last_event_time
            .map(|t| t + 86400000) // Start from day after last event
            .unwrap_or_else(|| routine.start_timestamp.unwrap_or(now));
        
        generate_events_for_routine(graph, &routine, routine_id, start_from, horizon).await?;
        routine_count += 1;
    }
    
    println!("Generated future events for {} routines", routine_count);
    Ok(())
}

async fn generate_events_for_routine(
    graph: &Graph,
    routine: &Goal,
    routine_id: i64,
    start_from: i64,
    until: i64,
) -> Result<(), String> {
    let frequency = routine.frequency.as_ref()
        .ok_or("Routine missing frequency")?;
    
    let instance_id = format!("{}-{}", routine_id, Utc::now().timestamp_millis());
    
    // Calculate event timestamps based on frequency
    let mut current_time = start_from;
    let mut event_count = 0;
    
    while current_time <= until {
        // Create event at this timestamp
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
        
        // Calculate next occurrence based on frequency
        current_time = calculate_next_occurrence(current_time, frequency)?;
    }
    
    if event_count > 0 {
        println!("Created {} new events for routine '{}'", event_count, routine.name);
    }
    Ok(())
}

fn calculate_next_occurrence(current_time: i64, frequency: &str) -> Result<i64, String> {
    let ms_per_day = 24 * 60 * 60 * 1000;
    
    // Parse frequency format: "ND" where N is number and D is unit (D/W/M/Y)
    // or special cases like "daily", "weekly", "monthly"
    let next_time = match frequency.to_lowercase().as_str() {
        "daily" => current_time + ms_per_day,
        "weekly" => current_time + (7 * ms_per_day),
        "monthly" => {
            // Use chrono for proper month calculation
            let current = Utc.timestamp_millis_opt(current_time)
                .single()
                .ok_or("Invalid timestamp")?;
            let next = current + Duration::days(30); // Simplified - could be improved
            next.timestamp_millis()
        }
        _ => {
            // Parse format like "1D", "2W", "3M"
            if let Some(captures) = regex::Regex::new(r"^(\d+)([DWMY])$")
                .unwrap()
                .captures(frequency) 
            {
                let number: i64 = captures[1].parse()
                    .map_err(|_| format!("Invalid frequency number: {}", &captures[1]))?;
                
                match &captures[2] {
                    "D" => current_time + (number * ms_per_day),
                    "W" => current_time + (number * 7 * ms_per_day),
                    "M" => {
                        let current = Utc.timestamp_millis_opt(current_time)
                            .single()
                            .ok_or("Invalid timestamp")?;
                        let next = current + Duration::days(30 * number); // Simplified
                        next.timestamp_millis()
                    }
                    "Y" => {
                        let current = Utc.timestamp_millis_opt(current_time)
                            .single()
                            .ok_or("Invalid timestamp")?;
                        let next = current + Duration::days(365 * number); // Simplified
                        next.timestamp_millis()
                    }
                    _ => return Err(format!("Unknown frequency unit: {}", &captures[2]))
                }
            } else {
                return Err(format!("Unknown frequency format: {}", frequency))
            }
        }
    };
    
    Ok(next_time)
}

// This function can be called periodically (e.g., daily) by a scheduler
pub async fn run_routine_generator(graph: Graph) {
    println!("Starting routine event generation job...");
    
    match generate_future_routine_events(&graph).await {
        Ok(_) => println!("Routine event generation completed successfully"),
        Err(e) => eprintln!("Error generating routine events: {}", e),
    }
} 