use axum::{extract::Extension, http::StatusCode, response::IntoResponse, Json};
use chrono::{NaiveDate, Utc};
use neo4rs::query;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::goal::GOAL_RETURN_QUERY;

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

// Struct for tool execution request
#[derive(Deserialize)]
pub struct ToolExecuteRequest {
    tool_name: String,
    args: Option<serde_json::Value>,
    conversation_id: Option<String>,
}

// Struct for tool execution response
#[derive(Serialize)]
pub struct ToolExecuteResponse {
    success: bool,
    message: Option<String>,
    error: Option<String>,
}

// Main handler for query requests
pub async fn handle_query(
    Extension(pool): Extension<neo4rs::Graph>,
    Json(request): Json<GeminiRequest>,
) -> impl IntoResponse {
    // Log incoming request details
    println!("Received query request: {:?}", request.query);

    // Initialize reqwest client
    let client = Client::new();

    // Create message history or initialize with user query
    let mut message_history = request.message_history.unwrap_or_else(|| vec![]);

    // Always add the current query to the message history
    message_history.push(Message {
        role: "user".to_string(),
        content: request.query.clone(),
    });

    // Clean up message history - limit size and filter out repeated error messages
    if message_history.len() > 10 {
        // Keep only the last 10 messages to prevent history from getting too large
        let skip_count = message_history.len() - 10;
        message_history = message_history.into_iter().skip(skip_count).collect();
    }

    // Remove consecutive duplicate error messages from the assistant
    let mut i = 1;
    while i < message_history.len() {
        if message_history[i].role == "assistant"
            && message_history[i]
                .content
                .contains("error processing your request")
            && i > 0
            && message_history[i].content == message_history[i - 1].content
        {
            message_history.remove(i);
        } else {
            i += 1;
        }
    }

    // Filter out messages with empty content
    message_history = message_history
        .into_iter()
        .filter(|msg| !msg.content.trim().is_empty())
        .collect();

    // Create Gemini API-specific message history with instructional messages first
    let mut gemini_contents = Vec::new();

    // Add instructional messages as the first turn
    gemini_contents.push(GeminiContent {
        parts: vec![Part {
            text: "You are an AI assistant that helps users manage their goals and tasks. When users ask to create, list, or manage goals, use the appropriate function. For example, if a user says 'create a goal called X', use the create_goal function with the title parameter. If they ask to see their goals, use the list_goals function.".to_string(),
        }],
        role: "user".to_string(),
    });

    gemini_contents.push(GeminiContent {
        parts: vec![Part {
            text: "I understand my role. I'll help manage goals and tasks using the appropriate functions when needed.".to_string(),
        }],
        role: "model".to_string(),
    });

    // Add actual conversation history
    for msg in &message_history {
        // Map "assistant" role to "model" as required by Gemini API
        let role = if msg.role == "assistant" {
            "model".to_string()
        } else {
            msg.role.clone()
        };

        gemini_contents.push(GeminiContent {
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
    let api_request = GeminiApiRequest {
        contents: gemini_contents,
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
        "Sending request to Gemini API: {}",
        serde_json::to_string_pretty(&api_request).unwrap_or_default()
    );

    // Get API key
    let api_key = match std::env::var("GOALS_GEMINI_API_KEY") {
        Ok(key) => {
            if key.is_empty() {
                eprintln!("ERROR: GOALS_GEMINI_API_KEY environment variable is empty");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "error": "Gemini API key is not set or is empty. Please set the GOALS_GEMINI_API_KEY environment variable."
                    })),
                )
                    .into_response();
            }
            key
        }
        Err(e) => {
            eprintln!(
                "ERROR: Failed to get GOALS_GEMINI_API_KEY environment variable: {}",
                e
            );
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Gemini API key is not set. Please set the GOALS_GEMINI_API_KEY environment variable."
                })),
            )
                .into_response();
        }
    };

    // Call Gemini API
    let api_response = match client
        .post("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent")
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
                    "Gemini API error: Status {}, Raw Response: {}",
                    status, error_text
                );
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "error": format!("Gemini API returned error (status {}): {}", status, error_text)
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
                    "error": format!("Failed to connect to Gemini API: {}", e)
                })),
            )
                .into_response();
        }
    };

    // Parse Gemini API response
    let text = match api_response.text().await {
        Ok(text) => text,
        Err(e) => {
            let error_msg = format!("Failed to get text from Gemini API response: {}", e);
            eprintln!("{}", error_msg);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": error_msg
                })),
            )
                .into_response();
        }
    };

    println!("Raw response from Gemini: {}", text);

    // Handle empty or malformed responses
    if text.trim().is_empty() {
        println!("Received empty text response from Gemini");
        
        // Add a generic error message to the conversation
        message_history.push(Message {
            role: "assistant".to_string(),
            content: "I'm sorry, I couldn't process your request at the moment. Please try again with a clearer instruction, such as 'create goal [goal name]' or 'list goals'.".to_string(),
        });

        // Generate conversation ID if not provided
        let conversation_id = request
            .conversation_id
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        // Return 200 to let the user see the error message
        return (
            StatusCode::OK, 
            Json(GeminiResponse {
                response: "I'm sorry, I couldn't process your request at the moment. Please try again with a clearer instruction, such as 'create goal [goal name]' or 'list goals'.".to_string(),
                conversation_id,
                message_history,
                tool_execution: None,
            }),
        ).into_response();
    }

    match serde_json::from_str::<GeminiApiResponse>(&text) {
        Ok(parsed_response) => {
            if parsed_response.candidates.is_empty() {
                eprintln!("Error: No candidates in Gemini response");
                
                // Add a generic error message to the conversation
                message_history.push(Message {
                    role: "assistant".to_string(),
                    content: "I'm sorry, I couldn't process your request at the moment. Please try again with a clearer instruction, such as 'create goal [goal name]' or 'list goals'.".to_string(),
                });

                // Generate conversation ID if not provided
                let conversation_id = request
                    .conversation_id
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

                // Return 200 to let the user see the error message
                return (
                    StatusCode::OK, 
                    Json(GeminiResponse {
                        response: "I'm sorry, I couldn't process your request at the moment. Please try again with a clearer instruction, such as 'create goal [goal name]' or 'list goals'.".to_string(),
                        conversation_id,
                        message_history,
                        tool_execution: None,
                    }),
                ).into_response();
            }

            let candidate = &parsed_response.candidates[0];
            let content = &candidate.content;

            // Check if the first part of the content exists and contains neither text nor a function call
            // If it's genuinely empty, trigger fallback. Otherwise, proceed.
            let is_empty_response = content.parts.is_empty() || 
                (content.parts.get(0).map_or(true, |part| part.text.is_none() && part.function_call.is_none()));

            if is_empty_response {
                println!("Detected empty content parts from Gemini, attempting to infer user intent");
                let fallback_response = handle_empty_response(&request.query, &message_history, &pool).await;
                return fallback_response;
            }

            // Check for function call FIRST
            if let Some(function_call) = content.parts.get(0).and_then(|part| part.function_call.as_ref()) {
                println!(
                    "Detected function call: {} with args: {:?}",
                    function_call.name, function_call.args
                );

                // Execute the tool function
                let tool_result =
                    match execute_tool(&function_call.name, &function_call.args, &pool).await {
                        Ok(result) => result,
                        Err(e) => {
                            let error_msg =
                                format!("Error executing tool {}: {}", function_call.name, e);
                            eprintln!("{}", error_msg);
                            return (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(serde_json::json!({
                                    "error": error_msg
                                })),
                            )
                                .into_response();
                        }
                    };

                // Create tool execution info
                let tool_execution = ToolExecution {
                    name: function_call.name.clone(),
                    args: Some(function_call.args.clone()),
                    write_operation: is_write_operation(&function_call.name),
                };

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
                // Create Gemini API-specific message history with instructional messages first
                let mut second_gemini_contents = Vec::new();

                // Add instructional messages as the first turn
                second_gemini_contents.push(GeminiContent {
                    parts: vec![Part {
                        text: "You are an AI assistant that helps users manage their goals and tasks. When users ask to create, list, or manage goals, use the appropriate function. For example, if a user says 'create a goal called X', use the create_goal function with the title parameter. If they ask to see their goals, use the list_goals function.".to_string(),
                    }],
                    role: "user".to_string(),
                });

                second_gemini_contents.push(GeminiContent {
                    parts: vec![Part {
                        text: "I understand my role. I'll help manage goals and tasks using the appropriate functions when needed.".to_string(),
                    }],
                    role: "model".to_string(),
                });

                // Add actual conversation history
                for msg in &message_history {
                    // Map "assistant" role to "model" as required by Gemini API
                    let role = if msg.role == "assistant" {
                        "model".to_string()
                    } else {
                        msg.role.clone()
                    };

                    second_gemini_contents.push(GeminiContent {
                        parts: vec![Part {
                            text: msg.content.clone(),
                        }],
                        role,
                    });
                }

                let second_api_request = GeminiApiRequest {
                    contents: second_gemini_contents,
                    generation_config: Some(GenerationConfig {
                        temperature: Some(0.7),
                        top_p: Some(0.95),
                        top_k: Some(40),
                        candidate_count: Some(1),
                        max_output_tokens: Some(2048),
                    }),
                    tools: Some(tools.clone()),
                };

                // Print the second outgoing request for debugging
                println!(
                    "Sending second request to Gemini API with {} contents items",
                    second_api_request.contents.len()
                );

                let second_api_response = match client
                    .post("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent")
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
                                "Gemini API error (second call): Status {}, Raw Response: {}",
                                status, error_text
                            );
                            return (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(serde_json::json!({
                                    "error": format!("Gemini API returned error on second call (status {}): {}", status, error_text)
                                })),
                            )
                                .into_response();
                        }
                        response
                    }
                    Err(e) => {
                        let error_msg = format!("Failed to connect to Gemini API for second call: {}", e);
                        eprintln!("{}", error_msg);
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({
                                "error": error_msg
                            })),
                        )
                            .into_response();
                    }
                };

                let second_gemini_response: GeminiApiResponse =
                    match second_api_response.json().await {
                        Ok(response) => response,
                        Err(e) => {
                            let error_msg =
                                format!("Failed to parse second Gemini API response: {}", e);
                            eprintln!("{}", error_msg);
                            return (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(serde_json::json!({
                                    "error": error_msg
                                })),
                            )
                                .into_response();
                        }
                    };

                // Get the final response text or potential function call from the second response
                let final_response_text = second_gemini_response
                    .candidates
                    .first()
                    .and_then(|candidate| candidate.content.parts.first())
                    .and_then(|part| part.text.clone())
                    .unwrap_or_else(|| {
                        // If no text, check if there's a function call (though unlikely in the second call)
                        // If neither, provide a generic success message based on the tool executed.
                        println!("Second Gemini call did not return text. Providing generic success message.");
                        format!("Successfully executed the {} function.", tool_execution.name)
                    });

                // Add the final assistant response to history
                message_history.push(Message {
                    role: "assistant".to_string(),
                    content: final_response_text.clone(),
                });

                // Generate conversation ID if not provided
                let conversation_id = request
                    .conversation_id
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

                // Return the final response with tool execution info
                return (
                    StatusCode::OK,
                    Json(GeminiResponse {
                        response: final_response_text,
                        conversation_id,
                        message_history,
                        tool_execution: Some(tool_execution),
                    }),
                )
                    .into_response();
            }
        }
        Err(e) => {
            let error_msg = format!("Failed to parse Gemini API response: {}", e);
            eprintln!("{}", error_msg);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": error_msg
                })),
            )
                .into_response();
        }
    }

    // We've processed all cases including function calls, so we should only get here 
    // if there was an actual empty response or an unprocessed edge case - log and provide a fallback
    println!("Detected empty response from Gemini, attempting to infer user intent");

    // Extract the original user query (without any instructions)
    let original_query = request.query.to_lowercase();
    println!("Processing fallback for query: {}", original_query);

    // Try to handle common queries directly
    if original_query.contains("create goal")
        || original_query.contains("add goal")
        || original_query.contains("new goal")
    {
        // Extract goal title from the query
        let title = original_query
            .replace("create goal", "")
            .replace("add goal", "")
            .replace("new goal", "")
            .trim()
            .to_string();

        if !title.is_empty() {
            println!("Inferring create_goal intent with title: {}", title);

            // Create a goal directly
            use crate::goal::{Goal, GoalType};

            let goal = Goal {
                id: None,
                name: title,
                goal_type: GoalType::Task,
                description: None,
                user_id: Some(1), // Default user ID
                priority: None,
                start_timestamp: None,
                end_timestamp: None,
                completion_date: None,
                next_timestamp: None,
                scheduled_timestamp: None,
                duration: None,
                completed: Some(false),
                frequency: None,
                routine_type: None,
                routine_time: None,
                position_x: None,
                position_y: None,
            };

            match goal.create_goal(&pool).await {
                Ok(created_goal) => {
                    println!(
                        "Successfully created goal via fallback with ID: {:?}",
                        created_goal.id
                    );

                    // Add successful response to message history
                    message_history.push(Message {
                        role: "assistant".to_string(),
                        content: format!(
                            "I've created a new goal '{}' for you.",
                            created_goal.name
                        ),
                    });

                    // Generate conversation ID if not provided
                    let conversation_id = request
                        .conversation_id
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

                    // Create tool execution info for direct goal creation
                    let tool_execution = ToolExecution {
                        name: "create_goal".to_string(),
                        args: Some(serde_json::json!({
                            "title": created_goal.name,
                            "description": created_goal.description
                        })),
                        write_operation: true,
                    };

                    return (
                        StatusCode::OK,
                        Json(GeminiResponse {
                            response: format!(
                                "I've created a new goal '{}' for you.",
                                created_goal.name
                            ),
                            conversation_id,
                            message_history,
                            tool_execution: Some(tool_execution),
                        }),
                    )
                        .into_response();
                }
                Err(e) => {
                    let error_msg = format!("Failed to create goal via fallback: {}", e);
                    eprintln!("{}", error_msg);
                }
            }
        }
    } else if original_query.contains("list goals")
        || original_query.contains("show goals")
        || original_query.contains("my goals")
    {
        println!("Inferring list_goals intent");

        // Execute list_goals directly
        match execute_tool("list_goals", &serde_json::json!({}), &pool).await {
            Ok(goals_result) => {
                let response_text = format!(
                    "Here are your goals: {}",
                    serde_json::to_string_pretty(&goals_result).unwrap_or_default()
                );

                // Add response to message history
                message_history.push(Message {
                    role: "assistant".to_string(),
                    content: response_text.clone(),
                });

                // Generate conversation ID if not provided
                let conversation_id = request
                    .conversation_id
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

                // Create tool execution info for direct goal listing
                let tool_execution = ToolExecution {
                    name: "list_goals".to_string(),
                    args: Some(serde_json::json!({})),
                    write_operation: false,
                };

                return (
                    StatusCode::OK,
                    Json(GeminiResponse {
                        response: response_text,
                        conversation_id,
                        message_history,
                        tool_execution: Some(tool_execution),
                    }),
                )
                    .into_response();
            }
            Err(e) => {
                let error_msg = format!("Failed to list goals via fallback: {}", e);
                eprintln!("{}", error_msg);
            }
        }
    }

    // Fallback response if we couldn't get a proper response from Gemini
    eprintln!(
        "Error: Failed to get a valid response from Gemini. Response: {:?}",
        text
    );

    // Add a generic error message to the conversation
    message_history.push(Message {
        role: "assistant".to_string(),
        content: "I'm sorry, I couldn't process your request at the moment. Please try again with a clearer instruction, such as 'create goal [goal name]' or 'list goals'.".to_string(),
    });

    // Generate conversation ID if not provided
    let conversation_id = request
        .conversation_id
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    // Return 200 to let the user see the error message
    (
        StatusCode::OK, 
        Json(GeminiResponse {
            response: "I'm sorry, I couldn't process your request at the moment. Please try again with a clearer instruction, such as 'create goal [goal name]' or 'list goals'.".to_string(),
            conversation_id,
            message_history,
            tool_execution: None,
        }),
    )
        .into_response()
}

// Execute a tool based on the function name and arguments
async fn execute_tool(
    function_name: &str,
    args: &serde_json::Value,
    pool: &neo4rs::Graph,
) -> Result<serde_json::Value, String> {
    println!("Executing tool: {} with args: {:?}", function_name, args);

    match function_name {
        "list_goals" => {
            // Get filter parameter if provided
            let filter = args["filter"].as_str().unwrap_or("all");

            // Construct query based on filter
            let filter_clause = match filter {
                "active" => "WHERE g.completed = false",
                "completed" => "WHERE g.completed = true",
                _ => "",
            };

            let query_str = format!("MATCH (g:Goal) {} {}", filter_clause, GOAL_RETURN_QUERY);
            let query = query(&query_str);

            println!("Executing Neo4j query: {}", query_str);

            // Execute query and collect results
            let mut goals = Vec::new();
            match pool.execute(query).await {
                Ok(mut result) => {
                    while let Ok(Some(row)) = result.next().await {
                        match row.get::<serde_json::Value>("g") {
                            Ok(goal) => goals.push(goal),
                            Err(e) => println!("Error getting goal from row: {}", e),
                        }
                    }

                    Ok(serde_json::json!({
                        "status": "success",
                        "goals": goals
                    }))
                }
                Err(e) => {
                    let error_msg = format!("Neo4j query error in list_goals: {}", e);
                    eprintln!("{}", error_msg);
                    Err(error_msg)
                }
            }
        }
        "create_goal" => {
            use crate::goal::{Goal, GoalType};

            // Get parameters
            let title = match args.get("title") {
                Some(title_val) => match title_val.as_str() {
                    Some(title_str) => title_str.to_string(),
                    None => {
                        let error_msg = "Title parameter is not a string".to_string();
                        eprintln!("{}", error_msg);
                        return Err(error_msg);
                    }
                },
                None => {
                    let error_msg = "Missing required parameter: title".to_string();
                    eprintln!("{}", error_msg);
                    return Err(error_msg);
                }
            };

            let description = args["description"].as_str().map(|s| s.to_string());
            let deadline = args["deadline"].as_str().unwrap_or("");

            println!(
                "Creating goal with title: {}, description: {:?}, deadline: {}",
                title, description, deadline
            );

            // Convert deadline to timestamp if provided
            let end_timestamp = if !deadline.is_empty() {
                match NaiveDate::parse_from_str(deadline, "%Y-%m-%d") {
                    Ok(date) => Some(
                        date.and_hms_opt(23, 59, 59)
                            .unwrap()
                            .and_utc()
                            .timestamp_millis(),
                    ),
                    Err(e) => {
                        let error_msg = format!("Invalid deadline format: {}", e);
                        eprintln!("{}", error_msg);
                        return Err(error_msg);
                    }
                }
            } else {
                None
            };

            // Create a Goal object
            let goal = Goal {
                id: None,
                name: title,
                goal_type: GoalType::Task,
                description,
                user_id: Some(1), // Default user ID
                priority: None,
                start_timestamp: None,
                end_timestamp,
                completion_date: None,
                next_timestamp: None,
                scheduled_timestamp: None,
                duration: None,
                completed: Some(false),
                frequency: None,
                routine_type: None,
                routine_time: None,
                position_x: None,
                position_y: None,
            };

            // Use the existing create_goal method
            match goal.create_goal(pool).await {
                Ok(created_goal) => {
                    println!("Goal created successfully with ID: {:?}", created_goal.id);
                    Ok(serde_json::json!({
                        "status": "success",
                        "goal": {
                            "id": created_goal.id,
                            "title": created_goal.name,
                            "description": created_goal.description,
                            "deadline": deadline
                        }
                    }))
                }
                Err(e) => {
                    let error_msg = format!("Failed to create goal: {}", e);
                    eprintln!("{}", error_msg);
                    Err(error_msg)
                }
            }
        }
        "get_calendar_events" => {
            // Get required parameters
            let start_date = match args.get("start_date") {
                Some(val) => match val.as_str() {
                    Some(s) => s,
                    None => {
                        let error_msg = "start_date parameter is not a string".to_string();
                        eprintln!("{}", error_msg);
                        return Err(error_msg);
                    }
                },
                None => {
                    let error_msg = "Missing required parameter: start_date".to_string();
                    eprintln!("{}", error_msg);
                    return Err(error_msg);
                }
            };

            let end_date = match args.get("end_date") {
                Some(val) => match val.as_str() {
                    Some(s) => s,
                    None => {
                        let error_msg = "end_date parameter is not a string".to_string();
                        eprintln!("{}", error_msg);
                        return Err(error_msg);
                    }
                },
                None => {
                    let error_msg = "Missing required parameter: end_date".to_string();
                    eprintln!("{}", error_msg);
                    return Err(error_msg);
                }
            };

            println!(
                "Getting calendar events for date range: {} to {}",
                start_date, end_date
            );

            // Parse dates
            let start_timestamp = if !start_date.is_empty() {
                match NaiveDate::parse_from_str(start_date, "%Y-%m-%d") {
                    Ok(date) => date
                        .and_hms_opt(0, 0, 0)
                        .unwrap()
                        .and_utc()
                        .timestamp_millis(),
                    Err(e) => {
                        let error_msg = format!("Invalid start_date format: {}", e);
                        eprintln!("{}", error_msg);
                        return Err(error_msg);
                    }
                }
            } else {
                return Err("start_date is required".to_string());
            };

            let end_timestamp = if !end_date.is_empty() {
                match NaiveDate::parse_from_str(end_date, "%Y-%m-%d") {
                    Ok(date) => date
                        .and_hms_opt(23, 59, 59)
                        .unwrap()
                        .and_utc()
                        .timestamp_millis(),
                    Err(e) => {
                        let error_msg = format!("Invalid end_date format: {}", e);
                        eprintln!("{}", error_msg);
                        return Err(error_msg);
                    }
                }
            } else {
                return Err("end_date is required".to_string());
            };

            // Use similar query as in day.rs's get_day_tasks
            let query_str = format!(
                "MATCH (g:Goal) 
                WHERE g.user_id = 1
                AND g.scheduled_timestamp >= $start_timestamp 
                AND g.scheduled_timestamp <= $end_timestamp
                {}",
                GOAL_RETURN_QUERY
            );

            let query = query(&query_str)
                .param("start_timestamp", start_timestamp)
                .param("end_timestamp", end_timestamp);

            println!("Executing Neo4j query for calendar events");

            let mut events = Vec::new();
            match pool.execute(query).await {
                Ok(mut result) => {
                    while let Ok(Some(row)) = result.next().await {
                        match row.get::<serde_json::Value>("g") {
                            Ok(event) => events.push(event),
                            Err(e) => println!("Error getting event from row: {}", e),
                        }
                    }

                    Ok(serde_json::json!({
                        "status": "success",
                        "events": events,
                        "date_range": {
                            "start": start_date,
                            "end": end_date
                        }
                    }))
                }
                Err(e) => {
                    let error_msg = format!("Neo4j query error in get_calendar_events: {}", e);
                    eprintln!("{}", error_msg);
                    Err(error_msg)
                }
            }
        }
        "get_day_plan" => {
            // Get required parameter
            let date = match args.get("date") {
                Some(val) => match val.as_str() {
                    Some(s) => s,
                    None => {
                        let error_msg = "date parameter is not a string".to_string();
                        eprintln!("{}", error_msg);
                        return Err(error_msg);
                    }
                },
                None => {
                    let error_msg = "Missing required parameter: date".to_string();
                    eprintln!("{}", error_msg);
                    return Err(error_msg);
                }
            };

            println!("Getting day plan for date: {}", date);

            // Parse date
            let start_timestamp = if !date.is_empty() {
                match NaiveDate::parse_from_str(date, "%Y-%m-%d") {
                    Ok(date) => date
                        .and_hms_opt(0, 0, 0)
                        .unwrap()
                        .and_utc()
                        .timestamp_millis(),
                    Err(e) => {
                        let error_msg = format!("Invalid date format: {}", e);
                        eprintln!("{}", error_msg);
                        return Err(error_msg);
                    }
                }
            } else {
                return Err("date is required".to_string());
            };

            let end_timestamp = if !date.is_empty() {
                match NaiveDate::parse_from_str(date, "%Y-%m-%d") {
                    Ok(date) => date
                        .and_hms_opt(23, 59, 59)
                        .unwrap()
                        .and_utc()
                        .timestamp_millis(),
                    Err(e) => {
                        let error_msg = format!("Invalid date format: {}", e);
                        eprintln!("{}", error_msg);
                        return Err(error_msg);
                    }
                }
            } else {
                Utc::now().timestamp_millis()
            };

            // Use query similar to day.rs get_day_tasks
            let query_str = format!(
                "MATCH (g:Goal) 
                WHERE g.user_id = 1
                AND (g.goal_type = 'task' OR g.goal_type = 'achievement')
                AND g.scheduled_timestamp >= $start_timestamp 
                AND g.scheduled_timestamp <= $end_timestamp
                {}
                ORDER BY g.scheduled_timestamp",
                GOAL_RETURN_QUERY
            );

            let query = query(&query_str)
                .param("start_timestamp", start_timestamp)
                .param("end_timestamp", end_timestamp);

            println!("Executing Neo4j query for day plan");

            let mut plan_items = Vec::new();
            match pool.execute(query).await {
                Ok(mut result) => {
                    while let Ok(Some(row)) = result.next().await {
                        match row.get::<serde_json::Value>("g") {
                            Ok(task) => plan_items.push(task),
                            Err(e) => println!("Error getting task from row: {}", e),
                        }
                    }

                    Ok(serde_json::json!({
                        "status": "success",
                        "date": date,
                        "plan": plan_items
                    }))
                }
                Err(e) => {
                    let error_msg = format!("Neo4j query error in get_day_plan: {}", e);
                    eprintln!("{}", error_msg);
                    Err(error_msg)
                }
            }
        }
        _ => {
            let error_msg = format!("Unknown function: {}", function_name);
            eprintln!("{}", error_msg);
            Err(error_msg)
        }
    }
}

// Function to determine if an operation writes to the database
fn is_write_operation(operation_name: &str) -> bool {
    match operation_name {
        "create_goal" | "update_goal" | "delete_goal" | "toggle_completion" => true,
        _ => false,
    }
}

// Handler for tool execution
pub async fn handle_tool_execute(
    Extension(pool): Extension<neo4rs::Graph>,
    Json(request): Json<ToolExecuteRequest>,
) -> impl IntoResponse {
    println!("Executing tool: {}", request.tool_name);
    
    // Execute the tool
    match execute_tool(&request.tool_name, &request.args.unwrap_or(serde_json::json!({})), &pool).await {
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
                    return "You don't have any goals yet. Would you like to create one?".to_string();
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
                    if let (Some(title), Some(date)) = (event["title"].as_str(), event["date"].as_str()) {
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

// Add this function to handle empty responses
async fn handle_empty_response(query: &str, message_history: &[Message], pool: &neo4rs::Graph) -> axum::response::Response {
    println!("Processing fallback for query: {}", query);
    let mut updated_history = message_history.to_vec();
    
    // Try to infer intent from the query
    let query_lower = query.to_lowercase();
    
    // Check for create goal intent
    if query_lower.contains("create goal") || query_lower.contains("add goal") || query_lower.contains("new goal") {
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
            
            match execute_tool("create_goal", &args, pool).await {
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
                    ).into_response();
                },
                Err(_) => {}
            }
        }
    } else if !query_lower.is_empty() {
        // Check if this might be a direct response to a request for a goal title
        // Look at the last assistant message to see if it was asking for a title
        if let Some(last_assistant_msg) = updated_history.iter().rev().find(|msg| msg.role == "assistant") {
            if last_assistant_msg.content.contains("title for the goal") || 
               last_assistant_msg.content.contains("call the goal") || 
               last_assistant_msg.content.contains("name for the goal") {
                
                // This is likely a direct response with just the title
                let title = query.trim();
                
                if !title.is_empty() {
                    // Try to create a goal with just this title
                    let args = serde_json::json!({
                        "title": title
                    });
                    
                    match execute_tool("create_goal", &args, pool).await {
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
                            ).into_response();
                        },
                        Err(_) => {}
                    }
                }
            }
        }
    }
    
    // Check for list goals intent
    if query_lower.contains("list goals") || query_lower.contains("show goals") || query_lower.contains("my goals") {
        match execute_tool("list_goals", &serde_json::json!({}), pool).await {
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
                ).into_response();
            },
            Err(_) => {}
        }
    }
    
    // Default fallback
    let fallback_message = "I'm sorry, I couldn't process your request at the moment. Please try again with a clearer instruction, such as 'create goal [goal name]' or 'list goals'.";
    updated_history.push(Message {
        role: "assistant".to_string(),
        content: fallback_message.to_string(),
    });

    let conversation_id = uuid::Uuid::new_v4().to_string();
    
    (
        StatusCode::OK, 
        Json(GeminiResponse {
            response: fallback_message.to_string(),
            conversation_id,
            message_history: updated_history,
            tool_execution: None,
        }),
    ).into_response()
}
