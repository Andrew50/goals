use axum::{
    extract::{Extension, Json, Path},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, put},
    Router,
};

use neo4rs::{query, Graph};
use serde::{Deserialize, Serialize};

use crate::goal::Goal;

#[derive(Debug, Serialize)]
pub struct NetworkData {
    nodes: Vec<NetworkNode>,
    edges: Vec<NetworkEdge>,
}

#[derive(Debug, Serialize)]
pub struct NetworkNode {
    //id: i64,
    //label: String,
    //title: String,
    //color: String,
    #[serde(flatten)]
    goal_data: Goal,
}

#[derive(Debug, Serialize)]
pub struct NetworkEdge {
    from: i64,
    to: i64,
    //label: String,
    #[serde(rename = "relationship_type")]
    relationship_type: String,
    //arrows: String,
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
struct PositionUpdate {
    x: f64,
    y: f64,
}

pub fn create_routes() -> Router {
    Router::new()
        .route("/", get(get_network_data))
        .route("/:id/position", put(update_node_position))
}

pub async fn get_network_data(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<NetworkData>, (StatusCode, String)> {
    println!("Fetching network data for user: {}", user_id);

    // Add filter to exclude tasks
    let query_str = format!(
        "MATCH (g:Goal) 
         WHERE g.user_id = $user_id
         AND g.goal_type <> 'task'
         OPTIONAL MATCH (g)-[r]->(g2:Goal)
         WHERE g2.user_id = $user_id
         AND g2.goal_type <> 'task'
         {}, 
         collect(DISTINCT CASE
             WHEN r IS NOT NULL THEN {{
                to: id(g2), 
                type: type(r)
            }}
            ELSE NULL
         END) as relationships",
        crate::goal::GOAL_RETURN_QUERY
    );

    //println!("Executing query: {}", query_str);
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
        // Debug print the raw row data
        //println!("Raw row data: {:?}", row);

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
            //id: goal_id,
            //label: goal.name.clone(),
            //           title: format_node_title(&goal.name, &goal.goal_type),
            //          color: get_node_color(&goal.goal_type),
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

        // Debug print the relationships
        //println!("Deserialized relationships: {:?}", relationships);

        for rel in relationships {
            if let Some(to_id) = rel.to {
                if to_id != 0 {
                    // Debug print each relationship before creating NetworkEdge
                    /*println!(
                        "Creating edge - from: {}, to: {}, type: '{}'",
                        goal_id, to_id, rel.type_
                    );*/

                    edges.push(NetworkEdge {
                        from: goal_id,
                        to: to_id,
                        relationship_type: rel.type_.to_lowercase(),
                        //arrows: "to".to_string(),
                    });
                }
            }
        }
    }

    // Debug print final edges
    //println!("Final edges: {:?}", edges);

    //println!("Successfully fetched network data:");
    //println!("  Nodes: {}", nodes.len());
    //println!("  Edges: {}", edges.len());

    Ok(Json(NetworkData { nodes, edges }))
}

async fn update_node_position(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
    Json(position): Json<PositionUpdate>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let query_str = "MATCH (g:Goal) WHERE id(g) = $id SET g.position_x = $x, g.position_y = $y";
    let query = query(query_str)
        .param("id", id)
        .param("x", position.x)
        .param("y", position.y);

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
