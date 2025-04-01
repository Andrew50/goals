use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Extension, Json, Router,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

// Import necessary modules for tool execution
use crate::calendar;
use crate::day;
use crate::goal;
use crate::network;
use crate::routine;

// Struct for the Gemini request
#[derive(Deserialize)]
pub struct GeminiRequest {
    query: String,
    conversation_id: Option<String>,
    message_history: Option<Vec<Message>>,
}

// Struct for the Gemini response
#[derive(Serialize)]
pub struct GeminiResponse {
    response: String,
    conversation_id: String,
    message_history: Vec<Message>,
}

// Struct for conversation messages
#[derive(Serialize, Deserialize, Clone)]
pub struct Message {
    role: String,
    content: String,
}

// Struct for tool descriptions
#[derive(Serialize)]
struct ToolDescription {
    name: String,
    description: String,
    parameters: serde_json::Value,
}

// Struct for Gemini API request
#[derive(Serialize)]
struct GeminiApiRequest {
    contents: Vec<GeminiContent>,
    tools: Vec<Tool>,
}

#[derive(Serialize)]
struct GeminiContent {
    parts: Vec<Part>,
    role: String,
}

#[derive(Serialize)]
struct Part {
    text: String,
}

#[derive(Serialize)]
struct Tool {
    function_declarations: Vec<FunctionDeclaration>,
}

#[derive(Serialize)]
struct FunctionDeclaration {
    name: String,
    description: String,
    parameters: serde_json::Value,
}

// Struct for Gemini API response
#[derive(Deserialize)]
struct GeminiApiResponse {
    candidates: Vec<Candidate>,
}

#[derive(Deserialize)]
struct Candidate {
    content: CandidateContent,
}

#[derive(Deserialize)]
struct CandidateContent {
    parts: Vec<ContentPart>,
}

#[derive(Deserialize)]
struct ContentPart {
    text: Option<String>,
    function_call: Option<FunctionCall>,
}

#[derive(Deserialize)]
struct FunctionCall {
    name: String,
    args: serde_json::Value,
}

// Create the routes for the query module
pub fn create_routes() -> Router {
    Router::new().route("/", post(handle_query))
}

// Tool definitions
fn get_tool_descriptions() -> Vec<ToolDescription> {
    vec![
        ToolDescription {
            name: "list_goals".to_string(),
            description: "Lists all goals for the user".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of goals to return"
                    }
                },
                "required": []
            }),
        },
        ToolDescription {
            name: "create_goal".to_string(),
            description: "Creates a new goal".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Title of the goal"
                    },
                    "description": {
                        "type": "string",
                        "description": "Description of the goal"
                    },
                    "deadline": {
                        "type": "string",
                        "description": "Deadline for the goal (ISO format)"
                    }
                },
                "required": ["title"]
            }),
        },
        ToolDescription {
            name: "get_calendar_events".to_string(),
            description: "Gets calendar events for a specific date range".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "start_date": {
                        "type": "string",
                        "description": "Start date in ISO format"
                    },
                    "end_date": {
                        "type": "string",
                        "description": "End date in ISO format"
                    }
                },
                "required": ["start_date", "end_date"]
            }),
        },
        ToolDescription {
            name: "get_day_plan".to_string(),
            description: "Gets the plan for a specific day".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "Date in ISO format"
                    }
                },
                "required": ["date"]
            }),
        },
    ]
}

// Main handler for query requests
async fn handle_query(
    Extension(pool): Extension<neo4rs::Graph>,
    Json(request): Json<GeminiRequest>,
) -> impl IntoResponse {
    // Initialize reqwest client
    let client = Client::new();

    // Get tool descriptions
    let tool_descriptions = get_tool_descriptions();

    // Convert tool descriptions to Gemini format
    let tools = vec![Tool {
        function_declarations: tool_descriptions
            .iter()
            .map(|tool| FunctionDeclaration {
                name: tool.name.clone(),
                description: tool.description.clone(),
                parameters: tool.parameters.clone(),
            })
            .collect(),
    }];

    // Create message history or initialize with user query
    let mut message_history = request.message_history.unwrap_or_else(|| {
        vec![Message {
            role: "user".to_string(),
            content: request.query.clone(),
        }]
    });

    // Create Gemini API request
    let api_request = GeminiApiRequest {
        contents: message_history
            .iter()
            .map(|msg| GeminiContent {
                parts: vec![Part {
                    text: msg.content.clone(),
                }],
                role: msg.role.clone(),
            })
            .collect(),
        tools,
    };

    // Call Gemini API
    let api_response = match client
        .post("https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent")
        .query(&[("key", std::env::var("GEMINI_API_KEY").unwrap_or_default())])
        .json(&api_request)
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Failed to connect to Gemini API"
                })),
            )
                .into_response();
        }
    };

    // Parse Gemini API response
    let gemini_response: GeminiApiResponse = match api_response.json().await {
        Ok(response) => response,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Failed to parse Gemini API response"
                })),
            )
                .into_response();
        }
    };

    // Check if we have a function call
    if let Some(candidate) = gemini_response.candidates.first() {
        for part in &candidate.content.parts {
            if let Some(function_call) = &part.function_call {
                // Execute the tool function
                let tool_result =
                    execute_tool(&function_call.name, &function_call.args, &pool).await;

                // Add assistant message with function call
                message_history.push(Message {
                    role: "assistant".to_string(),
                    content: format!("Executing function: {}", function_call.name),
                });

                // Add user message with function result
                message_history.push(Message {
                    role: "user".to_string(),
                    content: format!(
                        "Function result: {}",
                        serde_json::to_string(&tool_result).unwrap()
                    ),
                });

                // Make a second call to Gemini to process the result
                let second_api_request = GeminiApiRequest {
                    contents: message_history
                        .iter()
                        .map(|msg| GeminiContent {
                            parts: vec![Part {
                                text: msg.content.clone(),
                            }],
                            role: msg.role.clone(),
                        })
                        .collect(),
                    tools: vec![], // No tools needed for the second call
                };

                let second_api_response = match client
                    .post("https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent")
                    .query(&[("key", std::env::var("GEMINI_API_KEY").unwrap_or_default())])
                    .json(&second_api_request)
                    .send()
                    .await {
                        Ok(response) => response,
                        Err(_) => {
                            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
                                "error": "Failed to connect to Gemini API for second call"
                            }))).into_response();
                        }
                    };

                let second_gemini_response: GeminiApiResponse =
                    match second_api_response.json().await {
                        Ok(response) => response,
                        Err(_) => {
                            return (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(serde_json::json!({
                                    "error": "Failed to parse second Gemini API response"
                                })),
                            )
                                .into_response();
                        }
                    };

                // Get the final response text
                if let Some(second_candidate) = second_gemini_response.candidates.first() {
                    if let Some(part) = second_candidate.content.parts.first() {
                        if let Some(text) = &part.text {
                            // Add assistant response to history
                            message_history.push(Message {
                                role: "assistant".to_string(),
                                content: text.clone(),
                            });

                            // Generate conversation ID if not provided
                            let conversation_id = request
                                .conversation_id
                                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

                            // Return the response
                            return (
                                StatusCode::OK,
                                Json(GeminiResponse {
                                    response: text.clone(),
                                    conversation_id,
                                    message_history,
                                }),
                            )
                                .into_response();
                        }
                    }
                }
            } else if let Some(text) = &part.text {
                // Direct text response (no function call)
                message_history.push(Message {
                    role: "assistant".to_string(),
                    content: text.clone(),
                });

                // Generate conversation ID if not provided
                let conversation_id = request
                    .conversation_id
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

                // Return the response
                return (
                    StatusCode::OK,
                    Json(GeminiResponse {
                        response: text.clone(),
                        conversation_id,
                        message_history,
                    }),
                )
                    .into_response();
            }
        }
    }

    // Fallback response if we couldn't get a proper response from Gemini
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({
            "error": "Failed to get a valid response from Gemini"
        })),
    )
        .into_response()
}

// Execute a tool based on the function name and arguments
async fn execute_tool(
    function_name: &str,
    args: &serde_json::Value,
    pool: &neo4rs::Graph,
) -> serde_json::Value {
    match function_name {
        "list_goals" => {
            // Implementation for listing goals
            serde_json::json!({
                "status": "success",
                "message": "This is a placeholder for the list_goals implementation"
                // In a real implementation, you would call the actual function
                // and return its result
            })
        }
        "create_goal" => {
            // Implementation for creating a goal
            serde_json::json!({
                "status": "success",
                "message": "This is a placeholder for the create_goal implementation"
                // In a real implementation, you would call the actual function
                // and return its result
            })
        }
        "get_calendar_events" => {
            // Implementation for getting calendar events
            serde_json::json!({
                "status": "success",
                "message": "This is a placeholder for the get_calendar_events implementation"
                // In a real implementation, you would call the actual function
                // and return its result
            })
        }
        "get_day_plan" => {
            // Implementation for getting day plan
            serde_json::json!({
                "status": "success",
                "message": "This is a placeholder for the get_day_plan implementation"
                // In a real implementation, you would call the actual function
                // and return its result
            })
        }
        _ => serde_json::json!({
            "status": "error",
            "message": format!("Unknown function: {}", function_name)
        }),
    }
}
