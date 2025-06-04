use chrono::{Utc, Duration, TimeZone, Datelike};
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
        // Apply routine_time to the current timestamp
        let scheduled_timestamp = if let Some(routine_time) = routine.routine_time {
            set_time_of_day(current_time, routine_time)
        } else {
            current_time
        };

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
        .param("timestamp", scheduled_timestamp)
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

fn set_time_of_day(base_timestamp: i64, time_of_day: i64) -> i64 {
    let day_in_ms: i64 = 24 * 60 * 60 * 1000;
    let start_of_day = (base_timestamp / day_in_ms) * day_in_ms;

    // Extract just the minutes since midnight from the timestamp
    let minutes_since_midnight = (time_of_day % day_in_ms) / (60 * 1000);
    let time_of_day_ms = minutes_since_midnight * 60 * 1000;

    start_of_day + time_of_day_ms
}

fn calculate_next_occurrence(current_time: i64, frequency: &str) -> Result<i64, String> {
    // Use the same logic as in routine.rs
    let current_dt = Utc
        .timestamp_millis_opt(current_time)
        .earliest()
        .ok_or("Invalid timestamp")?;

    // frequency pattern: {multiplier}{unit}[:days]
    let parts: Vec<&str> = frequency.split(':').collect();
    let freq_part = parts[0];
    
    if let Some(unit_pos) = freq_part.find(|c: char| !c.is_numeric()) {
        let multiplier: i64 = freq_part[..unit_pos].parse()
            .map_err(|_| format!("Invalid frequency multiplier: {}", &freq_part[..unit_pos]))?;
        let unit = &freq_part[unit_pos..];

        // Calculate next date
        let next_date = match unit {
            "D" => current_dt.date_naive() + Duration::days(multiplier),
            "W" => {
                if let Some(days) = parts.get(1) {
                    // Get selected days as numbers (0-6)
                    let selected_days: Vec<u32> =
                        days.split(',').filter_map(|d| d.parse().ok()).collect();

                    if selected_days.is_empty() {
                        // Fallback if no days specified
                        current_dt.date_naive() + Duration::weeks(multiplier)
                    } else {
                        let mut next_dt = current_dt + Duration::days(1);

                        // Find the next occurrence of any selected day
                        while !selected_days.contains(&next_dt.weekday().num_days_from_sunday()) {
                            next_dt += Duration::days(1);
                        }

                        // If multiplier > 1, add additional weeks after finding next day
                        if multiplier > 1 {
                            next_dt += Duration::weeks(multiplier - 1);
                        }

                        next_dt.date_naive()
                    }
                } else {
                    current_dt.date_naive() + Duration::weeks(multiplier)
                }
            }
            "M" => current_dt.date_naive() + Duration::days(multiplier * 30),
            "Y" => current_dt.date_naive() + Duration::days(multiplier * 365),
            _ => current_dt.date_naive() + Duration::days(multiplier),
        };

        // Return timestamp with time set to beginning of day (routine_time would be applied elsewhere)
        Ok(next_date
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis())
    } else {
        // Default to daily if format is invalid
        let next_date = current_dt.date_naive() + Duration::days(1);
        Ok(next_date
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis())
    }
}

// This function can be called periodically (e.g., daily) by a scheduler
pub async fn run_routine_generator(graph: Graph) {
    println!("Starting routine event generation job...");
    
    match generate_future_routine_events(&graph).await {
        Ok(_) => println!("Routine event generation completed successfully"),
        Err(e) => eprintln!("Error generating routine events: {}", e),
    }
} 