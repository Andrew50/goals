use axum::{extract::Json, http::StatusCode};
use chrono::{TimeZone, Utc};
use neo4rs::{query, Graph};
use serde_json::Value;

// Business logic functions with regular parameters
pub async fn get_day_tasks(
    graph: Graph,
    user_id: i64,
    start_timestamp: Option<i64>,
    end_timestamp: Option<i64>,
) -> Result<Json<Vec<Value>>, (StatusCode, String)> {
    let start_timestamp = start_timestamp.unwrap_or_else(|| {
        println!("No start timestamp provided");
        // Default to start of current UTC day if not provided
        Utc::now()
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis()
    });

    let end_timestamp = end_timestamp.unwrap_or_else(|| {
        // Default to end of current UTC day if not provided
        Utc::now()
            .date_naive()
            .and_hms_opt(23, 59, 59)
            .unwrap()
            .and_utc()
            .timestamp_millis()
    });

    println!("Query Parameters:");
    println!("  user_id: {}", user_id);
    println!(
        "  start_timestamp: {} ({})",
        start_timestamp,
        Utc.timestamp_millis_opt(start_timestamp).unwrap()
    );
    println!(
        "  end_timestamp: {} ({})",
        end_timestamp,
        Utc.timestamp_millis_opt(end_timestamp).unwrap()
    );

    // Query Events (Goal nodes with goal_type='event') that are linked to tasks, achievements, or routines
    let query_str = "
        MATCH (e:Goal)<-[:HAS_EVENT]-(g:Goal)
        WHERE e.goal_type = 'event'
        AND g.user_id = $user_id 
        AND (g.goal_type = 'task' OR g.goal_type = 'achievement' OR g.goal_type = 'routine')
        AND e.scheduled_timestamp >= $start_timestamp 
        AND e.scheduled_timestamp <= $end_timestamp
        AND (e.is_deleted IS NULL OR e.is_deleted = false)
        RETURN {
            id: id(e),
            name: e.name,
            description: e.description,
            goal_type: g.goal_type,
            priority: COALESCE(e.priority, g.priority, 'medium'),
            color: COALESCE(e.color, g.color),
            completed: COALESCE(e.completed, false),
            scheduled_timestamp: e.scheduled_timestamp,
            goal_id: id(g),
            parent_type: e.parent_type,
            routine_instance_id: e.routine_instance_id
        } as event
        ORDER BY e.scheduled_timestamp";

    let query = query(query_str)
        .param("user_id", user_id)
        .param("start_timestamp", start_timestamp)
        .param("end_timestamp", end_timestamp);

    match graph.execute(query).await {
        Ok(mut result) => {
            let mut events = Vec::new();
            while let Ok(Some(row)) = result.next().await {
                if let Ok(event) = row.get::<serde_json::Value>("event") {
                    events.push(event);
                }
            }
            println!("Found {} events", events.len());
            Ok(Json(events))
        }
        Err(e) => {
            eprintln!("Error fetching day events: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch events: {}", e),
            ))
        }
    }
}

pub async fn toggle_complete_task(
    graph: Graph,
    id: i64,
) -> Result<StatusCode, (StatusCode, String)> {
    let now = Utc::now().timestamp();

    // Toggle completion on the Event (Goal node with goal_type='event')
    let query = query(
        "MATCH (e:Goal) 
         WHERE id(e) = $id 
         AND e.goal_type = 'event'
         SET e.completed = CASE WHEN e.completed = true THEN false ELSE true END,
             e.completion_date = CASE WHEN e.completed = true THEN null ELSE $completion_date END
         RETURN e",
    )
    .param("id", id)
    .param("completion_date", now);

    match graph.run(query).await {
        Ok(_) => Ok(StatusCode::OK),
        Err(e) => {
            eprintln!("Error toggling event completion: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to toggle event completion: {}", e),
            ))
        }
    }
}
