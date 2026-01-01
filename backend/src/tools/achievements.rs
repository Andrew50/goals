use axum::{http::StatusCode, Json};
use neo4rs::{query, Graph};
use serde_json::Value;

use crate::tools::goal::GOAL_RETURN_QUERY;

pub async fn get_achievements_data(
    graph: Graph,
    user_id: i64,
) -> Result<(StatusCode, Json<Value>), (StatusCode, String)> {
    // Query to get all achievement goals, prioritizing pending above resolved
    // (completed/failed/skipped), then sorting by due date (end_timestamp).
    let achievements_query = query(&format!(
        "MATCH (g:Goal)
         WHERE g.user_id = $user_id AND g.goal_type = 'achievement'
         ORDER BY
           CASE
             WHEN g.resolution_status IS NULL OR g.resolution_status = 'pending' THEN 0
             ELSE 1
           END ASC,
           coalesce(g.end_timestamp, 9223372036854775807) ASC
         {}",
        GOAL_RETURN_QUERY
    ))
    .param("user_id", user_id);

    let mut result = graph.execute(achievements_query).await.map_err(|e| {
        eprintln!("Error fetching achievements: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )
    })?;

    let mut achievements = Vec::new();
    while let Some(row) = result.next().await.map_err(|e| {
        eprintln!("Error processing achievement row: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error processing row: {}", e),
        )
    })? {
        if let Ok(achievement) = row.get::<Value>("g") {
            achievements.push(achievement);
        }
    }

    Ok((StatusCode::OK, Json(serde_json::json!(achievements))))
} 