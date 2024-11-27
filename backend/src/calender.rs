use axum::{extract::Extension, http::StatusCode, routing::get, Json, Router};
use chrono::{DateTime, Utc};
use neo4rs::{query, Graph};
use serde::Serialize;

use crate::goal::{Goal, GOAL_RETURN_QUERY};

#[derive(Debug, Serialize)]
pub struct CalenderData {
    unscheduled_tasks: Vec<Goal>,
    scheduled_tasks: Vec<Goal>,
    routines: Vec<Goal>,
    achievements: Vec<Goal>,
}

#[derive(Debug, Serialize)]
pub struct CalendarEvent {
    id: i64,
    title: String,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    #[serde(rename = "type")]
    event_type: String,
    description: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UnscheduledTask {
    id: i64,
    title: String,
    end_timestamp: i64,
    description: Option<String>,
}

pub fn create_routes() -> Router {
    Router::new().route("/", get(get_calender_data))
}

async fn execute_query<T>(
    graph: &Graph,
    mut query: neo4rs::Query,
    transform: impl Fn(Goal) -> T,
    user_id: i64,
    current_time: i64,
) -> Result<Vec<T>, (StatusCode, String)> {
    query = query
        .param("user_id", user_id)
        .param("current_time", current_time);

    // Only print parameters
    println!(
        "With parameters: user_id={}, current_time={}",
        user_id, current_time
    );

    let mut result = graph.execute(query).await.map_err(|e| {
        eprintln!("Database query failed: {:?}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database query failed: {}", e),
        )
    })?;

    let mut items = Vec::new();
    while let Some(row) = result.next().await.map_err(|e| {
        eprintln!("Error fetching row: {:?}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error fetching row: {}", e),
        )
    })? {
        let event_data: Goal = row.get("event").map_err(|e| {
            eprintln!("Error deserializing event: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error deserializing event: {}", e),
            )
        })?;

        if event_data.id.is_some() {
            items.push(transform(event_data));
        }
    }
    Ok(items)
}

pub async fn get_calender_data(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<CalenderData>, (StatusCode, String)> {
    let current_timestamp = Utc::now().timestamp() * 1000;

    // Define all queries
    let queries = vec![
        (
            query(
                format!(
                    "MATCH (g:Goal) 
                 WHERE g.user_id = $user_id 
                 AND g.goal_type = 'task'
                 AND g.scheduled_timestamp IS NOT NULL
                 AND g.start_timestamp <= $current_time 
                 AND (g.end_timestamp IS NULL OR g.end_timestamp >= $current_time)
                 {}",
                    GOAL_RETURN_QUERY
                )
                .as_str(),
            ),
            "assigned_tasks",
        ),
        (
            query(
                format!(
                    "MATCH (g:Goal) 
                 WHERE g.user_id = $user_id 
                 AND g.goal_type = 'task'
                 AND g.scheduled_timestamp IS NULL
                 AND g.start_timestamp <= $current_time 
                 AND (g.end_timestamp IS NULL OR g.end_timestamp >= $current_time)
                 {}",
                    GOAL_RETURN_QUERY
                )
                .as_str(),
            ),
            "unassigned_tasks",
        ),
        (
            query(
                format!(
                    "MATCH (g:Goal) 
                 WHERE g.user_id = $user_id 
                 AND g.goal_type = 'routine'
                 AND g.start_timestamp <= $current_time 
                 AND (g.end_timestamp IS NULL OR g.end_timestamp >= $current_time)
                 {}",
                    GOAL_RETURN_QUERY
                )
                .as_str(),
            ),
            "routines",
        ),
        (
            query(
                format!(
                    "MATCH (g:Goal) 
                 WHERE g.user_id = $user_id 
                 AND g.goal_type = 'achievement'
                 AND g.start_timestamp <= $current_time 
                 AND (g.end_timestamp IS NULL OR g.end_timestamp >= $current_time)
                 {}",
                    GOAL_RETURN_QUERY
                )
                .as_str(),
            ),
            "achievements",
        ),
    ];

    // Execute all queries and collect results
    let mut results = Vec::new();
    for (query, _) in &queries {
        let goals = execute_query(
            &graph,
            query.clone(),
            |goal| goal, // Simply return the Goal as is
            user_id,
            current_timestamp,
        )
        .await?;
        results.push(goals);
    }

    Ok(Json(CalenderData {
        scheduled_tasks: results[0].clone(),
        unscheduled_tasks: results[1].clone(),
        routines: results[2].clone(),
        achievements: results[3].clone(),
    }))
}
