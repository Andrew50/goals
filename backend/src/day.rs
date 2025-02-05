use axum::{
    extract::{Extension, Json, Path, Query},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, put},
    Router,
};
use chrono::{DateTime, Utc};
use neo4rs::{query, Graph};
use std::collections::HashMap;

use crate::goal::GOAL_RETURN_QUERY;

pub fn create_routes() -> Router {
    Router::new()
        .route("/", get(get_day_tasks))
        .route("/complete/:id", put(toggle_complete_task))
}

async fn get_day_tasks(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Query(params): Query<HashMap<String, i64>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let today_start = params.get("start").copied().unwrap_or_else(|| {
        Utc::now()
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp()
            * 1000
    });

    let today_end = params.get("end").copied().unwrap_or_else(|| {
        Utc::now()
            .date_naive()
            .and_hms_opt(23, 59, 59)
            .unwrap()
            .and_utc()
            .timestamp()
            * 1000
    });

    println!("Query Parameters:");
    println!("  user_id: {}", user_id);
    println!(
        "  today_start: {} ({})",
        today_start,
        DateTime::from_timestamp(today_start / 1000, 0).unwrap()
    );
    println!(
        "  today_end: {} ({})",
        today_end,
        DateTime::from_timestamp(today_end / 1000, 0).unwrap()
    );

    // Debug query to show tasks near our range
    let debug_query = query(
        "MATCH (g:Goal) 
         WHERE g.user_id = $user_id 
         AND g.goal_type = 'task'
         AND g.scheduled_timestamp >= $range_start
         AND g.scheduled_timestamp <= $range_end
         RETURN g.name, g.scheduled_timestamp, 
                datetime({ epochMillis: g.scheduled_timestamp }) as scheduled_date
         ORDER BY g.scheduled_timestamp",
    )
    .param("user_id", user_id)
    .param("range_start", today_start - (86400000)) // 1 day before
    .param("range_end", today_end + (86400000)); // 1 day after

    println!("\nTasks around the target date range:");
    if let Ok(mut result) = graph.execute(debug_query).await {
        while let Ok(Some(row)) = result.next().await {
            let timestamp = row.get::<i64>("g.scheduled_timestamp").unwrap_or(0);
            let name = row.get::<String>("g.name").unwrap_or_default();
            let date = row.get::<String>("scheduled_date").unwrap_or_default();
            println!("Task: {} - {} ({})", name, timestamp, date);
        }
    }

    let query_str = format!(
        "MATCH (g:Goal) 
         WHERE g.user_id = $user_id 
         AND g.goal_type = 'task'
         AND g.scheduled_timestamp >= $today_start 
         AND g.scheduled_timestamp <= $today_end
         {}",
        GOAL_RETURN_QUERY
    );

    //println!("\nExecuting query:");
    //println!("{}", query_str);

    let query = query(&query_str)
        .param("user_id", user_id)
        .param("today_start", today_start)
        .param("today_end", today_end);

    match graph.execute(query).await {
        Ok(mut result) => {
            let mut tasks = Vec::new();
            while let Ok(Some(row)) = result.next().await {
                if let Ok(goal) = row.get::<serde_json::Value>("g") {
                    tasks.push(goal);
                }
            }
            println!("Found {} tasks", tasks.len());
            Ok(Json(tasks))
        }
        Err(e) => {
            eprintln!("Error fetching day tasks: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch tasks: {}", e),
            ))
        }
    }
}

async fn toggle_complete_task(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let now = Utc::now().timestamp();

    let query = query(
        "MATCH (g:Goal) 
         WHERE id(g) = $id 
         SET g.completed = CASE WHEN g.completed = true THEN false ELSE true END,
             g.completion_date = CASE WHEN g.completed = true THEN null ELSE $completion_date END
         RETURN g",
    )
    .param("id", id)
    .param("completion_date", now);

    match graph.run(query).await {
        Ok(_) => Ok(StatusCode::OK),
        Err(e) => {
            eprintln!("Error toggling task completion: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to toggle task completion: {}", e),
            ))
        }
    }
}
