// Add tool registry functionality here
use crate::tools::goal::GOAL_RETURN_QUERY;
use chrono::NaiveDate;
use chrono::Utc;
use neo4rs::query as neo4j_query;

pub async fn execute_tool(
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
            let query = neo4j_query(&query_str);

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
            use crate::tools::goal::{Goal, GoalType};

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

            let query = neo4j_query(&query_str)
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

            let query = neo4j_query(&query_str)
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
