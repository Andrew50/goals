use axum::{http::StatusCode, Json};

use chrono::{Duration, Utc};
use neo4rs::{query, Graph};
use serde::{Deserialize, Serialize};

use crate::tools::goal::GoalType;

const NOT_DELETED: &str = "(g.is_deleted IS NULL OR g.is_deleted = false)";

/// Events in the visible range. Parents are loaded separately by id.
pub(crate) fn event_range_cypher() -> String {
    format!(
        "MATCH (g:Goal)
        WHERE g.user_id = $user_id
        AND g.goal_type = 'event'
        AND {NOT_DELETED}
        AND g.scheduled_timestamp >= $start_timestamp
        AND g.scheduled_timestamp <= $end_timestamp
        RETURN {{
            id: id(g),
            name: g.name,
            goal_type: g.goal_type,
            scheduled_timestamp: g.scheduled_timestamp,
            duration: g.duration,
            priority: g.priority,
            parent_id: g.parent_id,
            parent_type: g.parent_type,
            resolution_status: g.resolution_status,
            gcal_event_id: g.gcal_event_id,
            is_gcal_imported: g.is_gcal_imported
        }} AS g
        ORDER BY g.scheduled_timestamp ASC"
    )
}

pub(crate) fn parent_cypher() -> &'static str {
    "MATCH (g:Goal)
    WHERE id(g) IN $parent_ids
    RETURN {
        id: id(g),
        name: g.name,
        goal_type: g.goal_type,
        routine_time: g.routine_time,
        frequency: g.frequency
    } AS g"
}

/// Pending tasks plus event counts. Skipped events are excluded, matching get_task_events_handler.
pub(crate) fn pending_tasks_cypher() -> String {
    format!(
        "MATCH (t:Goal)
        WHERE t.user_id = $user_id
        AND t.goal_type = 'task'
        AND (t.resolution_status IS NULL OR t.resolution_status = 'pending')
        AND (t.is_deleted IS NULL OR t.is_deleted = false)
        OPTIONAL MATCH (t)-[:HAS_EVENT]->(e:Goal)
        WHERE e.goal_type = 'event'
        AND (e.is_deleted IS NULL OR e.is_deleted = false)
        AND coalesce(e.resolution_status, 'pending') <> 'skipped'
        WITH t, e
        WITH t,
            count(e) AS event_count,
            sum(CASE WHEN e IS NOT NULL AND coalesce(e.resolution_status, 'pending') = 'completed' THEN 1 ELSE 0 END) AS completed_event_count,
            sum(CASE WHEN e IS NOT NULL AND coalesce(e.resolution_status, 'pending') <> 'completed' AND e.scheduled_timestamp > $now THEN 1 ELSE 0 END) AS future_uncompleted_count,
            min(CASE WHEN e IS NOT NULL AND coalesce(e.resolution_status, 'pending') <> 'completed' AND e.scheduled_timestamp > $now THEN e.scheduled_timestamp ELSE NULL END) AS next_uncompleted
        ORDER BY t.priority DESC, t.name ASC
        RETURN {{
            id: id(t),
            name: t.name,
            goal_type: t.goal_type,
            duration: t.duration,
            priority: t.priority,
            start_timestamp: t.start_timestamp,
            end_timestamp: t.end_timestamp,
            resolution_status: t.resolution_status,
            event_count: event_count,
            completed_event_count: completed_event_count,
            future_uncompleted_count: future_uncompleted_count,
            next_uncompleted: next_uncompleted
        }} AS t"
    )
}

pub fn past_uncompleted_count(event_count: i64, completed: i64, future_uncompleted: i64) -> i64 {
    (event_count - completed - future_uncompleted).max(0)
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CalendarEventNode {
    pub id: Option<i64>,
    pub name: String,
    pub goal_type: GoalType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduled_timestamp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gcal_event_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_gcal_imported: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CalendarParentNode {
    pub id: Option<i64>,
    pub name: String,
    pub goal_type: GoalType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routine_time: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frequency: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct TaskAggRow {
    id: Option<i64>,
    name: String,
    goal_type: GoalType,
    #[serde(default)]
    duration: Option<i32>,
    #[serde(default)]
    priority: Option<String>,
    #[serde(default)]
    start_timestamp: Option<i64>,
    #[serde(default)]
    end_timestamp: Option<i64>,
    #[serde(default)]
    resolution_status: Option<String>,
    #[serde(default)]
    event_count: i64,
    #[serde(default)]
    completed_event_count: i64,
    #[serde(default)]
    future_uncompleted_count: i64,
    #[serde(default)]
    next_uncompleted: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct CalendarTaskNode {
    pub id: Option<i64>,
    pub name: String,
    pub goal_type: GoalType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_timestamp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_timestamp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution_status: Option<String>,
    pub event_count: i64,
    pub completed_event_count: i64,
    pub past_uncompleted_count: i64,
    pub future_uncompleted_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_uncompleted: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct CalendarRangeData {
    events: Vec<CalendarEventNode>,
    parents: Vec<CalendarParentNode>,
}

#[derive(Debug, Serialize)]
pub struct CalendarTasksData {
    tasks: Vec<CalendarTaskNode>,
}

/// Combined shape for the AI tool. Routines are not included.
/// The tool registry is not compiled into normal builds, so this stays unused there.
#[allow(dead_code)]
#[derive(Debug, Serialize)]
pub struct CalendarData {
    events: Vec<CalendarEventNode>,
    unscheduled_tasks: Vec<CalendarTaskNode>,
    parents: Vec<CalendarParentNode>,
}

fn db_err(context: &str, err: impl std::fmt::Display) -> (StatusCode, String) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("{context}: {err}"),
    )
}

pub async fn get_calendar_range(
    graph: Graph,
    user_id: i64,
    start_timestamp: Option<i64>,
    end_timestamp: Option<i64>,
) -> Result<Json<CalendarRangeData>, (StatusCode, String)> {
    let (events, parents) =
        fetch_events_and_parents(&graph, user_id, start_timestamp, end_timestamp).await?;
    Ok(Json(CalendarRangeData { events, parents }))
}

pub async fn get_calendar_tasks(
    graph: Graph,
    user_id: i64,
) -> Result<Json<CalendarTasksData>, (StatusCode, String)> {
    let tasks = fetch_pending_tasks(&graph, user_id).await?;
    Ok(Json(CalendarTasksData { tasks }))
}

#[allow(dead_code)]
pub async fn get_calendar_data(
    graph: Graph,
    user_id: i64,
    start_timestamp: Option<i64>,
    end_timestamp: Option<i64>,
) -> Result<Json<CalendarData>, (StatusCode, String)> {
    let tasks_graph = graph.clone();
    let (range, tasks) = tokio::join!(
        fetch_events_and_parents(&graph, user_id, start_timestamp, end_timestamp),
        fetch_pending_tasks(&tasks_graph, user_id),
    );
    let (events, parents) = range?;
    let unscheduled_tasks = tasks?;
    Ok(Json(CalendarData {
        events,
        unscheduled_tasks,
        parents,
    }))
}

async fn fetch_events_and_parents(
    graph: &Graph,
    user_id: i64,
    start_timestamp: Option<i64>,
    end_timestamp: Option<i64>,
) -> Result<(Vec<CalendarEventNode>, Vec<CalendarParentNode>), (StatusCode, String)> {
    let now = Utc::now();
    let start_timestamp = start_timestamp.unwrap_or((now - Duration::days(30)).timestamp_millis());
    let end_timestamp = end_timestamp.unwrap_or((now + Duration::days(60)).timestamp_millis());

    let events_query = query(&event_range_cypher())
        .param("user_id", user_id)
        .param("start_timestamp", start_timestamp)
        .param("end_timestamp", end_timestamp);

    let mut events_result = graph
        .execute(events_query)
        .await
        .map_err(|e| db_err("Failed to fetch events", e))?;

    let mut events = Vec::new();
    let mut parent_ids = Vec::new();

    while let Some(row) = events_result
        .next()
        .await
        .map_err(|e| db_err("Error fetching event row", e))?
    {
        let event: CalendarEventNode = row
            .get("g")
            .map_err(|e| db_err("Error deserializing event", e))?;
        if let Some(parent_id) = event.parent_id {
            parent_ids.push(parent_id);
        }
        if event.id.is_some() {
            events.push(event);
        }
    }

    parent_ids.sort_unstable();
    parent_ids.dedup();

    let parents = if parent_ids.is_empty() {
        Vec::new()
    } else {
        let parent_query = query(parent_cypher()).param("parent_ids", parent_ids);
        let mut parent_result = graph
            .execute(parent_query)
            .await
            .map_err(|e| db_err("Failed to fetch parent goals", e))?;
        let mut parents = Vec::new();
        while let Some(row) = parent_result
            .next()
            .await
            .map_err(|e| db_err("Error fetching parent row", e))?
        {
            let parent: CalendarParentNode = row
                .get("g")
                .map_err(|e| db_err("Error deserializing parent", e))?;
            parents.push(parent);
        }
        parents
    };

    Ok((events, parents))
}

async fn fetch_pending_tasks(
    graph: &Graph,
    user_id: i64,
) -> Result<Vec<CalendarTaskNode>, (StatusCode, String)> {
    let tasks_query = query(&pending_tasks_cypher())
        .param("user_id", user_id)
        .param("now", Utc::now().timestamp_millis());

    let mut tasks_result = graph
        .execute(tasks_query)
        .await
        .map_err(|e| db_err("Failed to fetch unscheduled tasks", e))?;

    let mut tasks = Vec::new();
    while let Some(row) = tasks_result
        .next()
        .await
        .map_err(|e| db_err("Error fetching unscheduled task row", e))?
    {
        let agg: TaskAggRow = row
            .get("t")
            .map_err(|e| db_err("Error deserializing task", e))?;
        if agg.id.is_none() {
            continue;
        }
        tasks.push(CalendarTaskNode {
            id: agg.id,
            name: agg.name,
            goal_type: agg.goal_type,
            duration: agg.duration,
            priority: agg.priority,
            start_timestamp: agg.start_timestamp,
            end_timestamp: agg.end_timestamp,
            resolution_status: agg.resolution_status,
            event_count: agg.event_count,
            completed_event_count: agg.completed_event_count,
            past_uncompleted_count: past_uncompleted_count(
                agg.event_count,
                agg.completed_event_count,
                agg.future_uncompleted_count,
            ),
            future_uncompleted_count: agg.future_uncompleted_count,
            next_uncompleted: agg.next_uncompleted,
        });
    }
    Ok(tasks)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_query_does_not_load_routines() {
        let q = event_range_cypher();
        assert!(q.contains("goal_type = 'event'"));
        assert!(!q.contains("goal_type = 'routine'"));
        assert!(!q.contains("routines"));
        assert!(q.contains("g.is_deleted IS NULL OR g.is_deleted = false"));
        assert!(!q.contains("coalesce(g.is_deleted"));
    }

    #[test]
    fn task_stats_query_aggregates_events() {
        let q = pending_tasks_cypher();
        assert!(q.contains("HAS_EVENT"));
        assert!(q.contains("event_count"));
        assert!(q.contains("completed_event_count"));
        assert!(q.contains("future_uncompleted_count"));
        assert!(q.contains("next_uncompleted"));
        assert!(q.contains("<> 'skipped'"));
        assert!(!q.contains("goal_type = 'routine'"));
    }

    #[test]
    fn past_uncompleted_matches_task_event_handler() {
        // 5 events, 2 completed, 1 future => 2 past. Negative clamps to 0.
        assert_eq!(past_uncompleted_count(5, 2, 1), 2);
        assert_eq!(past_uncompleted_count(1, 1, 1), 0);
    }
}
