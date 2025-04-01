use axum::{
    extract::Extension, http::StatusCode, response::IntoResponse, routing::post, Json, Router,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};

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

// Struct for Gemini API request
#[derive(Serialize)]
struct GeminiApiRequest {
    contents: Vec<GeminiContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    generation_config: Option<GenerationConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_config: Option<ToolConfig>,
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
struct GenerationConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_p: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_k: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    candidate_count: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_output_tokens: Option<i32>,
}

// Tool config struct for the Gemini API
#[derive(Serialize, Clone, Debug)]
struct ToolConfig {
    tools: Vec<Tool>,
}

// Tool-related structs for the Gemini API
#[derive(Serialize, Clone, Debug)]
struct Tool {
    #[serde(rename = "functionDeclarations")]
    function_declarations: Vec<FunctionDeclaration>,
}

#[derive(Serialize, Clone, Debug)]
struct FunctionDeclaration {
    name: String,
    description: String,
    parameters: ParameterDefinition,
}

#[derive(Serialize, Clone, Debug)]
struct ParameterDefinition {
    #[serde(rename = "type")]
    type_: String,
    properties: serde_json::Map<String, serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    required: Option<Vec<String>>,
}

// Struct for Gemini API response
#[derive(Deserialize, Debug)]
struct GeminiApiResponse {
    candidates: Vec<Candidate>,
}

#[derive(Deserialize, Debug)]
struct Candidate {
    content: CandidateContent,
}

#[derive(Deserialize, Debug)]
struct CandidateContent {
    parts: Vec<ContentPart>,
    role: String,
}

#[derive(Deserialize, Debug)]
struct ContentPart {
    text: Option<String>,
    function_call: Option<FunctionCall>,
}

#[derive(Deserialize, Debug)]
struct FunctionCall {
    name: String,
    args: serde_json::Value,
}

// Helper struct for extracted function calls
struct ExtractedFunctionCall {
    name: String,
    args: serde_json::Value,
}

// Create the routes for the query module
pub fn create_routes() -> Router {
    Router::new().route("/", post(handle_query))
}

// Main handler for query requests
async fn handle_query(
    Extension(pool): Extension<neo4rs::Graph>,
    Json(request): Json<GeminiRequest>,
) -> impl IntoResponse {
    // Initialize reqwest client
    let client = Client::new();

    // Create message history or initialize with user query
    let mut message_history = request.message_history.unwrap_or_else(|| {
        vec![Message {
            role: "user".to_string(),
            content: request.query.clone(),
        }]
    });

    // Create function declarations for tools
    let tools = vec![Tool {
        function_declarations: vec![
            FunctionDeclaration {
                name: "list_goals".to_string(),
                description: "Lists all goals for the user".to_string(),
                parameters: ParameterDefinition {
                    type_: "object".to_string(),
                    properties: serde_json::Map::new(),
                    required: None,
                },
            },
            FunctionDeclaration {
                name: "create_goal".to_string(),
                description: "Creates a new goal".to_string(),
                parameters: ParameterDefinition {
                    type_: "object".to_string(),
                    properties: {
                        let mut props = serde_json::Map::new();
                        props.insert(
                            "title".to_string(),
                            serde_json::json!({
                                "type": "string",
                                "description": "The title of the goal"
                            }),
                        );
                        props.insert(
                            "description".to_string(),
                            serde_json::json!({
                                "type": "string",
                                "description": "Optional description of the goal"
                            }),
                        );
                        props.insert(
                            "deadline".to_string(),
                            serde_json::json!({
                                "type": "string",
                                "description": "Optional deadline for the goal (e.g., '2024-07-29')"
                            }),
                        );
                        props
                    },
                    required: Some(vec!["title".to_string()]),
                },
            },
            FunctionDeclaration {
                name: "get_calendar_events".to_string(),
                description: "Gets calendar events for a date range".to_string(),
                parameters: ParameterDefinition {
                    type_: "object".to_string(),
                    properties: {
                        let mut props = serde_json::Map::new();
                        props.insert(
                            "start_date".to_string(),
                            serde_json::json!({
                                "type": "string",
                                "description": "Start date for the event range (e.g., '2024-07-29')"
                            }),
                        );
                        props.insert(
                            "end_date".to_string(),
                            serde_json::json!({
                                "type": "string",
                                "description": "End date for the event range (e.g., '2024-07-30')"
                            }),
                        );
                        props
                    },
                    required: Some(vec!["start_date".to_string(), "end_date".to_string()]),
                },
            },
            FunctionDeclaration {
                name: "get_day_plan".to_string(),
                description: "Gets the plan for a specific day".to_string(),
                parameters: ParameterDefinition {
                    type_: "object".to_string(),
                    properties: {
                        let mut props = serde_json::Map::new();
                        props.insert(
                            "date".to_string(),
                            serde_json::json!({
                                "type": "string",
                                "description": "The date to get the plan for (e.g., '2024-07-29')"
                            }),
                        );
                        props
                    },
                    required: Some(vec!["date".to_string()]),
                },
            },
        ],
    }];

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
        generation_config: Some(GenerationConfig {
            temperature: Some(0.7),
            top_p: Some(0.95),
            top_k: Some(40),
            candidate_count: Some(1),
            max_output_tokens: Some(2048),
        }),
        tool_config: Some(ToolConfig {
            tools: tools.clone(),
        }),
    };

    // Print the outgoing request for debugging
    println!(
        "Sending request to Gemini API: {}",
        serde_json::to_string_pretty(&api_request).unwrap_or_default()
    );

    // Get API key
    let api_key = std::env::var("GOALS_GEMINI_API_KEY").unwrap_or_default();

    // Check if API key is empty
    if api_key.is_empty() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "Gemini API key is not set. Please set the GOALS_GEMINI_API_KEY environment variable."
            })),
        )
            .into_response();
    }

    // Call Gemini API
    let api_response = match client
        .post("https://generativelanguage.googleapis.com/v1/models/gemini-2.5-pro:generateContent")
        .query(&[("key", api_key.clone())])
        .json(&api_request)
        .send()
        .await
    {
        Ok(response) => {
            // Check if response is successful
            if !response.status().is_success() {
                let status = response.status();
                let error_text = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Unknown error".to_string());
                eprintln!(
                    "Gemini API error: Status {}, Response: {}",
                    status, error_text
                );
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "error": format!("Gemini API returned error: {}", status)
                    })),
                )
                    .into_response();
            }
            response
        }
        Err(e) => {
            eprintln!("Failed to connect to Gemini API: {}", e);
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
        Err(e) => {
            eprintln!("Failed to parse Gemini API response: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Failed to parse Gemini API response. Make sure the Gemini API key is valid."
                })),
            )
                .into_response();
        }
    };

    // Process the response
    if let Some(candidate) = gemini_response.candidates.first() {
        if let Some(part) = candidate.content.parts.first() {
            // Check if we have a function call
            if let Some(function_call) = &part.function_call {
                // Execute the tool function
                let tool_result =
                    execute_tool(&function_call.name, &function_call.args, &pool).await;

                // Add assistant message with function call
                message_history.push(Message {
                    role: "assistant".to_string(),
                    content: format!(
                        "I'll help you with that by using the {} function.",
                        function_call.name
                    ),
                });

                // Add function response message
                message_history.push(Message {
                    role: "function".to_string(),
                    content: serde_json::to_string(&tool_result).unwrap(),
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
                    generation_config: Some(GenerationConfig {
                        temperature: Some(0.7),
                        top_p: Some(0.95),
                        top_k: Some(40),
                        candidate_count: Some(1),
                        max_output_tokens: Some(2048),
                    }),
                    tool_config: Some(ToolConfig {
                        tools: tools.clone(),
                    }),
                };

                // Print the second outgoing request for debugging
                println!(
                    "Sending second request to Gemini API: {}",
                    serde_json::to_string_pretty(&second_api_request).unwrap_or_default()
                );

                let second_api_response = match client
                    .post("https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent")
                    .query(&[("key", api_key.clone())])
                    .json(&second_api_request)
                    .send()
                    .await
                {
                    Ok(response) => {
                        // Check if response is successful
                        if !response.status().is_success() {
                            let status = response.status();
                            let error_text = response
                                .text()
                                .await
                                .unwrap_or_else(|_| "Unknown error".to_string());
                            eprintln!(
                                "Gemini API error (second call): Status {}, Response: {}",
                                status, error_text
                            );
                            return (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(serde_json::json!({
                                    "error": format!("Gemini API returned error on second call: {}", status)
                                })),
                            )
                                .into_response();
                        }
                        response
                    }
                    Err(e) => {
                        eprintln!("Failed to connect to Gemini API for second call: {}", e);
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({
                                "error": "Failed to connect to Gemini API for second call"
                            })),
                        )
                            .into_response();
                    }
                };

                let second_gemini_response: GeminiApiResponse =
                    match second_api_response.json().await {
                        Ok(response) => response,
                        Err(e) => {
                            eprintln!("Failed to parse second Gemini API response: {}", e);
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
    _pool: &neo4rs::Graph,
) -> serde_json::Value {
    match function_name {
        "list_goals" => {
            // Implementation for listing goals
            serde_json::json!({
                "status": "success",
                "goals": [
                    {
                        "id": "1",
                        "title": "Learn Rust",
                        "description": "Master Rust programming language",
                        "deadline": "2024-12-31"
                    },
                    {
                        "id": "2",
                        "title": "Finish project",
                        "description": "Complete the goals project",
                        "deadline": "2024-08-15"
                    }
                ]
            })
        }
        "create_goal" => {
            // Get arguments
            let title = args["title"].as_str().unwrap_or("Untitled");
            let description = args["description"].as_str().unwrap_or("");
            let deadline = args["deadline"].as_str().unwrap_or("");

            // Implementation for creating a goal
            serde_json::json!({
                "status": "success",
                "goal": {
                    "id": uuid::Uuid::new_v4().to_string(),
                    "title": title,
                    "description": description,
                    "deadline": deadline
                }
            })
        }
        "get_calendar_events" => {
            // Get arguments
            let start_date = args["start_date"].as_str().unwrap_or("");
            let end_date = args["end_date"].as_str().unwrap_or("");

            // Implementation for getting calendar events
            serde_json::json!({
                "status": "success",
                "events": [
                    {
                        "id": "1",
                        "title": "Team meeting",
                        "date": start_date,
                        "time": "10:00 AM",
                        "duration": 60
                    },
                    {
                        "id": "2",
                        "title": "Project review",
                        "date": end_date,
                        "time": "2:00 PM",
                        "duration": 90
                    }
                ],
                "date_range": {
                    "start": start_date,
                    "end": end_date
                }
            })
        }
        "get_day_plan" => {
            // Get arguments
            let date = args["date"].as_str().unwrap_or("");

            // Implementation for getting day plan
            serde_json::json!({
                "status": "success",
                "date": date,
                "plan": [
                    {
                        "time": "09:00 AM",
                        "activity": "Morning routine"
                    },
                    {
                        "time": "10:00 AM",
                        "activity": "Team meeting"
                    },
                    {
                        "time": "12:00 PM",
                        "activity": "Lunch"
                    },
                    {
                        "time": "01:00 PM",
                        "activity": "Work on goals project"
                    },
                    {
                        "time": "05:00 PM",
                        "activity": "End of day review"
                    }
                ]
            })
        }
        _ => serde_json::json!({
            "status": "error",
            "message": format!("Unknown function: {}", function_name)
        }),
    }
}

// Function to extract function calls from text
fn extract_function_call(text: &str) -> Option<ExtractedFunctionCall> {
    // Look for the pattern: I need to execute: function_name(arg1="value1", arg2="value2")
    if let Some(start_idx) = text.find("I need to execute: ") {
        let function_text = &text[start_idx + "I need to execute: ".len()..];

        // Find the function name
        if let Some(paren_idx) = function_text.find('(') {
            let function_name = function_text[..paren_idx].trim().to_string();

            // Extract arguments
            if let Some(end_paren_idx) = function_text.find(')') {
                let args_text = &function_text[paren_idx + 1..end_paren_idx];

                // Parse arguments
                let mut args_map = serde_json::Map::new();

                for arg_pair in args_text.split(',') {
                    let parts: Vec<&str> = arg_pair.split('=').collect();
                    if parts.len() == 2 {
                        let key = parts[0].trim();
                        let value = parts[1].trim();

                        // Remove quotes from value if present
                        let clean_value = if value.starts_with('"') && value.ends_with('"') {
                            &value[1..value.len() - 1]
                        } else {
                            value
                        };

                        args_map.insert(
                            key.to_string(),
                            serde_json::Value::String(clean_value.to_string()),
                        );
                    }
                }

                return Some(ExtractedFunctionCall {
                    name: function_name,
                    args: serde_json::Value::Object(args_map),
                });
            }
        }
    }

    None
}
