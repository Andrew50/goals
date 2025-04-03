use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket},
        Extension, WebSocketUpgrade,
    },
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use futures_util::{SinkExt, StreamExt};
use reqwest::Client;
use serde::Deserialize;
use serde::Serialize;

use crate::ai::tool_registry;

const SIMPLE_ERROR_MESSAGE: &str = "Error.";

// Define WebSocket message types
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type")]
pub enum WsQueryMessage {
    UserQuery {
        content: String,
        conversation_id: Option<String>,
    },
    AssistantText {
        content: String,
    },
    ToolCall {
        name: String,
        args: serde_json::Value,
    },
    ToolResult {
        success: bool,
        name: String,
        content: serde_json::Value,
    },
    Error {
        message: String,
    },
}

// Struct for the Gemini request
#[derive(Deserialize)]
#[allow(dead_code)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_execution: Option<ToolExecution>,
}

// Struct for tool execution information
#[derive(Serialize)]
pub struct ToolExecution {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    args: Option<serde_json::Value>,
    write_operation: bool,
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
    tools: Option<Vec<Tool>>,
}

#[derive(Serialize, Clone)]
struct GeminiContent {
    parts: Vec<Part>,
    role: String,
}

#[derive(Serialize, Clone)]
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

#[derive(Deserialize, Debug, Clone)]
struct CandidateContent {
    parts: Vec<ContentPart>,
    #[allow(dead_code)]
    role: String,
}

#[derive(Deserialize, Debug, Clone)]
struct ContentPart {
    text: Option<String>,
    function_call: Option<FunctionCall>,
}

#[derive(Deserialize, Debug, Clone)]
struct FunctionCall {
    name: String,
    args: serde_json::Value,
}

// Struct for tool execution request
#[derive(Deserialize)]
#[allow(dead_code)]
pub struct ToolExecuteRequest {
    tool_name: String,
    args: Option<serde_json::Value>,
    #[allow(dead_code)]
    conversation_id: Option<String>,
}

// Struct for tool execution response
#[derive(Serialize)]
pub struct ToolExecuteResponse {
    success: bool,
    message: Option<String>,
    error: Option<String>,
}

// Helper function to process a user query and stream responses
async fn process_user_query(
    _sender: &mut futures_util::stream::SplitSink<WebSocket, WsMessage>,
    message_history: &mut Vec<Message>,
    query: String,
    _conversation_id: Option<String>,
    pool: &neo4rs::Graph,
) -> axum::http::Response<axum::body::Body> {
    // Log incoming request details
    println!("Received query request: {:?}", query);

    // Initialize reqwest client
    let client = Client::new();

    // Always add the current query to the message history
    message_history.push(Message {
        role: "user".to_string(),
        content: query.clone(),
    });

    // Clean up message history - limit size and filter out repeated error messages
    if message_history.len() > 10 {
        // Keep only the last 10 messages to prevent history from getting too large
        let skip_count = message_history.len() - 10;
        message_history.drain(0..skip_count);
    }

    // Filter out messages with empty content
    message_history.retain(|msg| !msg.content.trim().is_empty());

    // Create Gemini API-specific message history with instructional messages first
    let mut initial_gemini_contents = Vec::new();

    // Add instructional messages as the first turn
    initial_gemini_contents.push(GeminiContent {
        parts: vec![Part {
            text: "You are an AI assistant that helps users manage their goals and tasks. When users ask to create, list, or manage goals, use the appropriate function. For example, if a user says 'create a goal called X', use the create_goal function with the title parameter. If they ask to see their goals, use the list_goals function.".to_string(),
        }],
        role: "user".to_string(),
    });

    initial_gemini_contents.push(GeminiContent {
        parts: vec![Part {
            text: "I understand my role. I'll help manage goals and tasks using the appropriate functions when needed.".to_string(),
        }],
        role: "model".to_string(),
    });

    // Add actual conversation history
    for msg in message_history.iter_mut() {
        let role = if msg.role == "assistant" {
            "model".to_string()
        } else {
            msg.role.clone()
        };
        // Handle function role specifically if needed, otherwise treat as text
        initial_gemini_contents.push(GeminiContent {
            parts: vec![Part {
                text: msg.content.clone(),
            }],
            role,
        });
    }

    // Create function declarations for tools
    let tools = vec![Tool {
        function_declarations: vec![
            FunctionDeclaration {
                name: "list_goals".to_string(),
                description: "Lists all goals for the user".to_string(),
                parameters: ParameterDefinition {
                    type_: "object".to_string(),
                    properties: {
                        let mut props = serde_json::Map::new();
                        props.insert(
                            "filter".to_string(),
                            serde_json::json!({
                                "type": "string",
                                "description": "Optional filter for goals (e.g., 'active', 'completed')",
                            }),
                        );
                        props
                    },
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
    // --- Get API Key ---
    let api_key = match std::env::var("GOALS_GEMINI_API_KEY") {
        Ok(key) if !key.is_empty() => key,
        _ => {
            eprintln!("ERROR: GOALS_GEMINI_API_KEY environment variable is not set or empty");
            // Return simple error message to user
            return (
                StatusCode::INTERNAL_SERVER_ERROR, // Still use 500 for server config issue
                Json(serde_json::json!({ "error": SIMPLE_ERROR_MESSAGE })),
            )
                .into_response();
        }
    };

    // --- First Gemini Call ---
    let initial_api_request = GeminiApiRequest {
        contents: initial_gemini_contents.clone(), // Use initial contents
        generation_config: Some(GenerationConfig {
            temperature: Some(0.7),
            top_p: Some(0.95),
            top_k: Some(40),
            candidate_count: Some(1),
            max_output_tokens: Some(2048),
        }),
        tools: Some(tools.clone()),
    };

    // Print the outgoing request for debugging
    println!(
        "Sending initial request to Gemini API: {}",
        serde_json::to_string_pretty(&initial_api_request).unwrap_or_default()
    );

    // Call Gemini API
    let initial_api_response = match client
        .post("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent")
        .query(&[("key", api_key.clone())])
        .json(&initial_api_request)
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
                    "Gemini API error (initial call): Status {}, Raw Response: {}",
                    status, error_text
                );
                 // Add error to history for context, but return simple message
                 message_history.push(Message {
                    role: "assistant".to_string(),
                    content: format!("Gemini API Error: {}", status), // Internal log/history
                });
                let conversation_id = _conversation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                 return (
                    StatusCode::OK, // Return OK so frontend shows the simple error
                    Json(GeminiResponse {
                        response: SIMPLE_ERROR_MESSAGE.to_string(),
                        conversation_id,
                        message_history: message_history.to_vec(),
                        tool_execution: None,
                    }),
                ).into_response();
            }
            response
        }
        Err(e) => {
            eprintln!("Failed to connect to Gemini API (initial call): {}", e);
             // Add error to history for context, but return simple message
             message_history.push(Message {
                 role: "assistant".to_string(),
                 content: format!("API Connection Error: {}", e), // Internal log/history
             });
             let conversation_id = _conversation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            return (
                 StatusCode::OK, // Return OK so frontend shows the simple error
                 Json(GeminiResponse {
                     response: SIMPLE_ERROR_MESSAGE.to_string(),
                     conversation_id,
                     message_history: message_history.to_vec(),
                     tool_execution: None,
                 }),
             ).into_response();
        }
    };

    // Parse Gemini API response
    let initial_text = match initial_api_response.text().await {
        Ok(text) => text,
        Err(e) => {
            let error_msg = format!("Failed to get text from initial Gemini API response: {}", e);
            eprintln!("{}", error_msg);
            // Add error to history for context, but return simple message
            message_history.push(Message {
                role: "assistant".to_string(),
                content: format!("API Response Read Error: {}", e), // Internal log/history
            });
            let conversation_id =
                _conversation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            return (
                StatusCode::OK, // Return OK so frontend shows the simple error
                Json(GeminiResponse {
                    response: SIMPLE_ERROR_MESSAGE.to_string(),
                    conversation_id,
                    message_history: message_history.to_vec(),
                    tool_execution: None,
                }),
            )
                .into_response();
        }
    };

    println!("Raw initial response from Gemini: {}", initial_text);

    // Handle empty or malformed responses
    if initial_text.trim().is_empty() {
        println!("Received empty text response from Gemini (initial call)");
        // Return simple error message
        message_history.push(Message {
            role: "assistant".to_string(),
            content: SIMPLE_ERROR_MESSAGE.to_string(),
        });

        // Generate conversation ID if not provided
        let conversation_id = _conversation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        // Return 200 to let the user see the error message
        return (
            StatusCode::OK,
            Json(GeminiResponse {
                response: SIMPLE_ERROR_MESSAGE.to_string(),
                conversation_id,
                message_history: message_history.to_vec(),
                tool_execution: None,
            }),
        )
            .into_response();
    }

    match serde_json::from_str::<GeminiApiResponse>(&initial_text) {
        Ok(parsed_response) => {
            if parsed_response.candidates.is_empty()
                || parsed_response.candidates[0].content.parts.is_empty()
            {
                eprintln!("Error: No candidates or parts in Gemini response");
                // Return simple error message
                message_history.push(Message {
                    role: "assistant".to_string(),
                    content: SIMPLE_ERROR_MESSAGE.to_string(),
                });

                // Generate conversation ID if not provided
                let conversation_id =
                    _conversation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

                // Return 200 to let the user see the error message
                return (
                    StatusCode::OK,
                    Json(GeminiResponse {
                        response: SIMPLE_ERROR_MESSAGE.to_string(),
                        conversation_id,
                        message_history: message_history.to_vec(),
                        tool_execution: None,
                    }),
                )
                    .into_response();
            }

            let content = &parsed_response.candidates[0].content;
            let mut function_calls_to_execute: Vec<FunctionCall> = Vec::new();
            let mut initial_text_response = String::new();

            // Collect all function calls and text parts from the initial response
            for part in &content.parts {
                if let Some(fc) = &part.function_call {
                    println!(
                        "Detected function call: {} with args: {:?}",
                        fc.name, fc.args
                    );
                    // Clone the function call to own it
                    function_calls_to_execute.push(fc.clone());
                }
                if let Some(text) = &part.text {
                    println!("Detected initial text part: {}", text);
                    initial_text_response.push_str(text);
                    initial_text_response.push(' '); // Add space between text parts if multiple
                }
            }
            initial_text_response = initial_text_response.trim().to_string(); // Clean up trailing space

            // --- Tool Execution Phase ---
            if !function_calls_to_execute.is_empty() {
                println!(
                    "Executing {} function calls sequentially...",
                    function_calls_to_execute.len()
                );

                // Add initial text response from Gemini to history if any was provided alongside tools
                if !initial_text_response.is_empty() {
                    message_history.push(Message {
                        role: "assistant".to_string(),
                        content: initial_text_response.clone(),
                    });
                }

                for function_call in function_calls_to_execute {
                    // Add assistant message indicating the *intent* to use the tool
                    // The actual result/summary comes after the second Gemini call
                    message_history.push(Message {
                        role: "assistant".to_string(), // Represents the *intent* to call the function
                        content: format!(
                            "Using the {} function.", // Simple placeholder, actual result comes later
                            function_call.name
                        ),
                    });

                    // Execute the tool
                    match tool_registry::execute_tool(
                        &function_call.name,
                        &function_call.args,
                        pool,
                    )
                    .await
                    {
                        Ok(result) => {
                            println!("Tool {} executed successfully.", function_call.name);
                            // Add function response message to history for the next Gemini call
                            message_history.push(Message {
                                role: "function".to_string(), // Use 'function' role for tool results
                                content: serde_json::to_string(&result).unwrap_or_else(|e| {
                                    eprintln!("Error serializing tool result for {}: {}", function_call.name, e);
                                    // Provide a structured error message for the LLM
                                    serde_json::json!({
                                        "error": format!("Failed to serialize result for tool {}", function_call.name),
                                        "details": e.to_string()
                                    }).to_string()
                                }),
                            });
                        }
                        Err(e) => {
                            let error_msg =
                                format!("Error executing tool {}: {}", function_call.name, e);
                            eprintln!("{}", error_msg);
                            // Add function error message to history
                            message_history.push(Message {
                                role: "function".to_string(), // Still use 'function' role, but indicate error
                                content: serde_json::json!({
                                    "error": error_msg,
                                    "tool_name": function_call.name
                                })
                                .to_string(),
                            });
                            // Continue to the next tool even if one fails, let Gemini summarize the situation.
                        }
                    }
                }

                // --- Second Gemini Call for Summary ---
                println!("Making second Gemini call for summary after tool executions.");

                // Rebuild contents for the second call, including function results/errors
                let mut second_gemini_contents = Vec::new();
                // Add instructional messages again
                second_gemini_contents.push(GeminiContent {
                    parts: vec![Part {
                        text: "You are an AI assistant...".to_string(),
                    }],
                    role: "user".to_string(),
                });
                second_gemini_contents.push(GeminiContent {
                    parts: vec![Part {
                        text: "I understand my role...".to_string(),
                    }],
                    role: "model".to_string(),
                });

                // Add full updated conversation history
                for msg in message_history.iter_mut() {
                    let role = match msg.role.as_str() {
                        "assistant" => "model".to_string(),
                        "function" => "function".to_string(), // Pass function results correctly
                        _ => "user".to_string(), // Default to user if not assistant or function
                    };
                    second_gemini_contents.push(GeminiContent {
                        parts: vec![Part {
                            text: msg.content.clone(),
                        }], // Send content as text for now
                        role,
                    });
                }

                let second_api_request = GeminiApiRequest {
                    contents: second_gemini_contents,
                    // Correctly initialize GenerationConfig with all fields
                    generation_config: Some(GenerationConfig {
                        temperature: Some(0.7),
                        top_p: Some(0.95),
                        top_k: Some(40),
                        candidate_count: Some(1),
                        max_output_tokens: Some(2048),
                    }),
                    tools: None,
                };

                println!(
                    "Sending second request to Gemini API with {} contents items",
                    second_api_request.contents.len()
                );

                let second_api_response_result = client
                    .post("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent")
                    .query(&[("key", api_key)]) // Reuse API key
                    .json(&second_api_request)
                    .send()
                    .await;

                match second_api_response_result {
                    Ok(second_api_response) => {
                        if !second_api_response.status().is_success() {
                            let status = second_api_response.status();
                            let error_text = second_api_response
                                .text()
                                .await
                                .unwrap_or_else(|_| "Unknown error".to_string());
                            eprintln!(
                                "Gemini API error (second call): Status {}, Raw Response: {}",
                                status, error_text
                            );
                            message_history.push(Message {
                                role: "assistant".to_string(),
                                content: format!("Gemini API Error (Summary): {}", status),
                            });
                            let conversation_id = _conversation_id
                                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                            return (
                                StatusCode::OK, // Return OK for user
                                Json(GeminiResponse {
                                    response: SIMPLE_ERROR_MESSAGE.to_string(),
                                    conversation_id,
                                    message_history: message_history.to_vec(),
                                    tool_execution: None,
                                }),
                            )
                                .into_response();
                        }

                        match second_api_response.json::<GeminiApiResponse>().await {
                            Ok(second_parsed_response) => {
                                let final_response_text = second_parsed_response
                                     .candidates.first()
                                     .and_then(|candidate| candidate.content.parts.first())
                                     .and_then(|part| part.text.clone())
                                     .unwrap_or_else(|| {
                                         println!("Second Gemini call did not return text. Providing generic confirmation/error.");
                                         if let Some(last_msg) = message_history.last() {
                                             if last_msg.role == "function" && !last_msg.content.contains("\"error\":") {
                                                  "OK.".to_string()
                                             } else {
                                                  SIMPLE_ERROR_MESSAGE.to_string()
                                             }
                                         } else {
                                             SIMPLE_ERROR_MESSAGE.to_string()
                                         }
                                     });

                                println!(
                                    "Final summary response from Gemini: {}",
                                    final_response_text
                                );

                                message_history.push(Message {
                                    role: "assistant".to_string(),
                                    content: final_response_text.clone(),
                                });

                                let conversation_id = _conversation_id
                                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

                                (
                                    StatusCode::OK,
                                    Json(GeminiResponse {
                                        response: final_response_text,
                                        conversation_id,
                                        message_history: message_history.to_vec(),
                                        tool_execution: None,
                                    }),
                                )
                                    .into_response()
                            }
                            Err(e) => {
                                eprintln!("Failed to parse second Gemini API response: {}", e);
                                message_history.push(Message {
                                    role: "assistant".to_string(),
                                    content: format!("API Parse Error (Summary): {}", e),
                                });
                                let conversation_id = _conversation_id
                                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                                (
                                    StatusCode::OK,
                                    Json(GeminiResponse {
                                        response: SIMPLE_ERROR_MESSAGE.to_string(),
                                        conversation_id,
                                        message_history: message_history.to_vec(),
                                        tool_execution: None,
                                    }),
                                )
                                    .into_response()
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to connect to Gemini API for second call: {}", e);
                        message_history.push(Message {
                            role: "assistant".to_string(),
                            content: format!("API Connection Error (Summary): {}", e),
                        });
                        let conversation_id =
                            _conversation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                        (
                            StatusCode::OK,
                            Json(GeminiResponse {
                                response: SIMPLE_ERROR_MESSAGE.to_string(),
                                conversation_id,
                                message_history: message_history.to_vec(),
                                tool_execution: None,
                            }),
                        )
                            .into_response()
                    }
                }
            } else if !initial_text_response.is_empty() {
                // --- Handle Plain Text Response (No Tools Called) ---
                println!("Detected plain text response: {}", initial_text_response);

                // Add the assistant's text response to the history
                message_history.push(Message {
                    role: "assistant".to_string(), // Gemini's role is 'model', map to 'assistant'
                    content: initial_text_response.clone(),
                });

                // Generate conversation ID if not provided
                let conversation_id =
                    _conversation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

                // Return the response directly
                return (
                    StatusCode::OK,
                    Json(GeminiResponse {
                        response: initial_text_response.clone(),
                        conversation_id,
                        message_history: message_history.to_vec(),
                        tool_execution: None, // No tool was executed
                    }),
                )
                    .into_response();
            } else {
                // --- Handle Case with Neither Text nor Function Call (Should be rare) ---
                // This case implies the first Gemini call returned parts but none contained text or function calls.
                println!("Detected initial response part with neither text nor function call, returning error.");
                // Return simple error message
                message_history.push(Message {
                    role: "assistant".to_string(),
                    content: SIMPLE_ERROR_MESSAGE.to_string(),
                });
                let conversation_id =
                    _conversation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                return (
                    StatusCode::OK, // Return OK for user
                    Json(GeminiResponse {
                        response: SIMPLE_ERROR_MESSAGE.to_string(),
                        conversation_id,
                        message_history: message_history.to_vec(),
                        tool_execution: None,
                    }),
                )
                    .into_response();
            }
        }
        Err(e) => {
            let error_msg = format!("Failed to parse initial Gemini API response: {}", e);
            eprintln!("{}", error_msg);
            // Add internal error message to conversation history before returning simple error
            message_history.push(Message {
                role: "assistant".to_string(),
                content: format!("API Parse Error: {}", e), // Internal log/history
            });
            let conversation_id =
                _conversation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            (
                StatusCode::OK, // Return OK so frontend shows the simple error message
                Json(GeminiResponse {
                    response: SIMPLE_ERROR_MESSAGE.to_string(),
                    conversation_id,
                    message_history: message_history.to_vec(),
                    tool_execution: None,
                }),
            )
                .into_response()
        }
    }
}

// Execute a tool based on the function name and arguments

#[allow(dead_code)]
fn is_write_operation(operation_name: &str) -> bool {
    matches!(
        operation_name,
        "create_goal" | "update_goal" | "delete_goal" | "toggle_completion"
    )
}

// Handler for tool execution
#[allow(dead_code)]
pub async fn handle_tool_execute(
    Extension(pool): Extension<neo4rs::Graph>,
    Json(request): Json<ToolExecuteRequest>,
) -> impl IntoResponse {
    println!("Executing tool: {}", request.tool_name);

    // Execute the tool
    match tool_registry::execute_tool(
        &request.tool_name,
        &request.args.unwrap_or(serde_json::json!({})),
        &pool,
    )
    .await
    {
        Ok(result) => {
            // Convert result to a user-friendly message
            let message = format_tool_result(&request.tool_name, &result);

            // Return success response
            (
                StatusCode::OK,
                Json(ToolExecuteResponse {
                    success: true,
                    message: Some(message),
                    error: None,
                }),
            )
                .into_response()
        }
        Err(e) => {
            eprintln!("Tool execution error: {}", e);

            // Return error response
            (
                StatusCode::BAD_REQUEST,
                Json(ToolExecuteResponse {
                    success: false,
                    message: None,
                    error: Some(format!("Failed to execute {}: {}", request.tool_name, e)),
                }),
            )
                .into_response()
        }
    }
}

// Helper function to format tool results into human-readable messages
fn format_tool_result(tool_name: &str, result: &serde_json::Value) -> String {
    match tool_name {
        "list_goals" => {
            // Format goals list
            if let Some(goals) = result.as_array() {
                if goals.is_empty() {
                    return "You don't have any goals yet. Would you like to create one?"
                        .to_string();
                }

                let mut response = "Here are your goals:\n\n".to_string();
                for (i, goal) in goals.iter().enumerate() {
                    let title = goal["title"].as_str().unwrap_or("Untitled");
                    let status = if goal["completed"].as_bool().unwrap_or(false) {
                        "✅ Completed"
                    } else {
                        "⏳ In progress"
                    };

                    response.push_str(&format!("{}. {} - {}\n", i + 1, title, status));

                    if let Some(description) = goal["description"].as_str() {
                        if !description.is_empty() {
                            response.push_str(&format!("   Description: {}\n", description));
                        }
                    }

                    if let Some(deadline) = goal["deadline"].as_str() {
                        if !deadline.is_empty() {
                            response.push_str(&format!("   Deadline: {}\n", deadline));
                        }
                    }

                    response.push('\n');
                }
                return response;
            }
            "No goals found.".to_string()
        }
        "create_goal" => {
            // Format goal creation confirmation
            if let Some(goal_id) = result["id"].as_i64() {
                let title = result["title"].as_str().unwrap_or("Untitled");
                format!("I've created your goal \"{}\" with ID {}.", title, goal_id)
            } else {
                "Goal was created successfully.".to_string()
            }
        }
        "get_calendar_events" => {
            // Format calendar events
            if let Some(events) = result.as_array() {
                if events.is_empty() {
                    return "No events found for the specified date range.".to_string();
                }

                let mut response = "Here are your calendar events:\n\n".to_string();
                for event in events {
                    if let (Some(title), Some(date)) =
                        (event["title"].as_str(), event["date"].as_str())
                    {
                        response.push_str(&format!("• {} ({})\n", title, date));
                    }
                }
                return response;
            }
            "No events found.".to_string()
        }
        "get_day_plan" => {
            // Format day plan
            if let Some(tasks) = result.as_array() {
                if tasks.is_empty() {
                    return "No tasks planned for this day.".to_string();
                }

                let mut response = "Here's your plan for the day:\n\n".to_string();
                for task in tasks {
                    if let Some(title) = task["title"].as_str() {
                        let status = if task["completed"].as_bool().unwrap_or(false) {
                            "✅"
                        } else {
                            "⏳"
                        };
                        response.push_str(&format!("{} {}\n", status, title));
                    }
                }
                return response;
            }
            "No tasks found for the specified day.".to_string()
        }
        _ => format!("Tool {} executed successfully.", tool_name),
    }
}

#[allow(dead_code)]
async fn handle_empty_response(
    query: &str,
    message_history: &[Message],
    pool: &neo4rs::Graph,
) -> axum::response::Response {
    println!("Processing fallback for query: {}", query);
    let mut updated_history = message_history.to_vec();

    // Try to infer intent from the query
    let query_lower = query.to_lowercase();

    // Check for create goal intent
    if query_lower.contains("create goal")
        || query_lower.contains("add goal")
        || query_lower.contains("new goal")
    {
        let title = query_lower
            .replace("create goal", "")
            .replace("add goal", "")
            .replace("new goal", "")
            .trim()
            .to_string();

        if !title.is_empty() {
            // Try to create a goal
            let args = serde_json::json!({
                "title": title
            });

            match tool_registry::execute_tool("create_goal", &args, pool).await {
                Ok(result) => {
                    let message = format_tool_result("create_goal", &result);
                    updated_history.push(Message {
                        role: "assistant".to_string(),
                        content: message.clone(),
                    });

                    let conversation_id = uuid::Uuid::new_v4().to_string();

                    return (
                        StatusCode::OK,
                        Json(GeminiResponse {
                            response: message,
                            conversation_id,
                            message_history: updated_history,
                            tool_execution: Some(ToolExecution {
                                name: "create_goal".to_string(),
                                args: Some(args),
                                write_operation: true,
                            }),
                        }),
                    )
                        .into_response();
                }
                Err(e) => {
                    eprintln!("Fallback create_goal error: {}", e);
                    // Fall through to default fallback error
                }
            }
        }
    } else if !query_lower.is_empty() {
        // Check if this might be a direct response to a request for a goal title
        // Look at the last assistant message to see if it was asking for a title
        if let Some(last_assistant_msg) = updated_history
            .iter()
            .rev()
            .find(|msg| msg.role == "assistant")
        {
            if last_assistant_msg.content.contains("title for the goal")
                || last_assistant_msg.content.contains("call the goal")
                || last_assistant_msg.content.contains("name for the goal")
            {
                // This is likely a direct response with just the title
                let title = query.trim();

                if !title.is_empty() {
                    // Try to create a goal with just this title
                    let args = serde_json::json!({
                        "title": title
                    });

                    match tool_registry::execute_tool("create_goal", &args, pool).await {
                        Ok(result) => {
                            let message = format_tool_result("create_goal", &result);
                            updated_history.push(Message {
                                role: "assistant".to_string(),
                                content: message.clone(),
                            });

                            let conversation_id = uuid::Uuid::new_v4().to_string();

                            return (
                                StatusCode::OK,
                                Json(GeminiResponse {
                                    response: message,
                                    conversation_id,
                                    message_history: updated_history,
                                    tool_execution: Some(ToolExecution {
                                        name: "create_goal".to_string(),
                                        args: Some(args),
                                        write_operation: true,
                                    }),
                                }),
                            )
                                .into_response();
                        }
                        Err(e) => {
                            eprintln!("Fallback create_goal (title only) error: {}", e);
                            // Fall through to default fallback error
                        }
                    }
                }
            }
        }
    }

    // Check for list goals intent
    if query_lower.contains("list goals")
        || query_lower.contains("show goals")
        || query_lower.contains("my goals")
    {
        match tool_registry::execute_tool("list_goals", &serde_json::json!({}), pool).await {
            Ok(result) => {
                let message = format_tool_result("list_goals", &result);
                updated_history.push(Message {
                    role: "assistant".to_string(),
                    content: message.clone(),
                });

                let conversation_id = uuid::Uuid::new_v4().to_string();

                return (
                    StatusCode::OK,
                    Json(GeminiResponse {
                        response: message,
                        conversation_id,
                        message_history: updated_history,
                        tool_execution: Some(ToolExecution {
                            name: "list_goals".to_string(),
                            args: Some(serde_json::json!({})),
                            write_operation: false,
                        }),
                    }),
                )
                    .into_response();
            }
            Err(e) => {
                eprintln!("Fallback list_goals error: {}", e);
                // Fall through to default fallback error
            }
        }
    }

    // Default fallback
    println!("Fallback failed to infer intent or execution failed.");
    // Use the simplified error message
    let fallback_message = SIMPLE_ERROR_MESSAGE;
    updated_history.push(Message {
        role: "assistant".to_string(),
        content: fallback_message.to_string(),
    });

    let conversation_id = uuid::Uuid::new_v4().to_string();

    (
        StatusCode::OK, // Return OK to show the error message
        Json(GeminiResponse {
            response: fallback_message.to_string(),
            conversation_id,
            message_history: updated_history,
            tool_execution: None,
        }),
    )
        .into_response()
}

// Helper function to send error messages over WebSocket
async fn send_error(
    sender: &mut futures_util::stream::SplitSink<WebSocket, WsMessage>,
    message: &str,
) -> Result<(), axum::Error> {
    let error_message = WsQueryMessage::Error {
        message: message.to_string(),
    };
    let json = serde_json::to_string(&error_message)
        .map_err(|e| axum::Error::new(format!("JSON serialization error: {}", e)))?;
    sender.send(WsMessage::Text(json)).await
}

// Main handler for query requests
#[allow(dead_code)]
pub async fn handle_query(
    Extension(_pool): Extension<neo4rs::Graph>,
    Json(request): Json<GeminiRequest>,
) -> impl IntoResponse {
    // Log incoming request details
    println!("Received query request: {:?}", request.query);

    // Initialize reqwest client
    let _client = Client::new();

    // Create message history or initialize with user query
    let mut message_history = request.message_history.unwrap_or_else(Vec::new);

    // Always add the current query to the message history
    message_history.push(Message {
        role: "user".to_string(),
        content: request.query.clone(),
    });

    // Clean up message history - limit size and filter out repeated error messages
    if message_history.len() > 10 {
        // Keep only the last 10 messages to prevent history from getting too large
        let skip_count = message_history.len() - 10;
        message_history = message_history.iter().skip(skip_count).cloned().collect();
    }

    // Filter out messages with empty content
    message_history.retain(|msg| !msg.content.trim().is_empty());

    // Add a response message for testing
    message_history.push(Message {
        role: "assistant".to_string(),
        content: "This is a placeholder response. The API endpoint is working, but now uses WebSockets instead. Please use the /query/ws endpoint for interactive conversations.".to_string(),
    });

    // Generate a conversation ID if not provided
    let conversation_id = request
        .conversation_id
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    // Return response
    (
        StatusCode::OK,
        Json(GeminiResponse {
            response: "This API now uses WebSockets. Please use the /query/ws endpoint."
                .to_string(),
            conversation_id,
            message_history,
            tool_execution: None,
        }),
    )
        .into_response()
}

// Handler for WebSocket upgrade request
pub async fn handle_query_ws(
    ws: WebSocketUpgrade,
    Extension(pool): Extension<neo4rs::Graph>,
    Extension(user_id): Extension<i64>,
) -> impl IntoResponse {
    println!("WebSocket upgrade request for user {}", user_id);
    ws.on_upgrade(move |socket| handle_websocket_connection(socket, pool, user_id))
}

// WebSocket connection handler
async fn handle_websocket_connection(socket: WebSocket, pool: neo4rs::Graph, user_id: i64) {
    println!("New WebSocket connection established for user: {}", user_id);

    // Split the socket into sender and receiver
    let (mut sender, mut receiver) = socket.split();

    // Initialize conversation state
    let mut message_history: Vec<Message> = Vec::new();

    // Add initial system prompt to history (not sent to client)
    let system_prompt = Message {
        role: "system".to_string(),
        content: "You are an AI assistant that helps users manage their goals and tasks. When users ask to create, list, or manage goals, use the appropriate function.".to_string(),
    };
    message_history.push(system_prompt);

    // Main loop to process messages
    while let Some(result) = receiver.next().await {
        match result {
            Ok(WsMessage::Text(text)) => {
                println!("Received message: {}", text);

                // Parse the incoming message
                match serde_json::from_str::<WsQueryMessage>(&text) {
                    Ok(WsQueryMessage::UserQuery {
                        content,
                        conversation_id,
                    }) => {
                        // Process user query
                        process_user_query(
                            &mut sender,
                            &mut message_history,
                            content,
                            conversation_id,
                            &pool,
                        )
                        .await;
                    }
                    Ok(_) => {
                        // Received a different message type from client
                        if let Err(e) =
                            send_error(&mut sender, "Unexpected message type received").await
                        {
                            eprintln!("Error sending error message: {}", e);
                            break;
                        }
                    }
                    Err(e) => {
                        // Failed to parse message
                        eprintln!("Failed to parse message: {}", e);
                        if let Err(e) = send_error(&mut sender, "Failed to parse message").await {
                            eprintln!("Error sending error message: {}", e);
                            break;
                        }
                    }
                }
            }
            Ok(WsMessage::Close(_)) => {
                println!("WebSocket connection closed by client");
                break;
            }
            Ok(_) => {
                // Ignore other message types
            }
            Err(e) => {
                eprintln!("WebSocket error: {}", e);
                break;
            }
        }
    }

    println!("WebSocket connection terminated for user: {}", user_id);
}
