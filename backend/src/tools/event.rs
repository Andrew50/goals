use axum::{http::StatusCode, Json};
use neo4rs::{query, Graph};
use serde::{Deserialize, Serialize};
use chrono::Utc;

use crate::tools::goal::{Goal, GoalType};
use crate::tools::stats::EventMove;

#[derive(Debug, Deserialize)]
pub struct CreateEventRequest {
    pub parent_id: i64,
    pub parent_type: String,  // "task" or "routine"
    pub scheduled_timestamp: i64,
    pub duration: i32,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEventRequest {
    pub scheduled_timestamp: Option<i64>,
    pub duration: Option<i32>,
    pub completed: Option<bool>,
    pub move_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRoutineEventRequest {
    pub new_timestamp: i64,
    pub update_scope: String,  // "single", "all", or "future"
}

#[derive(Debug, Serialize)]
pub struct CompleteEventResponse {
    pub event_completed: bool,
    pub parent_task_id: Option<i64>,
    pub parent_task_name: String,
    pub has_future_events: bool,
    pub should_prompt_task_completion: bool,
}

#[derive(Debug, Serialize)]
pub struct TaskEventsResponse {
    pub task_id: i64,
    pub events: Vec<Goal>,
    pub total_duration: i32,
    pub next_scheduled: Option<i64>,
    pub last_scheduled: Option<i64>,
}

pub async fn create_event_handler(
    graph: Graph,
    user_id: i64,
    request: CreateEventRequest,
) -> Result<(StatusCode, Json<Goal>), (StatusCode, String)> {
    // Fetch parent to inherit properties
    let parent_query = query(
        "MATCH (p:Goal) 
         WHERE id(p) = $parent_id AND p.user_id = $user_id
         RETURN p"
    )
    .param("parent_id", request.parent_id)
    .param("user_id", user_id);
    
    let mut result = graph.execute(parent_query).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let parent_row = result.next().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Parent not found".to_string()))?;
    
    let parent: Goal = parent_row.get("p")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    // Create event inheriting from parent
    let event = Goal {
        id: None,
        name: parent.name.clone(),
        goal_type: GoalType::Event,
        description: parent.description.clone(),
        priority: parent.priority.clone(),
        user_id: Some(user_id),
        scheduled_timestamp: Some(request.scheduled_timestamp),
        duration: Some(request.duration),
        parent_id: Some(request.parent_id),
        parent_type: Some(request.parent_type),
        completed: Some(false),
        is_deleted: Some(false),
        start_timestamp: None,
        end_timestamp: None,
        completion_date: None,
        next_timestamp: None,
        frequency: None,
        routine_type: None,
        routine_time: None,
        position_x: None,
        position_y: None,
        routine_instance_id: None,
        due_date: None,
        start_date: None,
    };
    
    let created_event = event.create_goal(&graph).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    // Create HAS_EVENT relationship
    let rel_query = query(
        "MATCH (p:Goal), (e:Goal)
         WHERE id(p) = $parent_id AND id(e) = $event_id
         CREATE (p)-[:HAS_EVENT]->(e)"
    )
    .param("parent_id", request.parent_id)
    .param("event_id", created_event.id.unwrap());
    
    graph.run(rel_query).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    Ok((StatusCode::CREATED, Json(created_event)))
}

pub async fn complete_event_handler(
    graph: Graph,
    event_id: i64,
) -> Result<Json<CompleteEventResponse>, (StatusCode, String)> {
    // Mark event complete
    let complete_query = query(
        "MATCH (e:Goal)
         WHERE id(e) = $event_id
         SET e.completed = true
         WITH e
         MATCH (p:Goal)-[:HAS_EVENT]->(e)
         OPTIONAL MATCH (p)-[:HAS_EVENT]->(other:Goal)
         WHERE other.scheduled_timestamp > e.scheduled_timestamp
         AND other.is_deleted <> true
         AND other.completed <> true
         RETURN e, p, count(other) as future_events"
    )
    .param("event_id", event_id);
    
    let mut result = graph.execute(complete_query).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    if let Some(row) = result.next().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))? {
        let future_events: i64 = row.get("future_events").unwrap_or(0);
        let parent: Goal = row.get("p")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        
        Ok(Json(CompleteEventResponse {
            event_completed: true,
            parent_task_id: parent.id,
            parent_task_name: parent.name,
            has_future_events: future_events > 0,
            should_prompt_task_completion: parent.goal_type == GoalType::Task && future_events == 0,
        }))
    } else {
        Err((StatusCode::NOT_FOUND, "Event not found".to_string()))
    }
}

pub async fn delete_event_handler(
    graph: Graph,
    event_id: i64,
    delete_future: bool,
) -> Result<StatusCode, (StatusCode, String)> {
    if delete_future {
        // For routine events, delete this and all future
        let delete_query = query(
            "MATCH (e:Goal)
             WHERE id(e) = $event_id
             WITH e, e.routine_instance_id as instance_id, e.scheduled_timestamp as cutoff
             MATCH (r:Goal)-[:HAS_EVENT]->(events:Goal)
             WHERE events.routine_instance_id = instance_id
             AND events.scheduled_timestamp >= cutoff
             SET events.is_deleted = true
             WITH r, max(events.scheduled_timestamp) as last_timestamp
             WHERE last_timestamp IS NOT NULL
             SET r.end_date = last_timestamp"
        )
        .param("event_id", event_id);
        
        graph.run(delete_query).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    } else {
        // Soft delete single event
        let delete_query = query(
            "MATCH (e:Goal)
             WHERE id(e) = $event_id
             SET e.is_deleted = true"
        )
        .param("event_id", event_id);
        
        graph.run(delete_query).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    
    Ok(StatusCode::OK)
}

pub async fn split_event_handler(
    graph: Graph,
    event_id: i64,
) -> Result<Json<Vec<Goal>>, (StatusCode, String)> {
    // Fetch the event to split
    let fetch_query = query(
        "MATCH (e:Goal)
         WHERE id(e) = $event_id
         RETURN e"
    )
    .param("event_id", event_id);
    
    let mut result = graph.execute(fetch_query).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let event_row = result.next().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Event not found".to_string()))?;
    
    let event: Goal = event_row.get("e")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let half_duration = event.duration.unwrap_or(60) / 2;
    let start_time = event.scheduled_timestamp.unwrap();
    let mid_time = start_time + (half_duration as i64 * 60 * 1000);
    
    // Create two new events
    let mut event1 = event.clone();
    event1.id = None;
    event1.duration = Some(half_duration);
    
    let mut event2 = event.clone();
    event2.id = None;
    event2.scheduled_timestamp = Some(mid_time);
    event2.duration = Some(half_duration);
    
    let created1 = event1.create_goal(&graph).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let created2 = event2.create_goal(&graph).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    // Copy the HAS_EVENT relationship
    let copy_rel_query = query(
        "MATCH (p:Goal)-[:HAS_EVENT]->(e:Goal)
         WHERE id(e) = $old_event_id
         WITH p
         MATCH (e1:Goal), (e2:Goal)
         WHERE id(e1) = $event1_id AND id(e2) = $event2_id
         CREATE (p)-[:HAS_EVENT]->(e1)
         CREATE (p)-[:HAS_EVENT]->(e2)"
    )
    .param("old_event_id", event_id)
    .param("event1_id", created1.id.unwrap())
    .param("event2_id", created2.id.unwrap());
    
    graph.run(copy_rel_query).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    // Delete original event
    let delete_query = query(
        "MATCH (e:Goal)
         WHERE id(e) = $event_id
         DETACH DELETE e"
    )
    .param("event_id", event_id);
    
    graph.run(delete_query).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    Ok(Json(vec![created1, created2]))
}

pub async fn get_task_events_handler(
    graph: Graph,
    task_id: i64,
) -> Result<Json<TaskEventsResponse>, (StatusCode, String)> {
    let query_str = "
        MATCH (t:Goal)-[:HAS_EVENT]->(e:Goal)
        WHERE id(t) = $task_id 
        AND e.goal_type = 'event'
        AND (e.is_deleted IS NULL OR e.is_deleted = false)
        RETURN e
        ORDER BY e.scheduled_timestamp ASC
    ";
    
    let query = query(query_str).param("task_id", task_id);
    
    let mut result = graph.execute(query).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let mut events = Vec::new();
    let mut total_duration = 0i32;
    let mut next_scheduled = None;
    let mut last_scheduled = None;
    
    while let Some(row) = result.next().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))? {
        let event: Goal = row.get("e")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        
        if let Some(duration) = event.duration {
            total_duration += duration;
        }
        
        if let Some(scheduled) = event.scheduled_timestamp {
            if next_scheduled.is_none() || next_scheduled.unwrap() > scheduled {
                next_scheduled = Some(scheduled);
            }
            if last_scheduled.is_none() || last_scheduled.unwrap() < scheduled {
                last_scheduled = Some(scheduled);
            }
        }
        
        events.push(event);
    }
    
    Ok(Json(TaskEventsResponse {
        task_id,
        events,
        total_duration,
        next_scheduled,
        last_scheduled,
    }))
}

pub async fn update_event_handler(
    graph: Graph,
    user_id: i64,
    event_id: i64,
    request: UpdateEventRequest,
) -> Result<Json<Goal>, (StatusCode, String)> {
    // First fetch the existing event
    let fetch_query = query(
        "MATCH (e:Goal)
         WHERE id(e) = $event_id
         RETURN e"
    )
    .param("event_id", event_id);
    
    let mut result = graph.execute(fetch_query).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let event_row = result.next().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Event not found".to_string()))?;
    
    let old_event: Goal = event_row.get("e")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    // Check if this is a reschedule (timestamp change)
    let is_reschedule = request.scheduled_timestamp.is_some() && 
        request.scheduled_timestamp != old_event.scheduled_timestamp;
    
    // Build update query
    let mut set_clauses = Vec::new();
    let mut params = vec![("event_id", neo4rs::BoltType::Integer(neo4rs::BoltInteger { value: event_id }))];
    
    if let Some(timestamp) = request.scheduled_timestamp {
        set_clauses.push("e.scheduled_timestamp = $new_timestamp");
        params.push(("new_timestamp", neo4rs::BoltType::Integer(neo4rs::BoltInteger { value: timestamp })));
    }
    
    if let Some(duration) = request.duration {
        set_clauses.push("e.duration = $duration");
        params.push(("duration", neo4rs::BoltType::Integer(neo4rs::BoltInteger { value: duration as i64 })));
    }
    
    if let Some(completed) = request.completed {
        set_clauses.push("e.completed = $completed");
        params.push(("completed", neo4rs::BoltType::Boolean(neo4rs::BoltBoolean { value: completed })));
    }
    
    if set_clauses.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "No fields to update".to_string()));
    }
    
    let update_query = format!(
        "MATCH (e:Goal) WHERE id(e) = $event_id SET {} RETURN e",
        set_clauses.join(", ")
    );
    
    let mut query_builder = query(&update_query);
    for (key, value) in params {
        query_builder = query_builder.param(key, value);
    }
    
    let mut update_result = graph.execute(query_builder).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let updated_event: Goal = if let Some(row) = update_result.next().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))? {
        row.get("e").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        return Err((StatusCode::NOT_FOUND, "Event not found after update".to_string()));
    };
    
    // Record the move if this was a reschedule
    if is_reschedule {
        let event_move = EventMove {
            id: None,
            event_id,
            user_id,
            old_timestamp: old_event.scheduled_timestamp.unwrap_or(0),
            new_timestamp: request.scheduled_timestamp.unwrap(),
            move_type: "reschedule".to_string(),
            move_timestamp: Utc::now().timestamp_millis(),
            reason: request.move_reason,
        };
        
        // Record the move (don't fail the update if this fails, just log)
        if let Err(e) = crate::tools::stats::record_event_move(graph.clone(), event_move).await {
            eprintln!("Warning: Failed to record event move: {:?}", e);
        }
    }
    
    Ok(Json(updated_event))
}

pub async fn update_routine_event_handler(
    graph: Graph,
    user_id: i64,
    event_id: i64,
    request: UpdateRoutineEventRequest,
) -> Result<Json<Vec<Goal>>, (StatusCode, String)> {
    // First, fetch the event to get routine information
    let fetch_query = query(
        "MATCH (e:Goal)
         WHERE id(e) = $event_id
         AND e.goal_type = 'event'
         AND e.parent_type = 'routine'
         RETURN e"
    )
    .param("event_id", event_id);
    
    let mut result = graph.execute(fetch_query).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let event_row = result.next().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Routine event not found".to_string()))?;
    
    let event: Goal = event_row.get("e")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let parent_id = event.parent_id
        .ok_or((StatusCode::BAD_REQUEST, "Event missing parent_id".to_string()))?;
    let current_timestamp = event.scheduled_timestamp
        .ok_or((StatusCode::BAD_REQUEST, "Event missing scheduled_timestamp".to_string()))?;
    
    // Extract the time-of-day from the new timestamp (milliseconds since midnight)
    let day_in_ms: i64 = 24 * 60 * 60 * 1000;
    let new_time_of_day = request.new_timestamp % day_in_ms;
    
    match request.update_scope.as_str() {
        "single" => {
            // Update only this event
            let update_query = query(
                "MATCH (e:Goal)
                 WHERE id(e) = $event_id
                 SET e.scheduled_timestamp = $new_timestamp
                 RETURN e"
            )
            .param("event_id", event_id)
            .param("new_timestamp", request.new_timestamp);
            
            let mut update_result = graph.execute(update_query).await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            
            if let Some(row) = update_result.next().await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))? {
                let updated_event: Goal = row.get("e")
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                Ok(Json(vec![updated_event]))
            } else {
                Err((StatusCode::NOT_FOUND, "Event not found after update".to_string()))
            }
        },
        "all" => {
            // Update all events for this routine to the same time-of-day
            let update_query = query(
                "MATCH (e:Goal)
                 WHERE e.goal_type = 'event'
                 AND e.parent_id = $parent_id
                 AND e.parent_type = 'routine'
                 AND (e.is_deleted IS NULL OR e.is_deleted = false)
                 SET e.scheduled_timestamp = (e.scheduled_timestamp / $day_in_ms) * $day_in_ms + $new_time_of_day
                 RETURN collect(e) as events"
            )
            .param("parent_id", parent_id)
            .param("day_in_ms", day_in_ms)
            .param("new_time_of_day", new_time_of_day);
            
            let mut update_result = graph.execute(update_query).await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            
            if let Some(row) = update_result.next().await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))? {
                let events: Vec<Goal> = row.get("events")
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                Ok(Json(events))
            } else {
                Ok(Json(vec![]))
            }
        },
        "future" => {
            // Update this event and all future events to the same time-of-day
            let update_query = query(
                "MATCH (e:Goal)
                 WHERE e.goal_type = 'event'
                 AND e.parent_id = $parent_id
                 AND e.parent_type = 'routine'
                 AND e.scheduled_timestamp >= $current_timestamp
                 AND (e.is_deleted IS NULL OR e.is_deleted = false)
                 SET e.scheduled_timestamp = (e.scheduled_timestamp / $day_in_ms) * $day_in_ms + $new_time_of_day
                 RETURN collect(e) as events"
            )
            .param("parent_id", parent_id)
            .param("current_timestamp", current_timestamp)
            .param("day_in_ms", day_in_ms)
            .param("new_time_of_day", new_time_of_day);
            
            let mut update_result = graph.execute(update_query).await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            
            if let Some(row) = update_result.next().await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))? {
                let events: Vec<Goal> = row.get("events")
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                Ok(Json(events))
            } else {
                Ok(Json(vec![]))
            }
        },
        _ => Err((StatusCode::BAD_REQUEST, "Invalid update_scope. Must be 'single', 'all', or 'future'".to_string()))
    }
} 