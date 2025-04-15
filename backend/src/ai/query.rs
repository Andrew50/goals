use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket},
        Extension, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tracing::{error, info};

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::ai::tool_registry;

// Alias for UserLocks, matching the one in tool_registry
type UserLocks = Arc<Mutex<HashMap<i64, Arc<Mutex<()>>>>>;

// ==================================================================
// Constants and Data Types
// ==================================================================
const SYSTEM_PROMPT: &str = r#"You are an AI assistant that helps users manage their goals and tasks.
You can make use of the included tools to help the user. If you need
to use a tool, call it using the function call syntax. If you don't
need to use a tool, just respond with the natural language response."#;

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

// Internal representation of a conversation message
#[derive(Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
}

// Struct that describes function calls from Gemini
#[derive(Deserialize, Debug, Clone)]
pub struct FunctionCall {
    pub name: String,
    pub args: serde_json::Value,
}

// For convenience, represents a single chunk of LLM output (text or function call)
#[derive(Debug)]
pub enum LlmChunk {
    Text(String),
    FunctionCall(FunctionCall),
}

// Gemini request/response structs (simplified for illustration)
#[derive(Serialize)]
struct GeminiApiRequest {
    contents: Vec<GeminiContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    generation_config: Option<GenerationConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<tool_registry::Tool>>,
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
    role: String,
    parts: Vec<ContentPart>,
}

#[derive(Deserialize, Debug, Clone)]
struct ContentPart {
    text: Option<String>,
    #[serde(rename = "functionCall")]
    function_call: Option<FunctionCall>,
    #[serde(flatten)]
    #[allow(dead_code)] // Allow dead code for the 'other' field
    other: std::collections::HashMap<String, serde_json::Value>,
}

// ==================================================================
// WebSocket Handler
// ==================================================================

pub async fn handle_query_ws(
    ws: WebSocketUpgrade,
    Extension(pool): Extension<neo4rs::Graph>,
    Extension(user_id): Extension<i64>,
    Extension(user_locks): Extension<UserLocks>,
) -> impl IntoResponse {
    info!(user_id = user_id, "WebSocket upgrade request received for user");
    ws.on_upgrade(move |socket| handle_websocket_connection(socket, pool, user_id, user_locks))
}

async fn handle_websocket_connection(
    socket: WebSocket,
    pool: neo4rs::Graph,
    user_id: i64,
    user_locks: UserLocks,
) {
    info!(user_id = user_id, "WebSocket connection established");
    let (mut sender, mut receiver) = socket.split();

    // Initialize conversation history with system prompt
    let mut conversation_history: Vec<Message> = vec![Message {
        role: "user".to_string(),
        content: SYSTEM_PROMPT.to_string(),
    }];

    // Continuously listen for messages from the user
    while let Some(Ok(msg)) = receiver.next().await {
        match msg {
            WsMessage::Text(text) => {
                match serde_json::from_str::<WsQueryMessage>(&text) {
                    Ok(WsQueryMessage::UserQuery {
                        content,
                        conversation_id,
                    }) => {
                        // Append user's message to conversation
                        conversation_history.push(Message {
                            role: "user".to_string(),
                            content: content.clone(),
                        });

                        // Handle user query in a loop that checks for function calls
                        let query_result = handle_user_query_loop(
                            &mut sender,
                            &mut conversation_history,
                            &pool, // Pass as reference
                            &user_locks, // Pass as reference
                            conversation_id,
                            user_id,
                        )
                        .await;

                        if let Err(e) = query_result {
                            let error_string = format!("{}", e);
                            error!(
                                user_id = user_id,
                                "Error in handle_user_query_loop: {}", error_string
                            );
                            let _ = send_error(&mut sender, &error_string).await;
                        }
                    }
                    // We only handle UserQuery in this example; everything else -> error
                    Ok(_) => {
                        let _ = send_error(&mut sender, "Unexpected message type").await;
                    }
                    Err(e) => {
                        error!(user_id = user_id, "Failed to parse message: {}", e);
                        let _ = send_error(&mut sender, "Failed to parse message").await;
                    }
                }
            }
            WsMessage::Close(_) => {
                info!(user_id = user_id, "WebSocket connection closed by client");
                break;
            }
            _ => {
                // Ignore other message types (Binary, Ping, Pong, etc.)
            }
        }
    }

    info!(user_id = user_id, "WebSocket connection terminated");
}

// ==================================================================
// Main Loop for a Single User Query
// ==================================================================

async fn handle_user_query_loop(
    sender: &mut futures_util::stream::SplitSink<WebSocket, WsMessage>,
    conversation_history: &mut Vec<Message>,
    pool: &neo4rs::Graph,
    user_locks: &UserLocks,
    conversation_id: Option<String>,
    user_id: i64,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let conversation_uuid = conversation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    info!(
        conversation_id = %conversation_uuid,
        history_length = conversation_history.len(),
        "Starting user query loop"
    );

    loop {
        // 1. Call Gemini with the current conversation
        info!(conversation_id = %conversation_uuid, "Calling Gemini API");
        let chunks = call_gemini(conversation_history).await?;
        // 2. Parse chunks (text or function call)
        let mut found_function_call = false;
        let mut collected_text = String::new();

        info!(
            conversation_id = %conversation_uuid,
            chunk_count = chunks.len(),
            "Processing LLM response chunks"
        );

        for (i, chunk) in chunks.into_iter().enumerate() {
            match chunk {
                LlmChunk::Text(txt) => {
                    info!(
                        conversation_id = %conversation_uuid,
                        chunk_index = i,
                        text_length = txt.len(),
                        "Received text chunk"
                    );
                    collected_text.push_str(&txt);
                }
                LlmChunk::FunctionCall(function_call) => {
                    // Before we do anything, if we have some text buffered, send it out
                    if !collected_text.is_empty() {
                        info!(
                            conversation_id = %conversation_uuid,
                            text_length = collected_text.len(),
                            "Sending buffered text before function call"
                        );
                        // Send partial text to the frontend
                        let msg = WsQueryMessage::AssistantText {
                            content: collected_text.clone(),
                        };
                        send_ws_message(sender, &msg).await?;
                        // Also store in conversation as the "assistant" text
                        conversation_history.push(Message {
                            role: "model".to_string(),
                            content: collected_text.clone(),
                        });
                        collected_text.clear();
                    }

                    found_function_call = true;
                    let tool_call_name = function_call.name.clone();
                    let args = function_call.args.clone();

                    info!(
                        conversation_id = %conversation_uuid,
                        chunk_index = i,
                        tool_name = %tool_call_name,
                        args = %serde_json::to_string(&function_call.args).unwrap_or_default(),
                        "Processing function call"
                    );

                    // Send tool call info to the frontend
                    let tool_call_msg = WsQueryMessage::ToolCall {
                        name: tool_call_name.clone(),
                        args: function_call.args.clone(),
                    };
                    send_ws_message(sender, &tool_call_msg).await?;

                    // Execute the tool
                    info!(
                        conversation_id = %conversation_uuid,
                        tool_name = %tool_call_name,
                        "Executing tool"
                    );

                    match tool_registry::dispatch_tool(
                        &tool_call_name,
                        &args,
                        &pool,
                        &user_locks,
                        user_id,
                    )
                    .await
                    {
                        // tool_result is now the JSON: {"result": "success", "data": ...}
                        Ok(tool_result) => {
                            info!(
                                conversation_id = %conversation_uuid,
                                tool_name = %tool_call_name,
                                result_size = tool_result.to_string().len(),
                                "Tool execution succeeded"
                            );

                            // Send success result (tool_result is already the JSON value we want)
                            let tool_result_msg = WsQueryMessage::ToolResult {
                                success: true,
                                name: tool_call_name.clone(),
                                content: tool_result.clone(), // Send the whole wrapper object
                            };
                            send_ws_message(sender, &tool_result_msg).await?;

                            // Extract the actual data part (which is now the Debug string)
                            // for the conversation history. The LLM needs the function's output.
                            let data_for_history_str = tool_result
                                .get("data") // Get the value of the "data" key
                                .and_then(|v| v.as_str()) // Attempt to get it as a string
                                .unwrap_or("Tool returned non-string data") // Fallback if data wasn't a string
                                .to_string();

                            // Add the extracted string data to history
                            conversation_history.push(Message {
                                role: "model".to_string(), // Gemini expects "function" role for tool results
                                content: data_for_history_str, // Use the extracted string
                            });
                        }
                        Err(e) => {
                            // Error case: 'e' is the error string from wrap_result or dispatch_tool
                            error!(
                                conversation_id = %conversation_uuid,
                                tool_name = %tool_call_name,
                                error = %e,
                                "Tool execution failed"
                            );

                            let error_val = serde_json::json!({
                                "error": e.to_string(),
                                "tool_name": tool_call_name.clone()
                            });
                            // Send failure result
                            let tool_result_msg = WsQueryMessage::ToolResult {
                                success: false,
                                name: tool_call_name.clone(),
                                content: error_val.clone(),
                            };
                            send_ws_message(sender, &tool_result_msg).await?;

                            // Insert the error as a "function" role message
                            conversation_history.push(Message {
                                role: "model".to_string(),
                                content: error_val.to_string(),
                            });
                        }
                    }

                    info!(
                        conversation_id = %conversation_uuid,
                        tool_name = %tool_call_name,
                        "Restarting LLM loop after tool execution"
                    );

                    // Break out and do another loop iteration to re-call Gemini
                    break;
                }
            }
        }

        // If we found a function call, continue the loop to call Gemini again
        if found_function_call {
            info!(
                conversation_id = %conversation_uuid,
                "Function call detected, continuing LLM loop"
            );
            continue;
        }

        // If we get here, no function calls were found, so we have final text
        if !collected_text.is_empty() {
            info!(
                conversation_id = %conversation_uuid,
                text_length = collected_text.len(),
                "Sending final text response"
            );
            let final_text_msg = WsQueryMessage::AssistantText {
                content: collected_text.clone(),
            };
            send_ws_message(sender, &final_text_msg).await?;

            // Append final text to conversation history
            conversation_history.push(Message {
                role: "model".to_string(),
                content: collected_text,
            });
        } else {
            info!(
                conversation_id = %conversation_uuid,
                "No text content in final response"
            );
        }

        // We've got our final text output for this user query
        info!(
            conversation_id = %conversation_uuid,
            "Completed LLM response cycle"
        );
        break;
    }

    info!(
        "Completed user query cycle for conversation_id={}",
        conversation_uuid
    );
    Ok(())
}

// ==================================================================
// Gemini (LLM) Call
// ==================================================================

async fn call_gemini(
    conversation_history: &[Message],
) -> Result<Vec<LlmChunk>, Box<dyn std::error::Error + Send + Sync>> {
    let tools = tool_registry::get_tools();
    let api_key =
        std::env::var("GOALS_GEMINI_API_KEY").map_err(|_| "GOALS_GEMINI_API_KEY not set")?;

    info!(
        history_length = conversation_history.len(),
        tool_count = tools.len(),
        "Preparing Gemini API request"
    );

    // Convert conversation to Gemini contents
    let mut contents = Vec::new();
    for msg in conversation_history {
        // Gemini API v1beta uses "user", "model", and "function" roles directly.
        // The "function" role is specifically for the *response* from a tool.
        /*let role = match msg.role.as_str() {
            "system" => "user", // Treat system prompt as initial user message context
            "assistant" => "model",
            "function" => "function", // Keep the function role for tool results
            _ => "user", // Default to user
        };*/
        contents.push(GeminiContent {
            parts: vec![Part {
                text: msg.content.clone(),
            }],
            role: msg.role.to_string(),
        });
    }

    let request_body = GeminiApiRequest {
        contents,
        generation_config: Some(GenerationConfig {
            temperature: Some(0.7),
            top_p: Some(0.95),
            top_k: Some(40),
            candidate_count: Some(1),
            max_output_tokens: Some(1024),
        }),
        tools: Some(tools),
    };

    info!("Sending request to Gemini API");
    let client = reqwest::Client::new();
    let resp = client
        .post("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent")
        .query(&[("key", api_key)])
        .json(&request_body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err_text = resp
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        let msg = format!("Gemini API error (status {}): {}", status, err_text);
        error!(
            status = %status,
            error = %err_text,
            "Gemini API request failed"
        );
        return Err(msg.into());
    }

    info!("Gemini API request successful, parsing response");
    let response_text = resp.text().await?;
    info!(
        response_length = response_text.len(),
        "Raw Gemini API response: {}", response_text
    );

    let gemini_resp: GeminiApiResponse = serde_json::from_str(&response_text).map_err(|e| {
        format!(
            "Failed to parse Gemini response: {}. Response: {}",
            e, response_text
        )
    })?;
    if gemini_resp.candidates.is_empty() {
        info!("Gemini API returned empty candidates");
        return Ok(vec![]);
    }

    let candidate = &gemini_resp.candidates[0];
    let mut chunks = Vec::new();

    info!(
        "Candidate role: {}, parts count: {}",
        candidate.content.role,
        candidate.content.parts.len()
    );

    // Collect text parts and function calls
    for (_i, part) in candidate.content.parts.iter().enumerate() { // Use _i for unused variable
        if let Some(fc) = &part.function_call {
            chunks.push(LlmChunk::FunctionCall(fc.clone()));
        }
        if let Some(txt) = &part.text {
            if !txt.trim().is_empty() {
                chunks.push(LlmChunk::Text(txt.clone()));
            }
        }
    }

    Ok(chunks)
}

// ==================================================================
// WebSocket Utility: Sending Errors and Standard Messages
// ==================================================================

async fn send_error(
    sender: &mut futures_util::stream::SplitSink<WebSocket, WsMessage>,
    message: &str,
) -> Result<(), axum::Error> {
    let error_message = WsQueryMessage::Error {
        message: message.to_string(),
    };
    send_ws_message(sender, &error_message).await
}

async fn send_ws_message(
    sender: &mut futures_util::stream::SplitSink<WebSocket, WsMessage>,
    msg: &WsQueryMessage,
) -> Result<(), axum::Error> {
    let json = serde_json::to_string(msg)
        .map_err(|e| axum::Error::new(format!("JSON serialization error: {}", e)))?;
    sender.send(WsMessage::Text(json)).await
}
