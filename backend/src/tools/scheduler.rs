use axum::http::StatusCode;
use chrono::{TimeZone, Timelike, Utc};
use neo4rs::{query, Graph};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Serialize, Clone)]
pub struct SchedulingWindow {
    pub start_minutes: i64,
    pub end_minutes: i64,
}

pub async fn update_scheduling_window(
    graph: Graph,
    user_id: i64,
) -> Result<SchedulingWindow, (StatusCode, String)> {
    let q = query(
        "MATCH (g:Goal)\n         WHERE g.user_id = $user_id\n         AND g.goal_type = 'task'\n         AND g.scheduled_timestamp IS NOT NULL\n         RETURN g.scheduled_timestamp AS ts\n         ORDER BY g.scheduled_timestamp",
    )
    .param("user_id", user_id);

    let mut result = graph.execute(q).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Query failed: {}", e),
        )
    })?;

    let mut day_map: HashMap<i64, (i64, i64)> = HashMap::new();
    let day_ms: i64 = 24 * 60 * 60 * 1000;

    while let Ok(Some(row)) = result.next().await {
        let ts: i64 = row.get("ts").unwrap_or(0);
        let day = ts / day_ms;
        let minutes = {
            let dt = Utc.timestamp_millis_opt(ts).unwrap();
            dt.time().num_seconds_from_midnight() as i64 / 60
        };
        let entry = day_map.entry(day).or_insert((i64::MAX, i64::MIN));
        if minutes < entry.0 {
            entry.0 = minutes;
        }
        if minutes > entry.1 {
            entry.1 = minutes;
        }
    }

    if day_map.is_empty() {
        let default = SchedulingWindow {
            start_minutes: 9 * 60,
            end_minutes: 17 * 60,
        };
        store_window(&graph, user_id, default.start_minutes, default.end_minutes).await?;
        return Ok(default);
    }

    let alpha = 0.2_f64;
    let mut days: Vec<i64> = day_map.keys().cloned().collect();
    days.sort();

    let mut ema_start = 0_f64;
    let mut ema_end = 0_f64;
    let mut first = true;
    for day in days {
        let (start, end) = day_map[&day];
        if first {
            ema_start = start as f64;
            ema_end = end as f64;
            first = false;
        } else {
            ema_start = alpha * start as f64 + (1.0 - alpha) * ema_start;
            ema_end = alpha * end as f64 + (1.0 - alpha) * ema_end;
        }
    }

    let window = SchedulingWindow {
        start_minutes: ema_start.round() as i64,
        end_minutes: ema_end.round() as i64,
    };
    store_window(&graph, user_id, window.start_minutes, window.end_minutes).await?;
    Ok(window)
}

async fn store_window(
    graph: &Graph,
    user_id: i64,
    start_minutes: i64,
    end_minutes: i64,
) -> Result<(), (StatusCode, String)> {
    let q = query(
        "MATCH (u:User) WHERE id(u) = $user_id\n         SET u.schedule_window_start = $start,\n             u.schedule_window_end = $end",
    )
    .param("user_id", user_id)
    .param("start", start_minutes)
    .param("end", end_minutes);

    graph.run(q).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to update user prefs: {}", e),
        )
    })
}

pub async fn suggest_schedule_tasks(
    graph: Graph,
    user_id: i64,
) -> Result<(), (StatusCode, String)> {
    let window = update_scheduling_window(graph.clone(), user_id).await?;

    let q = query(
        "MATCH (g:Goal)\n         WHERE g.user_id = $user_id\n           AND g.goal_type = 'task'\n           AND g.scheduled_timestamp IS NULL\n         RETURN id(g) AS id, g.duration AS duration, g.priority AS priority",
    )
    .param("user_id", user_id);

    let mut result = graph.execute(q).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to fetch tasks: {}", e),
        )
    })?;

    let mut tasks = Vec::new();
    while let Ok(Some(row)) = result.next().await {
        let id: i64 = row.get("id").unwrap();
        let duration: Option<i64> = row.get("duration").ok();
        let priority: Option<String> = row.get("priority").ok();
        tasks.push((id, duration.unwrap_or(60), priority));
    }

    if tasks.is_empty() {
        return Ok(());
    }

    // Sort tasks by priority (high -> medium -> low) and duration
    fn priority_weight(p: &Option<String>) -> i32 {
        match p.as_deref() {
            Some("high") => 0,
            Some("medium") => 1,
            Some("low") => 2,
            _ => 3,
        }
    }
    tasks.sort_by_key(|(_, duration, priority)| (priority_weight(priority), *duration));

    let start_of_day = {
        let now = Utc::now();
        now.date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis()
    };
    let mut current = start_of_day + window.start_minutes * 60 * 1000;
    let end_limit = start_of_day + window.end_minutes * 60 * 1000;

    for (id, dur_min, _) in tasks {
        if current > end_limit {
            break;
        }
        let q = query(
            "MATCH (g:Goal) WHERE id(g) = $id SET g.suggested_timestamp = $ts",
        )
        .param("id", id)
        .param("ts", current);
        graph.run(q).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to schedule task: {}", e),
            )
        })?;
        current += dur_min * 60 * 1000;
    }
    Ok(())
}

