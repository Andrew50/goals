use axum::{
    extract::{Extension, Json, Path},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, put},
    Router,
};
use chrono::{DateTime, Local, Utc};
use neo4rs::{query, Graph};

use crate::goal::GOAL_RETURN_QUERY;

pub fn create_routes() -> Router {
    Router::new()
        .route("/", get(get_day_tasks))
        .route("/complete/:id", put(toggle_complete_task))
}

async fn get_day_tasks(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let local_now = Local::now();
    let today_start = local_now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(Local)
        .unwrap()
        .timestamp()
        * 1000;

    let today_end = local_now
        .date_naive()
        .and_hms_opt(23, 59, 59)
        .unwrap()
        .and_local_timezone(Local)
        .unwrap()
        .timestamp()
        * 1000;

    println!("Current time: {}", local_now);
    println!(
        "Checking for tasks between {} and {}",
        today_start, today_end
    );
    println!(
        "Start date: {}",
        DateTime::from_timestamp(today_start / 1000, 0).unwrap()
    );
    println!(
        "End date: {}",
        DateTime::from_timestamp(today_end / 1000, 0).unwrap()
    );

    let query_str = format!(
        "MATCH (g:Goal) 
         WHERE g.user_id = $user_id 
         AND g.goal_type = 'task'
         AND (
             (g.scheduled_timestamp >= $today_start AND g.scheduled_timestamp <= $today_end)
             OR (g.next_timestamp >= $today_start AND g.next_timestamp <= $today_end)
         )
         {}",
        GOAL_RETURN_QUERY
    );

    let query = query(&query_str)
        .param("user_id", user_id)
        .param("today_start", today_start)
        .param("today_end", today_end);

    match graph.execute(query).await {
        Ok(mut result) => {
            let mut tasks = Vec::new();
            while let Ok(Some(row)) = result.next().await {
                if let Ok(goal) = row.get::<serde_json::Value>("goal") {
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
