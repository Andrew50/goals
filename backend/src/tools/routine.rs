use axum::http::StatusCode;
use chrono::{Datelike, Duration, TimeZone, Utc};
use neo4rs::Graph;
#[allow(clippy::single_component_path_imports)]
use serde_json;
use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::error;

use crate::tools::goal::{Goal, GoalType, GOAL_RETURN_QUERY};

// Custom error type
#[derive(Debug)]
pub enum RoutineError {
    Neo4j(neo4rs::Error),
    Serde(serde_json::Error),
    Deserialization(neo4rs::DeError),
}

pub type UserLocks = Arc<Mutex<HashMap<i64, Arc<Mutex<()>>>>>;

impl fmt::Display for RoutineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RoutineError::Neo4j(e) => write!(f, "Neo4j error: {}", e),
            RoutineError::Serde(e) => write!(f, "Serde error: {}", e),
            RoutineError::Deserialization(e) => write!(f, "Deserialization error: {}", e),
        }
    }
}

impl From<neo4rs::Error> for RoutineError {
    fn from(err: neo4rs::Error) -> Self {
        RoutineError::Neo4j(err)
    }
}
impl From<serde_json::Error> for RoutineError {
    fn from(err: serde_json::Error) -> Self {
        RoutineError::Serde(err)
    }
}
impl From<neo4rs::DeError> for RoutineError {
    fn from(err: neo4rs::DeError) -> Self {
        RoutineError::Deserialization(err)
    }
}
impl From<RoutineError> for (StatusCode, String) {
    fn from(err: RoutineError) -> Self {
        (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
    }
}

pub async fn process_user_routines(
    user_eod_timestamp: i64, // the timestamp to update routines up to. is the end of the user timezone's day, in UTC
    graph: Graph,
    user_id: i64,
    user_locks: UserLocks,
) -> Result<(), (StatusCode, String)> {
    let mut locks = user_locks.lock().await;
    let user_lock = locks
        .entry(user_id)
        .or_insert_with(|| Arc::new(Mutex::new(())));

    // Acquire the lock for the user
    let _guard = user_lock.lock().await;

    let query = format!(
        "MATCH (g:Goal) 
         WHERE g.goal_type = 'routine' 
         AND g.start_timestamp IS NOT NULL
         AND (g.next_timestamp IS NULL OR g.next_timestamp < $user_eod_timestamp)
         AND g.user_id = $user_id
         {}",
        GOAL_RETURN_QUERY
    );

    let mut result = graph
        .execute(
            neo4rs::query(&query)
                .param("user_id", user_id)
                .param("user_eod_timestamp", user_eod_timestamp),
        )
        .await
        .map_err(RoutineError::from)?;

    while let Some(row) = result.next().await.map_err(RoutineError::from)? {
        //iterate over all routines
        let row_value = row.get("g").map_err(RoutineError::from)?;
        let routine: Goal = serde_json::from_value(row_value).map_err(RoutineError::from)?;

        if let Err(e) = catch_up_routine(&graph, &routine, user_eod_timestamp).await {
            error!(
                "Error processing routine {}: {}",
                routine.id.unwrap_or(0),
                e
            );
        }
    }

    Ok(())
}

pub async fn catch_up_routine(
    graph: &Graph,
    routine: &Goal,
    to_timestamp: i64, // the timestamp to update routines up to. is the end of the user timezone's day, in UTC
) -> Result<(), RoutineError> {
    let mut scheduled_timestamp = routine.next_timestamp.unwrap_or_else(|| {
        // For new routines, calculate the first occurrence properly
        calculate_first_occurrence(
            routine.start_timestamp.unwrap(),
            &routine.frequency.clone().unwrap_or_default(),
            routine.routine_time,
        )
    });

    while scheduled_timestamp < to_timestamp {
        let next_scheduled_timestamp = calculate_next_timestamp(
            scheduled_timestamp,
            &routine.frequency.clone().unwrap_or_default(),
            routine.routine_time,
        );

        println!(
            "Creating event from routine '{}'\nScheduled: {} UTC / {} EST\nCreating up to: {} UTC / {} EST\nCurrent time: {} UTC / {} EST\nRoutine time: {}",
            routine.name,
            Utc.timestamp_millis_opt(scheduled_timestamp).unwrap(),
            Utc.timestamp_millis_opt(scheduled_timestamp).unwrap().with_timezone(&chrono_tz::America::New_York),
            Utc.timestamp_millis_opt(to_timestamp).unwrap(),
            Utc.timestamp_millis_opt(to_timestamp).unwrap().with_timezone(&chrono_tz::America::New_York),
            Utc::now(),
            Utc::now().with_timezone(&chrono_tz::America::New_York),
            routine
                .routine_time
                .map_or("None".to_string(), |t| t.to_string()),
        );

        // Create event instead of task
        let event_goal = Goal {
            id: None,
            name: routine.name.clone(),
            goal_type: GoalType::Event,
            description: routine.description.clone(),
            user_id: routine.user_id,
            priority: routine.priority.clone(),
            start_timestamp: None,
            end_timestamp: None,
            completion_date: None,
            next_timestamp: None,
            scheduled_timestamp: Some(scheduled_timestamp),
            duration: routine.duration,
            completed: Some(false),
            frequency: None,
            routine_type: None,
            routine_time: None,
            position_x: None,
            position_y: None,
            parent_id: Some(routine.id.unwrap()),
            parent_type: Some("routine".to_string()),
            routine_instance_id: Some(format!("{}-{}", routine.id.unwrap(), Utc::now().timestamp_millis())),
            is_deleted: Some(false),
            due_date: None,
            start_date: None,
        };
        let created_goal = event_goal.create_goal(graph).await?;

        // Create HAS_EVENT relationship instead of GENERATED
        let relationship = "MATCH (r:Goal), (e:Goal) 
             WHERE id(r) = $routine_id AND id(e) = $event_id 
             CREATE (r)-[:HAS_EVENT]->(e)"
            .to_string();
        let _ = graph
            .execute(
                neo4rs::query(&relationship)
                    .param("routine_id", routine.id.unwrap())
                    .param("event_id", created_goal.id.unwrap()),
            )
            .await?;
        let update = neo4rs::query(
            "MATCH (g:Goal) WHERE id(g) = $id 
             SET g.next_timestamp = $next_timestamp",
        )
        .param("id", routine.id.unwrap())
        .param("next_timestamp", next_scheduled_timestamp);
        graph.run(update).await?;

        scheduled_timestamp = next_scheduled_timestamp;
    }

    Ok(())
}

// New function to calculate first occurrence correctly
fn calculate_first_occurrence(start_timestamp: i64, frequency: &str, routine_time: Option<i64>) -> i64 {
    let start_dt = Utc
        .timestamp_millis_opt(start_timestamp)
        .earliest()
        .expect("Invalid timestamp");
    
    let routine_time_ms = routine_time.unwrap_or(0);
    
    // Calculate what time the routine should run today
    let today = start_dt.date_naive();
    let today_routine_time = set_time_of_day(
        today.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp_millis(),
        routine_time_ms,
    );
    
    // If the routine time for today hasn't passed yet, use today
    if today_routine_time > start_timestamp {
        today_routine_time
    } else {
        // Otherwise, calculate the next occurrence
        calculate_next_timestamp(start_timestamp, frequency, routine_time)
    }
}

fn calculate_next_timestamp(current: i64, frequency: &str, routine_time: Option<i64>) -> i64 {
    let current_dt = Utc
        .timestamp_millis_opt(current)
        .earliest()
        .expect("Invalid timestamp");

    // frequency pattern: {multiplier}{unit}[:days]
    let parts: Vec<&str> = frequency.split(':').collect();
    let freq_part = parts[0];
    if let Some(unit_pos) = freq_part.find(|c: char| !c.is_numeric()) {
        let multiplier: i64 = freq_part[..unit_pos].parse().unwrap_or(1);
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

        // Use set_time_of_day to apply the time components
        set_time_of_day(
            next_date
                .and_hms_opt(0, 0, 0)
                .unwrap()
                .and_utc()
                .timestamp_millis(),
            routine_time.unwrap_or(0),
        )
    } else {
        // Default to daily if format is invalid
        let next_date = current_dt.date_naive() + Duration::days(1);
        set_time_of_day(
            next_date
                .and_hms_opt(0, 0, 0)
                .unwrap()
                .and_utc()
                .timestamp_millis(),
            routine_time.unwrap_or(0),
        )
    }
}

fn set_time_of_day(base_timestamp: i64, time_of_day: i64) -> i64 {
    let day_in_ms: i64 = 24 * 60 * 60 * 1000;
    let start_of_day = (base_timestamp / day_in_ms) * day_in_ms;

    // Extract just the minutes since midnight from the timestamp
    let minutes_since_midnight = (time_of_day % day_in_ms) / (60 * 1000);
    let time_of_day_ms = minutes_since_midnight * 60 * 1000;

    start_of_day + time_of_day_ms
}
