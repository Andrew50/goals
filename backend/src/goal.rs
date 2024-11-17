use axum::{
    debug_handler,
    extract::{Extension, Path},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post, put},
    Json, Router,
};
use neo4rs::{query, Graph};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct Goal {
    pub id: Option<i64>,   // ID of the goal, Neo4j IDs are i64
    pub name: String,      // Name of the goal
    pub goal_type: String, // task, routine, directive, achievement, habit
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Relationship {
    pub from_id: i64,              // ID of the source goal
    pub to_id: i64,                // ID of the target goal
    pub relationship_type: String, // parent, child, next
}

pub fn create_routes() -> Router {
    Router::new()
        .route("/create", post(create_goal_handler))
        .route("/create_relationship", post(create_relationship_handler))
        .route("/hierarchy/:goal_id", post(query_hierarchy_handler))
        .route("/", get(get_all_goals))
        .route("/relationships", get(get_all_relationships))
        .route("/:id", put(update_goal_handler))
        .route("/:id", delete(delete_goal_handler))
}

//#[debug_handler]
pub async fn create_goal_handler(
    Extension(graph): Extension<Graph>,
    Json(goal): Json<Goal>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match goal.create_goal(&graph).await {
        Ok(created_goal) => Ok((StatusCode::CREATED, Json(created_goal))),
        Err(e) => {
            eprintln!("Error creating goal: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error creating goal: {}", e),
            ))
        }
    }
}

pub async fn create_relationship_handler(
    Extension(graph): Extension<Graph>,
    Json(relationship): Json<Relationship>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match Goal::create_relationship(&graph, &relationship).await {
        Ok(_) => Ok((StatusCode::CREATED, "Relationship created")),
        Err(e) => {
            eprintln!("Error creating relationship: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error creating relationship: {}", e),
            ))
        }
    }
}

pub async fn query_hierarchy_handler(
    Path(goal_id): Path<i64>,
    Extension(graph): Extension<Graph>,
) -> Result<impl IntoResponse, impl IntoResponse> {
    match Goal::query_hierarchy(&graph, goal_id).await {
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

pub async fn get_all_goals(
    Extension(graph): Extension<Graph>,
) -> Result<Json<Vec<Goal>>, (StatusCode, String)> {
    let query =
        query("MATCH (g:Goal) RETURN g.name AS name, g.goal_type AS goal_type, id(g) AS id");

    let mut result = graph.execute(query).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )
    })?;
    let mut goals = Vec::new();

    while let Some(row) = result.next().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )
    })? {
        goals.push(Goal {
            id: Some(row.get::<i64>("id").map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Data conversion error: {}", e),
                )
            })?),
            name: row.get::<String>("name").map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Data conversion error: {}", e),
                )
            })?,
            goal_type: row.get::<String>("goal_type").map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Data conversion error: {}", e),
                )
            })?,
        });
    }

    Ok(Json(goals))
}

pub async fn get_all_relationships(
    Extension(graph): Extension<Graph>,
) -> Result<Json<Vec<Relationship>>, (StatusCode, String)> {
    let query = query(
        "MATCH (g1:Goal)-[r]->(g2:Goal) 
         RETURN id(g1) as from_id, id(g2) as to_id, type(r) as relationship_type",
    );

    let mut result = graph.execute(query).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )
    })?;
    let mut relationships = Vec::new();

    while let Some(row) = result.next().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )
    })? {
        relationships.push(Relationship {
            from_id: row.get::<i64>("from_id").map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Data conversion error: {}", e),
                )
            })?,
            to_id: row.get::<i64>("to_id").map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Data conversion error: {}", e),
                )
            })?,
            relationship_type: row.get::<String>("relationship_type").map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Data conversion error: {}", e),
                )
            })?,
        });
    }

    Ok(Json(relationships))
}

pub async fn update_goal_handler(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
    Json(goal): Json<Goal>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let query = query(
        "MATCH (g:Goal) WHERE id(g) = $id 
         SET g.name = $name, g.goal_type = $goal_type 
         RETURN g.name AS name, g.goal_type AS goal_type, id(g) AS id",
    )
    .param("id", id)
    .param("name", goal.name.as_str())
    .param("goal_type", goal.goal_type.as_str());

    let mut result = graph.execute(query).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )
    })?;

    if let Some(row) = result.next().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )
    })? {
        let updated_goal = Goal {
            id: Some(row.get::<i64>("id").map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Data conversion error: {}", e),
                )
            })?),
            name: row.get::<String>("name").map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Data conversion error: {}", e),
                )
            })?,
            goal_type: row.get::<String>("goal_type").map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Data conversion error: {}", e),
                )
            })?,
        };
        Ok((StatusCode::OK, Json(updated_goal)))
    } else {
        Err((StatusCode::NOT_FOUND, "Goal not found".to_string()))
    }
}

pub async fn delete_goal_handler(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let query = query(
        "MATCH (g:Goal) WHERE id(g) = $id 
         DETACH DELETE g",
    )
    .param("id", id);

    match graph.run(query).await {
        Ok(_) => Ok(StatusCode::OK),
        Err(e) => {
            eprintln!("Error deleting goal: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error deleting goal: {}", e),
            ))
        }
    }
}

impl Goal {
    pub async fn create_goal(&self, graph: &Graph) -> Result<Goal, neo4rs::Error> {
        let query = query(
            "CREATE (g:Goal {name: $name, goal_type: $goal_type}) \
             RETURN g.name AS name, g.goal_type AS goal_type, id(g) AS id",
        )
        .param("name", self.name.as_str())
        .param("goal_type", self.goal_type.as_str());

        let mut result = graph.execute(query).await?;

        if let Some(row) = result.next().await? {
            Ok(Goal {
                id: Some(
                    row.get::<i64>("id")
                        .map_err(|_| neo4rs::Error::ConversionError)?,
                ),
                name: row
                    .get::<String>("name")
                    .map_err(|_| neo4rs::Error::ConversionError)?,
                goal_type: row
                    .get::<String>("goal_type")
                    .map_err(|_| neo4rs::Error::ConversionError)?,
            })
        } else {
            Err(neo4rs::Error::UnexpectedMessage(
                "Failed to create goal".to_string(),
            ))
        }
    }

    pub async fn create_relationship(
        graph: &Graph,
        relationship: &Relationship,
    ) -> Result<(), neo4rs::Error> {
        // Validate relationship_type to prevent Cypher injection
        let allowed_relationship_types = ["parent", "child", "next"];
        if !allowed_relationship_types.contains(&relationship.relationship_type.as_str()) {
            return Err(neo4rs::Error::InvalidTypeMarker(
                "Invalid relationship type".to_string(),
            ));
        }

        // Construct the query string
        let query_str = format!(
            "MATCH (from:Goal), (to:Goal) \
             WHERE id(from) = $from_id AND id(to) = $to_id \
             CREATE (from)-[:{}]->(to)",
            relationship.relationship_type
        );

        let query = query(&query_str)
            .param("from_id", relationship.from_id)
            .param("to_id", relationship.to_id);

        graph.run(query).await?;
        Ok(())
    }

    pub async fn query_hierarchy(graph: &Graph, goal_id: i64) -> Result<Vec<Goal>, neo4rs::Error> {
        let query = query(
            "MATCH (g:Goal)-[*]-(related:Goal) \
             WHERE id(g) = $goal_id \
             RETURN DISTINCT related.name AS name, related.goal_type AS goal_type, id(related) AS id",
        )
        .param("goal_id", goal_id);

        let mut result = graph.execute(query).await?;
        let mut hierarchy = Vec::new();

        while let Some(row) = result.next().await? {
            // Directly use `?` for `row.get` errors, as they propagate as `neo4rs::Error`.
            let id = row
                .get::<i64>("id")
                .map_err(|_| neo4rs::Error::ConversionError)?;
            let name = row
                .get::<String>("name")
                .map_err(|_| neo4rs::Error::ConversionError)?;
            let goal_type = row
                .get::<String>("goal_type")
                .map_err(|_| neo4rs::Error::ConversionError)?;

            hierarchy.push(Goal {
                id: Some(id),
                name,
                goal_type,
            });
        }

        Ok(hierarchy)
    }
}
