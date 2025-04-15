// Removed the unused Axum imports, as this file no longer
// needs to implement a web-handler function:
use axum::http::StatusCode; // Import StatusCode
use neo4rs::Graph;
use serde::Serialize; // Removed unused Deserialize
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

// Import the relevant base functions and types
use crate::tools::calendar::get_calendar_data;
use crate::tools::day::{get_day_tasks, toggle_complete_task};
use crate::tools::goal::{
    create_goal_handler, create_relationship_handler, delete_goal_handler,
    delete_relationship_handler, toggle_completion, update_goal_handler, Goal, GoalUpdate,
    Relationship,
};
use crate::tools::list::get_list_data;
use crate::tools::network::{get_network_data, update_node_position};
use crate::tools::routine::process_user_routines;
use crate::tools::traversal::query_hierarchy_handler;

// The same alias as in http_handler for user locks
type UserLocks = Arc<Mutex<HashMap<i64, Arc<Mutex<()>>>>>;

/// This matches the FunctionCall struct from `query.rs`.
#[allow(dead_code)] // Allow dead code as it's not constructed here but matches query.rs
#[derive(Debug, Clone)]
pub struct FunctionCall {
    pub name: String,
    pub args: serde_json::Value,
}

/// A container describing the set of tool definitions you want to expose.
#[derive(Serialize, Clone, Debug)]
pub struct Tool {
    /// Each tool can declare one or more "functions" that can be called.
    #[serde(rename = "functionDeclarations")]
    pub function_declarations: Vec<FunctionDeclaration>,
}

/// Metadata describing a single function/tool.
#[derive(Serialize, Clone, Debug)]
pub struct FunctionDeclaration {
    pub name: String,
    pub description: String,
    pub parameters: ParameterDefinition,
}

/// JSON schema describing the parameters object for a tool.
#[derive(Serialize, Clone, Debug)]
pub struct ParameterDefinition {
    #[serde(rename = "type")]
    pub type_: String,
    pub properties: serde_json::Map<String, serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<Vec<String>>,
}

/// Return the complete list of Tools for all your tool endpoints.
pub fn get_tools() -> Vec<Tool> {
    let mut function_declarations = vec![];

    // 1) create_goal
    function_declarations.push(FunctionDeclaration {
        name: "create_goal".to_string(),
        description: "Creates a new goal.".to_string(),
        parameters: ParameterDefinition {
            type_: "object".to_string(),
            properties: {
                let mut props = serde_json::Map::new();
                /*props.insert(
                    "user_id".to_string(),
                    serde_json::json!({
                        "type": "number",
                        "description": "The ID of the user creating the goal."
                    }),
                );*/
                props.insert(
                    "goal".to_string(),
                    serde_json::json!({
                        "type": "object",
                        "description": "The Goal object to create (name, goal_type, etc.)."
                    }),
                );
                props
            },
            required: Some(vec!["goal".to_string()]),
        },
    });

    // 2) update_goal
    function_declarations.push(FunctionDeclaration {
        name: "update_goal".to_string(),
        description: "Updates an existing goal by ID.".to_string(),
        parameters: ParameterDefinition {
            type_: "object".to_string(),
            properties: {
                let mut props = serde_json::Map::new();
                props.insert(
                    "id".to_string(),
                    serde_json::json!({
                        "type": "number",
                        "description": "The ID of the goal to update."
                    }),
                );
                props.insert(
                    "goal".to_string(),
                    serde_json::json!({
                        "type": "object",
                        "description": "The updated Goal object."
                    }),
                );
                props
            },
            required: Some(vec!["id".to_string(), "goal".to_string()]),
        },
    });

    // 3) delete_goal
    function_declarations.push(FunctionDeclaration {
        name: "delete_goal".to_string(),
        description: "Deletes an existing goal by goal ID.".to_string(),
        parameters: ParameterDefinition {
            type_: "object".to_string(),
            properties: {
                let mut props = serde_json::Map::new();
                props.insert(
                    "id".to_string(),
                    serde_json::json!({
                        "type": "number",
                        "description": "The ID of the goal to delete."
                    }),
                );
                props
            },
            required: Some(vec!["id".to_string()]),
        },
    });

    // 4) create_relationship
    function_declarations.push(FunctionDeclaration {
        name: "create_relationship".to_string(),
        description: "Creates a relationship between two goals (e.g. parent/child.".to_string(),
        parameters: ParameterDefinition {
            type_: "object".to_string(),
            properties: {
                let mut props = serde_json::Map::new();
                props.insert(
                    "relationship".to_string(),
                    serde_json::json!({
                        "type": "object",
                        "description": "Relationship object with from_id, to_id, relationship_type, etc."
                    }),
                );
                props
            },
            required: Some(vec!["relationship".to_string()]),
        },
    });

    // 5) delete_relationship
    function_declarations.push(FunctionDeclaration {
        name: "delete_relationship".to_string(),
        description: "Deletes a relationship between two goals.".to_string(),
        parameters: ParameterDefinition {
            type_: "object".to_string(),
            properties: {
                let mut props = serde_json::Map::new();
                props.insert(
                    "from_id".to_string(),
                    serde_json::json!({
                        "type": "number",
                        "description": "The 'from' goal ID."
                    }),
                );
                props.insert(
                    "to_id".to_string(),
                    serde_json::json!({
                        "type": "number",
                        "description": "The 'to' goal ID."
                    }),
                );
                props
            },
            required: Some(vec!["from_id".to_string(), "to_id".to_string()]),
        },
    });

    // 6) toggle_completion
    function_declarations.push(FunctionDeclaration {
        name: "toggle_completion".to_string(),
        description: "Toggles the completion state of a goal via a GoalUpdate object.".to_string(),
        parameters: ParameterDefinition {
            type_: "object".to_string(),
            properties: {
                let mut props = serde_json::Map::new();
                props.insert(
                    "update".to_string(),
                    serde_json::json!({
                        "type": "object",
                        "description": "A GoalUpdate object (id, completed, completion_date, etc.)."
                    }),
                );
                props
            },
            required: Some(vec!["update".to_string()]),
        },
    });

    // 7) get_network_data
    function_declarations.push(FunctionDeclaration {
        name: "get_network_data".to_string(),
        description: "Fetches the entire network data for a given user.".to_string(),
        parameters: ParameterDefinition {
            type_: "object".to_string(),
            properties: {
<<<<<<< HEAD
                let props = serde_json::Map::new();
=======
                // Directly return the map, fixing let_and_return
                 // Directly return the map, fixing let_and_return
                /*props.insert(
                    "user_id".to_string(),
                    serde_json::json!({
                        "type": "number",
                        "description": "The ID of the user."
                    }),
                );*/
<<<<<<< HEAD
                props
=======
                serde_json::Map::new() // Directly return the map
                serde_json::Map::new() // Directly return the map
            },
            //required: Some(vec!["user_id".to_string()]),
            required: None,
        },
    });

    // 8) update_node_position
    function_declarations.push(FunctionDeclaration {
        name: "update_node_position".to_string(),
        description: "Updates the position (x, y) of a node in the network graph.".to_string(),
        parameters: ParameterDefinition {
            type_: "object".to_string(),
            properties: {
                let mut props = serde_json::Map::new();
                props.insert(
                    "id".to_string(),
                    serde_json::json!({
                        "type": "number",
                        "description": "The ID of the goal/node to update."
                    }),
                );
                props.insert(
                    "x".to_string(),
                    serde_json::json!({
                        "type": "number",
                        "description": "The new X position."
                    }),
                );
                props.insert(
                    "y".to_string(),
                    serde_json::json!({
                        "type": "number",
                        "description": "The new Y position."
                    }),
                );
                props
            },
            required: Some(vec!["id".to_string(), "x".to_string(), "y".to_string()]),
        },
    });

    // 9) query_hierarchy
    function_declarations.push(FunctionDeclaration {
        name: "query_hierarchy".to_string(),
        description: "Queries a hierarchy of goals starting from a given goal ID.".to_string(),
        parameters: ParameterDefinition {
            type_: "object".to_string(),
            properties: {
                let mut props = serde_json::Map::new();
                props.insert(
                    "goal_id".to_string(),
                    serde_json::json!({
                        "type": "number",
                        "description": "The ID of the root goal for hierarchy traversal."
                    }),
                );
                props
            },
            required: Some(vec!["goal_id".to_string()]),
        },
    });

    // 10) get_calendar_data
    function_declarations.push(FunctionDeclaration {
        name: "get_calendar_data".to_string(),
        description: "Fetches calendar-related data for a user.".to_string(),
        parameters: ParameterDefinition {
            type_: "object".to_string(),
            properties: {
                let mut props = serde_json::Map::new();
                props.insert(
                    "user_id".to_string(),
                    serde_json::json!({
                        "type": "number",
                        "description": "The ID of the user."
                    }),
                );
                props
            },
            required: Some(vec!["user_id".to_string()]),
        },
    });

    // 11) get_list_data
    function_declarations.push(FunctionDeclaration {
        name: "get_list_data".to_string(),
        description: "Fetches list-related data for a user (e.g., tasks, notes).".to_string(),
        parameters: ParameterDefinition {
            type_: "object".to_string(),
            properties: {
                let props = serde_json::Map::new();
                /*props.insert(
                    "user_id".to_string(),
                    serde_json::json!({
                        "type": "number",
                        "description": "The ID of the user."
                    }),
                );*/
                props
            },
            //required: Some(vec!["user_id".to_string()]),
            required: None,
        },
    });

    // 12) get_day_tasks
    function_declarations.push(FunctionDeclaration {
        name: "get_day_tasks".to_string(),
        description: "Retrieves tasks for a specified day or day range, for a given user."
            .to_string(),
        parameters: ParameterDefinition {
            type_: "object".to_string(),
            properties: {
                let mut props = serde_json::Map::new();
                /*props.insert(
                    "user_id".to_string(),
                    serde_json::json!({
                        "type": "number",
                        "description": "The ID of the user."
                    }),
                );*/
                props.insert(
                    "start_timestamp".to_string(),
                    serde_json::json!({
                        "type": "number",
                        "description": "Optional start timestamp (millis)."
                    }),
                );
                props.insert(
                    "end_timestamp".to_string(),
                    serde_json::json!({
                        "type": "number",
                        "description": "Optional end timestamp (millis)."
                    }),
                );
                props
            },
            //required: Some(vec!["user_id".to_string()]),
            required: None,
        },
    });

    // 13) toggle_complete_task
    function_declarations.push(FunctionDeclaration {
        name: "toggle_complete_task".to_string(),
        description: "Toggles a day's task by goal ID to mark it complete/incomplete.".to_string(),
        parameters: ParameterDefinition {
            type_: "object".to_string(),
            properties: {
                let mut props = serde_json::Map::new();
                props.insert(
                    "id".to_string(),
                    serde_json::json!({
                        "type": "number",
                        "description": "The ID of the goal/task to toggle."
                    }),
                );
                props
            },
            required: Some(vec!["id".to_string()]),
        },
    });

    // 14) process_user_routines
    function_declarations.push(FunctionDeclaration {
        name: "process_user_routines".to_string(),
        description: "Processes all user routines for a given user EOD timestamp and user ID."
            .to_string(),
        parameters: ParameterDefinition {
            type_: "object".to_string(),
            properties: {
                let mut props = serde_json::Map::new();
                props.insert(
                    "user_eod_timestamp".to_string(),
                    serde_json::json!({
                        "type": "number",
                        "description": "The user's End-Of-Day timestamp (millis)."
                    }),
                );
                /*props.insert(
                    "user_id".to_string(),
                    serde_json::json!({
                        "type": "number",
                        "description": "The user ID whose routines should be processed."
                    }),
                );*/
                props
            },
            //required: Some(vec!["user_eod_timestamp".to_string(), "user_id".to_string()]),
            required: Some(vec!["user_eod_timestamp".to_string()]),
        },
    });

    vec![Tool {
        function_declarations,
    }]
}

// ======================================================================
// Main function to handle a tool function-call from your LLM pipeline.
// ======================================================================

/// Plain function to execute a tool call, without Axum route handling.
/// Takes a `Graph`, `UserLocks`, and a `FunctionCall` object.

/// Dispatches calls to the correct base function based on the `tool_name`,
/// extracts/validates arguments from `args`, and calls the corresponding handler.
/// Returns `Result<serde_json::Value, String>` (on success, you get some JSON data; on error, you get a string).
pub async fn dispatch_tool(
    tool_name: &str,
    args: &serde_json::Value,
    graph: &Graph,
    user_locks: &UserLocks,
    user_id: i64,
) -> Result<serde_json::Value, String> {
    match tool_name {
        // 1) create_goal
        "create_goal" => {
            //let user_id = must_get_i64(args, "user_id")?;
            let goal_val = must_get_value(args, "goal")?;
            let goal_obj: Goal = serde_json::from_value(goal_val)
                .map_err(|e| format!("Invalid 'goal' object: {e}"))?;
            let result = create_goal_handler(graph.clone(), user_id, goal_obj).await;
            wrap_result(result)
        }

        // 2) update_goal
        "update_goal" => {
            let id = must_get_i64(args, "id")?;
            let goal_val = must_get_value(args, "goal")?;
            let goal_obj: Goal = serde_json::from_value(goal_val)
                .map_err(|e| format!("Invalid 'goal' object: {e}"))?;
            let result = update_goal_handler(graph.clone(), id, goal_obj).await;
            wrap_result(result)
        }

        // 3) delete_goal
        "delete_goal" => {
            let id = must_get_i64(args, "id")?;
            let result = delete_goal_handler(graph.clone(), id).await;
            wrap_result(result)
        }

        // 4) create_relationship
        "create_relationship" => {
            let rel_val = must_get_value(args, "relationship")?;
            let rel_obj: Relationship = serde_json::from_value(rel_val)
                .map_err(|e| format!("Invalid 'relationship': {e}"))?;
            let result = create_relationship_handler(graph.clone(), rel_obj).await;
            wrap_result(result)
        }

        // 5) delete_relationship
        "delete_relationship" => {
            let from_id = must_get_i64(args, "from_id")?;
            let to_id = must_get_i64(args, "to_id")?;
            let result = delete_relationship_handler(graph.clone(), from_id, to_id).await;
            wrap_result(result)
        }

        // 6) toggle_completion
        "toggle_completion" => {
            let update_val = must_get_value(args, "update")?;
            let update_obj: GoalUpdate =
                serde_json::from_value(update_val).map_err(|e| format!("Invalid 'update': {e}"))?;
            let result = toggle_completion(graph.clone(), update_obj).await;
            wrap_result(result)
        }

        // 7) get_network_data
        "get_network_data" => {
            //let user_id = must_get_i64(args, "user_id")?;
            let result = get_network_data(graph.clone(), user_id).await;
            wrap_result(result)
        }

        // 8) update_node_position
        "update_node_position" => {
            let id = must_get_i64(args, "id")?;
            let x = must_get_f64(args, "x")?;
            let y = must_get_f64(args, "y")?;
            let result = update_node_position(graph.clone(), id, x, y).await;
            wrap_result(result)
        }

        // 9) query_hierarchy
        "query_hierarchy" => {
            let goal_id = must_get_i64(args, "goal_id")?;
            let result = query_hierarchy_handler(graph.clone(), goal_id).await;
            wrap_result(result)
        }

        // 10) get_calendar_data
        "get_calendar_data" => {
            //let user_id = must_get_i64(args, "user_id")?;
            let result = get_calendar_data(graph.clone(), user_id).await;
            wrap_result(result)
        }

        // 11) get_list_data
        "get_list_data" => {
            //let user_id = must_get_i64(args, "user_id")?;
            let result = get_list_data(graph.clone(), user_id).await;
            wrap_result(result)
        }

        // 12) get_day_tasks
        "get_day_tasks" => {
            //let user_id = must_get_i64(args, "user_id")?;
            let start_timestamp = args.get("start_timestamp").and_then(|v| v.as_i64());
            let end_timestamp = args.get("end_timestamp").and_then(|v| v.as_i64());
            let result =
                get_day_tasks(graph.clone(), user_id, start_timestamp, end_timestamp).await;
            wrap_result(result)
        }

        // 13) toggle_complete_task
        "toggle_complete_task" => {
            let id = must_get_i64(args, "id")?;
            let result = toggle_complete_task(graph.clone(), id).await;
            wrap_result(result)
        }

        // 14) process_user_routines
        "process_user_routines" => {
            let user_eod_timestamp = must_get_i64(args, "user_eod_timestamp")?;
            //let user_id = must_get_i64(args, "user_id")?;
            let result = process_user_routines(
                user_eod_timestamp,
                graph.clone(),
                user_id,
                user_locks.clone(),
            )
            .await;
            wrap_result(result)
        }

        // Fallback
        other => Err(format!("Unknown tool_name: '{other}'")),
    }
}

/// Wraps a Result<T, (u16, String)> from the various tool handlers into a clean
/// `Result<serde_json::Value, String>`. This way, your tools can return a numeric code
/// plus an error string, and we convert that to a simple `Err(String)` or a JSON success.
// Updated to accept (StatusCode, String) as the error type, matching the tool handlers.
fn wrap_result<T: std::fmt::Debug>(
    base_result: Result<T, (StatusCode, String)>, // Changed error type from (u16, String)
) -> Result<serde_json::Value, String> {
    match base_result {
        Ok(success_payload) => {
            // We’ll just convert the success payload to a debug string here.
            // This provides a consistent, simple JSON structure for the LLM.
            let json_val = serde_json::json!({
                "result": "success",
                "data": format!("{:?}", success_payload),
            });
            Ok(json_val)
        }
        Err((_status_code, err_message)) => {
            // Destructure (StatusCode, String)
            // Return only the error message string
            Err(err_message)
        }
    }
}

// -----------------------------------------------------------
// Helper: Extract an i64 from `args[key]` or return an error.
// -----------------------------------------------------------
fn must_get_i64(args: &serde_json::Value, key: &str) -> Result<i64, String> {
    args.get(key)
        .and_then(|v| v.as_i64())
        .ok_or_else(|| format!("Missing or invalid i64 parameter: '{}'", key))
}

// ------------------------------------------------------------
// Helper: Extract a f64 from `args[key]` or return an error.
// ------------------------------------------------------------
fn must_get_f64(args: &serde_json::Value, key: &str) -> Result<f64, String> {
    args.get(key)
        .and_then(|v| v.as_f64())
        .ok_or_else(|| format!("Missing or invalid f64 parameter: '{}'", key))
}

// ---------------------------------------------------------------------
// Helper: Extract any JSON value from `args[key]` or return an error.
// ---------------------------------------------------------------------
fn must_get_value(args: &serde_json::Value, key: &str) -> Result<serde_json::Value, String> {
    args.get(key)
        .cloned()
        .ok_or_else(|| format!("Missing required parameter: '{}'", key))
}

