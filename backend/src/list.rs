use axum::{
    extract::Extension,
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use neo4rs::{query, Graph};
use serde_json::Value;

use crate::goal::GOAL_RETURN_QUERY;

pub fn create_routes() -> Router {
    Router::new().route("/", get(get_list_data))
}

pub async fn get_list_data(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let query_str = format!(
        "MATCH (g:Goal) 
         WHERE g.user_id = $user_id
         {}",
        GOAL_RETURN_QUERY
    );

    let query = query(&query_str).param("user_id", user_id);

    match graph.execute(query).await {
        Ok(mut result) => {
            let mut goals: Vec<Value> = Vec::new();
            while let Ok(Some(row)) = result.next().await {
                if let Ok(event) = row.get::<Value>("event") {
                    goals.push(event);
                }
            }
            Ok(Json(goals))
        }
        Err(e) => {
            eprintln!("Error fetching goals: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error fetching goals: {}", e),
            ))
        }
    }
}
