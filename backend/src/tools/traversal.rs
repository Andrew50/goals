use crate::tools::goal::Goal;
use crate::tools::goal::GoalType;
use axum::{http::StatusCode, Json};
use neo4rs::{query, Graph};

pub async fn query_hierarchy(graph: Graph, goal_id: i64) -> Result<Vec<Goal>, neo4rs::Error> {
    let query = query(
        "MATCH (g:Goal)-[*]-(related:Goal) \
         WHERE id(g) = $goal_id \
         RETURN DISTINCT related.name AS name, related.goal_type AS goal_type, id(related) AS id",
    )
    .param("goal_id", goal_id);

    let mut result = graph.execute(query).await?;
    let mut hierarchy = Vec::new();

    while let Some(row) = result.next().await? {
        let id = row
            .get::<i64>("id")
            .map_err(|_| neo4rs::Error::ConversionError)?;
        let name = row
            .get::<String>("name")
            .map_err(|_| neo4rs::Error::ConversionError)?;
        let _goal_type = row
            .get::<String>("goal_type")
            .map_err(|_| neo4rs::Error::ConversionError)?;

        hierarchy.push(Goal {
            id: Some(id),
            name,
            description: None,
            goal_type: GoalType::Directive,
            user_id: None,
            priority: None,
            start_timestamp: None,
            end_timestamp: None,
            next_timestamp: None,
            scheduled_timestamp: None,
            suggested_timestamp: None,
            duration: None,
            completed: None,
            frequency: None,
            completion_date: None,
            routine_type: None,
            routine_time: None,
            position_x: None,
            position_y: None,
        });
    }

    Ok(hierarchy)
}

pub async fn query_hierarchy_handler(
    graph: Graph,
    goal_id: i64,
) -> Result<Json<Vec<Goal>>, (StatusCode, String)> {
    match query_hierarchy(graph, goal_id).await {
        Ok(hierarchy) => Ok(Json(hierarchy)),
        Err(e) => {
            eprintln!("Error querying hierarchy: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error querying hierarchy: {}", e),
            ))
        }
    }
}
