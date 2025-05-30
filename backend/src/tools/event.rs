use axum::{http::StatusCode, Json};
use neo4rs::{query, Graph};
use serde::{Deserialize, Serialize};

use crate::tools::goal::{Goal, GoalType};

#[derive(Debug, Deserialize)]
pub struct CreateEventRequest {
    pub parent_id: i64,
    pub parent_type: String,  // "task" or "routine"
    pub scheduled_timestamp: i64,
    pub duration: i32,
}

#[derive(Debug, Serialize)]
pub struct CompleteEventResponse {
    pub event_completed: bool,
    pub parent_task_id: Option<i64>,
    pub parent_task_name: String,
    pub has_future_events: bool,
    pub should_prompt_task_completion: bool,
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