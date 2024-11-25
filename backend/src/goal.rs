/*
manage operations on goals and relationships between goals
doesnt include fetching of all goals as that is handled by endpoints specific to that frontend view
*/
use axum::{
    extract::{Extension, Path},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, post, put},
    Json, Router,
};
use neo4rs::{query, Graph};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Goal {
    pub id: Option<i64>,
    pub name: String,
    pub goal_type: GoalType,
    pub description: Option<String>,
    pub user_id: Option<i64>,
    pub priority: Option<String>,
    pub start_timestamp: Option<i64>,
    pub end_timestamp: Option<i64>,
    pub completion_date: Option<i64>,
    pub next_timestamp: Option<i64>,
    pub scheduled_timestamp: Option<i64>,
    pub duration: Option<i32>,
    pub completed: Option<bool>,
    pub frequency: Option<String>,
    //pub min_timestamp: Option<i64>,
    //pub max_timestamp: Option<i64>,
}

pub const GOAL_RETURN_QUERY: &str = "RETURN {
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
                 } as event";

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum GoalType {
    Directive,
    Project,
    Achievement,
    Routine,
    Task,
}

impl GoalType {
    pub fn as_str(&self) -> &'static str {
        match self {
            GoalType::Directive => "directive",
            GoalType::Project => "project",
            GoalType::Achievement => "achievement",
            GoalType::Routine => "routine",
            GoalType::Task => "task",
        }
    }
}

impl std::fmt::Display for GoalType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GoalType::Task => write!(f, "task"),
            GoalType::Routine => write!(f, "routine"),
            GoalType::Project => write!(f, "project"),
            GoalType::Directive => write!(f, "directive"),
            GoalType::Achievement => write!(f, "achievement"),
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub enum RelationshipType {
    Parent,
    Child,
    Queue,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Relationship {
    pub from_id: i64,
    pub to_id: i64,
    pub relationship_type: String,
}

pub fn create_routes() -> Router {
    Router::new()
        .route("/create", post(create_goal_handler))
        .route("/:id", put(update_goal_handler))
        .route("/:id", delete(delete_goal_handler))
        .route("/relationships", post(create_relationship_handler))
}

pub async fn create_goal_handler(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(goal): Json<Goal>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let goal = Goal {
        user_id: Some(user_id),
        ..goal
    };
    println!("Received goal creation request: {:?}", goal);
    let mut validation_errors = Vec::new();
    if goal.name.trim().is_empty() {
        validation_errors.push("Name is required");
    }
    let error_msg = format!("Invalid user_id {}", goal.user_id.unwrap_or(0));
    if goal.user_id.unwrap_or(0) < 0 {
        validation_errors.push(&error_msg);
    }

    // Goal type specific validation
    match goal.goal_type {
        GoalType::Routine => {
            if goal.frequency.is_none() {
                validation_errors.push("Frequency is required for routine goals");
            }
        }
        GoalType::Task => {
            if goal.duration.is_none() {
                validation_errors.push("Duration is required for task goals");
            }
        }
        GoalType::Project | GoalType::Achievement => {
            if goal.start_timestamp.is_none() {
                validation_errors
                    .push("Start timestamp is required for project and achievement goals");
            }
            /*if goal.end_timestamp.is_none() {
                validation_errors
                    .push("End timestamp is required for project and achievement goals");
            }*/
        }
        _ => {}
    }

    // If there are any validation errors, return them all
    if !validation_errors.is_empty() {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("Validation failed:\n- {}", validation_errors.join("\n- ")),
        ));
    }

    // Attempt to create the goal
    match goal.create_goal(&graph).await {
        Ok(created_goal) => {
            println!("Successfully created goal: {:?}", created_goal);
            Ok((StatusCode::CREATED, Json(created_goal)))
        }
        Err(e) => {
            // Enhanced error logging
            eprintln!("Error creating goal: {:?}", e);
            eprintln!("Goal data that caused error: {:?}", goal);
            eprintln!("Error details: {:#?}", e);

            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!(
                    "Failed to create goal. Error: {}. Please check server logs for more details.",
                    e
                ),
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

pub async fn update_goal_handler(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
    Json(goal): Json<Goal>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // Build the SET clause dynamically based on provided fields
    let mut set_clauses = vec!["g.name = $name", "g.goal_type = $goal_type"];
    let mut params = vec![
        (
            "id",
            neo4rs::BoltType::Integer(neo4rs::BoltInteger { value: id }),
        ),
        ("name", goal.name.into()),
        ("goal_type", goal.goal_type.as_str().into()),
    ];

    // Optional fields
    if let Some(desc) = &goal.description {
        set_clauses.push("g.description = $description");
        params.push(("description", desc.clone().into()));
    }
    if let Some(priority) = &goal.priority {
        set_clauses.push("g.priority = $priority");
        params.push(("priority", priority.clone().into()));
    }
    if let Some(start) = goal.start_timestamp {
        set_clauses.push("g.start_timestamp = $start_timestamp");
        params.push(("start_timestamp", start.into()));
    }
    if let Some(end) = goal.end_timestamp {
        set_clauses.push("g.end_timestamp = $end_timestamp");
        params.push(("end_timestamp", end.into()));
    }
    if let Some(next) = goal.next_timestamp {
        set_clauses.push("g.next_timestamp = $next_timestamp");
        params.push(("next_timestamp", next.into()));
    }
    if let Some(scheduled) = goal.scheduled_timestamp {
        set_clauses.push("g.scheduled_timestamp = $scheduled_timestamp");
        params.push(("scheduled_timestamp", scheduled.into()));
    }
    if let Some(duration) = goal.duration {
        set_clauses.push("g.duration = $duration");
        params.push(("duration", duration.into()));
    }
    if let Some(completed) = goal.completed {
        set_clauses.push("g.completed = $completed");
        params.push(("completed", completed.into()));
    }
    if let Some(frequency) = &goal.frequency {
        set_clauses.push("g.frequency = $frequency");
        params.push(("frequency", frequency.clone().into()));
    }

    let query_str = format!(
        "MATCH (g:Goal) WHERE id(g) = $id SET {}",
        set_clauses.join(", ")
    );

    let query = query(&query_str).params(params);

    match graph.run(query).await {
        Ok(_) => Ok(StatusCode::OK),
        Err(e) => {
            eprintln!("Error updating goal: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error updating goal: {}", e),
            ))
        }
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
        // Log the goal creation attempt
        println!("Attempting to create goal in database: {:?}", self);

        // Define all possible properties and their corresponding parameter values
        let property_params: Vec<(&str, Option<neo4rs::BoltType>)> = vec![
            ("name", Some(self.name.clone().into())),
            ("goal_type", Some(self.goal_type.as_str().into())),
            (
                "user_id",
                Some(neo4rs::BoltType::Integer(neo4rs::BoltInteger {
                    value: self.user_id.unwrap_or(0),
                })),
            ),
            (
                "description",
                self.description.as_ref().map(|v| v.clone().into()),
            ),
            ("priority", self.priority.as_ref().map(|v| v.clone().into())),
            (
                "start_timestamp",
                self.start_timestamp
                    .map(|ts| neo4rs::BoltType::Integer(neo4rs::BoltInteger { value: ts })),
            ),
            (
                "end_timestamp",
                self.end_timestamp
                    .map(|ts| neo4rs::BoltType::Integer(neo4rs::BoltInteger { value: ts })),
            ),
            (
                "next_timestamp",
                self.next_timestamp
                    .map(|ts| neo4rs::BoltType::Integer(neo4rs::BoltInteger { value: ts })),
            ),
            (
                "scheduled_timestamp",
                self.scheduled_timestamp
                    .map(|ts| neo4rs::BoltType::Integer(neo4rs::BoltInteger { value: ts })),
            ),
            (
                "duration",
                self.duration
                    .map(|v| neo4rs::BoltType::Integer(neo4rs::BoltInteger { value: v as i64 })),
            ),
            ("completed", self.completed.map(|v| v.into())),
            (
                "frequency",
                self.frequency.as_ref().map(|v| v.clone().into()),
            ),
        ];

        // Build query properties and parameters in one pass
        let mut properties = Vec::new();
        let mut params = Vec::new();

        for (name, value) in property_params {
            if let Some(value) = value {
                properties.push(format!("{}: ${}", name, name));
                params.push((name, value));
            }
        }

        let query_str = format!(
            "CREATE (g:Goal {{ {} }}) RETURN g, id(g) as id",
            properties.join(", ")
        );

        // Execute query with parameters
        let mut result = graph.execute(query(&query_str).params(params)).await?;

        if let Some(row) = result.next().await? {
            // Handle the error conversion manually
            let id: i64 = row.get("id").map_err(|_| neo4rs::Error::ConversionError)?;

            let created_goal = Goal {
                id: Some(id),
                ..self.clone()
            };

            Ok(created_goal)
        } else {
            Err(neo4rs::Error::UnexpectedMessage(
                "Failed to create goal".into(),
            ))
        }
    }

    pub async fn create_relationship(
        graph: &Graph,
        relationship: &Relationship,
    ) -> Result<(), neo4rs::Error> {
        let type_query = neo4rs::query(
            "MATCH (from:Goal), (to:Goal) 
             WHERE id(from) = $from_id AND id(to) = $to_id 
             RETURN from.goal_type as from_type, to.goal_type as to_type",
        )
        .param("from_id", relationship.from_id)
        .param("to_id", relationship.to_id);

        let mut result = graph.execute(type_query).await?;

        if let Some(row) = result.next().await? {
            let from_type: String = row
                .get("from_type")
                .map_err(|_| neo4rs::Error::ConversionError)?;
            let to_type: String = row
                .get("to_type")
                .map_err(|_| neo4rs::Error::ConversionError)?;
            let from_type = parse_goal_type(&from_type)?;
            let to_type = parse_goal_type(&to_type)?;

            // Validate relationship types
            match (from_type, to_type) {
                (GoalType::Task, _) => {
                    return Err(neo4rs::Error::UnexpectedMessage(
                        "Tasks cannot have children".to_string(),
                    ))
                }
                (GoalType::Directive, GoalType::Achievement) => {
                    return Err(neo4rs::Error::UnexpectedMessage(
                        "Directives cannot directly connect to achievements".to_string(),
                    ))
                }
                _ => {}
            }

            // Create relationship if validation passes
            let create_query = neo4rs::query(&format!(
                "MATCH (from:Goal), (to:Goal) 
                     WHERE id(from) = $from_id AND id(to) = $to_id 
                     CREATE (from)-[:{}]->(to)",
                relationship.relationship_type
            ))
            .param("from_id", relationship.from_id)
            .param("to_id", relationship.to_id);

            graph.run(create_query).await?;
            Ok(())
        } else {
            Err(neo4rs::Error::UnexpectedMessage("Goals not found".into()))
        }
    }
}

fn parse_goal_type(goal_type: &str) -> Result<GoalType, neo4rs::Error> {
    match goal_type.to_lowercase().as_str() {
        "directive" => Ok(GoalType::Directive),
        "project" => Ok(GoalType::Project),
        "achievement" => Ok(GoalType::Achievement),
        "routine" => Ok(GoalType::Routine),
        "task" => Ok(GoalType::Task),
        _ => Err(neo4rs::Error::ConversionError),
    }
}