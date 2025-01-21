use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::{
    extract::{Extension, Path},
    routing::post,
    Router,
};
use chrono::{Datelike, Duration, TimeZone, Utc};
use neo4rs::Graph;
use serde_json;
use std::fmt;
use tracing::error;

use crate::goal::{Goal, GoalType, GOAL_RETURN_QUERY};

// Custom error type
#[derive(Debug)]
pub enum RoutineError {
    Neo4j(neo4rs::Error),
    Serde(serde_json::Error),
    Deserialization(neo4rs::DeError),
}

pub fn create_routes() -> Router {
    Router::new().route("/:timestamp", post(process_user_routines))
}

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

async fn process_user_routines(
    Path(timestamp): Path<i64>,
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let query = format!(
        "MATCH (g:Goal) 
         WHERE g.goal_type = 'routine' 
         AND (g.next_timestamp IS NULL OR g.next_timestamp < timestamp())
         AND g.start_timestamp IS NOT NULL
         AND g.user_id = $user_id
         {}",
        GOAL_RETURN_QUERY
    );

    let mut result = graph
        .execute(neo4rs::query(&query).param("user_id", user_id))
        .await
        .map_err(RoutineError::from)?;

    while let Some(row) = result.next().await.map_err(RoutineError::from)? {
        let row_value = row.get("g").map_err(RoutineError::from)?;
        let routine: Goal = serde_json::from_value(row_value).map_err(RoutineError::from)?;

        if let Err(e) = catch_up_routine(&graph, &routine, timestamp).await {
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
    to_timestamp: i64,
) -> Result<(), RoutineError> {
    let end_of_day = Utc::now()
        .date_naive()
        .and_hms_opt(23, 59, 59)
        .unwrap()
        .and_utc()
        .timestamp_millis();

    let mut current_next_timestamp = routine.next_timestamp.unwrap_or_else(|| {
        routine
            .start_timestamp
            .unwrap_or_else(|| Utc::now().timestamp_millis())
    });

    println!(
        "Processing routine: {} (ID: {:?})",
        routine.name, routine.id
    );
    println!(
        "Current next timestamp: {}",
        Utc.timestamp_millis_opt(current_next_timestamp).unwrap()
    );

    while current_next_timestamp < to_timestamp && current_next_timestamp <= end_of_day {
        let new_next_timestamp = calculate_next_timestamp(
            current_next_timestamp,
            &routine.frequency.clone().unwrap_or_default(),
        );

        let scheduled_timestamp = if routine.duration == Some(1440) {
            println!("All-day routine detected, using current_next_timestamp as scheduled time");
            Some(current_next_timestamp)
        } else {
            let scheduled = routine
                .routine_time
                .map(|routine_time| set_time_of_day(current_next_timestamp, routine_time));
            println!(
                "Regular routine, scheduled time: {}",
                scheduled.map_or("None".to_string(), |ts| Utc
                    .timestamp_millis_opt(ts)
                    .unwrap()
                    .to_string())
            );
            scheduled
        };

        println!("Creating task for {} with:", routine.name);
        println!(
            "  Start timestamp: {}",
            Utc.timestamp_millis_opt(current_next_timestamp).unwrap()
        );
        println!(
            "  End timestamp: {}",
            Utc.timestamp_millis_opt(new_next_timestamp).unwrap()
        );
        println!(
            "  Scheduled timestamp: {}",
            scheduled_timestamp.map_or("None".to_string(), |ts| Utc
                .timestamp_millis_opt(ts)
                .unwrap()
                .to_string())
        );

        let child_goal = Goal {
            id: None,
            name: routine.name.clone(),
            goal_type: if routine.goal_type == GoalType::Routine {
                match routine.routine_type.as_deref() {
                    Some("achievement") => GoalType::Achievement,
                    _ => GoalType::Task,
                }
            } else {
                GoalType::Task
            },
            description: routine.description.clone(),
            user_id: routine.user_id,
            priority: routine.priority.clone(),
            start_timestamp: Some(current_next_timestamp),
            end_timestamp: Some(new_next_timestamp),
            completion_date: None,
            next_timestamp: None,
            scheduled_timestamp,
            duration: routine.duration,
            completed: Some(false),
            frequency: None,
            routine_type: None,
            routine_time: None,
        };

        let created_goal = child_goal.create_goal(graph).await?;

        let relationship = format!(
            "MATCH (r:Goal), (c:Goal) 
             WHERE id(r) = $routine_id AND id(c) = $child_id 
             CREATE (r)-[:GENERATED]->(c)"
        );
        let _ = graph
            .execute(
                neo4rs::query(&relationship)
                    .param("routine_id", routine.id.unwrap())
                    .param("child_id", created_goal.id.unwrap()),
            )
            .await?;

        let update = neo4rs::query(
            "MATCH (g:Goal) WHERE id(g) = $id 
             SET g.next_timestamp = $next_timestamp",
        )
        .param("id", routine.id.unwrap())
        .param("next_timestamp", new_next_timestamp);

        graph.run(update).await?;

        current_next_timestamp = new_next_timestamp;
    }

    Ok(())
}

fn calculate_next_timestamp(current: i64, frequency: &str) -> i64 {
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

        match unit {
            "D" => current_dt + Duration::days(multiplier),
            "W" => {
                if let Some(days) = parts.get(1) {
                    // Get selected days as numbers (0-6)
                    let selected_days: Vec<u32> =
                        days.split(',').filter_map(|d| d.parse().ok()).collect();

                    if selected_days.is_empty() {
                        // Fallback if no days specified
                        current_dt + Duration::weeks(multiplier)
                    } else {
                        let current_day = current_dt.weekday().num_days_from_sunday();
                        let mut next_dt = current_dt + Duration::days(1);

                        // Find the next occurrence of any selected day
                        while !selected_days.contains(&next_dt.weekday().num_days_from_sunday()) {
                            next_dt = next_dt + Duration::days(1);
                        }

                        // If multiplier > 1, add additional weeks after finding next day
                        if multiplier > 1 {
                            next_dt = next_dt + Duration::weeks(multiplier - 1);
                        }

                        next_dt
                    }
                } else {
                    current_dt + Duration::weeks(multiplier)
                }
            }
            "M" => current_dt + Duration::days(multiplier * 30),
            "Y" => current_dt + Duration::days(multiplier * 365),
            _ => current_dt + Duration::days(multiplier), // Default to daily if unit is unknown
        }
    } else {
        // Default to daily if format is invalid
        current_dt + Duration::days(1)
    }
    .timestamp_millis()
}

fn set_time_of_day(base_timestamp: i64, time_of_day: i64) -> i64 {
    let day_in_ms: i64 = 24 * 60 * 60 * 1000;
    let start_of_day = (base_timestamp / day_in_ms) * day_in_ms;

    // Extract just the minutes since midnight from the timestamp
    let minutes_since_midnight = (time_of_day % day_in_ms) / (60 * 1000);
    let time_of_day_ms = minutes_since_midnight * 60 * 1000;

    println!("Debug set_time_of_day:");
    println!(
        "  base_timestamp: {}",
        Utc.timestamp_millis_opt(base_timestamp).unwrap()
    );
    println!("  original time_of_day: {}", time_of_day);
    println!("  minutes_since_midnight: {}", minutes_since_midnight);
    println!("  time_of_day_ms: {}", time_of_day_ms);
    println!(
        "  result: {}",
        Utc.timestamp_millis_opt(start_of_day + time_of_day_ms)
            .unwrap()
    );

    start_of_day + time_of_day_ms
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn test_calculate_next_timestamp() {
        let current = Utc.ymd(2024, 3, 13).and_hms(12, 0, 0);
        let current_ts = current.timestamp_millis();
        let next_daily = calculate_next_timestamp(current_ts, "1D");
        assert_eq!(
            Utc.timestamp_millis_opt(next_daily).unwrap().date(),
            current.date() + Duration::days(1)
        );
        let next_weekly = calculate_next_timestamp(current_ts, "1W:1,3,5");
        assert_eq!(
            Utc.timestamp_millis_opt(next_weekly)
                .unwrap()
                .weekday()
                .num_days_from_sunday(),
            5 // Should be Friday (next selected day after Wednesday)
        );
        let next_biweekly = calculate_next_timestamp(current_ts, "2W:1,3,5");
        assert_eq!(
            Utc.timestamp_millis_opt(next_biweekly).unwrap().date(),
            Utc.timestamp_millis_opt(next_weekly).unwrap().date() + Duration::weeks(1)
        );
        let next_monthly = calculate_next_timestamp(current_ts, "1M");
        assert_eq!(
            Utc.timestamp_millis_opt(next_monthly).unwrap().date(),
            current.date() + Duration::days(30)
        );
    }

    #[tokio::test]
    async fn test_catch_up_routine_no_duplicates() {
        let graph = Graph::new("bolt://localhost:7687", "neo4j", "password")
            .await
            .unwrap();

        // First, let's verify our initial state
        let initial_query =
            "MATCH (g:Goal) WHERE g.goal_type = 'routine' AND g.user_id = 1 RETURN g LIMIT 1";
        let mut result = graph.execute(initial_query).await.unwrap();
        let row = result.next().await.unwrap().unwrap();
        let routine_value = row.get("g").unwrap();
        let routine: Goal = serde_json::from_value(routine_value).unwrap();

        // Get current count of generated tasks
        let count_before = count_generated_tasks(&graph, routine.id.unwrap()).await;

        // Run catch_up_routine multiple times with the same timestamp
        let current_time = Utc::now().timestamp_millis();

        // First run
        catch_up_routine(&graph, &routine, current_time)
            .await
            .unwrap();
        let count_after_first = count_generated_tasks(&graph, routine.id.unwrap()).await;

        // Second run - should not create new tasks
        catch_up_routine(&graph, &routine, current_time)
            .await
            .unwrap();
        let count_after_second = count_generated_tasks(&graph, routine.id.unwrap()).await;

        assert_eq!(
            count_after_first, count_after_second,
            "Second run should not create additional tasks"
        );

        // Verify the tasks created
        let tasks_query = format!(
            "MATCH (r:Goal)-[:GENERATED]->(t:Goal) 
             WHERE id(r) = {} 
             RETURN t.start_timestamp as start, t.end_timestamp as end",
            routine.id.unwrap()
        );
        let mut result = graph.execute(&tasks_query).await.unwrap();

        // Collect and verify no duplicate timestamps
        let mut timestamps = Vec::new();
        while let Some(row) = result.next().await.unwrap() {
            let start: i64 = row.get("start").unwrap();
            timestamps.push(start);
        }

        let unique_timestamps: std::collections::HashSet<_> = timestamps.iter().cloned().collect();
        assert_eq!(
            timestamps.len(),
            unique_timestamps.len(),
            "Found duplicate start timestamps: {:?}",
            timestamps
        );
    }

    async fn count_generated_tasks(graph: &Graph, routine_id: i64) -> i64 {
        let query = "MATCH (r:Goal)-[:GENERATED]->(t:Goal) WHERE id(r) = $routine_id RETURN count(t) as count";
        let mut result = graph
            .execute(neo4rs::query(query).param("routine_id", routine_id))
            .await
            .unwrap();
        let row = result.next().await.unwrap().unwrap();
        row.get("count").unwrap()
    }
}
