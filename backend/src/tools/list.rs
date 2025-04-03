use axum::{http::StatusCode, Json};
use neo4rs::{query, Graph};
use serde_json::Value;

use crate::tools::goal::GOAL_RETURN_QUERY;

pub async fn get_list_data(
    graph: Graph,
    user_id: i64,
) -> Result<Json<Vec<Value>>, (StatusCode, String)> {
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
                if let Ok(goal) = row.get::<Value>("g") {
                    goals.push(goal);
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
