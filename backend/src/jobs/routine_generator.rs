use crate::tools::goal::Goal;
use chrono::{Datelike, Duration, TimeZone, Utc};
use neo4rs::{query, Graph};

pub async fn generate_future_routine_events(graph: &Graph) -> Result<(), String> {
    let now = Utc::now().timestamp_millis();
    let six_months = Duration::days(180).num_milliseconds();
    let horizon = now + six_months;

    // Find routines that need more events generated
    let query_str = "
        MATCH (r:Goal)
        WHERE r.goal_type = 'routine'
        AND (r.end_timestamp IS NULL OR r.end_timestamp > $now)
        WITH r
        OPTIONAL MATCH (r)-[:HAS_EVENT]->(e:Goal)
        WHERE (e.is_deleted IS NULL OR e.is_deleted = false)
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

        // Determine the correct starting point for generation:
        // - If we have a last event, start from the NEXT occurrence (not +1 day)
        // - Otherwise, advance from the routine start to the first occurrence >= now
        let start_from = if let Some(last) = last_event_time {
            match calculate_next_occurrence(last, routine.frequency.as_ref().ok_or("Routine missing frequency")?) {
                Ok(next) => next,
                Err(e) => {
                    eprintln!("[routine_generator] Failed to calculate next occurrence from last event: {}. Falling back to +1 day.", e);
                    last + 86_400_000
                }
            }
        } else {
            let mut t = routine.start_timestamp.unwrap_or(now);
            if let Some(freq) = &routine.frequency {
                let guard_limit = 10_000; // safety guard
                let mut guard = 0;
                while t < now && guard < guard_limit {
                    t = match calculate_next_occurrence(t, freq) {
                        Ok(v) => v,
                        Err(e) => {
                            eprintln!("[routine_generator] Failed to advance to now for routine id {:?}: {}", routine.id, e);
                            break;
                        }
                    };
                    guard += 1;
                }
            }
            t
        };

        // Respect the routine's explicit end date if it exists and is sooner than the 180-day horizon
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
        let unit_upper = unit.to_ascii_uppercase();

        match unit_upper.as_str() {
            "W" => {
                if let Some(days) = parts.get(1) {
                    // Get selected days as numbers (0-6)
                    let selected_days: Vec<u32> =
                        days.split(',').filter_map(|d| d.parse().ok()).collect();

                    if selected_days.is_empty() {
                        // If no specific days are selected, all days are valid for weekly
                        Ok(true)
                    } else {
                        // Check if current day is one of the selected days
                        let current_weekday = current_dt.weekday().num_days_from_sunday();
                        Ok(selected_days.contains(&current_weekday))
                    }
                } else {
                    // Weekly without specific days - all days are valid
                    Ok(true)
                }
            }
            "D" | "M" | "Y" => {
                // For daily, monthly, yearly - all days are valid (the frequency calculation handles the intervals)
                Ok(true)
            }
            _ => {
                // Unknown unit - assume valid (we will warn and skip creation elsewhere)
                Ok(true)
            }
        }
    } else {
        // No unit found - assume daily, so all days are valid
        Ok(true)
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
        let unit_upper = unit.to_ascii_uppercase();

        // Calculate next date (date component only for calendar calculations)
        let next_date = match unit_upper.as_str() {
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
            "M" => add_months_clamped(current_dt.date_naive(), multiplier)?,
            "Y" => add_months_clamped(current_dt.date_naive(), multiplier * 12)?,
            _ => {
                eprintln!("[routine_generator] Unknown frequency unit '{}', defaulting to daily step.", unit);
                current_dt.date_naive() + Duration::days(multiplier)
            }
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

fn add_months_clamped(date: chrono::NaiveDate, months: i64) -> Result<chrono::NaiveDate, String> {
    use chrono::NaiveDate;
    let year = date.year();
    let month0 = (date.month() - 1) as i64; // 0-based month
    let total_months = year as i64 * 12 + month0 + months;
    let new_year = (total_months.div_euclid(12)) as i32;
    let new_month0 = (total_months.rem_euclid(12)) as u32;
    let new_month = new_month0 + 1; // 1-based
    let last_dom = last_day_of_month(new_year, new_month);
    let new_day = date.day().min(last_dom);
    NaiveDate::from_ymd_opt(new_year, new_month, new_day)
        .ok_or_else(|| "Invalid date after month addition".to_string())
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    use chrono::NaiveDate;
    let (next_year, next_month) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    let first_next = NaiveDate::from_ymd_opt(next_year, next_month, 1).expect("valid next month");
    let last = first_next - Duration::days(1);
    last.day()
}

// This function can be called periodically (e.g., daily) by a scheduler
pub async fn run_routine_generator(graph: Graph) {
    println!("Starting routine event generation job...");

    match generate_future_routine_events(&graph).await {
        Ok(_) => println!("Routine event generation completed successfully"),
        Err(e) => eprintln!("Error generating routine events: {}", e),
    }
}

// Recompute future events for a single routine:
// - Soft-delete all future events (>= now), including completed ones
// - Regenerate based on the routine's updated schedule
// Returns (deleted_count, created_count)
pub async fn recompute_future_for_routine(
    graph: &Graph,
    routine_id: i64,
    
) -> Result<(i64, i64), String> {
    let now = Utc::now().timestamp_millis();
    let six_months = Duration::days(180).num_milliseconds();
    let horizon = now + six_months;

    // 1) Soft-delete all future events for this routine (including completed)
    let mut del_result = graph
        .execute(
            query(
                "MATCH (r:Goal) WHERE id(r) = $rid AND r.goal_type = 'routine'
                 OPTIONAL MATCH (r)-[:HAS_EVENT]->(e:Goal)
                 WHERE e.goal_type = 'event'
                   AND (e.is_deleted IS NULL OR e.is_deleted = false)
                   AND e.scheduled_timestamp >= $now
                 WITH r, e
                 SET e.is_deleted = true
                 RETURN count(e) as deleted_count",
            )
            .param("rid", routine_id)
            .param("now", now),
        )
        .await
        .map_err(|e| format!("Failed to soft-delete future events: {}", e))?;

    let deleted_count: i64 = if let Some(row) = del_result
        .next()
        .await
        .map_err(|e| e.to_string())? {
        row.get("deleted_count").unwrap_or(0)
    } else {
        0
    };

    // 2) Fetch routine and last remaining non-deleted event time
    let mut fetch_result = graph
        .execute(
            query(
                "MATCH (r:Goal) WHERE id(r) = $rid AND r.goal_type = 'routine'
                 OPTIONAL MATCH (r)-[:HAS_EVENT]->(e:Goal)
                 WHERE e.goal_type = 'event' AND (e.is_deleted IS NULL OR e.is_deleted = false)
                 WITH r, max(e.scheduled_timestamp) as last_event_time
                 RETURN r, last_event_time",
            )
            .param("rid", routine_id),
        )
        .await
        .map_err(|e| format!("Failed to fetch routine for recompute: {}", e))?;

    let row = fetch_result
        .next()
        .await
        .map_err(|e| format!("Error fetching routine row: {}", e))?
        .ok_or_else(|| "Routine not found".to_string())?;

    let routine: Goal = row
        .get("r")
        .map_err(|e| format!("Failed to get routine node: {}", e))?;
    let last_event_time: Option<i64> = row.get("last_event_time").ok();

    // 3) Decide start_from as in the generator
    let start_from = if let Some(last) = last_event_time {
        match calculate_next_occurrence(
            last,
            routine
                .frequency
                .as_ref()
                .ok_or("Routine missing frequency")?,
        ) {
            Ok(next) => next,
            Err(e) => {
                eprintln!(
                    "[routine_generator] Failed to calculate next occurrence from last event during recompute: {}. Falling back to +1 day.",
                    e
                );
                last + 86_400_000
            }
        }
    } else {
        let mut t = routine.start_timestamp.unwrap_or(now);
        if let Some(freq) = &routine.frequency {
            let guard_limit = 10_000; // safety guard
            let mut guard = 0;
            while t < now && guard < guard_limit {
                t = match calculate_next_occurrence(t, freq) {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!(
                            "[routine_generator] Failed to advance to now for routine id {:?}: {}",
                            routine.id, e
                        );
                        break;
                    }
                };
                guard += 1;
            }
        }
        t
    };

    // 4) Respect explicit end date if present
    let effective_until = match routine.end_timestamp {
        Some(end_ts) if end_ts < horizon => end_ts,
        _ => horizon,
    };

    // 5) Regenerate, counting creations
    let frequency = routine
        .frequency
        .as_ref()
        .ok_or("Routine missing frequency")?;

    let instance_id = format!("{}-{}", routine_id, Utc::now().timestamp_millis());
    let mut current_time = start_from;
    let mut created_count: i64 = 0;

    while current_time <= effective_until {
        if !is_valid_day_for_routine(current_time, frequency)? {
            current_time = calculate_next_occurrence(current_time, frequency)?;
            continue;
        }

        let scheduled_timestamp = if let Some(routine_time) = routine.routine_time {
            set_time_of_day(current_time, routine_time)
        } else {
            current_time
        };

        if let Some(end_ts) = routine.end_timestamp {
            if scheduled_timestamp > end_ts {
                break;
            }
        }

        // Only create if not already existing (non-deleted) at this timestamp
        let mut check_result = graph
            .execute(
                query(
                    "MATCH (r:Goal)-[:HAS_EVENT]->(e:Goal)
                     WHERE id(r) = $routine_id
                     AND e.scheduled_timestamp = $timestamp
                     AND (e.is_deleted IS NULL OR e.is_deleted = false)
                     RETURN count(e) as existing_count",
                )
                .param("routine_id", routine_id)
                .param("timestamp", scheduled_timestamp),
            )
            .await
            .map_err(|e| format!("Failed to check existing events during recompute: {}", e))?;

        let existing_count: i64 = if let Some(row) = check_result
            .next()
            .await
            .map_err(|e| e.to_string())? {
            row.get("existing_count").unwrap_or(0)
        } else {
            0
        };

        if existing_count == 0 {
            graph
                .run(
                    query(
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
                    .param("instance_id", instance_id.clone()),
                )
                .await
                .map_err(|e| format!("Failed to create routine event during recompute: {}", e))?;
            created_count += 1;
        }

        current_time = calculate_next_occurrence(current_time, frequency)?;
    }

    if created_count > 0 {
        println!(
            "Recomputed routine '{}' -> deleted {}, created {}",
            routine.name, deleted_count, created_count
        );
    } else {
        println!(
            "Recomputed routine '{}' -> deleted {}, created 0",
            routine.name, deleted_count
        );
    }

    Ok((deleted_count, created_count))
}
