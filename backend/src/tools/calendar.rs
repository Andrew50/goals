use axum::{http::StatusCode, Json};

use chrono::{DateTime, Duration, Utc};
use neo4rs::{query, Graph};
use serde::Serialize;

use crate::tools::goal::{Goal, GOAL_RETURN_QUERY};

#[derive(Debug, Serialize)]
pub struct CalendarData {
    events: Vec<Goal>,
    unscheduled_tasks: Vec<Goal>,
    routines: Vec<Goal>,     // Keep for reference if needed
    achievements: Vec<Goal>, // Keep for reference if needed
    parents: Vec<Goal>,      // Parent tasks/routines for events
}

#[derive(Debug, Serialize)]
pub struct CalendarEvent {
    id: i64,
    title: String,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    #[serde(rename = "type")]
    event_type: String,
    description: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UnscheduledTask {
    id: i64,
    title: String,
    end_timestamp: i64,
    description: Option<String>,
}

#[allow(dead_code)]
async fn execute_query<T>(
    graph: &Graph,
    mut query: neo4rs::Query,
    transform: impl Fn(Goal) -> T,
    user_id: i64,
    current_time: i64,
) -> Result<Vec<T>, (StatusCode, String)> {
    query = query
        .param("user_id", user_id)
        .param("current_time", current_time);

    // Only print parameters
    println!(
        "With parameters: user_id={}, current_time={}",
        user_id, current_time
    );

    let mut result = graph.execute(query).await.map_err(|e| {
        eprintln!("Database query failed: {:?}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database query failed: {}", e),
        )
    })?;

    let mut items = Vec::new();
    while let Some(row) = result.next().await.map_err(|e| {
        eprintln!("Error fetching row: {:?}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error fetching row: {}", e),
        )
    })? {
        let event_data: Goal = row.get("g").map_err(|e| {
            eprintln!("Error deserializing event: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error deserializing event: {}", e),
            )
        })?;

        if event_data.id.is_some() {
            items.push(transform(event_data));
        }
    }
    Ok(items)
}

pub async fn get_calendar_data(
    graph: Graph,
    user_id: i64,
) -> Result<Json<CalendarData>, (StatusCode, String)> {
    // Calculate time range - default to current month +/- 1 month
    let now = Utc::now();
    let start_timestamp = (now - Duration::days(30)).timestamp_millis();
    let end_timestamp = (now + Duration::days(60)).timestamp_millis();

    // Simply fetch all events in range - no more dynamic generation
    let events_query_str = format!(
        "MATCH (g:Goal)
        WHERE g.user_id = $user_id
        AND g.goal_type = 'event'
        AND coalesce(g.is_deleted, false) <> true
        AND g.scheduled_timestamp >= $start_timestamp
        AND g.scheduled_timestamp <= $end_timestamp
        {}
        ORDER BY g.scheduled_timestamp ASC",
        GOAL_RETURN_QUERY
    );

    let events_query = query(&events_query_str)
        .param("user_id", user_id)
        .param("start_timestamp", start_timestamp)
        .param("end_timestamp", end_timestamp);

    let mut events_result = graph.execute(events_query).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to fetch events: {}", e),
        )
    })?;

    let mut events = Vec::new();
    let mut parent_ids = Vec::new();

    while let Some(row) = events_result.next().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error fetching event row: {}", e),
        )
    })? {
        let event: Goal = row.get("g").map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error deserializing event: {}", e),
            )
        })?;

        if let Some(parent_id) = event.parent_id {
            parent_ids.push(parent_id);
        }
        events.push(event);
    }

    // Fetch parent goals for the events
    let parents = if !parent_ids.is_empty() {
        let parent_query_str = format!(
            "MATCH (g:Goal)
            WHERE id(g) IN $parent_ids
            {}",
            GOAL_RETURN_QUERY
        );

        let parent_query = query(&parent_query_str).param("parent_ids", parent_ids);

        let mut parent_result = graph.execute(parent_query).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch parent goals: {}", e),
            )
        })?;

        let mut parents = Vec::new();
        while let Some(row) = parent_result.next().await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error fetching parent row: {}", e),
            )
        })? {
            let parent: Goal = row.get("g").map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Error deserializing parent: {}", e),
                )
            })?;
            parents.push(parent);
        }
        parents
    } else {
        Vec::new()
    };

    // Fetch all non-completed tasks
    let unscheduled_query_str = format!(
        "MATCH (g:Goal)
        WHERE g.user_id = $user_id
        AND g.goal_type = 'task'
        AND coalesce(g.completed, false) <> true
        AND coalesce(g.is_deleted, false) <> true
        {}
        ORDER BY g.priority DESC, g.name ASC",
        GOAL_RETURN_QUERY
    );

    let unscheduled_query = query(&unscheduled_query_str).param("user_id", user_id);

    let mut unscheduled_result = graph.execute(unscheduled_query).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to fetch unscheduled tasks: {}", e),
        )
    })?;

    let mut unscheduled_tasks = Vec::new();
    while let Some(row) = unscheduled_result.next().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error fetching unscheduled task row: {}", e),
        )
    })? {
        let task: Goal = row.get("g").map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error deserializing task: {}", e),
            )
        })?;
        unscheduled_tasks.push(task);
    }

    // Optionally fetch routines for reference (if needed by UI)
    let routines_query_str = format!(
        "MATCH (g:Goal)
        WHERE g.user_id = $user_id
        AND g.goal_type = 'routine'
        AND (g.end_timestamp IS NULL OR g.end_timestamp >= $now)
        {}
        ORDER BY g.name ASC",
        GOAL_RETURN_QUERY
    );

    let routines_query = query(&routines_query_str)
        .param("user_id", user_id)
        .param("now", Utc::now().timestamp_millis());

    let mut routines_result = graph.execute(routines_query).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to fetch routines: {}", e),
        )
    })?;

    let mut routines = Vec::new();
    while let Some(row) = routines_result.next().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error fetching routine row: {}", e),
        )
    })? {
        let routine: Goal = row.get("g").map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error deserializing routine: {}", e),
            )
        })?;
        routines.push(routine);
    }

    Ok(Json(CalendarData {
        events,
        unscheduled_tasks,
        routines,
        achievements: vec![], // Keep empty for now, can populate if needed
        parents,
    }))
}
