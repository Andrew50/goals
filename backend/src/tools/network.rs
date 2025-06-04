use axum::{http::StatusCode, Json};

use neo4rs::{query, Graph};
use serde::{Deserialize, Serialize};

use crate::tools::goal::Goal;

#[derive(Debug, Serialize)]
pub struct NetworkData {
    nodes: Vec<NetworkNode>,
    edges: Vec<NetworkEdge>,
}

#[derive(Debug, Serialize)]
pub struct NetworkNode {
    #[serde(flatten)]
    goal_data: Goal,
}

#[derive(Debug, Serialize)]
pub struct NetworkEdge {
    from: i64,
    to: i64,
    #[serde(rename = "relationship_type")]
    relationship_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct RelationshipData {
    #[serde(default)]
    to: Option<i64>,
    #[serde(default)]
    #[serde(rename = "type")]
    type_: String,
}

#[derive(Debug, Deserialize)]
pub struct PositionUpdate {
    pub x: f64,
    pub y: f64,
}

pub async fn get_network_data(
    graph: Graph,
    user_id: i64,
) -> Result<Json<NetworkData>, (StatusCode, String)> {
    println!("Fetching network data for user: {}", user_id);

    // Update filter to exclude events instead of tasks
    let query_str = format!(
        "MATCH (g:Goal) 
         WHERE g.user_id = $user_id
         AND g.goal_type <> 'event'
         OPTIONAL MATCH (g)-[r]->(g2:Goal)
         WHERE g2.user_id = $user_id
         AND g2.goal_type <> 'event'
         {}, 
         collect(DISTINCT CASE
             WHEN r IS NOT NULL THEN {{
                to: id(g2), 
                type: type(r)
            }}
            ELSE NULL
         END) as relationships",
        crate::tools::goal::GOAL_RETURN_QUERY
    );

    let query = query(&query_str).param("user_id", user_id);

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

        let goal_id = goal.id.unwrap_or_else(|| {
            eprintln!("Warning: Goal without ID found: {:?}", goal);
            0
        });

        nodes.push(NetworkNode {
            goal_data: goal.clone(),
        });

        let relationships: Vec<RelationshipData> = row.get("relationships").map_err(|e| {
            eprintln!("Error deserializing relationships: {:?}", e);
            eprintln!("Row data: {:?}", row);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error deserializing relationships: {}", e),
            )
        })?;

        for rel in relationships {
            if let Some(to_id) = rel.to {
                if to_id != 0 {
                    edges.push(NetworkEdge {
                        from: goal_id,
                        to: to_id,
                        relationship_type: rel.type_.to_lowercase(),
                    });
                }
            }
        }
    }

    Ok(Json(NetworkData { nodes, edges }))
}

pub async fn update_node_position(
    graph: Graph,
    id: i64,
    x: f64,
    y: f64,
) -> Result<StatusCode, (StatusCode, String)> {
    let query_str = "MATCH (g:Goal) WHERE id(g) = $id SET g.position_x = $x, g.position_y = $y";
    let query = query(query_str).param("id", id).param("x", x).param("y", y);

    match graph.run(query).await {
        Ok(_) => Ok(StatusCode::OK),
        Err(e) => {
            eprintln!("Error updating node position: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error updating node position: {}", e),
            ))
        }
    }
}
