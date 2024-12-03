use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::{
    extract::{Extension, Path},
    routing::post,
    Router,
};
use chrono::{Duration, TimeZone, Utc};
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

    while current_next_timestamp < to_timestamp && current_next_timestamp <= end_of_day {
        let new_next_timestamp = calculate_next_timestamp(
            current_next_timestamp,
            &routine.frequency.clone().unwrap_or_default(),
        );
        let scheduled_timestamp = routine
            .routine_time
            .map(|routine_time| set_time_of_day(current_next_timestamp, routine_time));

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
            scheduled_timestamp: scheduled_timestamp,
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

    let next_dt = match frequency.to_lowercase().as_str() {
        "daily" => current_dt + Duration::days(1),
        "weekly" => current_dt + Duration::weeks(1),
        "monthly" => current_dt + Duration::days(30),
        "yearly" => current_dt + Duration::days(365),
        _ => current_dt + Duration::days(1),
    };

    next_dt.timestamp_millis()
}

fn set_time_of_day(base_timestamp: i64, time_of_day: i64) -> i64 {
    let day_in_ms: i64 = 24 * 60 * 60 * 1000;
    let start_of_day = (base_timestamp / day_in_ms) * day_in_ms;
    start_of_day + time_of_day
}
