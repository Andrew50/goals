use crate::tools::goal::Goal;
use chrono::{Datelike, Duration, TimeZone, Utc};
use neo4rs::{query, Graph};

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

    let mut result = graph
        .execute(query(query_str).param("now", now).param("horizon", horizon))
        .await
        .map_err(|e| format!("Failed to query routines: {}", e))?;

    let mut routine_count = 0;
    while let Some(row) = result
        .next()
        .await
        .map_err(|e| format!("Error fetching row: {}", e))?
    {
        let routine: Goal = row
            .get("r")
            .map_err(|e| format!("Failed to get routine: {}", e))?;
        let routine_id: i64 = row
            .get("routine_id")
            .map_err(|e| format!("Failed to get routine_id: {}", e))?;
        let last_event_time: Option<i64> = row.get("last_event_time").ok();

        let start_from = last_event_time
            .map(|t| t + 86400000) // Start from day after last event
            .unwrap_or_else(|| routine.start_timestamp.unwrap_or(now));

        // Respect the routine's explicit end date if it exists and is sooner than the 90-day horizon
        let effective_until = match routine.end_timestamp {
            Some(end_ts) if end_ts < horizon => end_ts,
            _ => horizon,
        };

        generate_events_for_routine(graph, &routine, routine_id, start_from, effective_until)
            .await?;
        routine_count += 1;
    }

    println!("Generated future events for {} routines", routine_count);
    Ok(())
}

// Helper function to validate if a given timestamp matches the routine's frequency pattern
fn is_valid_day_for_routine(timestamp: i64, frequency: &str) -> Result<bool, String> {
    let current_dt = Utc
        .timestamp_millis_opt(timestamp)
        .earliest()
        .ok_or("Invalid timestamp")?;

    // frequency pattern: {multiplier}{unit}[:days]
    let parts: Vec<&str> = frequency.split(':').collect();
    let freq_part = parts[0];

    if let Some(unit_pos) = freq_part.find(|c: char| !c.is_numeric()) {
        let unit = &freq_part[unit_pos..];

        match unit {
            "W" => {
                if let Some(days) = parts.get(1) {
                    // Get selected days as numbers (0-6)
                    let selected_days: Vec<u32> =
                        days.split(',').filter_map(|d| d.parse().ok()).collect();

                    if selected_days.is_empty() {
                        // If no specific days are selected, all days are valid for weekly
                        return Ok(true);
                    } else {
                        // Check if current day is one of the selected days
                        let current_weekday = current_dt.weekday().num_days_from_sunday();
                        return Ok(selected_days.contains(&current_weekday));
                    }
                } else {
                    // Weekly without specific days - all days are valid
                    return Ok(true);
                }
            }
            "D" | "M" | "Y" => {
                // For daily, monthly, yearly - all days are valid (the frequency calculation handles the intervals)
                return Ok(true);
            }
            _ => {
                // Unknown unit - assume valid
                return Ok(true);
            }
        }
    } else {
        // No unit found - assume daily, so all days are valid
        return Ok(true);
    }
}

async fn generate_events_for_routine(
    graph: &Graph,
    routine: &Goal,
    routine_id: i64,
    start_from: i64,
    until: i64,
) -> Result<(), String> {
    let frequency = routine
        .frequency
        .as_ref()
        .ok_or("Routine missing frequency")?;

    let instance_id = format!("{}-{}", routine_id, Utc::now().timestamp_millis());

    // Calculate event timestamps based on frequency
    let mut current_time = start_from;
    let mut event_count = 0;

    while current_time <= until {
        // Check if this day is valid for the routine's frequency pattern
        if !is_valid_day_for_routine(current_time, frequency)? {
            // Skip to next occurrence if this day doesn't match the pattern
            current_time = calculate_next_occurrence(current_time, frequency)?;
            continue;
        }

        // Apply routine_time to the current timestamp
        let scheduled_timestamp = if let Some(routine_time) = routine.routine_time {
            set_time_of_day(current_time, routine_time)
        } else {
            current_time
        };

        // If the calculated timestamp would exceed the routine's end date (when set), stop generation
        if let Some(end_ts) = routine.end_timestamp {
            if scheduled_timestamp > end_ts {
                break;
            }
        }

        // Check if an event already exists at this timestamp for this routine
        let check_query = query(
            "MATCH (r:Goal)-[:HAS_EVENT]->(e:Goal)
             WHERE id(r) = $routine_id
             AND e.scheduled_timestamp = $timestamp
             AND (e.is_deleted IS NULL OR e.is_deleted = false)
             RETURN count(e) as existing_count",
        )
        .param("routine_id", routine_id)
        .param("timestamp", scheduled_timestamp);

        let mut check_result = graph
            .execute(check_query)
            .await
            .map_err(|e| format!("Failed to check existing events: {}", e))?;

        let existing_count: i64 =
            if let Some(row) = check_result.next().await.map_err(|e| e.to_string())? {
                row.get("existing_count").unwrap_or(0)
            } else {
                0
            };

        // Only create event if none exists at this timestamp
        if existing_count == 0 {
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
                 CREATE (r)-[:HAS_EVENT]->(e)",
            )
            .param("routine_id", routine_id)
            .param("timestamp", scheduled_timestamp)
            .param("instance_id", instance_id.clone());

            graph
                .run(create_query)
                .await
                .map_err(|e| format!("Failed to create routine event: {}", e))?;

            event_count += 1;
        }

        // Calculate next occurrence based on frequency
        current_time = calculate_next_occurrence(current_time, frequency)?;
    }

    if event_count > 0 {
        println!(
            "Created {} new events for routine '{}'",
            event_count, routine.name
        );
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

    // Preserve the original time-of-day (hours, minutes, seconds) so that, in the absence of
    // `routine_time`, subsequent events keep the same scheduled time instead of defaulting to
    // midnight. This was the root cause for the first event having a different time-of-day.
    let original_time_of_day = current_dt.time();

    // frequency pattern: {multiplier}{unit}[:days]
    let parts: Vec<&str> = frequency.split(':').collect();
    let freq_part = parts[0];

    if let Some(unit_pos) = freq_part.find(|c: char| !c.is_numeric()) {
        let multiplier: i64 = freq_part[..unit_pos]
            .parse()
            .map_err(|_| format!("Invalid frequency multiplier: {}", &freq_part[..unit_pos]))?;
        let unit = &freq_part[unit_pos..];

        // Calculate next date (date component only for calendar calculations)
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

        // Combine the calculated date with the preserved time-of-day
        Ok(next_date
            .and_time(original_time_of_day)
            .and_utc()
            .timestamp_millis())
    } else {
        // Default to daily if format is invalid, preserving time-of-day
        let next_dt = current_dt + Duration::days(1);
        Ok(next_dt.timestamp_millis())
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
