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

    // For events only:
    pub parent_id: Option<i64>,      // Reference to parent task/routine
    pub parent_type: Option<String>, // "task" or "routine"
    pub routine_instance_id: Option<String>, // For routine events
    pub is_deleted: Option<bool>,    // Soft delete for routine events

    // Modified fields for tasks:
    pub due_date: Option<i64>,   // New for tasks
    pub start_date: Option<i64>, // New for tasks (earliest event date)

    // Add these fields to the Goal struct after the existing fields
    pub gcal_event_id: Option<String>, // Google Calendar event ID
    pub gcal_calendar_id: Option<String>, // Google Calendar calendar ID
    pub gcal_sync_enabled: Option<bool>, // Whether this goal should sync to Google Calendar
    pub gcal_last_sync: Option<i64>,   // Last sync timestamp
    pub gcal_sync_direction: Option<String>, // "bidirectional", "to_gcal", "from_gcal"
    pub is_gcal_imported: Option<bool>, // Whether this event was imported from Google Calendar
}

impl Default for Goal {
    fn default() -> Self {
        Goal {
            id: None,
            name: String::new(),
            goal_type: GoalType::Task,
            description: None,
            user_id: None,
            priority: None,
            start_timestamp: None,
            end_timestamp: None,
            completion_date: None,
            next_timestamp: None,
            scheduled_timestamp: None,
            duration: None,
            completed: None,
            frequency: None,
            routine_type: None,
            routine_time: None,
            position_x: None,
            position_y: None,
            parent_id: None,
            parent_type: None,
            routine_instance_id: None,
            is_deleted: None,
            due_date: None,
            start_date: None,
            gcal_event_id: None,
            gcal_calendar_id: None,
            gcal_sync_enabled: None,
            gcal_last_sync: None,
            gcal_sync_direction: None,
            is_gcal_imported: None,
        }
    }
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
                    parent_id: g.parent_id,
                    parent_type: g.parent_type,
                    routine_instance_id: g.routine_instance_id,
                    is_deleted: g.is_deleted,
                    due_date: g.due_date,
                    start_date: g.start_date,
                    gcal_event_id: g.gcal_event_id,
                    gcal_calendar_id: g.gcal_calendar_id,
                    gcal_sync_enabled: g.gcal_sync_enabled,
                    gcal_last_sync: g.gcal_last_sync,
                    gcal_sync_direction: g.gcal_sync_direction,
                    is_gcal_imported: g.is_gcal_imported,
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
    Event, // NEW
}
impl GoalType {
    pub fn as_str(&self) -> &'static str {
        match self {
            GoalType::Directive => "directive",
            GoalType::Project => "project",
            GoalType::Achievement => "achievement",
            GoalType::Routine => "routine",
            GoalType::Task => "task",
            GoalType::Event => "event",
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
            GoalType::Event => write!(f, "event"),
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

#[derive(Debug, Deserialize)]
pub struct ExpandTaskDateRangeRequest {
    pub task_id: i64,
    pub new_start_timestamp: Option<i64>,
    pub new_end_timestamp: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct DuplicateOptions {
    pub include_children: Option<bool>,
    pub keep_parent_links: Option<bool>,
    pub name_suffix: Option<String>,
    pub clear_external_ids: Option<bool>,
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

pub async fn get_goal_handler(
    graph: Graph,
    id: i64,
) -> Result<(StatusCode, Json<Goal>), (StatusCode, String)> {
    let query = format!("MATCH (g:Goal) WHERE g.id = $id {}", GOAL_RETURN_QUERY);

    let mut result = graph
        .execute(neo4rs::query(&query).param("id", id))
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(row) = result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        let goal_data: serde_json::Value = row.get("goal").map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error getting goal data: {}", e),
            )
        })?;

        let goal: Goal = serde_json::from_value(goal_data).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error parsing goal data: {}", e),
            )
        })?;

        Ok((StatusCode::OK, Json(goal)))
    } else {
        Err((StatusCode::NOT_FOUND, "Goal not found".to_string()))
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
            "parent_id",
            "parent_type",
            "routine_instance_id",
            "is_deleted",
            "due_date",
            "start_date",
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
            // Duration is no longer required for tasks - it will be calculated from child events
        }
        GoalType::Event => {
            if goal.parent_id.is_none() {
                validation_errors.push("Events must have a parent task or routine");
            }
            if goal.scheduled_timestamp.is_none() {
                validation_errors.push("Events must have a scheduled time");
            }
            if goal.duration.is_none() {
                validation_errors.push("Events must have a duration");
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
    if let Some(parent_id) = goal.parent_id {
        set_clauses.push("g.parent_id = $parent_id");
        params.push(("parent_id", parent_id.into()));
    }
    if let Some(parent_type) = &goal.parent_type {
        set_clauses.push("g.parent_type = $parent_type");
        params.push(("parent_type", parent_type.clone().into()));
    }
    if let Some(routine_instance_id) = &goal.routine_instance_id {
        set_clauses.push("g.routine_instance_id = $routine_instance_id");
        params.push(("routine_instance_id", routine_instance_id.clone().into()));
    }
    if let Some(is_deleted) = goal.is_deleted {
        set_clauses.push("g.is_deleted = $is_deleted");
        params.push(("is_deleted", is_deleted.into()));
    }
    if let Some(due_date) = goal.due_date {
        set_clauses.push("g.due_date = $due_date");
        params.push(("due_date", due_date.into()));
    }
    if let Some(start_date) = goal.start_date {
        set_clauses.push("g.start_date = $start_date");
        params.push(("start_date", start_date.into()));
    }
    if let Some(gcal_event_id) = &goal.gcal_event_id {
        set_clauses.push("g.gcal_event_id = $gcal_event_id");
        params.push(("gcal_event_id", gcal_event_id.clone().into()));
    }
    if let Some(gcal_calendar_id) = &goal.gcal_calendar_id {
        set_clauses.push("g.gcal_calendar_id = $gcal_calendar_id");
        params.push(("gcal_calendar_id", gcal_calendar_id.clone().into()));
    }
    if let Some(gcal_sync_enabled) = goal.gcal_sync_enabled {
        set_clauses.push("g.gcal_sync_enabled = $gcal_sync_enabled");
        params.push(("gcal_sync_enabled", gcal_sync_enabled.into()));
    }
    if let Some(gcal_last_sync) = goal.gcal_last_sync {
        set_clauses.push("g.gcal_last_sync = $gcal_last_sync");
        params.push(("gcal_last_sync", gcal_last_sync.into()));
    }
    if let Some(gcal_sync_direction) = &goal.gcal_sync_direction {
        set_clauses.push("g.gcal_sync_direction = $gcal_sync_direction");
        params.push(("gcal_sync_direction", gcal_sync_direction.clone().into()));
    }
    if let Some(is_gcal_imported) = goal.is_gcal_imported {
        set_clauses.push("g.is_gcal_imported = $is_gcal_imported");
        params.push(("is_gcal_imported", is_gcal_imported.into()));
    }
    // Log the routine_time being sent in the update
    if let Some(rt) = goal.routine_time {
        use chrono::{TimeZone, Utc};
        println!(
            "[goal.rs] update_goal_handler - Updating goal ID: {}. Sending routine_time: {} ({})",
            id,
            rt,
            Utc.timestamp_millis_opt(rt).unwrap()
        );
    } else {
        println!(
            "[goal.rs] update_goal_handler - Updating goal ID: {}. Sending routine_time: None",
            id
        );
    }

    let query_str = format!(
        "MATCH (g:Goal) WHERE id(g) = $id SET {}",
        set_clauses.join(", ")
    );

    println!("Final query string: {}", query_str);
    //println!("Final params: {:?}", params); // Can be verbose, log specific parts if needed

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
    // First check if this is a routine goal, and if so, delete all its events
    let check_routine_query = query(
        "MATCH (g:Goal) WHERE id(g) = $id 
         RETURN g.goal_type as goal_type",
    )
    .param("id", id);

    let mut check_result = graph.execute(check_routine_query).await.map_err(|e| {
        eprintln!("Error checking goal type: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error checking goal type: {}", e),
        )
    })?;

    if let Some(row) = check_result.next().await.map_err(|e| {
        eprintln!("Error fetching goal type: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error fetching goal type: {}", e),
        )
    })? {
        let goal_type: String = row.get("goal_type").unwrap_or_default();

        if goal_type == "routine" {
            // Delete all events belonging to this routine first
            let delete_events_query = query(
                "MATCH (r:Goal)-[:HAS_EVENT]->(e:Goal)
                 WHERE id(r) = $id
                 DETACH DELETE e",
            )
            .param("id", id);

            graph.run(delete_events_query).await.map_err(|e| {
                eprintln!("Error deleting routine events: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Error deleting routine events: {}", e),
                )
            })?;
        }
    }

    // Now delete the goal itself
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

pub async fn expand_task_date_range_handler(
    graph: Graph,
    user_id: i64,
    request: ExpandTaskDateRangeRequest,
) -> Result<(StatusCode, Json<Goal>), (StatusCode, String)> {
    // Verify the task exists and belongs to the user
    let verify_query = query(
        "MATCH (t:Goal)
         WHERE id(t) = $task_id
         AND t.user_id = $user_id
         AND t.goal_type = 'task'
         RETURN t",
    )
    .param("task_id", request.task_id)
    .param("user_id", user_id);

    let mut result = graph
        .execute(verify_query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .is_none()
    {
        return Err((StatusCode::NOT_FOUND, "Task not found".to_string()));
    }

    // Build update query for the new date range
    let mut set_clauses = Vec::new();
    let mut params = vec![(
        "task_id",
        neo4rs::BoltType::Integer(neo4rs::BoltInteger {
            value: request.task_id,
        }),
    )];

    if let Some(start) = request.new_start_timestamp {
        set_clauses.push("t.start_timestamp = $new_start");
        params.push((
            "new_start",
            neo4rs::BoltType::Integer(neo4rs::BoltInteger { value: start }),
        ));
    }

    if let Some(end) = request.new_end_timestamp {
        set_clauses.push("t.end_timestamp = $new_end");
        params.push((
            "new_end",
            neo4rs::BoltType::Integer(neo4rs::BoltInteger { value: end }),
        ));
    }

    if set_clauses.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "No date changes specified".to_string(),
        ));
    }

    let update_query = format!(
        "MATCH (t:Goal)
         WHERE id(t) = $task_id
         SET {}
         RETURN t",
        set_clauses.join(", ")
    );

    let mut query_builder = query(&update_query);
    for (key, value) in params {
        query_builder = query_builder.param(key, value);
    }

    let mut update_result = graph
        .execute(query_builder)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(row) = update_result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        let updated_task: Goal = row
            .get("t")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        Ok((StatusCode::OK, Json(updated_task)))
    } else {
        Err((
            StatusCode::NOT_FOUND,
            "Task not found after update".to_string(),
        ))
    }
}

pub async fn duplicate_goal_handler(
    graph: Graph,
    user_id: i64,
    goal_id: i64,
    options: DuplicateOptions,
) -> Result<(StatusCode, Json<Goal>), (StatusCode, String)> {
    // 1) Fetch source goal and validate ownership
    let mut fetch_result = graph
        .execute(
            query("MATCH (g:Goal) WHERE id(g) = $id AND g.user_id = $user_id RETURN g")
                .param("id", goal_id)
                .param("user_id", user_id),
        )
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let row = fetch_result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Goal not found".to_string()))?;

    let source: Goal = row
        .get("g")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let name_suffix = options.name_suffix.unwrap_or_else(|| " (Copy)".to_string());
    let keep_parent_links = options.keep_parent_links.unwrap_or(true);
    let include_children = options.include_children.unwrap_or(false);
    let clear_external_ids = options.clear_external_ids.unwrap_or(true);

    if include_children {
        // Not implemented by design (explicitly out of scope)
        // Return an error to make behavior explicit.
        return Err((
            StatusCode::BAD_REQUEST,
            "include_children is not supported".to_string(),
        ));
    }

    // 2) Build duplicated goal
    let mut duplicated = source.clone();
    duplicated.id = None;
    duplicated.user_id = source.user_id.or(Some(user_id));
    duplicated.name = format!("{}{}", source.name, name_suffix);
    duplicated.completed = Some(false);
    duplicated.completion_date = None;

    if clear_external_ids {
        duplicated.gcal_event_id = None;
        duplicated.gcal_last_sync = None;
        duplicated.is_gcal_imported = None;
        // Keep sync configuration and calendar_id as-is so user intent persists
    }

    // 3) Create duplicated node
    let created = duplicated
        .create_goal(&graph)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 4) Copy inbound relationships for non-event goals (parents)
    if keep_parent_links && source.goal_type != GoalType::Event {
        // CHILD relationships
        let copy_child_parents = query(
            "MATCH (p:Goal)-[:CHILD]->(o:Goal) WHERE id(o) = $old_id
             WITH p
             MATCH (n:Goal) WHERE id(n) = $new_id
             MERGE (p)-[:CHILD]->(n)",
        )
        .param("old_id", goal_id)
        .param("new_id", created.id.unwrap());
        graph
            .run(copy_child_parents)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        // QUEUE relationships (for achievements)
        let copy_queue_parents = query(
            "MATCH (p:Goal)-[:QUEUE]->(o:Goal) WHERE id(o) = $old_id
             WITH p
             MATCH (n:Goal) WHERE id(n) = $new_id
             MERGE (p)-[:QUEUE]->(n)",
        )
        .param("old_id", goal_id)
        .param("new_id", created.id.unwrap());
        graph
            .run(copy_queue_parents)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    // 5) For events: ensure HAS_EVENT relationship to parent exists
    if source.goal_type == GoalType::Event {
        if let (Some(parent_id), Some(_parent_type)) = (source.parent_id, &source.parent_type) {
            let rel_query = query(
                "MATCH (p:Goal), (e:Goal)
                 WHERE id(p) = $parent_id AND id(e) = $event_id
                 MERGE (p)-[:HAS_EVENT]->(e)",
            )
            .param("parent_id", parent_id)
            .param("event_id", created.id.unwrap());

            graph
                .run(rel_query)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
    }

    Ok((StatusCode::CREATED, Json(created)))
}

impl Goal {
    pub async fn create_goal(&self, graph: &Graph) -> Result<Goal, neo4rs::Error> {
        // Enhanced logging for routine_time specifically
        println!(
            "[goal.rs] create_goal - Attempting to create goal. Received routine_time: {:?}",
            self.routine_time
        );
        if let Some(rt) = self.routine_time {
            // Log the UTC interpretation of the received timestamp
            use chrono::{TimeZone, Utc};
            println!(
                "[goal.rs] create_goal - Received routine_time as UTC DateTime: {}",
                Utc.timestamp_millis_opt(rt).unwrap()
            );
        }

        if DEBUG_PRINTS {
            println!("Attempting to create goal in database: {:?}", self);
            println!("Routine fields in incoming goal:");
            println!("routine_type: {:?}", self.routine_type);
            //println!("routine_time: {:?}", self.routine_time); // Covered above
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
            (
                "parent_id",
                self.parent_id
                    .map(|v| neo4rs::BoltType::Integer(neo4rs::BoltInteger { value: v })),
            ),
            (
                "parent_type",
                self.parent_type.as_ref().map(|v| v.clone().into()),
            ),
            (
                "routine_instance_id",
                self.routine_instance_id.as_ref().map(|v| v.clone().into()),
            ),
            ("is_deleted", self.is_deleted.map(|v| v.into())),
            (
                "due_date",
                self.due_date
                    .map(|ts| neo4rs::BoltType::Integer(neo4rs::BoltInteger { value: ts })),
            ),
            (
                "start_date",
                self.start_date
                    .map(|ts| neo4rs::BoltType::Integer(neo4rs::BoltInteger { value: ts })),
            ),
            (
                "gcal_event_id",
                self.gcal_event_id.as_ref().map(|v| v.clone().into()),
            ),
            (
                "gcal_calendar_id",
                self.gcal_calendar_id.as_ref().map(|v| v.clone().into()),
            ),
            (
                "gcal_sync_enabled",
                self.gcal_sync_enabled.map(|v| v.into()),
            ),
            (
                "gcal_last_sync",
                self.gcal_last_sync
                    .map(|ts| neo4rs::BoltType::Integer(neo4rs::BoltInteger { value: ts })),
            ),
            (
                "gcal_sync_direction",
                self.gcal_sync_direction.as_ref().map(|v| v.clone().into()),
            ),
            ("is_gcal_imported", self.is_gcal_imported.map(|v| v.into())),
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
                (GoalType::Event, _, _) => {
                    return Err(neo4rs::Error::UnexpectedMessage(
                        "Events cannot have children".to_string(),
                    ))
                }
                // Allow directives to connect to achievements
                (GoalType::Routine, GoalType::Task, "CHILD") => {
                    return Err(neo4rs::Error::UnexpectedMessage(
                        "Tasks cannot be children of routines".to_string(),
                    ))
                }
                (_, GoalType::Event, _) => {
                    return Err(neo4rs::Error::UnexpectedMessage(
                        "Events cannot be targets of relationships".to_string(),
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
        "event" => Ok(GoalType::Event),
        _ => Err(neo4rs::Error::ConversionError),
    }
}
