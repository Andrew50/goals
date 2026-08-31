use crate::tools::goal::Goal;
use chrono::{Datelike, Duration, TimeZone, Utc};
use neo4rs::{query, Graph};
use serde::Deserialize;

#[derive(Debug, Deserialize, Clone)]
struct RoutineOverride {
    pub routine_id: Option<i64>,
    pub start_timestamp: Option<i64>,
    pub end_timestamp: Option<i64>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub priority: Option<String>,
    pub duration: Option<i32>,
    pub routine_time: Option<i64>,
    pub frequency: Option<String>,
    pub created_at: Option<i64>,
}

#[derive(Debug, Clone)]
struct EffectiveRoutineProps {
    pub name: String,
    pub description: Option<String>,
    pub priority: Option<String>,
    pub duration: Option<i32>,
    pub routine_time: Option<i64>,
    pub frequency: String,
}

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

        // Start from the next valid occurrence after the last existing event (or routine start if none).
        // This avoids drift for non-daily frequencies (e.g., 2D, weekly patterns).
        let start_from = if let Some(last_ts) = last_event_time {
            let freq = routine
                .frequency
                .as_ref()
                .ok_or("Routine missing frequency")?;
            calculate_next_occurrence(last_ts, freq)?
        } else {
            routine.start_timestamp.unwrap_or(now)
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

        match unit {
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
                // Unknown unit - assume valid
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
    let base_frequency = routine
        .frequency
        .as_ref()
        .ok_or("Routine missing frequency")?
        .clone();

    let overrides = fetch_routine_overrides(graph, routine_id, start_from, until).await?;

    let instance_id = format!("{}-{}", routine_id, Utc::now().timestamp_millis());
    let mut event_count = 0;

    // Build segments: base + override windows (non-overlapping by construction in event handler)
    let mut cursor = start_from;
    for ov in overrides {
        let ov_start = ov
            .start_timestamp
            .ok_or("RoutineOverride missing start_timestamp")?
            .max(start_from);
        let ov_end = ov
            .end_timestamp
            .ok_or("RoutineOverride missing end_timestamp")?
            .min(until);

        if cursor < ov_start {
            // base segment before override
            let base_props = EffectiveRoutineProps {
                name: routine.name.clone(),
                description: routine.description.clone(),
                priority: routine.priority.clone(),
                duration: routine.duration,
                routine_time: routine.routine_time,
                frequency: base_frequency.clone(),
            };
            event_count += generate_events_for_segment(
                graph,
                routine_id,
                &instance_id,
                &base_props,
                cursor,
                ov_start - 1,
            )
            .await?;
        }

        // override segment
        let props = EffectiveRoutineProps {
            name: ov.name.clone().unwrap_or_else(|| routine.name.clone()),
            description: ov.description.clone().or_else(|| routine.description.clone()),
            priority: ov.priority.clone().or_else(|| routine.priority.clone()),
            duration: ov.duration.or(routine.duration),
            routine_time: ov.routine_time.or(routine.routine_time),
            frequency: ov.frequency.clone().unwrap_or_else(|| base_frequency.clone()),
        };
        event_count += generate_events_for_segment(
            graph,
            routine_id,
            &instance_id,
            &props,
            ov_start,
            ov_end,
        )
        .await?;

        cursor = ov_end + 1;
        if cursor > until {
            break;
        }
    }

    if cursor <= until {
        // trailing base segment after last override
        let base_props = EffectiveRoutineProps {
            name: routine.name.clone(),
            description: routine.description.clone(),
            priority: routine.priority.clone(),
            duration: routine.duration,
            routine_time: routine.routine_time,
            frequency: base_frequency.clone(),
        };
        event_count += generate_events_for_segment(graph, routine_id, &instance_id, &base_props, cursor, until).await?;
    }

    if event_count > 0 {
        println!(
            "Created {} new events for routine '{}'",
            event_count, routine.name
        );
    }
    Ok(())
}

async fn fetch_routine_overrides(
    graph: &Graph,
    routine_id: i64,
    start_from: i64,
    until: i64,
) -> Result<Vec<RoutineOverride>, String> {
    let q = query(
        "MATCH (o:RoutineOverride)
         WHERE o.routine_id = $routine_id
         AND o.end_timestamp >= $start_from
         AND o.start_timestamp <= $until
         RETURN o
         ORDER BY o.start_timestamp ASC, o.created_at ASC",
    )
    .param("routine_id", routine_id)
    .param("start_from", start_from)
    .param("until", until);

    let mut result = graph
        .execute(q)
        .await
        .map_err(|e| format!("Failed to fetch routine overrides: {}", e))?;

    let mut overrides = Vec::new();
    while let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        let ov: RoutineOverride = row
            .get("o")
            .map_err(|e| format!("Failed to deserialize RoutineOverride: {}", e))?;
        overrides.push(ov);
    }
    Ok(overrides)
}

async fn generate_events_for_segment(
    graph: &Graph,
    routine_id: i64,
    instance_id: &str,
    props: &EffectiveRoutineProps,
    start_from: i64,
    until: i64,
) -> Result<i64, String> {
    if start_from > until {
        return Ok(0);
    }

    let frequency = props.frequency.as_str();

    // Calculate event timestamps based on frequency
    let mut current_time = start_from;
    let mut created = 0;

    while current_time <= until {
        if !is_valid_day_for_routine(current_time, frequency)? {
            current_time = calculate_next_occurrence(current_time, frequency)?;
            continue;
        }

        // Apply routine_time to the current timestamp
        let scheduled_timestamp = if let Some(routine_time) = props.routine_time {
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
                     name: $name,
                     goal_type: 'event',
                     scheduled_timestamp: $timestamp,
                     duration: $duration,
                     parent_id: id(r),
                     parent_type: 'routine',
                     routine_instance_id: $instance_id,
                     user_id: r.user_id,
                     priority: $priority,
                     description: $description,
                     completed: false,
                     is_deleted: false
                 })
                 CREATE (r)-[:HAS_EVENT]->(e)",
            )
            .param("routine_id", routine_id)
            .param("timestamp", scheduled_timestamp)
            .param("instance_id", instance_id.to_string())
            .param("name", props.name.clone())
            .param("duration", props.duration.map(|d| d as i64))
            .param("priority", props.priority.clone())
            .param("description", props.description.clone());

            graph
                .run(create_query)
                .await
                .map_err(|e| format!("Failed to create routine event: {}", e))?;

            created += 1;
        }

        // Calculate next occurrence based on frequency
        current_time = calculate_next_occurrence(current_time, frequency)?;
    }

    Ok(created)
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
