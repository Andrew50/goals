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

// Main handler for query requests
pub async fn handle_query(
    Extension(pool): Extension<neo4rs::Graph>,
    Json(request): Json<GeminiRequest>,
) -> impl IntoResponse {
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
        tools: Some(tools.clone()),
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
                    tools: Some(tools.clone()),
                };

                // Print the second outgoing request for debugging
                println!(
                    "Sending second request to Gemini API: {}",
                    serde_json::to_string_pretty(&second_api_request).unwrap_or_default()
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
    pool: &neo4rs::Graph,
) -> serde_json::Value {
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

            // Execute query and collect results
            let mut goals = Vec::new();
            if let Ok(mut result) = pool.execute(query).await {
                while let Ok(Some(row)) = result.next().await {
                    if let Ok(goal) = row.get::<serde_json::Value>("g") {
                        goals.push(goal);
                    }
                }
            }

            serde_json::json!({
                "status": "success",
                "goals": goals
            })
        }
        "create_goal" => {
            use crate::goal::{Goal, GoalType};

            // Get parameters
            let title = args["title"].as_str().unwrap_or("Untitled").to_string();
            let description = args["description"].as_str().map(|s| s.to_string());
            let deadline = args["deadline"].as_str().unwrap_or("");

            // Convert deadline to timestamp if provided
            let end_timestamp = if !deadline.is_empty() {
                if let Ok(date) = NaiveDate::parse_from_str(deadline, "%Y-%m-%d") {
                    Some(
                        date.and_hms_opt(23, 59, 59)
                            .unwrap()
                            .and_utc()
                            .timestamp_millis(),
                    )
                } else {
                    None
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
                    serde_json::json!({
                        "status": "success",
                        "goal": {
                            "id": created_goal.id,
                            "title": created_goal.name,
                            "description": created_goal.description,
                            "deadline": deadline
                        }
                    })
                }
                Err(e) => {
                    serde_json::json!({
                        "status": "error",
                        "message": format!("Failed to create goal: {}", e)
                    })
                }
            }
        }
        "get_calendar_events" => {
            // Get required parameters
            let start_date = args["start_date"].as_str().unwrap_or("");
            let end_date = args["end_date"].as_str().unwrap_or("");

            // Parse dates
            let start_timestamp = if !start_date.is_empty() {
                if let Ok(date) = NaiveDate::parse_from_str(start_date, "%Y-%m-%d") {
                    date.and_hms_opt(0, 0, 0)
                        .unwrap()
                        .and_utc()
                        .timestamp_millis()
                } else {
                    return serde_json::json!({
                        "status": "error",
                        "message": "Invalid start_date format"
                    });
                }
            } else {
                return serde_json::json!({
                    "status": "error",
                    "message": "start_date is required"
                });
            };

            let end_timestamp = if !end_date.is_empty() {
                if let Ok(date) = NaiveDate::parse_from_str(end_date, "%Y-%m-%d") {
                    date.and_hms_opt(23, 59, 59)
                        .unwrap()
                        .and_utc()
                        .timestamp_millis()
                } else {
                    return serde_json::json!({
                        "status": "error",
                        "message": "Invalid end_date format"
                    });
                }
            } else {
                return serde_json::json!({
                    "status": "error",
                    "message": "end_date is required"
                });
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

            let mut events = Vec::new();
            if let Ok(mut result) = pool.execute(query).await {
                while let Ok(Some(row)) = result.next().await {
                    if let Ok(event) = row.get::<serde_json::Value>("g") {
                        events.push(event);
                    }
                }
            }

            serde_json::json!({
                "status": "success",
                "events": events,
                "date_range": {
                    "start": start_date,
                    "end": end_date
                }
            })
        }
        "get_day_plan" => {
            // Get required parameter
            let date = args["date"].as_str().unwrap_or("");

            // Parse date
            let start_timestamp = if !date.is_empty() {
                if let Ok(date) = NaiveDate::parse_from_str(date, "%Y-%m-%d") {
                    date.and_hms_opt(0, 0, 0)
                        .unwrap()
                        .and_utc()
                        .timestamp_millis()
                } else {
                    return serde_json::json!({
                        "status": "error",
                        "message": "Invalid date format"
                    });
                }
            } else {
                return serde_json::json!({
                    "status": "error",
                    "message": "date is required"
                });
            };

            let end_timestamp = if !date.is_empty() {
                if let Ok(date) = NaiveDate::parse_from_str(date, "%Y-%m-%d") {
                    date.and_hms_opt(23, 59, 59)
                        .unwrap()
                        .and_utc()
                        .timestamp_millis()
                } else {
                    return serde_json::json!({
                        "status": "error",
                        "message": "Invalid date format"
                    });
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

            let mut plan_items = Vec::new();
            if let Ok(mut result) = pool.execute(query).await {
                while let Ok(Some(row)) = result.next().await {
                    if let Ok(task) = row.get::<serde_json::Value>("g") {
                        plan_items.push(task);
                    }
                }
            }

            serde_json::json!({
                "status": "success",
                "date": date,
                "plan": plan_items
            })
        }
        _ => serde_json::json!({
            "status": "error",
            "message": format!("Unknown function: {}", function_name)
        }),
    }
}
