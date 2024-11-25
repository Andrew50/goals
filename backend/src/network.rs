use axum::{extract::Extension, http::StatusCode, routing::get, Json, Router};

use neo4rs::{query, Graph};
use serde::{Deserialize, Serialize};

use crate::goal::{Goal, GoalType};

#[derive(Debug, Serialize)]
pub struct NetworkData {
    nodes: Vec<NetworkNode>,
    edges: Vec<NetworkEdge>,
}

#[derive(Debug, Serialize)]
pub struct NetworkNode {
    //id: i64,
    label: String,
    title: String,
    color: String,
    #[serde(flatten)]
    goal_data: Goal,
}

#[derive(Debug, Serialize)]
pub struct NetworkEdge {
    from: i64,
    to: i64,
    label: String,
    arrows: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct RelationshipData {
    #[serde(default)]
    to: Option<i64>,
    #[serde(default)]
    type_: String,
}

pub fn create_routes() -> Router {
    Router::new().route("/", get(get_network_data))
}

pub async fn get_network_data(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<NetworkData>, (StatusCode, String)> {
    println!("Fetching network data for user: {}", user_id);
    let query = query(
        "MATCH (g:Goal) 
         WHERE g.user_id = $user_id
         OPTIONAL MATCH (g)-[r]->(g2:Goal)
         WHERE g2.user_id = $user_id
         RETURN {
            name: g.name,
            description: g.description,
            goal_type: g.goal_type,
            user_id: g.user_id,
            priority: g.priority,
            start_timestamp: g.start_timestamp,
            end_timestamp: g.end_timestamp,
            next_timestamp: g.next_timestamp,
            scheduled_timestamp: g.scheduled_timestamp,
            duration: g.duration,
            completed: g.completed,
            frequency: g.frequency,
            id: id(g)
         } as g, 
         collect(DISTINCT {to: id(g2), type: type(r)}) as relationships",
    )
    .param("user_id", user_id);

    let mut result = graph.execute(query).await.map_err(|e| {
        eprintln!("Database query failed: {:?}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database query failed: {}", e),
        )
    })?;

    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    while let Some(row) = result.next().await.map_err(|e| {
        eprintln!("Error fetching row: {:?}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error fetching row: {}", e),
        )
    })? {
        let goal: Goal = row.get("g").map_err(|e| {
            eprintln!("Error deserializing goal: {:?}", e);
            eprintln!("Row data: {:?}", row);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error deserializing goal: {}", e),
            )
        })?;

        let relationships: Vec<RelationshipData> = row.get("relationships").map_err(|e| {
            eprintln!("Error deserializing relationships: {:?}", e);
            eprintln!("Row data: {:?}", row);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error deserializing relationships: {}", e),
            )
        })?;

        let goal_id = goal.id.unwrap_or_else(|| {
            eprintln!("Warning: Goal without ID found: {:?}", goal);
            0
        });

        nodes.push(NetworkNode {
            //id: goal_id,
            label: goal.name.clone(),
            title: format!("{} ({})", goal.name, goal.goal_type.as_str()),
            color: get_node_color(&goal.goal_type),
            goal_data: goal.clone(),
        });

        for rel in relationships {
            if let Some(to_id) = rel.to {
                if to_id != 0 {
                    edges.push(NetworkEdge {
                        from: goal_id,
                        to: to_id,
                        label: rel.type_.clone(),
                        arrows: "to".to_string(),
                    });
                }
            }
        }
    }

    println!("Successfully fetched network data:");
    println!("  Nodes: {}", nodes.len());
    println!("  Edges: {}", edges.len());

    Ok(Json(NetworkData { nodes, edges }))
}

fn get_node_color(goal_type: &GoalType) -> String {
    match goal_type {
        GoalType::Task => "#FF9999".to_string(),
        GoalType::Routine => "#99FF99".to_string(),
        GoalType::Directive => "#9999FF".to_string(),
        GoalType::Achievement => "#FFFF99".to_string(),
        GoalType::Project => "#FF99FF".to_string(),
    }
}
