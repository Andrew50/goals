/*
manage operations on goals and relationships between goals
doesnt include fetching of all goals as that is handled by endpoints specific to that frontend view
*/
use axum::{http::StatusCode, Json};
use neo4rs::{query, Graph};
use serde::{Deserialize, Serialize};
use serde_json::json;

pub const DEBUG_PRINTS: bool = false;

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
    //pub previous_timestamp: Option<i64>,
    pub scheduled_timestamp: Option<i64>,
    pub duration: Option<i32>,
    pub completed: Option<bool>,
    pub frequency: Option<String>,
    pub routine_type: Option<String>,
    pub routine_time: Option<i64>,
    pub position_x: Option<f64>,
    pub position_y: Option<f64>,
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
                    routine_type: g.routine_type,
                    routine_time: g.routine_time,
                    position_x: g.position_x,
                    position_y: g.position_y,
                    id: id(g)
                 } as g";

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum GoalType {
    Directive,
    Project,
    Achievement,
    Routine,
    Task,
}
#[derive(Debug, Deserialize, Serialize, Clone)]
pub enum RelationshipType {
    Child,
    Queue,
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

#[derive(Debug, Deserialize, Serialize)]
pub struct Relationship {
    pub from_id: i64,
    pub to_id: i64,
    pub relationship_type: String,
}

// Add this new struct for partial updates
#[derive(Debug, Deserialize)]
pub struct GoalUpdate {
    pub id: i64,
    pub completed: bool,
}

pub async fn delete_relationship_handler(
    graph: Graph,
    from_id: i64,
    to_id: i64,
) -> Result<StatusCode, (StatusCode, String)> {
    let query = query(
        "MATCH (from:Goal)-[r]->(to:Goal) 
         WHERE id(from) = $from_id AND id(to) = $to_id 
         DELETE r",
    )
    .param("from_id", from_id)
    .param("to_id", to_id);

    match graph.run(query).await {
        Ok(_) => Ok(StatusCode::OK),
        Err(e) => {
            eprintln!("Error deleting relationship: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error deleting relationship: {}", e),
            ))
        }
    }
}

pub async fn create_goal_handler(
    graph: Graph,
    user_id: i64,
    goal: Goal,
) -> Result<(StatusCode, Json<Goal>), (StatusCode, String)> {
    if DEBUG_PRINTS {
        println!("Received goal creation request: {:?}", goal);
    }

    // Deserialize the raw JSON to check for extra fields
    let raw_value: serde_json::Value = serde_json::to_value(&goal)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let serde_json::Value::Object(map) = raw_value {
        let known_fields = vec![
            "id",
            "name",
            "goal_type",
            "description",
            "user_id",
            "priority",
            "start_timestamp",
            "end_timestamp",
            "completion_date",
            "next_timestamp",
            "scheduled_timestamp",
            "duration",
            "completed",
            "frequency",
            "routine_type",
            "routine_time",
            "position_x",
            "position_y",
        ];

        let unknown_fields: Vec<String> = map
            .keys()
            .filter(|k| !known_fields.contains(&k.as_str()))
            .cloned()
            .collect();

        if !unknown_fields.is_empty() {
            println!(
                "Warning: Received unhandled fields in goal creation: {:?}",
                unknown_fields
            );
        }
    }

    // Create a mutable copy of the goal with the user_id and start_timestamp
    let goal = Goal {
        user_id: Some(user_id),
        ..goal
    };

    if DEBUG_PRINTS {
        println!("Processed goal creation request: {:?}", goal);
    }

    let mut validation_errors = Vec::new();
    if goal.name.trim().is_empty() {
        validation_errors.push("Name is required");
    }
    let error_msg = format!("Invalid user_id {}", goal.user_id.unwrap_or(0));
    if goal.user_id.unwrap_or(0) < 0 {
        validation_errors.push(&error_msg);
    }
    match goal.goal_type {
        GoalType::Routine => {
            if goal.frequency.is_none() {
                validation_errors.push("Frequency is required for routine goals");
            }
            if goal.start_timestamp.is_none() {
                validation_errors.push("Start timestamp is required for routine goals");
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
        }
        _ => {}
    }
    if !validation_errors.is_empty() {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("Validation failed:\n- {}", validation_errors.join("\n- ")),
        ));
    }

    match goal.create_goal(&graph).await {
        Ok(created_goal) => {
            println!("Successfully created goal: {:?}", created_goal);

            Ok((StatusCode::CREATED, Json(created_goal)))
        }
        Err(e) => {
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
    graph: Graph,
    relationship: Relationship,
) -> Result<(StatusCode, &'static str), (StatusCode, String)> {
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
    graph: Graph,
    id: i64,
    goal: Goal,
) -> Result<StatusCode, (StatusCode, String)> {
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
    if let Some(routine_type) = &goal.routine_type {
        set_clauses.push("g.routine_type = $routine_type");
        params.push(("routine_type", routine_type.clone().into()));
    }
    if let Some(routine_time) = goal.routine_time {
        set_clauses.push("g.routine_time = $routine_time");
        params.push(("routine_time", routine_time.into()));
    }
    if let Some(x) = goal.position_x {
        set_clauses.push("g.position_x = $position_x");
        params.push(("position_x", x.into()));
    }
    if let Some(y) = goal.position_y {
        set_clauses.push("g.position_y = $position_y");
        params.push(("position_y", y.into()));
    }

    let query_str = format!(
        "MATCH (g:Goal) WHERE id(g) = $id SET {}",
        set_clauses.join(", ")
    );

    println!("Final query string: {}", query_str);
    println!("Final params: {:?}", params);

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
    graph: Graph,
    id: i64,
) -> Result<StatusCode, (StatusCode, String)> {
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

pub async fn toggle_completion(
    graph: Graph,
    update: GoalUpdate,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    println!(
        "Toggling completion for goal {}: {}",
        update.id, update.completed
    );

    // First, check if this is an achievement type goal
    let type_query = query(
        "MATCH (g:Goal) WHERE id(g) = $id 
         RETURN g.goal_type as goal_type, g.completed as current_completed",
    )
    .param("id", update.id);

    let mut result = graph.execute(type_query).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )
    })?;

    if let Some(row) = result.next().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error fetching result: {}", e),
        )
    })? {
        let goal_type: String = row.get("goal_type").map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error getting goal type: {}", e),
            )
        })?;

        if goal_type == "achievement" {
            if update.completed {
                // Verify this is the highest uncompleted achievement in the queue
                let queue_check = query(
                    "MATCH (g:Goal)
                     WHERE id(g) = $id
                     OPTIONAL MATCH (prev:Goal)-[:QUEUE*]->(g)
                     WHERE prev.completed = false
                     RETURN count(prev) as count",
                )
                .param("id", update.id);

                let mut check_result = graph.execute(queue_check).await.map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Database error: {}", e),
                    )
                })?;

                if let Some(check_row) = check_result.next().await.map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Error checking queue: {}", e),
                    )
                })? {
                    let count: i64 = check_row.get("count").unwrap_or(0);
                    if count > 0 {
                        return Err((
                            StatusCode::BAD_REQUEST,
                            "Cannot complete this achievement as there are uncompleted achievements before it in the queue"
                                .to_string(),
                        ));
                    }
                }

                // Complete this achievement and transfer relationships to next in queue
                let transfer_query = query(
                    "MATCH (current:Goal) WHERE id(current) = $id
                     OPTIONAL MATCH (current)-[:QUEUE]->(next:Goal)
                     WHERE next.completed = false
                     OPTIONAL MATCH (parent:Goal)-[r:CHILD]->(current)
                     WITH current, next, collect(parent) as parents
                     SET current.completed = true
                     WITH current, next, parents
                     WHERE next IS NOT NULL
                     UNWIND parents as parent
                     MERGE (parent)-[:CHILD]->(next)
                     WITH current, next, parent
                     MATCH (parent)-[r:CHILD]->(current)
                     DELETE r
                     WITH current, next
                     OPTIONAL MATCH (current)-[r:CHILD]->(child:Goal)
                     WHERE NOT child = next
                     WITH current, next, child, r
                     WHERE child IS NOT NULL
                     MERGE (next)-[:CHILD]->(child)
                     DELETE r",
                )
                .param("id", update.id);

                graph.run(transfer_query).await.map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Error updating relationships: {}", e),
                    )
                })?;
            } else {
                // Uncomplete this achievement and all following in queue
                let uncomplete_query = query(
                    "MATCH (current:Goal) WHERE id(current) = $id
                     OPTIONAL MATCH (current)-[:QUEUE*]->(following:Goal)
                     WITH current, collect(following) as following_goals
                     SET current.completed = false
                     FOREACH (goal IN following_goals | SET goal.completed = false)
                     WITH current, following_goals
                     UNWIND following_goals as following
                     OPTIONAL MATCH (parent:Goal)-[r:CHILD]->(following)
                     WITH current, following, following_goals, collect(parent) as parents
                     UNWIND parents as parent
                     MERGE (parent)-[:CHILD]->(current)
                     WITH current, following, following_goals, parent
                     MATCH (parent)-[r:CHILD]->(following)
                     DELETE r
                     WITH current, following_goals
                     UNWIND following_goals as following
                     OPTIONAL MATCH (following)-[r:CHILD]->(child:Goal)
                     WHERE child IS NOT NULL
                     WITH current, child, r
                     MERGE (current)-[:CHILD]->(child)
                     DELETE r",
                )
                .param("id", update.id);

                graph.run(uncomplete_query).await.map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Error updating relationships: {}", e),
                    )
                })?;
            }
        } else if goal_type == "task" || goal_type == "project" {
            // For non-achievement goals, just toggle completion
            let toggle_query = query(
                "MATCH (g:Goal) 
                 WHERE id(g) = $id 
                 SET g.completed = $completed",
            )
            .param("id", update.id)
            .param("completed", update.completed);

            graph.run(toggle_query).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Database error: {}", e),
                )
            })?;
        } else {
            return Err((
                StatusCode::BAD_REQUEST,
                "Cannot toggle completion for non achievement, task, or project goals".to_string(),
            ));
        }

        Ok(Json(json!({ "completed": update.completed })))
    } else {
        Err((StatusCode::NOT_FOUND, "Goal not found".to_string()))
    }
}

impl Goal {
    pub async fn create_goal(&self, graph: &Graph) -> Result<Goal, neo4rs::Error> {
        if DEBUG_PRINTS {
            println!("Attempting to create goal in database: {:?}", self);
            println!("Routine fields in incoming goal:");
            println!("routine_type: {:?}", self.routine_type);
            println!("routine_time: {:?}", self.routine_time);
        }

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
            (
                "routine_type",
                self.routine_type.as_ref().map(|v| v.clone().into()),
            ),
            (
                "routine_time",
                self.routine_time
                    .map(|ts| neo4rs::BoltType::Integer(neo4rs::BoltInteger { value: ts })),
            ),
            (
                "position_x",
                self.position_x
                    .map(|v| neo4rs::BoltType::Float(neo4rs::BoltFloat { value: v })),
            ),
            (
                "position_y",
                self.position_y
                    .map(|v| neo4rs::BoltType::Float(neo4rs::BoltFloat { value: v })),
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

        if DEBUG_PRINTS {
            println!("Final query string: {}", query_str);
            println!("Final params: {:?}", params);
        }

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
            match (
                from_type,
                to_type,
                relationship.relationship_type.to_uppercase().as_str(),
            ) {
                (GoalType::Task, _, _) => {
                    return Err(neo4rs::Error::UnexpectedMessage(
                        "Tasks cannot have children".to_string(),
                    ))
                }
                (GoalType::Directive, GoalType::Achievement, _) => {
                    return Err(neo4rs::Error::UnexpectedMessage(
                        "Directives cannot directly connect to achievements".to_string(),
                    ))
                }
                (_, _, "QUEUE") if from_type != GoalType::Achievement => {
                    return Err(neo4rs::Error::UnexpectedMessage(
                        "Queue relationships can only be created on achievements".to_string(),
                    ))
                }
                _ => {}
            }

            // Create relationship if validation passes
            let query_string = format!(
                "MATCH (from:Goal), (to:Goal) 
                     WHERE id(from) = $from_id AND id(to) = $to_id 
                     CREATE (from)-[:{}]->(to)",
                relationship.relationship_type.to_uppercase()
            );
            if DEBUG_PRINTS {
                println!("Query string: {}", query_string);
                println!("with params: {:?}", relationship);
            }
            let create_query = neo4rs::query(&query_string)
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
