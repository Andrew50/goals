use axum::{http::StatusCode, Json};
use chrono::{Datelike, Duration, Timelike, Utc};
use neo4rs::{query, Graph};
use serde::{Deserialize, Serialize};
use std::env;

// HTTP client for OpenRouter
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};

use crate::tools::goal::{Goal, GoalType};
use crate::tools::routine_exceptions;
use crate::tools::stats::EventMove;

#[derive(Debug, Deserialize)]
pub struct CreateEventRequest {
    pub parent_id: i64,
    pub parent_type: String, // "task" or "routine"
    pub scheduled_timestamp: i64,
    pub duration: i32,
    pub priority: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEventRequest {
    pub scheduled_timestamp: Option<i64>,
    pub duration: Option<i32>,
    pub resolution_status: Option<String>, // "pending", "completed", "failed", "skipped"
    #[serde(default)]
    pub completed: Option<bool>, // Legacy field for backward compatibility
    pub move_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRoutineEventRequest {
    pub new_timestamp: i64,
    pub update_scope: String, // "single", "all", "future", or "range"
    pub range_start: Option<i64>,
    pub range_end: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRoutineEventPropertiesRequest {
    pub update_scope: String, // "single", "all", "future", or "range"
    pub scheduled_timestamp: Option<i64>,
    pub duration: Option<i32>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub priority: Option<String>,
    #[allow(dead_code)]
    pub frequency: Option<String>,
    pub range_start: Option<i64>,
    pub range_end: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct SmartScheduleRequest {
    pub duration: i32,
    pub look_ahead_days: Option<i32>,
    pub preferred_time_start: Option<i32>, // Hour of day (0-23)
    pub preferred_time_end: Option<i32>,   // Hour of day (0-23)
    pub start_after_timestamp: Option<i64>, // For rescheduling - start suggestions after this time
    pub event_name: Option<String>,
    pub event_description: Option<String>,
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
    pub event_count: i32,
    pub completed_event_count: i32,
    pub failed_event_count: i32,
    pub skipped_event_count: i32,
    pub past_uncompleted_count: i32,
    pub future_uncompleted_count: i32,
    pub next_uncompleted_timestamp: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct RescheduleSuggestion {
    pub timestamp: i64,
    pub reason: String,
    pub score: f64,
}

#[derive(Debug, Serialize)]
pub struct RescheduleOptionsResponse {
    pub suggestions: Vec<RescheduleSuggestion>,
}

#[derive(Debug, Serialize)]
pub struct TaskDateRangeViolation {
    pub violation_type: String, // "before_start" or "after_end"
    pub event_timestamp: i64,
    pub task_start: Option<i64>,
    pub task_end: Option<i64>,
    pub suggested_task_start: Option<i64>,
    pub suggested_task_end: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct TaskDateValidationError {
    pub error_type: String, // "task_date_range_violation"
    pub message: String,
    pub violation: TaskDateRangeViolation,
}

// Helper function to validate event against task date range
async fn validate_event_against_task_dates(
    graph: &Graph,
    parent_id: i64,
    parent_type: &str,
    event_timestamp: i64,
) -> Result<Option<TaskDateRangeViolation>, (StatusCode, String)> {
    // Only validate for task parents, not routines
    if parent_type != "task" {
        return Ok(None);
    }

    // Fetch parent task details
    let parent_query = query(
        "MATCH (p:Goal) 
         WHERE id(p) = $parent_id
         AND p.goal_type = 'task'
         RETURN p.start_timestamp as start_timestamp, p.end_timestamp as end_timestamp",
    )
    .param("parent_id", parent_id);

    let mut result = graph
        .execute(parent_query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(row) = result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        let task_start: Option<i64> = row.get("start_timestamp").unwrap_or(None);
        let task_end: Option<i64> = row.get("end_timestamp").unwrap_or(None);

        // Check if event is outside task date range
        let mut violation_type = None;
        let mut suggested_task_start = task_start;
        let mut suggested_task_end = task_end;

        if let Some(start) = task_start {
            if event_timestamp < start {
                violation_type = Some("before_start");
                suggested_task_start = Some(event_timestamp);
            }
        }

        if let Some(end) = task_end {
            if event_timestamp > end {
                violation_type = Some("after_end");
                suggested_task_end = Some(event_timestamp);
            }
        }

        if let Some(vtype) = violation_type {
            return Ok(Some(TaskDateRangeViolation {
                violation_type: vtype.to_string(),
                event_timestamp,
                task_start,
                task_end,
                suggested_task_start,
                suggested_task_end,
            }));
        }
    }

    Ok(None)
}

pub async fn create_event_handler(
    graph: Graph,
    user_id: i64,
    request: CreateEventRequest,
) -> Result<(StatusCode, Json<Goal>), (StatusCode, String)> {
    // Validate against task date range if parent is a task
    if let Some(violation) = validate_event_against_task_dates(
        &graph,
        request.parent_id,
        &request.parent_type,
        request.scheduled_timestamp,
    )
    .await?
    {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            serde_json::to_string(&TaskDateValidationError {
                error_type: "task_date_range_violation".to_string(),
                message: format!(
                    "Event scheduled {} task's date range. Event is at {} but task {} is {}.",
                    match violation.violation_type.as_str() {
                        "before_start" => "before",
                        "after_end" => "after",
                        _ => "outside",
                    },
                    chrono::DateTime::from_timestamp_millis(violation.event_timestamp)
                        .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
                        .unwrap_or_else(|| "invalid timestamp".to_string()),
                    violation.violation_type.as_str().replace("_", " "),
                    match violation.violation_type.as_str() {
                        "before_start" => format!(
                            "starts at {}",
                            violation
                                .task_start
                                .and_then(chrono::DateTime::from_timestamp_millis)
                                .map(|dt| dt.format("%Y-%m-%d").to_string())
                                .unwrap_or_else(|| "unknown date".to_string())
                        ),
                        "after_end" => format!(
                            "ends at {}",
                            violation
                                .task_end
                                .and_then(chrono::DateTime::from_timestamp_millis)
                                .map(|dt| dt.format("%Y-%m-%d").to_string())
                                .unwrap_or_else(|| "unknown date".to_string())
                        ),
                        _ => "has invalid dates".to_string(),
                    }
                ),
                violation,
            })
            .unwrap_or_else(|_| "Serialization error".to_string()),
        ));
    }

    // Fetch parent to inherit properties
    let parent_query = query(
        "MATCH (p:Goal) 
         WHERE id(p) = $parent_id AND p.user_id = $user_id
         RETURN p",
    )
    .param("parent_id", request.parent_id)
    .param("user_id", user_id);

    let mut result = graph
        .execute(parent_query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let parent_row = result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Parent not found".to_string()))?;

    let parent: Goal = parent_row
        .get("p")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Create event inheriting from parent
    let event = Goal {
        id: None,
        name: parent.name.clone(),
        goal_type: GoalType::Event,
        description: parent.description.clone(),
        priority: request.priority.or(parent.priority.clone()),
        user_id: Some(user_id),
        scheduled_timestamp: Some(request.scheduled_timestamp),
        duration: Some(request.duration),
        parent_id: Some(request.parent_id),
        parent_type: Some(request.parent_type),
        resolution_status: Some("pending".to_string()),
        resolved_at: None,
        is_deleted: Some(false),
        start_timestamp: None,
        end_timestamp: None,
        next_timestamp: None,
        frequency: None,
        routine_type: None,
        routine_time: None,
        position_x: None,
        position_y: None,
        routine_instance_id: None,
        due_date: None,
        start_date: None,
        gcal_event_id: None,
        gcal_calendar_id: None,
        gcal_sync_enabled: None,
        gcal_last_sync: None,
        gcal_sync_direction: None,
        is_gcal_imported: None,
        updated_at: None,
    };

    let created_event = event
        .create_goal(&graph)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Create HAS_EVENT relationship
    let rel_query = query(
        "MATCH (p:Goal), (e:Goal)
         WHERE id(p) = $parent_id AND id(e) = $event_id
         CREATE (p)-[:HAS_EVENT]->(e)",
    )
    .param("parent_id", request.parent_id)
    .param("event_id", created_event.id.unwrap());

    graph
        .run(rel_query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok((StatusCode::CREATED, Json(created_event)))
}

pub async fn complete_event_handler(
    graph: Graph,
    event_id: i64,
) -> Result<Json<CompleteEventResponse>, (StatusCode, String)> {
    // First, just mark the event as complete and verify it exists
    let complete_query = query(
        "MATCH (e:Goal)
         WHERE id(e) = $event_id
         AND e.goal_type = 'event'
         SET e.resolution_status = 'completed',
             e.resolved_at = $resolved_at
         RETURN e",
    )
    .param("event_id", event_id)
    .param("resolved_at", chrono::Utc::now().timestamp_millis());

    let mut result = graph
        .execute(complete_query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let _event_row = result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Event not found".to_string()))?;

    // Now try to find the parent and future events
    let parent_query = query(
        "MATCH (e:Goal)
         WHERE id(e) = $event_id
         OPTIONAL MATCH (p:Goal)-[:HAS_EVENT]->(e)
         OPTIONAL MATCH (p)-[:HAS_EVENT]->(other:Goal)
         WHERE other.scheduled_timestamp > e.scheduled_timestamp
         AND (other.is_deleted IS NULL OR other.is_deleted = false)
         AND (other.resolution_status IS NULL OR other.resolution_status = 'pending')
         RETURN e, p, count(other) as future_events",
    )
    .param("event_id", event_id);

    let mut parent_result = graph
        .execute(parent_query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(row) = parent_result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        let future_events: i64 = row.get("future_events").unwrap_or(0);

        // Check if we found a parent
        if let Ok(parent) = row.get::<Goal>("p") {
            Ok(Json(CompleteEventResponse {
                event_completed: true,
                parent_task_id: parent.id,
                parent_task_name: parent.name,
                has_future_events: future_events > 0,
                should_prompt_task_completion: parent.goal_type == GoalType::Task
                    && future_events == 0,
            }))
        } else {
            // No parent found, just return basic completion response
            Ok(Json(CompleteEventResponse {
                event_completed: true,
                parent_task_id: None,
                parent_task_name: "Unknown".to_string(),
                has_future_events: false,
                should_prompt_task_completion: false,
            }))
        }
    } else {
        // This shouldn't happen since we already verified the event exists
        Err((StatusCode::NOT_FOUND, "Event not found".to_string()))
    }
}

// New function to handle task completion and sync with events
pub async fn complete_task_handler(
    graph: Graph,
    task_id: i64,
    user_id: i64,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let now = chrono::Utc::now().timestamp_millis();

    // Mark the task as completed
    let complete_task_query = query(
        "MATCH (t:Goal)
         WHERE id(t) = $task_id
         AND t.user_id = $user_id
         AND t.goal_type = 'task'
         SET t.resolution_status = 'completed',
             t.resolved_at = $resolved_at
         RETURN t",
    )
    .param("task_id", task_id)
    .param("user_id", user_id)
    .param("resolved_at", now);

    let mut result = graph
        .execute(complete_task_query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let _task_row = result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Task not found".to_string()))?;

    // Complete all non-deleted events of this task
    let complete_events_query = query(
        "MATCH (t:Goal)-[:HAS_EVENT]->(e:Goal)
         WHERE id(t) = $task_id
         AND e.goal_type = 'event'
         AND (e.is_deleted IS NULL OR e.is_deleted = false)
         SET e.resolution_status = 'completed',
             e.resolved_at = $resolved_at
         RETURN count(e) as completed_events",
    )
    .param("task_id", task_id)
    .param("resolved_at", now);

    let mut events_result = graph
        .execute(complete_events_query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let completed_events = if let Some(row) = events_result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        row.get::<i64>("completed_events").unwrap_or(0)
    } else {
        0
    };

    Ok(Json(serde_json::json!({
        "task_completed": true,
        "completed_events": completed_events
    })))
}

// New function to handle task incompletion and sync with events
pub async fn uncomplete_task_handler(
    graph: Graph,
    task_id: i64,
    user_id: i64,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Mark the task as pending (not resolved)
    let uncomplete_task_query = query(
        "MATCH (t:Goal)
         WHERE id(t) = $task_id
         AND t.user_id = $user_id
         AND t.goal_type = 'task'
         SET t.resolution_status = 'pending',
             t.resolved_at = null
         RETURN t",
    )
    .param("task_id", task_id)
    .param("user_id", user_id);

    let mut result = graph
        .execute(uncomplete_task_query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let _task_row = result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Task not found".to_string()))?;

    // Set all events of this task back to pending
    let uncomplete_events_query = query(
        "MATCH (t:Goal)-[:HAS_EVENT]->(e:Goal)
         WHERE id(t) = $task_id
         AND e.goal_type = 'event'
         AND (e.is_deleted IS NULL OR e.is_deleted = false)
         SET e.resolution_status = 'pending',
             e.resolved_at = null
         RETURN count(e) as uncompleted_events",
    )
    .param("task_id", task_id);

    let mut events_result = graph
        .execute(uncomplete_events_query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let uncompleted_events = if let Some(row) = events_result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        row.get::<i64>("uncompleted_events").unwrap_or(0)
    } else {
        0
    };

    Ok(Json(serde_json::json!({
        "task_uncompleted": true,
        "uncompleted_events": uncompleted_events
    })))
}

// New function to check task completion status based on events
pub async fn check_task_completion_status(
    graph: Graph,
    task_id: i64,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let status_query = query(
        "MATCH (t:Goal)
         WHERE id(t) = $task_id
         AND t.goal_type = 'task'
          OPTIONAL MATCH (t)-[:HAS_EVENT]->(e:Goal)
         WHERE e.goal_type = 'event'
         AND (e.is_deleted IS NULL OR e.is_deleted = false)
         AND COALESCE(e.resolution_status, 'pending') <> 'skipped'
         WITH t, 
              count(e) as total_events,
              count(CASE WHEN COALESCE(e.resolution_status, 'pending') = 'completed' THEN 1 END) as completed_events,
              count(CASE WHEN COALESCE(e.resolution_status, 'pending') = 'failed' THEN 1 END) as failed_events
         RETURN t.name as task_name,
                t.resolution_status as task_resolution_status,
                total_events,
                completed_events,
                failed_events,
                CASE 
                    WHEN total_events = 0 THEN false
                    WHEN completed_events = total_events THEN true
                    ELSE false
                END as all_events_completed",
    )
    .param("task_id", task_id);

    let mut result = graph
        .execute(status_query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(row) = result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        let task_name: String = row
            .get("task_name")
            .unwrap_or_else(|_| "Unknown".to_string());
        let task_resolution_status: String = row
            .get("task_resolution_status")
            .unwrap_or_else(|_| "pending".to_string());
        let task_completed = task_resolution_status == "completed";
        let total_events: i64 = row.get("total_events").unwrap_or(0);
        let completed_events: i64 = row.get("completed_events").unwrap_or(0);
        let all_events_completed: bool = row.get("all_events_completed").unwrap_or(false);

        Ok(Json(serde_json::json!({
            "task_name": task_name,
            "task_resolution_status": task_resolution_status,
            "task_completed": task_completed,
            "total_events": total_events,
            "completed_events": completed_events,
            "all_events_completed": all_events_completed,
            "should_suggest_task_completion": !task_completed && all_events_completed && total_events > 0
        })))
    } else {
        Err((StatusCode::NOT_FOUND, "Task not found".to_string()))
    }
}

pub async fn delete_event_handler(
    graph: Graph,
    user_id: i64,
    event_id: i64,
    delete_future: bool,
) -> Result<StatusCode, (StatusCode, String)> {
    // Authorization: ensure the event belongs to the authenticated user.
    // Without this, a user could delete other users' events by guessing `event_id`.
    let auth_query = query(
        "MATCH (e:Goal)
         WHERE id(e) = $event_id
           AND e.goal_type = 'event'
         RETURN e.user_id AS user_id",
    )
    .param("event_id", event_id);

    let mut auth_result = graph
        .execute(auth_query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(row) = auth_result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        let event_user_id: i64 = row.get("user_id").map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to get event user_id".to_string(),
            )
        })?;
        if event_user_id != user_id {
            return Err((
                StatusCode::FORBIDDEN,
                "You are not authorized to delete this event".to_string(),
            ));
        }
    } else {
        return Err((StatusCode::NOT_FOUND, "Event not found".to_string()));
    }

    if delete_future {
        // Delete this and all future occurrences for the parent routine,
        // and set the routine's end_timestamp so no new events are generated.
        // Note: Scope by parent_id (entire routine), not by routine_instance_id.
        let delete_query = query(
            "MATCH (e:Goal)
             WHERE id(e) = $event_id AND e.goal_type = 'event' AND e.user_id = $user_id
             WITH e, e.scheduled_timestamp AS cutoff, e.parent_id AS parent_id
             // Soft-delete all future events for this routine
             MATCH (r:Goal)
             WHERE id(r) = parent_id AND r.goal_type = 'routine'
             WITH r, cutoff
             OPTIONAL MATCH (r)-[:HAS_EVENT]->(f:Goal)
             WHERE f.goal_type = 'event'
               AND (f.is_deleted IS NULL OR f.is_deleted = false)
               AND f.scheduled_timestamp >= cutoff
             SET f.is_deleted = true
             WITH r, cutoff
             // Find latest remaining non-deleted event before cutoff
             OPTIONAL MATCH (r)-[:HAS_EVENT]->(keep:Goal)
             WHERE keep.goal_type = 'event'
               AND (keep.is_deleted IS NULL OR keep.is_deleted = false)
               AND keep.scheduled_timestamp < cutoff
             WITH r, cutoff, max(keep.scheduled_timestamp) AS last_kept
             // If none remain, set end just before cutoff to prevent regeneration
             SET r.end_timestamp = coalesce(last_kept, cutoff - 1)"
        )
        .param("event_id", event_id);
        let delete_query = delete_query.param("user_id", user_id);

        graph
            .run(delete_query)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    } else {
        // Soft delete single event.
        //
        // If it's a routine occurrence, also create a skip exception so the generator
        // does not recreate it later.
        let mut fetch_result = graph
            .execute(
                query(
                    "MATCH (e:Goal)
                     WHERE id(e) = $event_id
                       AND e.goal_type = 'event'
                       AND e.user_id = $user_id
                     RETURN e.parent_type as parent_type, e.parent_id as parent_id, e.scheduled_timestamp as ts",
                )
                .param("event_id", event_id)
                .param("user_id", user_id),
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        if let Some(row) = fetch_result
            .next()
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        {
            let parent_type: Option<String> = row.get("parent_type").ok();
            let parent_id: Option<i64> = row.get("parent_id").ok();
            let ts: Option<i64> = row.get("ts").ok();

            if parent_type.as_deref() == Some("routine") {
                if let (Some(routine_id), Some(timestamp)) = (parent_id, ts) {
                    if let Err(e) = routine_exceptions::create_skip_exception(
                        &graph,
                        user_id,
                        routine_id,
                        timestamp,
                    )
                    .await
                    {
                        eprintln!(
                            "Warning: failed to create routine skip exception for routine_id={}, ts={}: {}",
                            routine_id, timestamp, e
                        );
                    }
                }
            }
        }

        graph
            .run(
                query(
                    "MATCH (e:Goal)
                     WHERE id(e) = $event_id
                       AND e.user_id = $user_id
                     SET e.is_deleted = true",
                )
                .param("event_id", event_id)
                .param("user_id", user_id),
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    Ok(StatusCode::OK)
}

// split_event_handler removed; use duplicate goal endpoint instead

pub async fn get_task_events_handler(
    graph: Graph,
    task_id: i64,
) -> Result<Json<TaskEventsResponse>, (StatusCode, String)> {
    let query_str = "
        MATCH (t:Goal)-[:HAS_EVENT]->(e:Goal)
        WHERE id(t) = $task_id 
        AND e.goal_type = 'event'
        AND (e.is_deleted IS NULL OR e.is_deleted = false)
        AND COALESCE(e.resolution_status, 'pending') <> 'skipped'
        RETURN e
        ORDER BY e.scheduled_timestamp ASC
    ";

    let query = query(query_str).param("task_id", task_id);

    let mut result = graph
        .execute(query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut events = Vec::new();
    let mut total_duration = 0i32;
    let mut next_scheduled = None;
    let mut last_scheduled = None;
    let mut event_count = 0i32;
    let mut completed_event_count = 0i32;
    let mut failed_event_count = 0i32;
    let mut skipped_event_count = 0i32;
    let mut future_uncompleted_count = 0i32;
    let mut next_uncompleted_timestamp = None;
    let now_ms = Utc::now().timestamp_millis();

    while let Some(row) = result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        let event: Goal = row
            .get("e")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        event_count += 1;

        let status = event.resolution_status.as_deref().unwrap_or("pending");
        let is_completed = status == "completed";
        let is_failed = status == "failed";
        let is_skipped = status == "skipped";
        
        if is_completed {
            completed_event_count += 1;
        } else if is_failed {
            failed_event_count += 1;
        } else if is_skipped {
            skipped_event_count += 1;
        }

        if let Some(duration) = event.duration {
            total_duration += duration;
        }

        if let Some(scheduled) = event.scheduled_timestamp {
            // Future uncompleted includes pending and failed (but not skipped, which are already excluded)
            if !is_completed && !is_skipped && scheduled > now_ms {
                future_uncompleted_count += 1;
                if next_uncompleted_timestamp
                    .map(|existing| scheduled < existing)
                    .unwrap_or(true)
                {
                    next_uncompleted_timestamp = Some(scheduled);
                }
            }

            if next_scheduled.is_none() || next_scheduled.unwrap() > scheduled {
                next_scheduled = Some(scheduled);
            }
            if last_scheduled.is_none() || last_scheduled.unwrap() < scheduled {
                last_scheduled = Some(scheduled);
            }
        }

        events.push(event);
    }

    // Past uncompleted = total eligible (non-skipped) - completed - future uncompleted
    // This includes pending and failed events in the past
    let past_uncompleted_count =
        (event_count - completed_event_count - future_uncompleted_count).max(0);

    Ok(Json(TaskEventsResponse {
        task_id,
        events,
        total_duration,
        next_scheduled,
        last_scheduled,
        event_count,
        completed_event_count,
        failed_event_count,
        skipped_event_count,
        past_uncompleted_count,
        future_uncompleted_count,
        next_uncompleted_timestamp,
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
         RETURN e",
    )
    .param("event_id", event_id);

    let mut result = graph
        .execute(fetch_query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let event_row = result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Event not found".to_string()))?;

    let old_event: Goal = event_row
        .get("e")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // If updating the timestamp, validate against task date range
    if let Some(new_timestamp) = request.scheduled_timestamp {
        if let (Some(parent_id), Some(parent_type)) = (old_event.parent_id, &old_event.parent_type)
        {
            if let Some(violation) =
                validate_event_against_task_dates(&graph, parent_id, parent_type, new_timestamp)
                    .await?
            {
                return Err((
                    StatusCode::UNPROCESSABLE_ENTITY,
                    serde_json::to_string(&TaskDateValidationError {
                        error_type: "task_date_range_violation".to_string(),
                        message: format!(
                            "Event cannot be moved {} task's date range. Event would be at {} but task {} is {}.",
                            match violation.violation_type.as_str() {
                                "before_start" => "before",
                                "after_end" => "after",
                                _ => "outside"
                            },
                            chrono::DateTime::from_timestamp_millis(violation.event_timestamp)
                                .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
                                .unwrap_or_else(|| "invalid timestamp".to_string()),
                            violation.violation_type.as_str().replace("_", " "),
                            match violation.violation_type.as_str() {
                                "before_start" => format!(
                                    "starts at {}",
                                    violation
                                        .task_start
                                        .and_then(chrono::DateTime::from_timestamp_millis)
                                        .map(|dt| dt.format("%Y-%m-%d").to_string())
                                        .unwrap_or_else(|| "unknown date".to_string())
                                ),
                                "after_end" => format!(
                                    "ends at {}",
                                    violation
                                        .task_end
                                        .and_then(chrono::DateTime::from_timestamp_millis)
                                        .map(|dt| dt.format("%Y-%m-%d").to_string())
                                        .unwrap_or_else(|| "unknown date".to_string())
                                ),
                                _ => "has invalid dates".to_string()
                            }
                        ),
                        violation,
                    }).unwrap_or_else(|_| "Serialization error".to_string())
                ));
            }
        }
    }

    // Check if this is a reschedule (timestamp change)
    let is_reschedule = request.scheduled_timestamp.is_some()
        && request.scheduled_timestamp != old_event.scheduled_timestamp;

    // Build update query
    let mut set_clauses = Vec::new();
    let mut params = vec![(
        "event_id",
        neo4rs::BoltType::Integer(neo4rs::BoltInteger { value: event_id }),
    )];

    if let Some(timestamp) = request.scheduled_timestamp {
        set_clauses.push("e.scheduled_timestamp = $new_timestamp");
        params.push((
            "new_timestamp",
            neo4rs::BoltType::Integer(neo4rs::BoltInteger { value: timestamp }),
        ));
    }

    if let Some(duration) = request.duration {
        set_clauses.push("e.duration = $duration");
        params.push((
            "duration",
            neo4rs::BoltType::Integer(neo4rs::BoltInteger {
                value: duration as i64,
            }),
        ));
    }

    // Handle resolution_status (with backward compatibility for completed boolean)
    let resolution_status = if let Some(status) = &request.resolution_status {
        Some(status.clone())
    } else {
        // Legacy compatibility: map boolean to resolution_status
        request.completed.map(|completed| {
            if completed {
                "completed".to_string()
            } else {
                "pending".to_string()
            }
        })
    };

    if let Some(resolution_status) = &resolution_status {
        // Validate resolution_status
        if !["pending", "completed", "failed", "skipped"].contains(&resolution_status.as_str()) {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Invalid resolution_status: {}. Must be one of: pending, completed, failed, skipped", resolution_status)
            ));
        }
        
        set_clauses.push("e.resolution_status = $resolution_status");
        params.push((
            "resolution_status",
            neo4rs::BoltType::String(neo4rs::BoltString {
                value: resolution_status.clone(),
            }),
        ));
        // If setting to completed/failed/skipped, set resolved_at to now
        // If setting back to pending, clear resolved_at
        if resolution_status == "pending" {
            set_clauses.push("e.resolved_at = null");
        } else {
            set_clauses.push("e.resolved_at = $resolved_at");
            params.push((
                "resolved_at",
                neo4rs::BoltType::Integer(neo4rs::BoltInteger {
                    value: chrono::Utc::now().timestamp_millis(),
                }),
            ));
        }
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

    let mut update_result = graph
        .execute(query_builder)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let updated_event: Goal = if let Some(row) = update_result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        row.get("e")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        return Err((
            StatusCode::NOT_FOUND,
            "Event not found after update".to_string(),
        ));
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
    println!(
        "🔄 [ROUTINE_UPDATE] Starting routine event update for event_id: {}, scope: {}",
        event_id, request.update_scope
    );

    // First, fetch the event to get routine information
    let fetch_query = query(
        "MATCH (e:Goal)
         WHERE id(e) = $event_id
         AND e.goal_type = 'event'
         AND e.parent_type = 'routine'
         AND e.user_id = $user_id
         RETURN e",
    )
    .param("event_id", event_id);
    let fetch_query = fetch_query.param("user_id", user_id);

    let mut result = graph
        .execute(fetch_query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let event_row = result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Routine event not found".to_string()))?;

    let event: Goal = event_row
        .get("e")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let parent_id = event.parent_id.ok_or((
        StatusCode::BAD_REQUEST,
        "Event missing parent_id".to_string(),
    ))?;
    let current_timestamp = event.scheduled_timestamp.ok_or((
        StatusCode::BAD_REQUEST,
        "Event missing scheduled_timestamp".to_string(),
    ))?;

    println!("📋 [ROUTINE_UPDATE] Event details - parent_id: {}, current_timestamp: {}, new_timestamp: {}", 
             parent_id, current_timestamp, request.new_timestamp);

    match request.update_scope.as_str() {
        "single" => {
            println!("🎯 [ROUTINE_UPDATE] Processing single event update");
            // Create a skip exception for the old slot so the generator doesn't backfill it.
            if let Err(e) =
                routine_exceptions::create_skip_exception(&graph, user_id, parent_id, current_timestamp).await
            {
                eprintln!(
                    "Warning: failed to create routine skip exception for routine_id={}, ts={}: {}",
                    parent_id, current_timestamp, e
                );
            }

            // Update only this event
            let update_query = query(
                "MATCH (e:Goal)
                 WHERE id(e) = $event_id
                 AND e.user_id = $user_id
                 SET e.scheduled_timestamp = $new_timestamp
                 RETURN e",
            )
            .param("event_id", event_id)
            .param("new_timestamp", request.new_timestamp)
            .param("user_id", user_id);

            let mut update_result = graph
                .execute(update_query)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            if let Some(row) = update_result
                .next()
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            {
                let updated_event: Goal = row
                    .get("e")
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                println!("✅ [ROUTINE_UPDATE] Single event updated successfully");
                Ok(Json(vec![updated_event]))
            } else {
                println!(
                    "❌ [ROUTINE_UPDATE] Failed to update single event - not found after update"
                );
                Err((
                    StatusCode::NOT_FOUND,
                    "Event not found after update".to_string(),
                ))
            }
        }
        "all" => {
            println!("🌐 [ROUTINE_UPDATE] Processing all events update");

            // Calculate the new time-of-day from the new timestamp
            let day_in_ms: i64 = 24 * 60 * 60 * 1000;
            let new_time_of_day = request.new_timestamp % day_in_ms;
            println!(
                "🕐 [ROUTINE_UPDATE] New time of day: {} ms",
                new_time_of_day
            );

            // Also update the parent routine so future generated events inherit this time-of-day
            let update_parent_time_query = query(
                "MATCH (r:Goal)
                 WHERE id(r) = $parent_id AND r.goal_type = 'routine' AND r.user_id = $user_id
                 SET r.routine_time = $new_timestamp",
            )
            .param("parent_id", parent_id)
            .param("new_timestamp", request.new_timestamp)
            .param("user_id", user_id);

            graph
                .run(update_parent_time_query)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            // Clear all exceptions for this routine when applying a schedule change to ALL.
            if let Err(e) = routine_exceptions::clear_all_exceptions(&graph, parent_id).await {
                eprintln!(
                    "Warning: failed to clear routine exceptions for routine_id={} (all): {}",
                    parent_id, e
                );
            }

            // For "all" scope, update ALL events for this routine to the new time-of-day
            let check_query = query(
                "MATCH (e:Goal)
                 WHERE e.goal_type = 'event'
                 AND e.parent_id = $parent_id
                 AND e.parent_type = 'routine'
                 AND e.user_id = $user_id
                 AND (e.is_deleted IS NULL OR e.is_deleted = false)
                 RETURN count(e) as event_count, collect(id(e)) as ids",
            )
            .param("parent_id", parent_id)
            .param("user_id", user_id);

            let mut check_result = graph
                .execute(check_query)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            if let Some(check_row) = check_result
                .next()
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            {
                let event_count: i64 = check_row.get("event_count").unwrap_or(0);
                let ids: Vec<i64> = check_row.get("ids").unwrap_or_default();
                println!(
                    "🔍 [ROUTINE_UPDATE] Found {} total events for 'all' scope. IDs: {:?}",
                    event_count, ids
                );
            }

            // Update ALL events to the new time-of-day (preserve their dates, change only time)
            let update_query = query(
                "MATCH (e:Goal)
                 WHERE e.goal_type = 'event'
                 AND e.parent_id = $parent_id
                 AND e.parent_type = 'routine'
                 AND e.user_id = $user_id
                 AND (e.is_deleted IS NULL OR e.is_deleted = false)
                 WITH e
                 SET e.scheduled_timestamp = (e.scheduled_timestamp / $day_in_ms) * $day_in_ms + $new_time_of_day
                 RETURN collect(e) as events"
            )
            .param("parent_id", parent_id)
            .param("day_in_ms", day_in_ms)
            .param("new_time_of_day", new_time_of_day)
            .param("user_id", user_id);

            let mut update_result = graph
                .execute(update_query)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            if let Some(row) = update_result
                .next()
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            {
                let events: Vec<Goal> = row
                    .get("events")
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                println!(
                    "✅ [ROUTINE_UPDATE] Updated {} events for 'all' scope to new time-of-day",
                    events.len()
                );
                Ok(Json(events))
            } else {
                println!("⚠️  [ROUTINE_UPDATE] No events returned from update query");
                Ok(Json(vec![]))
            }
        }
        "future" => {
            println!("⏭️  [ROUTINE_UPDATE] Processing future events update");

            // Calculate the new time-of-day from the new timestamp
            let day_in_ms: i64 = 24 * 60 * 60 * 1000;
            let new_time_of_day = request.new_timestamp % day_in_ms;
            println!(
                "🕐 [ROUTINE_UPDATE] New time of day: {} ms",
                new_time_of_day
            );

            // Also update the parent routine so future generated events inherit this time-of-day
            let update_parent_time_query = query(
                "MATCH (r:Goal)
                 WHERE id(r) = $parent_id AND r.goal_type = 'routine' AND r.user_id = $user_id
                 SET r.routine_time = $new_timestamp",
            )
            .param("parent_id", parent_id)
            .param("new_timestamp", request.new_timestamp)
            .param("user_id", user_id);

            graph
                .run(update_parent_time_query)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            // Clear exceptions at-or-after the cutoff for this routine when applying a schedule change to FUTURE.
            if let Err(e) =
                routine_exceptions::clear_exceptions_from(&graph, parent_id, current_timestamp).await
            {
                eprintln!(
                    "Warning: failed to clear routine exceptions for routine_id={} from_ts={} (future): {}",
                    parent_id, current_timestamp, e
                );
            }

            // For "future" scope, update ALL future events for this routine to the new time-of-day
            let check_query = query(
                "MATCH (e:Goal)
                 WHERE e.goal_type = 'event'
                 AND e.parent_id = $parent_id
                 AND e.parent_type = 'routine'
                 AND e.user_id = $user_id
                 AND e.scheduled_timestamp >= $current_timestamp
                 AND (e.is_deleted IS NULL OR e.is_deleted = false)
                 RETURN count(e) as event_count, collect(id(e)) as ids",
            )
            .param("parent_id", parent_id)
            .param("current_timestamp", current_timestamp)
            .param("user_id", user_id);

            let mut check_result = graph
                .execute(check_query)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            if let Some(check_row) = check_result
                .next()
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            {
                let event_count: i64 = check_row.get("event_count").unwrap_or(0);
                let ids: Vec<i64> = check_row.get("ids").unwrap_or_default();
                println!(
                    "🔍 [ROUTINE_UPDATE] Found {} future events for 'future' scope. IDs: {:?}",
                    event_count, ids
                );
            }

            // Update ALL future events to the new time-of-day (preserve their dates, change only time)
            let update_query = query(
                "MATCH (e:Goal)
                 WHERE e.goal_type = 'event'
                 AND e.parent_id = $parent_id
                 AND e.parent_type = 'routine'
                 AND e.user_id = $user_id
                 AND e.scheduled_timestamp >= $current_timestamp
                 AND (e.is_deleted IS NULL OR e.is_deleted = false)
                 WITH e
                 SET e.scheduled_timestamp = (e.scheduled_timestamp / $day_in_ms) * $day_in_ms + $new_time_of_day
                 RETURN collect(e) as events"
            )
            .param("parent_id", parent_id)
            .param("current_timestamp", current_timestamp)
            .param("day_in_ms", day_in_ms)
            .param("new_time_of_day", new_time_of_day)
            .param("user_id", user_id);

            let mut update_result = graph
                .execute(update_query)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            if let Some(row) = update_result
                .next()
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            {
                let events: Vec<Goal> = row
                    .get("events")
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                println!(
                    "✅ [ROUTINE_UPDATE] Updated {} events for 'future' scope to new time-of-day",
                    events.len()
                );
                Ok(Json(events))
            } else {
                println!("⚠️  [ROUTINE_UPDATE] No events returned from update query");
                Ok(Json(vec![]))
            }
        }
        "range" => {
            println!("📅 [ROUTINE_UPDATE] Processing range update");
            let range_start = request
                .range_start
                .ok_or((StatusCode::BAD_REQUEST, "Missing range_start".to_string()))?;
            let range_end = request
                .range_end
                .ok_or((StatusCode::BAD_REQUEST, "Missing range_end".to_string()))?;

            // Fetch parent routine to copy base properties
            let parent_query = query("MATCH (r:Goal) WHERE id(r) = $parent_id RETURN r")
                .param("parent_id", parent_id);
            let mut parent_result = graph
                .execute(parent_query)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            let parent_routine: Goal = parent_result
                .next()
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                .ok_or((StatusCode::NOT_FOUND, "Parent routine not found".to_string()))?
                .get("r")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            // Calculate time of day from new_timestamp
            let day_in_ms: i64 = 24 * 60 * 60 * 1000;
            let new_time_of_day = request.new_timestamp % day_in_ms;

            // Create RoutineState node (inheriting from parent, overriding time and range)
            let mut state_node = parent_routine.clone();
            state_node.id = None;
            state_node.routine_time = Some(new_time_of_day);
            state_node.start_timestamp = Some(range_start);
            state_node.end_timestamp = Some(range_end);
            state_node.goal_type = GoalType::Routine; // It's a routine state, modeled as a routine node

            // Create the state node
            let created_state = state_node
                .create_goal(&graph)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            // Link to parent with HAS_STATE
            let link_query = query(
                "MATCH (r:Goal), (s:Goal) WHERE id(r) = $rid AND id(s) = $sid CREATE (r)-[:HAS_STATE]->(s)",
            )
            .param("rid", parent_id)
            .param("sid", created_state.id.unwrap());
            graph
                .run(link_query)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            // Soft-delete existing events in range to force regeneration
            // Note: We only delete 'pending' or 'failed' events usually, but for a hard schedule change we might want to wipe 'completed' ones too?
            // The plan says "Delete existing future/pending events".
            // If the user changes history, we probably shouldn't delete completed events unless they really want to.
            // But for "future" scope we delete completed ones too in `recompute_future_for_routine`.
            // Let's stick to deleting non-deleted events.
            let delete_query = query(
                "MATCH (r:Goal)-[:HAS_EVENT]->(e:Goal)
                 WHERE id(r) = $rid
                 AND e.goal_type = 'event'
                 AND e.scheduled_timestamp >= $start
                 AND e.scheduled_timestamp <= $end
                 AND (e.is_deleted IS NULL OR e.is_deleted = false)
                 SET e.is_deleted = true
                 RETURN count(e) as count",
            )
            .param("rid", parent_id)
            .param("start", range_start)
            .param("end", range_end);
            
            graph
                .run(delete_query)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            println!("✅ [ROUTINE_UPDATE] Range update applied. RoutineState created. Events invalidated.");
            
            // Return empty list as we haven't regenerated yet. 
            // The frontend will likely trigger a refresh or we can trigger generation here.
            Ok(Json(vec![]))
        }
        _ => {
            println!(
                "❌ [ROUTINE_UPDATE] Invalid update_scope: {}",
                request.update_scope
            );
            Err((
                StatusCode::BAD_REQUEST,
                "Invalid update_scope. Must be 'single', 'all', or 'future'".to_string(),
            ))
        }
    }
}

pub async fn get_reschedule_options_handler(
    graph: Graph,
    user_id: i64,
    event_id: i64,
    look_ahead_days: i32,
) -> Result<Json<RescheduleOptionsResponse>, (StatusCode, String)> {
    // First, get the event to reschedule
    let event_query = query(
        "MATCH (e:Goal)
         WHERE id(e) = $event_id
         AND e.goal_type = 'event'
         AND e.user_id = $user_id
         RETURN e",
    )
    .param("event_id", event_id)
    .param("user_id", user_id);

    let mut event_result = graph
        .execute(event_query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let event: Goal = if let Some(row) = event_result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        row.get("e")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        return Err((StatusCode::NOT_FOUND, "Event not found".to_string()));
    };

    let current_timestamp = event.scheduled_timestamp.ok_or((
        StatusCode::BAD_REQUEST,
        "Event has no scheduled timestamp".to_string(),
    ))?;
    let duration = event.duration.unwrap_or(60) as i64;

    // Use the shared scheduling algorithm
    let suggestions = generate_schedule_suggestions(
        &graph,
        user_id,
        duration,
        current_timestamp,
        look_ahead_days,
        Some(event_id), // Exclude this event from conflicts
        None,           // No preferred time constraints for reschedule
        None,
    )
    .await?;

    Ok(Json(RescheduleOptionsResponse { suggestions }))
}

pub async fn get_smart_schedule_options_handler(
    graph: Graph,
    user_id: i64,
    request: SmartScheduleRequest,
) -> Result<Json<RescheduleOptionsResponse>, (StatusCode, String)> {
    // Use only the LLM-powered suggestion engine via OpenRouter. If it fails, surface the error to the frontend.
    match get_llm_smart_schedule_suggestions(&graph, user_id, &request).await {
        Ok(suggestions) => Ok(Json(RescheduleOptionsResponse { suggestions })),
        Err((status, msg)) => Err((status, msg)),
    }
}

// Shared scheduling algorithm for both reschedule and smart schedule
#[allow(clippy::too_many_arguments)]
async fn generate_schedule_suggestions(
    graph: &Graph,
    user_id: i64,
    duration: i64,
    start_timestamp: i64,
    look_ahead_days: i32,
    excluded_event_id: Option<i64>,
    preferred_time_start: Option<i32>,
    preferred_time_end: Option<i32>,
) -> Result<Vec<RescheduleSuggestion>, (StatusCode, String)> {
    let end_timestamp = start_timestamp + (look_ahead_days as i64 * 24 * 60 * 60 * 1000);

    // Get all user's events in the look-ahead period for schedule analysis
    let mut schedule_query = query(
        "MATCH (e:Goal)
         WHERE e.goal_type = 'event'
         AND e.user_id = $user_id
         AND e.scheduled_timestamp >= $start_timestamp
         AND e.scheduled_timestamp <= $end_timestamp
         AND (e.is_deleted IS NULL OR e.is_deleted = false)
         RETURN e.scheduled_timestamp as timestamp, e.duration as duration
         ORDER BY e.scheduled_timestamp",
    )
    .param("user_id", user_id)
    .param("start_timestamp", start_timestamp)
    .param("end_timestamp", end_timestamp);

    // Exclude specific event if provided (for rescheduling)
    if let Some(event_id) = excluded_event_id {
        schedule_query = query(
            "MATCH (e:Goal)
             WHERE e.goal_type = 'event'
             AND e.user_id = $user_id
             AND e.scheduled_timestamp >= $start_timestamp
             AND e.scheduled_timestamp <= $end_timestamp
             AND (e.is_deleted IS NULL OR e.is_deleted = false)
             AND id(e) <> $excluded_event_id
             RETURN e.scheduled_timestamp as timestamp, e.duration as duration
             ORDER BY e.scheduled_timestamp",
        )
        .param("user_id", user_id)
        .param("start_timestamp", start_timestamp)
        .param("end_timestamp", end_timestamp)
        .param("excluded_event_id", event_id);
    }

    let mut schedule_result = graph
        .execute(schedule_query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut existing_events = Vec::new();
    while let Some(row) = schedule_result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        let timestamp = row.get::<i64>("timestamp").unwrap_or(0);
        let event_duration = row.get::<i32>("duration").unwrap_or(60) as i64;
        existing_events.push((timestamp, event_duration));
    }

    // Analyze user's typical scheduling patterns
    let pattern_query = query(
        "MATCH (e:Goal)
         WHERE e.goal_type = 'event'
         AND e.user_id = $user_id
         AND e.scheduled_timestamp >= $lookback_start
         AND e.scheduled_timestamp <= $start_timestamp
         AND (e.is_deleted IS NULL OR e.is_deleted = false)
         RETURN e.scheduled_timestamp as timestamp",
    )
    .param("user_id", user_id)
    .param(
        "lookback_start",
        start_timestamp - (30 * 24 * 60 * 60 * 1000),
    ) // 30 days lookback
    .param("start_timestamp", start_timestamp);

    let mut pattern_result = graph
        .execute(pattern_query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut historical_hours = Vec::new();
    while let Some(row) = pattern_result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        let timestamp = row.get::<i64>("timestamp").unwrap_or(0);
        let dt = chrono::DateTime::from_timestamp_millis(timestamp).unwrap_or_default();
        historical_hours.push(dt.hour());
    }

    // Determine scheduling bounds (use preferences if provided, otherwise use historical data)
    let (earliest_hour, latest_hour) =
        if let (Some(start), Some(end)) = (preferred_time_start, preferred_time_end) {
            (start.max(0) as u32, end.max(0) as u32)
        } else if historical_hours.is_empty() {
            (8, 18) // Default to 8 AM - 6 PM
        } else {
            historical_hours.sort();
            let q25 = historical_hours[historical_hours.len() / 4];
            let q75 = historical_hours[historical_hours.len() * 3 / 4];
            (
                (q25.saturating_sub(1)).max(6), // Earliest no earlier than 6 AM
                (q75 + 1).min(22),              // Latest no later than 10 PM
            )
        };

    // Generate suggestions
    let mut suggestions = Vec::new();
    let start_time = chrono::DateTime::from_timestamp_millis(start_timestamp).unwrap_or_default();

    // Start looking from tomorrow or the day after the current event
    let mut candidate_time = start_time + Duration::days(1);
    candidate_time = candidate_time
        .date_naive()
        .and_hms_opt(earliest_hour, 0, 0)
        .unwrap()
        .and_utc();

    for day_offset in 0..look_ahead_days {
        let day_start = candidate_time + Duration::days(day_offset as i64);

        // Skip weekends if user doesn't typically schedule on weekends
        let weekday = day_start.weekday();
        if weekday == chrono::Weekday::Sat || weekday == chrono::Weekday::Sun {
            let weekend_events = historical_hours
                .iter()
                .enumerate()
                .filter(|(i, _)| {
                    let ts =
                        start_timestamp - (30 * 24 * 60 * 60 * 1000) + (*i as i64 * 60 * 60 * 1000);
                    let dt = chrono::DateTime::from_timestamp_millis(ts).unwrap_or_default();
                    dt.weekday() == chrono::Weekday::Sat || dt.weekday() == chrono::Weekday::Sun
                })
                .count();

            if weekend_events < historical_hours.len() / 10 {
                continue; // Skip weekends if less than 10% of events are on weekends
            }
        }

        // Check time slots throughout the day
        for hour in earliest_hour..=latest_hour {
            for minute_offset in [0, 30] {
                // Check every 30 minutes
                let slot_time = day_start
                    .date_naive()
                    .and_hms_opt(hour, minute_offset, 0)
                    .unwrap()
                    .and_utc();
                let slot_timestamp = slot_time.timestamp_millis();

                // Skip if this is before current time
                if slot_timestamp <= start_timestamp {
                    continue;
                }

                // Check if this slot conflicts with existing events
                let conflicts =
                    existing_events
                        .iter()
                        .any(|(existing_start, existing_duration)| {
                            let existing_end = existing_start + (existing_duration * 60 * 1000);
                            let slot_end = slot_timestamp + (duration * 60 * 1000);

                            // Check for overlap
                            slot_timestamp < existing_end && slot_end > *existing_start
                        });

                if conflicts {
                    continue;
                }

                // Calculate score based on multiple factors
                let mut score: f64 = 0.5; // Base score
                let mut reasons = Vec::new();

                // Factor 1: Proximity to other events (reduces whitespace)
                let mut min_distance_to_event = i64::MAX;
                for (existing_start, existing_duration) in &existing_events {
                    let existing_end = existing_start + (existing_duration * 60 * 1000);
                    let distance_before = if slot_timestamp > existing_end {
                        slot_timestamp - existing_end
                    } else {
                        i64::MAX
                    };
                    let distance_after =
                        if *existing_start > slot_timestamp + (duration * 60 * 1000) {
                            *existing_start - (slot_timestamp + (duration * 60 * 1000))
                        } else {
                            i64::MAX
                        };

                    min_distance_to_event = min_distance_to_event
                        .min(distance_before)
                        .min(distance_after);
                }

                if min_distance_to_event < 30 * 60 * 1000 {
                    // Within 30 minutes
                    score += 0.3;
                    reasons.push("close to existing event");
                } else if min_distance_to_event < 2 * 60 * 60 * 1000 {
                    // Within 2 hours
                    score += 0.15;
                    reasons.push("near existing event");
                }

                // Factor 2: Typical user scheduling time
                let slot_hour = slot_time.hour();
                if historical_hours.contains(&slot_hour) {
                    score += 0.2;
                    reasons.push("typical scheduling time");
                }

                // Factor 3: Morning bias (9-11 AM gets boost)
                if (9..=11).contains(&slot_hour) {
                    score += 0.15;
                    reasons.push("morning slot");
                }

                // Factor 4: Prefer round hours
                if slot_time.minute() == 0 {
                    score += 0.05;
                    reasons.push("round hour");
                }

                // Factor 5: Prefer weekdays
                if ![chrono::Weekday::Sat, chrono::Weekday::Sun].contains(&weekday) {
                    score += 0.1;
                    reasons.push("weekday");
                }

                // Factor 6: Sooner is generally better
                let days_ahead = (slot_timestamp - start_timestamp) / (24 * 60 * 60 * 1000);
                if days_ahead <= 3 {
                    score += 0.1;
                    reasons.push("soon");
                }

                let reason = if reasons.is_empty() {
                    "available slot".to_string()
                } else {
                    reasons.join(", ")
                };

                suggestions.push(RescheduleSuggestion {
                    timestamp: slot_timestamp,
                    reason,
                    score: score.min(1.0), // Cap at 1.0
                });

                // Limit suggestions per day to avoid overwhelming
                if suggestions.len() % 8 == 0 {
                    break;
                }
            }
        }

        // Stop if we have enough suggestions
        if suggestions.len() >= 20 {
            break;
        }
    }

    // Sort by score (descending) then by timestamp (ascending)
    suggestions.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.timestamp.cmp(&b.timestamp))
    });

    // Limit final results
    suggestions.truncate(15);

    Ok(suggestions)
}

// ------------------------------
// LLM-powered scheduling helpers
// ------------------------------

#[derive(Serialize)]
struct EventBrief {
    id: Option<i64>,
    name: String,
    description: Option<String>,
    scheduled_timestamp: Option<i64>,
    duration: Option<i32>,
    resolution_status: Option<String>,
}

async fn fetch_event_briefs(
    graph: &Graph,
    user_id: i64,
    start_ts: i64,
    end_ts: i64,
) -> Result<Vec<EventBrief>, (StatusCode, String)> {
    let q = query(
        "MATCH (g:Goal)\n         WHERE g.goal_type = 'event'\n         AND g.user_id = $user_id\n         AND coalesce(g.is_deleted, false) <> true\n         AND g.scheduled_timestamp >= $start_ts\n         AND g.scheduled_timestamp <= $end_ts\n         RETURN g ORDER BY g.scheduled_timestamp",
    )
    .param("user_id", user_id)
    .param("start_ts", start_ts)
    .param("end_ts", end_ts);

    let mut res = graph
        .execute(q)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut items = Vec::new();
    while let Some(row) = res
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        let g: crate::tools::goal::Goal = row
            .get("g")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        items.push(EventBrief {
            id: g.id,
            name: g.name,
            description: g.description,
            scheduled_timestamp: g.scheduled_timestamp,
            duration: g.duration,
            resolution_status: g.resolution_status,
        });
    }
    Ok(items)
}

#[derive(Serialize)]
struct LlmCalendarContext<'a> {
    past_two_weeks_events: &'a [EventBrief],
    next_month_events: &'a [EventBrief],
}

#[derive(Serialize)]
struct LlmSchedulingInput<'a> {
    event_name: Option<&'a str>,
    event_description: Option<&'a str>,
    duration_minutes: i32,
    preferred_time_start_hour: Option<i32>,
    preferred_time_end_hour: Option<i32>,
    start_after_timestamp: Option<i64>,
    look_ahead_days: i32,
}

async fn get_llm_smart_schedule_suggestions(
    graph: &Graph,
    user_id: i64,
    request: &SmartScheduleRequest,
) -> Result<Vec<RescheduleSuggestion>, (StatusCode, String)> {
    let overall_start = std::time::Instant::now();
    let now = Utc::now().timestamp_millis();
    let past_two_weeks_start = now - (14 * 24 * 60 * 60 * 1000);
    let next_month_end = now + (30 * 24 * 60 * 60 * 1000);

    eprintln!(
        "🔍 [SMART_SCHEDULE][CTX] user_id={} building context: past_two_weeks_start={} now={} next_month_end={}",
        user_id, past_two_weeks_start, now, next_month_end
    );
    let ctx_start = std::time::Instant::now();
    let past_events = fetch_event_briefs(graph, user_id, past_two_weeks_start, now).await?;
    let next_events = fetch_event_briefs(graph, user_id, now, next_month_end).await?;
    eprintln!(
        "✅ [SMART_SCHEDULE][CTX] fetched events: past={} next={} in {}ms",
        past_events.len(),
        next_events.len(),
        ctx_start.elapsed().as_millis()
    );

    let context = LlmCalendarContext {
        past_two_weeks_events: &past_events,
        next_month_events: &next_events,
    };

    // Prepare scheduling input
    let look_ahead_days = request.look_ahead_days.unwrap_or(7);
    let input = LlmSchedulingInput {
        event_name: request.event_name.as_deref(),
        event_description: request.event_description.as_deref(),
        duration_minutes: request.duration,
        preferred_time_start_hour: request.preferred_time_start,
        preferred_time_end_hour: request.preferred_time_end,
        start_after_timestamp: request.start_after_timestamp,
        look_ahead_days,
    };

    // Build prompt instructing strict JSON output
    let system_prompt = "You are a scheduling assistant. Based on the user's recent (past two weeks) and upcoming (next month) calendar, propose optimal times to schedule a new event. Return ONLY strict JSON in the following format: {\n  \"suggestions\": [ { \"timestamp\": <epoch_ms>, \"reason\": \"short natural-language sentence explaining why this slot is good\", \"score\": <0.0-1.0> }, ... ]\n}. The timestamps must be epoch milliseconds in the user's local timezone context. Do not return tag lists; write concise sentences.";

    let user_prompt = serde_json::json!({
        "task": "Suggest optimal times for a new event.",
        "scheduling_input": input,
        "calendar_context": context,
        "constraints": {
            "return_json_only": true,
            "timestamps": "epoch_ms",
            "max_suggestions": 15
        }
    })
    .to_string();

    // Call OpenRouter chat/completions with GPT-5
    let api_key = env::var("OPENROUTER_API_KEY").map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "OPENROUTER_API_KEY not set".to_string(),
        )
    })?;

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    // Authorization: Bearer <KEY>
    headers.insert(
        reqwest::header::AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", api_key))
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
    );
    // Optional but recommended by OpenRouter
    if let Ok(referer) = env::var("OPENROUTER_HTTP_REFERER") {
        headers.insert(
            "http-referer",
            HeaderValue::from_str(&referer).unwrap_or(HeaderValue::from_static("https://local")),
        );
    }
    if let Ok(title) = env::var("OPENROUTER_TITLE") {
        headers.insert(
            "x-title",
            HeaderValue::from_str(&title).unwrap_or(HeaderValue::from_static("GoalsApp")),
        );
    }

    let body = serde_json::json!({
        "model": "openai/gpt-5-mini",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
    });

    let client = reqwest::Client::new();
    eprintln!(
        "📤 [SMART_SCHEDULE][LLM] calling OpenRouter model=openai/gpt-5-mini messages_bytes={} ctx_sizes=(past:{}, next:{})",
        user_prompt.len(),
        past_events.len(),
        next_events.len()
    );
    let resp = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            eprintln!("❌ [LLM] OpenRouter request failed: {}", e);
            (
                StatusCode::BAD_GATEWAY,
                format!("OpenRouter request failed: {}", e),
            )
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp
            .text()
            .await
            .unwrap_or_else(|_| "<no body>".to_string());
        eprintln!(
            "❌ [LLM] OpenRouter non-success status: {} body: {}",
            status, text
        );
        let snippet = if text.len() > 500 {
            &text[..500]
        } else {
            &text
        };
        return Err((
            StatusCode::BAD_GATEWAY,
            format!("OpenRouter returned status: {} {}", status, snippet),
        ));
    }

    let value: serde_json::Value = resp.json().await.map_err(|e| {
        eprintln!("❌ [LLM] Failed to parse OpenRouter JSON: {}", e);
        (
            StatusCode::BAD_GATEWAY,
            format!("Failed to read OpenRouter response: {}", e),
        )
    })?;

    // Extract content from choices[0].message.content
    let content = value
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c0| c0.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .ok_or_else(|| {
            eprintln!(
                "❌ [LLM] Unexpected OpenRouter response format (missing content): {:?}",
                value
            );
            (
                StatusCode::BAD_GATEWAY,
                "Unexpected OpenRouter response format (missing content)".to_string(),
            )
        })?;

    // Ensure we have non-empty content
    let content_trimmed = content.trim();
    if content_trimmed.is_empty() {
        eprintln!(
            "❌ [LLM] Empty content from provider. Full response object: {:?}",
            value
        );
        return Err((
            StatusCode::BAD_GATEWAY,
            "LLM returned empty content".to_string(),
        ));
    }

    // Try strict JSON parse first; if that fails, try to extract a JSON block from the text
    let parsed: serde_json::Value = match serde_json::from_str::<serde_json::Value>(content_trimmed)
    {
        Ok(v) => v,
        Err(e) => {
            // Attempt to locate a JSON object within the content
            if let (Some(start), Some(end)) =
                (content_trimmed.find('{'), content_trimmed.rfind('}'))
            {
                let slice = &content_trimmed[start..=end];
                match serde_json::from_str::<serde_json::Value>(slice) {
                    Ok(v2) => v2,
                    Err(e2) => {
                        eprintln!(
                            "❌ [LLM] Failed to parse JSON. Primary error: {} | Fallback error: {} | content: {}",
                            e, e2, content_trimmed
                        );
                        return Err((
                            StatusCode::BAD_GATEWAY,
                            "Failed to parse LLM JSON content".to_string(),
                        ));
                    }
                }
            } else {
                eprintln!(
                    "❌ [LLM] No JSON object found in content. Error: {} | content: {}",
                    e, content_trimmed
                );
                return Err((
                    StatusCode::BAD_GATEWAY,
                    "LLM did not return JSON content".to_string(),
                ));
            }
        }
    };

    let suggestions_val = parsed
        .get("suggestions")
        .and_then(|v| v.as_array())
        .ok_or_else(|| {
            eprintln!(
                "❌ [LLM] LLM did not return 'suggestions' array: {}",
                content
            );
            (
                StatusCode::BAD_GATEWAY,
                "LLM did not return 'suggestions' array".to_string(),
            )
        })?;

    let mut suggestions: Vec<RescheduleSuggestion> = Vec::new();
    for s in suggestions_val {
        let ts = s.get("timestamp").and_then(|v| v.as_i64()).ok_or_else(|| {
            (
                StatusCode::BAD_GATEWAY,
                "suggestion.timestamp missing".to_string(),
            )
        })?;
        let reason = s
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let score = s.get("score").and_then(|v| v.as_f64()).unwrap_or(0.5);
        suggestions.push(RescheduleSuggestion {
            timestamp: ts,
            reason,
            score,
        });
    }

    eprintln!(
        "✅ [SMART_SCHEDULE][LLM] got {} suggestions in {}ms",
        suggestions.len(),
        overall_start.elapsed().as_millis()
    );
    Ok(suggestions)
}

pub async fn update_routine_event_properties_handler(
    graph: Graph,
    user_id: i64,
    event_id: i64,
    request: UpdateRoutineEventPropertiesRequest,
) -> Result<Json<Vec<Goal>>, (StatusCode, String)> {
    println!("🔄 [ROUTINE_PROPERTIES] Starting routine event properties update for event_id: {}, scope: {}", event_id, request.update_scope);

    // First, fetch the event to get routine information
    let fetch_query = query(
        "MATCH (e:Goal)
         WHERE id(e) = $event_id
         AND e.goal_type = 'event'
         AND e.parent_type = 'routine'
         AND e.user_id = $user_id
         RETURN e",
    )
    .param("event_id", event_id)
    .param("user_id", user_id);

    let mut result = graph
        .execute(fetch_query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let event_row = result
        .next()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Routine event not found".to_string()))?;

    let event: Goal = event_row
        .get("e")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let parent_id = event.parent_id.ok_or((
        StatusCode::BAD_REQUEST,
        "Event missing parent_id".to_string(),
    ))?;
    let current_timestamp = event.scheduled_timestamp.ok_or((
        StatusCode::BAD_REQUEST,
        "Event missing scheduled_timestamp".to_string(),
    ))?;

    println!(
        "📋 [ROUTINE_PROPERTIES] Event details - parent_id: {}, current_timestamp: {}",
        parent_id, current_timestamp
    );

    match request.update_scope.as_str() {
        "single" => {
            println!("🎯 [ROUTINE_PROPERTIES] Processing single event property update");

            // If this single update changes the scheduled_timestamp, create a skip exception for the old slot
            // so the generator doesn't backfill it.
            if let Some(new_ts) = request.scheduled_timestamp {
                if new_ts != current_timestamp {
                    if let Err(e) = routine_exceptions::create_skip_exception(
                        &graph,
                        user_id,
                        parent_id,
                        current_timestamp,
                    )
                    .await
                    {
                        eprintln!(
                            "Warning: failed to create routine skip exception for routine_id={}, ts={}: {}",
                            parent_id, current_timestamp, e
                        );
                    }
                }
            }

            // Build the SET clause dynamically based on what properties are provided
            let mut set_clauses = Vec::new();
            let mut params = vec![(
                "event_id".to_string(),
                neo4rs::BoltType::Integer(neo4rs::BoltInteger::new(event_id)),
            )];
            params.push((
                "user_id".to_string(),
                neo4rs::BoltType::Integer(neo4rs::BoltInteger::new(user_id)),
            ));

            if let Some(timestamp) = request.scheduled_timestamp {
                set_clauses.push("e.scheduled_timestamp = $scheduled_timestamp");
                params.push((
                    "scheduled_timestamp".to_string(),
                    neo4rs::BoltType::Integer(neo4rs::BoltInteger::new(timestamp)),
                ));
            }
            if let Some(duration) = request.duration {
                set_clauses.push("e.duration = $duration");
                params.push((
                    "duration".to_string(),
                    neo4rs::BoltType::Integer(neo4rs::BoltInteger::new(duration as i64)),
                ));
            }
            if let Some(name) = &request.name {
                set_clauses.push("e.name = $name");
                params.push((
                    "name".to_string(),
                    neo4rs::BoltType::String(neo4rs::BoltString::new(name)),
                ));
            }
            if let Some(description) = &request.description {
                set_clauses.push("e.description = $description");
                params.push((
                    "description".to_string(),
                    neo4rs::BoltType::String(neo4rs::BoltString::new(description)),
                ));
            }
            if let Some(priority) = &request.priority {
                set_clauses.push("e.priority = $priority");
                params.push((
                    "priority".to_string(),
                    neo4rs::BoltType::String(neo4rs::BoltString::new(priority)),
                ));
            }

            if set_clauses.is_empty() {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "No properties to update".to_string(),
                ));
            }

            let query_str = format!(
                "MATCH (e:Goal) WHERE id(e) = $event_id AND e.user_id = $user_id SET {} RETURN e",
                set_clauses.join(", ")
            );

            let mut update_query = query(&query_str);
            for (key, value) in params {
                update_query = update_query.param(&key, value);
            }

            let mut update_result = graph
                .execute(update_query)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            if let Some(row) = update_result
                .next()
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            {
                let updated_event: Goal = row
                    .get("e")
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                println!("✅ [ROUTINE_PROPERTIES] Single event properties updated successfully");
                Ok(Json(vec![updated_event]))
            } else {
                println!("❌ [ROUTINE_PROPERTIES] Failed to update single event properties");
                Err((
                    StatusCode::NOT_FOUND,
                    "Event not found after update".to_string(),
                ))
            }
        }
        "all" |         "future" => {
            println!(
                "🌐 [ROUTINE_PROPERTIES] Processing {} events property update",
                request.update_scope
            );

            // If this bulk update is changing scheduled_timestamp, it's schedule-affecting.
            // Clear exceptions so previously deleted occurrences in-range can reappear.
            if let Some(new_ts) = request.scheduled_timestamp {
                // If it's the same timestamp, it's not really a schedule change.
                if new_ts != current_timestamp {
                    if request.update_scope == "all" {
                        if let Err(e) = routine_exceptions::clear_all_exceptions(&graph, parent_id).await
                        {
                            eprintln!(
                                "Warning: failed to clear routine exceptions for routine_id={} (all properties): {}",
                                parent_id, e
                            );
                        }
                    } else if let Err(e) =
                        routine_exceptions::clear_exceptions_from(&graph, parent_id, current_timestamp).await
                    {
                        eprintln!(
                            "Warning: failed to clear routine exceptions for routine_id={} from_ts={} (future properties): {}",
                            parent_id, current_timestamp, e
                        );
                    }
                }
            }

            // Build the SET clause dynamically based on what properties are provided
            let mut set_clauses = Vec::new();
            let mut params = vec![(
                "parent_id".to_string(),
                neo4rs::BoltType::Integer(neo4rs::BoltInteger::new(parent_id)),
            )];
            params.push((
                "user_id".to_string(),
                neo4rs::BoltType::Integer(neo4rs::BoltInteger::new(user_id)),
            ));

            if let Some(timestamp) = request.scheduled_timestamp {
                set_clauses.push("e.scheduled_timestamp = $scheduled_timestamp");
                params.push((
                    "scheduled_timestamp".to_string(),
                    neo4rs::BoltType::Integer(neo4rs::BoltInteger::new(timestamp)),
                ));
            }
            if let Some(duration) = request.duration {
                set_clauses.push("e.duration = $duration");
                params.push((
                    "duration".to_string(),
                    neo4rs::BoltType::Integer(neo4rs::BoltInteger::new(duration as i64)),
                ));
            }
            if let Some(name) = &request.name {
                set_clauses.push("e.name = $name");
                params.push((
                    "name".to_string(),
                    neo4rs::BoltType::String(neo4rs::BoltString::new(name)),
                ));
            }
            if let Some(description) = &request.description {
                set_clauses.push("e.description = $description");
                params.push((
                    "description".to_string(),
                    neo4rs::BoltType::String(neo4rs::BoltString::new(description)),
                ));
            }
            if let Some(priority) = &request.priority {
                set_clauses.push("e.priority = $priority");
                params.push((
                    "priority".to_string(),
                    neo4rs::BoltType::String(neo4rs::BoltString::new(priority)),
                ));
            }

            if set_clauses.is_empty() {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "No properties to update".to_string(),
                ));
            }

            // Update parent routine so future generated events inherit these properties
            let mut routine_set_clauses: Vec<&str> = Vec::new();
            let mut routine_params = vec![
                (
                    "parent_id".to_string(),
                    neo4rs::BoltType::Integer(neo4rs::BoltInteger::new(parent_id)),
                ),
            ];
            routine_params.push((
                "user_id".to_string(),
                neo4rs::BoltType::Integer(neo4rs::BoltInteger::new(user_id)),
            ));

            if request.duration.is_some() {
                routine_set_clauses.push("r.duration = $r_duration");
                routine_params.push((
                    "r_duration".to_string(),
                    neo4rs::BoltType::Integer(neo4rs::BoltInteger::new(request.duration.unwrap() as i64)),
                ));
            }
            if let Some(name) = &request.name {
                routine_set_clauses.push("r.name = $r_name");
                routine_params.push((
                    "r_name".to_string(),
                    neo4rs::BoltType::String(neo4rs::BoltString::new(name)),
                ));
            }
            if let Some(description) = &request.description {
                routine_set_clauses.push("r.description = $r_description");
                routine_params.push((
                    "r_description".to_string(),
                    neo4rs::BoltType::String(neo4rs::BoltString::new(description)),
                ));
            }
            if let Some(priority) = &request.priority {
                routine_set_clauses.push("r.priority = $r_priority");
                routine_params.push((
                    "r_priority".to_string(),
                    neo4rs::BoltType::String(neo4rs::BoltString::new(priority)),
                ));
            }

            if !routine_set_clauses.is_empty() {
                let routine_query_str = format!(
                    "MATCH (r:Goal) WHERE id(r) = $parent_id AND r.goal_type = 'routine' AND r.user_id = $user_id SET {} RETURN id(r) as id",
                    routine_set_clauses.join(", ")
                );
                let mut routine_update_query = query(&routine_query_str);
                for (key, value) in routine_params {
                    routine_update_query = routine_update_query.param(&key, value);
                }
                graph
                    .run(routine_update_query)
                    .await
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            }

            // Build the query based on scope
            let query_str = if request.update_scope == "all" {
                format!(
                    "MATCH (e:Goal)
                     WHERE e.goal_type = 'event'
                     AND e.parent_id = $parent_id
                     AND e.parent_type = 'routine'
                     AND e.user_id = $user_id
                     AND (e.is_deleted IS NULL OR e.is_deleted = false)
                     SET {}
                     RETURN collect(e) as events",
                    set_clauses.join(", ")
                )
            } else {
                // future scope
                params.push((
                    "current_timestamp".to_string(),
                    neo4rs::BoltType::Integer(neo4rs::BoltInteger::new(current_timestamp)),
                ));
                format!(
                    "MATCH (e:Goal)
                     WHERE e.goal_type = 'event'
                     AND e.parent_id = $parent_id
                     AND e.parent_type = 'routine'
                     AND e.user_id = $user_id
                     AND e.scheduled_timestamp >= $current_timestamp
                     AND (e.is_deleted IS NULL OR e.is_deleted = false)
                     SET {}
                     RETURN collect(e) as events",
                    set_clauses.join(", ")
                )
            };

            let mut update_query = query(&query_str);
            for (key, value) in params {
                update_query = update_query.param(&key, value);
            }

            let mut update_result = graph
                .execute(update_query)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            if let Some(row) = update_result
                .next()
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            {
                let events: Vec<Goal> = row
                    .get("events")
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                println!(
                    "✅ [ROUTINE_PROPERTIES] Updated {} events for '{}' scope",
                    events.len(),
                    request.update_scope
                );
                Ok(Json(events))
            } else {
                println!("⚠️  [ROUTINE_PROPERTIES] No events returned from update query");
                Ok(Json(vec![]))
            }
        }
        "range" => {
            println!("📅 [ROUTINE_PROPERTIES] Processing range update");
            let range_start = request
                .range_start
                .ok_or((StatusCode::BAD_REQUEST, "Missing range_start".to_string()))?;
            let range_end = request
                .range_end
                .ok_or((StatusCode::BAD_REQUEST, "Missing range_end".to_string()))?;

            // Fetch parent routine to copy base properties
            let parent_query = query("MATCH (r:Goal) WHERE id(r) = $parent_id RETURN r")
                .param("parent_id", parent_id);
            let mut parent_result = graph
                .execute(parent_query)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            let parent_routine: Goal = parent_result
                .next()
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                .ok_or((StatusCode::NOT_FOUND, "Parent routine not found".to_string()))?
                .get("r")
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            // Create RoutineState node (inheriting from parent, overriding properties and range)
            let mut state_node = parent_routine.clone();
            state_node.id = None;
            state_node.start_timestamp = Some(range_start);
            state_node.end_timestamp = Some(range_end);
            state_node.goal_type = GoalType::Routine;

            // Apply property overrides
            if let Some(timestamp) = request.scheduled_timestamp {
                let day_in_ms: i64 = 24 * 60 * 60 * 1000;
                let new_time_of_day = timestamp % day_in_ms;
                state_node.routine_time = Some(new_time_of_day);
            }
            if let Some(duration) = request.duration {
                state_node.duration = Some(duration);
            }
            if let Some(name) = &request.name {
                state_node.name = name.clone();
            }
            if let Some(description) = &request.description {
                state_node.description = Some(description.clone());
            }
            if let Some(priority) = &request.priority {
                state_node.priority = Some(priority.clone());
            }

            // Create the state node
            let created_state = state_node
                .create_goal(&graph)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            // Link to parent with HAS_STATE
            let link_query = query(
                "MATCH (r:Goal), (s:Goal) WHERE id(r) = $rid AND id(s) = $sid CREATE (r)-[:HAS_STATE]->(s)",
            )
            .param("rid", parent_id)
            .param("sid", created_state.id.unwrap());
            graph
                .run(link_query)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            // Soft-delete existing events in range
            let delete_query = query(
                "MATCH (r:Goal)-[:HAS_EVENT]->(e:Goal)
                 WHERE id(r) = $rid
                 AND e.goal_type = 'event'
                 AND e.scheduled_timestamp >= $start
                 AND e.scheduled_timestamp <= $end
                 AND (e.is_deleted IS NULL OR e.is_deleted = false)
                 SET e.is_deleted = true
                 RETURN count(e) as count",
            )
            .param("rid", parent_id)
            .param("start", range_start)
            .param("end", range_end);
            
            graph
                .run(delete_query)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            println!("✅ [ROUTINE_PROPERTIES] Range update applied. RoutineState created. Events invalidated.");
            
            Ok(Json(vec![]))
        }
        _ => {
            println!(
                "❌ [ROUTINE_PROPERTIES] Invalid update_scope: {}",
                request.update_scope
            );
            Err((
                StatusCode::BAD_REQUEST,
                "Invalid update_scope. Must be 'single', 'all', or 'future'".to_string(),
            ))
        }
    }
}
