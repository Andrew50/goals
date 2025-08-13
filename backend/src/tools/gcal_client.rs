use axum::{http::StatusCode, Json};
use chrono::{DateTime, Utc};
use neo4rs::{query, Graph};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::server::token_manager;
use crate::tools::goal::{Goal, GoalType, GOAL_RETURN_QUERY};

#[derive(Debug, Serialize, Deserialize)]
pub struct GCalSyncRequest {
    pub calendar_id: String,
    pub sync_direction: String, // "bidirectional", "to_gcal", "from_gcal"
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GCalEvent {
    pub id: String,
    pub summary: String,
    pub description: Option<String>,
    pub start: EventDateTime,
    pub end: EventDateTime,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EventDateTime {
    #[serde(rename = "dateTime")]
    pub date_time: Option<String>,
    pub date: Option<String>,
    #[serde(rename = "timeZone")]
    pub time_zone: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SyncResult {
    pub imported_events: i32,
    pub exported_events: i32,
    pub updated_events: i32,
    pub errors: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct CalendarListResponse {
    items: Vec<CalendarListEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CalendarListEntry {
    pub id: String,
    pub summary: String,
    pub primary: Option<bool>,
    #[serde(rename = "accessRole")]
    pub access_role: String,
}

#[derive(Debug, Deserialize)]
struct EventsListResponse {
    items: Option<Vec<GCalEvent>>,
    #[serde(rename = "nextSyncToken")]
    next_sync_token: Option<String>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

const GOOGLE_CALENDAR_API_BASE: &str = "https://www.googleapis.com/calendar/v3";

/// List calendars accessible to the user
pub async fn list_calendars(
    graph: &Graph,
    user_id: i64,
) -> Result<Json<Vec<CalendarListEntry>>, (StatusCode, String)> {
    eprintln!("📅 [GCAL] Listing calendars for user {}", user_id);

    let token = token_manager::get_valid_token(graph, user_id)
        .await
        .map_err(|e| {
            eprintln!("❌ [GCAL] Failed to get token for user {}: {}", user_id, e);
            (StatusCode::UNAUTHORIZED, e)
        })?;

    eprintln!("✅ [GCAL] Got valid token for user {}", user_id);

    let client = Client::new();
    let response = client
        .get(format!(
            "{}/users/me/calendarList",
            GOOGLE_CALENDAR_API_BASE
        ))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch calendar list: {}", e),
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        eprintln!(
            "❌ [GCAL] Calendar API error - Status: {}, Error: {}",
            status, error_text
        );

        // Parse common Google API errors for better user feedback
        let user_message = if status.as_u16() == 403 {
            if error_text.contains("insufficient authentication scopes") {
                "Calendar permissions not granted. Please sign out, revoke app access in Google Account settings, and sign in again granting all calendar permissions.".to_string()
            } else if error_text.contains("Calendar API has not been used") {
                "Google Calendar API is not enabled for this application. Please contact support."
                    .to_string()
            } else {
                "Access denied to Google Calendar. Please re-authenticate and grant calendar permissions.".to_string()
            }
        } else if status.as_u16() == 401 {
            "Google authentication expired. Please sign in again.".to_string()
        } else {
            format!("Google Calendar API error: {}", error_text)
        };

        return Err((
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            user_message,
        ));
    }

    let calendar_list: CalendarListResponse = response.json().await.map_err(|e| {
        eprintln!("❌ [GCAL] Failed to parse calendar list response: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to parse calendar list: {}", e),
        )
    })?;

    eprintln!(
        "📋 [GCAL] Found {} calendars for user {}",
        calendar_list.items.len(),
        user_id
    );
    for cal in &calendar_list.items {
        eprintln!(
            "  - {} ({}){}",
            cal.summary,
            cal.id,
            if cal.primary.unwrap_or(false) {
                " [PRIMARY]"
            } else {
                ""
            }
        );
    }

    Ok(Json(calendar_list.items))
}

/// Fetch events from Google Calendar with incremental sync support
async fn fetch_events_incremental(
    token: &str,
    calendar_id: &str,
    sync_token: Option<String>,
    time_min: Option<DateTime<Utc>>,
    time_max: Option<DateTime<Utc>>,
) -> Result<(Vec<GCalEvent>, Option<String>), String> {
    let client = Client::new();
    let mut all_events = Vec::new();
    let mut page_token: Option<String> = None;
    let final_sync_token: Option<String>;
    let mut current_sync_token = sync_token;

    loop {
        let url = format!(
            "{}/calendars/{}/events",
            GOOGLE_CALENDAR_API_BASE, calendar_id
        );
        let mut params = vec![
            ("singleEvents", "true".to_string()),
            ("orderBy", "startTime".to_string()),
        ];

        if let Some(ref token) = current_sync_token {
            params.push(("syncToken", token.clone()));
        } else {
            // Only use time bounds if we don't have a sync token
            if let Some(ref min) = time_min {
                params.push(("timeMin", min.to_rfc3339()));
            }
            if let Some(ref max) = time_max {
                params.push(("timeMax", max.to_rfc3339()));
            }
        }

        if let Some(ref token) = page_token {
            params.push(("pageToken", token.clone()));
        }

        let response = client
            .get(&url)
            .bearer_auth(token)
            .query(&params)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch events: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();

            // If sync token is invalid, retry without it by clearing and continuing
            if current_sync_token.is_some() && error_text.contains("Sync token") {
                eprintln!("Sync token invalid, retrying without it");
                current_sync_token = None;
                page_token = None;
                continue;
            }

            return Err(format!("Google Calendar API error: {}", error_text));
        }

        let events_response: EventsListResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse events: {}", e))?;

        if let Some(events) = events_response.items {
            all_events.extend(events);
        }

        // Check for pagination
        if let Some(next_token) = events_response.next_page_token {
            page_token = Some(next_token);
        } else {
            // No more pages, save sync token if available
            final_sync_token = events_response.next_sync_token;
            break;
        }
    }

    Ok((all_events, final_sync_token))
}

/// Create an event in Google Calendar
async fn create_event(token: &str, calendar_id: &str, goal: &Goal) -> Result<String, String> {
    let start_time = goal
        .scheduled_timestamp
        .ok_or("Goal must have a scheduled timestamp")?;
    let duration_minutes = goal.duration.unwrap_or(60);
    let start_dt = DateTime::from_timestamp_millis(start_time).unwrap();
    let end_time = start_time + (duration_minutes as i64 * 60 * 1000);
    let end_dt = DateTime::from_timestamp_millis(end_time).unwrap();

    let event = if goal.duration == Some(1440) {
        // All-day event
        json!({
            "summary": goal.name,
            "description": goal.description,
            "start": {
                "date": start_dt.date_naive().to_string()
            },
            "end": {
                "date": end_dt.date_naive().to_string()
            }
        })
    } else {
        json!({
            "summary": goal.name,
            "description": goal.description,
            "start": {
                "dateTime": start_dt.to_rfc3339(),
                "timeZone": "UTC"
            },
            "end": {
                "dateTime": end_dt.to_rfc3339(),
                "timeZone": "UTC"
            }
        })
    };

    let client = Client::new();
    let response = client
        .post(format!(
            "{}/calendars/{}/events",
            GOOGLE_CALENDAR_API_BASE, calendar_id
        ))
        .bearer_auth(token)
        .json(&event)
        .send()
        .await
        .map_err(|e| format!("Failed to create event: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to create event: {}", error_text));
    }

    let created_event: GCalEvent = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse created event: {}", e))?;

    Ok(created_event.id)
}

/// Update an event in Google Calendar
async fn update_event(
    token: &str,
    calendar_id: &str,
    event_id: &str,
    goal: &Goal,
) -> Result<(), String> {
    let start_time = goal
        .scheduled_timestamp
        .ok_or("Goal must have a scheduled timestamp")?;
    let duration_minutes = goal.duration.unwrap_or(60);
    let start_dt = DateTime::from_timestamp_millis(start_time).unwrap();
    let end_time = start_time + (duration_minutes as i64 * 60 * 1000);
    let end_dt = DateTime::from_timestamp_millis(end_time).unwrap();

    let event = if goal.duration == Some(1440) {
        json!({
            "summary": goal.name,
            "description": goal.description,
            "start": {
                "date": start_dt.date_naive().to_string()
            },
            "end": {
                "date": end_dt.date_naive().to_string()
            }
        })
    } else {
        json!({
            "summary": goal.name,
            "description": goal.description,
            "start": {
                "dateTime": start_dt.to_rfc3339(),
                "timeZone": "UTC"
            },
            "end": {
                "dateTime": end_dt.to_rfc3339(),
                "timeZone": "UTC"
            }
        })
    };

    let client = Client::new();
    let response = client
        .put(format!(
            "{}/calendars/{}/events/{}",
            GOOGLE_CALENDAR_API_BASE, calendar_id, event_id
        ))
        .bearer_auth(token)
        .json(&event)
        .send()
        .await
        .map_err(|e| format!("Failed to update event: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to update event: {}", error_text));
    }

    Ok(())
}

/// Delete an event from Google Calendar
async fn delete_event(token: &str, calendar_id: &str, event_id: &str) -> Result<(), String> {
    let client = Client::new();
    let response = client
        .delete(format!(
            "{}/calendars/{}/events/{}",
            GOOGLE_CALENDAR_API_BASE, calendar_id, event_id
        ))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Failed to delete event: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to delete event: {}", error_text));
    }

    Ok(())
}

/// Get or create sync state for a user and calendar
async fn get_sync_state(
    graph: &Graph,
    user_id: i64,
    calendar_id: &str,
) -> Result<Option<String>, String> {
    let query = query(
        "MATCH (s:SyncState {user_id: $user_id, calendar_id: $calendar_id})
         RETURN s.sync_token as sync_token",
    )
    .param("user_id", user_id)
    .param("calendar_id", calendar_id.to_string());

    let mut result = graph
        .execute(query)
        .await
        .map_err(|e| format!("Failed to fetch sync state: {}", e))?;

    if let Some(row) = result.next().await.ok().flatten() {
        Ok(row.get("sync_token").ok())
    } else {
        Ok(None)
    }
}

/// Update sync state for a user and calendar
async fn update_sync_state(
    graph: &Graph,
    user_id: i64,
    calendar_id: &str,
    sync_token: Option<String>,
) -> Result<(), String> {
    let query = if sync_token.is_some() {
        query(
            "MERGE (s:SyncState {user_id: $user_id, calendar_id: $calendar_id})
             SET s.sync_token = $sync_token, s.last_synced = timestamp()
             RETURN s",
        )
        .param("user_id", user_id)
        .param("calendar_id", calendar_id.to_string())
        .param("sync_token", sync_token.unwrap())
    } else {
        query(
            "MERGE (s:SyncState {user_id: $user_id, calendar_id: $calendar_id})
             SET s.last_synced = timestamp()
             RETURN s",
        )
        .param("user_id", user_id)
        .param("calendar_id", calendar_id.to_string())
    };

    graph
        .run(query)
        .await
        .map_err(|e| format!("Failed to update sync state: {}", e))?;

    Ok(())
}

/// Sync events from Google Calendar to the local database
pub async fn sync_from_gcal(
    graph: Graph,
    user_id: i64,
    calendar_id: &str,
) -> Result<Json<SyncResult>, (StatusCode, String)> {
    eprintln!(
        "🚀 [GCAL←] Starting sync FROM Google Calendar | user={} calendar={}",
        user_id, calendar_id
    );
    // Get user's access token
    let token = token_manager::get_valid_token(&graph, user_id)
        .await
        .map_err(|e| (StatusCode::UNAUTHORIZED, e))?;

    // Get sync state
    let sync_token = get_sync_state(&graph, user_id, calendar_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    // Set time bounds if no sync token
    let (time_min, time_max) = if sync_token.is_none() {
        let now = Utc::now();
        (
            Some(now - chrono::Duration::days(30)),
            Some(now + chrono::Duration::days(60)),
        )
    } else {
        (None, None)
    };

    // Fetch events from Google Calendar
    let (gcal_events, new_sync_token) =
        fetch_events_incremental(&token, calendar_id, sync_token, time_min, time_max)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to fetch Google Calendar events: {}", e),
                )
            })?;

    eprintln!(
        "📥 [GCAL←] Retrieved {} events from Google Calendar (new_sync_token_present={})",
        gcal_events.len(),
        new_sync_token.as_ref().map(|_| true).unwrap_or(false)
    );

    let mut imported_events = 0;
    let mut updated_events = 0;
    let mut errors = Vec::new();

    for gcal_event in gcal_events {
        eprintln!(
            "➡️  [GCAL←] Processing event id='{}' summary='{}' start={:?} end={:?}",
            gcal_event.id, gcal_event.summary, gcal_event.start, gcal_event.end
        );
        // Parse timestamps
        let (start_timestamp, is_all_day) = if let Some(date) = &gcal_event.start.date {
            // All-day event
            let date = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
                .map_err(|e| format!("Failed to parse date: {}", e))
                .ok();
            if let Some(d) = date {
                (
                    d.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp_millis(),
                    true,
                )
            } else {
                errors.push(format!("Invalid start date for event {}", gcal_event.id));
                continue;
            }
        } else if let Some(datetime) = &gcal_event.start.date_time {
            // Timed event
            let dt = DateTime::parse_from_rfc3339(datetime)
                .map_err(|e| format!("Failed to parse datetime: {}", e))
                .ok();
            if let Some(d) = dt {
                (d.timestamp_millis(), false)
            } else {
                errors.push(format!(
                    "Invalid start datetime for event {}",
                    gcal_event.id
                ));
                continue;
            }
        } else {
            errors.push(format!("No start time for event {}", gcal_event.id));
            continue;
        };

        let duration = if is_all_day {
            1440 // All-day event
        } else {
            // Calculate duration from end time
            if let Some(datetime) = &gcal_event.end.date_time {
                if let Ok(end_dt) = DateTime::parse_from_rfc3339(datetime) {
                    ((end_dt.timestamp_millis() - start_timestamp) / 60000) as i32
                } else {
                    60 // Default to 1 hour
                }
            } else {
                60 // Default to 1 hour
            }
        };

        // Check if event already exists
        let existing_query = query(
            "MATCH (g:Goal) 
             WHERE g.user_id = $user_id 
             AND g.gcal_event_id = $gcal_event_id 
             AND g.gcal_calendar_id = $gcal_calendar_id
             RETURN g",
        )
        .param("user_id", user_id)
        .param("gcal_event_id", gcal_event.id.clone())
        .param("gcal_calendar_id", calendar_id.to_string());

        let mut existing_result = graph.execute(existing_query).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {}", e),
            )
        })?;

        if existing_result
            .next()
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Error checking existing event: {}", e),
                )
            })?
            .is_some()
        {
            // Update existing event
            let update_query = query(
                "MATCH (g:Goal) 
                 WHERE g.user_id = $user_id 
                 AND g.gcal_event_id = $gcal_event_id 
                 SET g.name = $name,
                     g.description = $description,
                     g.scheduled_timestamp = $scheduled_timestamp,
                     g.duration = $duration,
                     g.gcal_last_sync = $sync_time",
            )
            .param("user_id", user_id)
            .param("gcal_event_id", gcal_event.id.clone())
            .param("name", gcal_event.summary.clone())
            .param(
                "description",
                gcal_event.description.as_deref().unwrap_or(""),
            )
            .param("scheduled_timestamp", start_timestamp)
            .param("duration", duration)
            .param("sync_time", Utc::now().timestamp_millis());

            graph.run(update_query).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to update event: {}", e),
                )
            })?;

            updated_events += 1;
        } else {
            // Create new event
            let goal = Goal {
                id: None,
                name: gcal_event.summary,
                description: gcal_event.description,
                goal_type: GoalType::Event,
                user_id: Some(user_id),
                scheduled_timestamp: Some(start_timestamp),
                duration: Some(duration),
                gcal_event_id: Some(gcal_event.id),
                gcal_calendar_id: Some(calendar_id.to_string()),
                gcal_sync_enabled: Some(true),
                gcal_sync_direction: Some("from_gcal".to_string()),
                is_gcal_imported: Some(true),
                gcal_last_sync: Some(Utc::now().timestamp_millis()),
                ..Default::default()
            };

            goal.create_goal(&graph).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to create imported event: {}", e),
                )
            })?;

            imported_events += 1;
        }
    }

    // Update sync state with new token
    if let Some(token) = new_sync_token {
        update_sync_state(&graph, user_id, calendar_id, Some(token))
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    }

    Ok(Json(SyncResult {
        imported_events,
        exported_events: 0,
        updated_events,
        errors,
    }))
}

/// Sync events from local database to Google Calendar
pub async fn sync_to_gcal(
    graph: Graph,
    user_id: i64,
    calendar_id: &str,
) -> Result<Json<SyncResult>, (StatusCode, String)> {
    eprintln!(
        "🚀 [GCAL→] Starting sync TO Google Calendar | user={} calendar={}",
        user_id, calendar_id
    );
    // Get user's access token
    let token = token_manager::get_valid_token(&graph, user_id)
        .await
        .map_err(|e| (StatusCode::UNAUTHORIZED, e))?;

    eprintln!("🔑 [GCAL→] Obtained access token for user {}", user_id);

    // Get all events that should be synced to Google Calendar
    let events_query = format!(
        "MATCH (g:Goal)
         WHERE g.user_id = $user_id
         AND g.goal_type = 'event'
         AND g.gcal_sync_enabled = true
         AND (g.gcal_sync_direction = 'to_gcal' OR g.gcal_sync_direction = 'bidirectional')
         AND g.scheduled_timestamp IS NOT NULL
         {}
         ORDER BY g.scheduled_timestamp ASC",
        GOAL_RETURN_QUERY
    );

    let query_obj = query(&events_query).param("user_id", user_id);

    let mut result = graph.execute(query_obj).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to fetch events for sync: {}", e),
        )
    })?;

    let mut candidate_count: i32 = 0;
    let mut exported_events = 0;
    let mut updated_events = 0;
    let mut errors = Vec::new();

    eprintln!("🔎 [GCAL→] Evaluating local events eligible for export...");

    while let Some(row) = result.next().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error fetching event row: {}", e),
        )
    })? {
        let goal: Goal = row.get("g").map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error deserializing event: {}", e),
            )
        })?;

        candidate_count += 1;
        let scheduled_human = goal
            .scheduled_timestamp
            .and_then(|ts| chrono::DateTime::<Utc>::from_timestamp_millis(ts))
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_else(|| "<none>".to_string());

        eprintln!(
            "➡️  [GCAL→] Candidate #{}/? | id={:?} name='{}' scheduled={} duration={:?} gcal_event_id={:?} sync_enabled={:?} direction={:?} imported={:?}",
            candidate_count,
            goal.id,
            goal.name,
            scheduled_human,
            goal.duration,
            goal.gcal_event_id,
            goal.gcal_sync_enabled,
            goal.gcal_sync_direction,
            goal.is_gcal_imported,
        );

        if let Some(gcal_event_id) = &goal.gcal_event_id {
            // Update existing Google Calendar event
            eprintln!(
                "✏️  [GCAL→] Updating existing GCal event id={} for goal id={:?} ('{}')",
                gcal_event_id, goal.id, goal.name
            );
            match update_event(&token, calendar_id, gcal_event_id, &goal).await {
                Ok(_) => {
                    updated_events += 1;
                    // Update sync timestamp
                    let update_sync_query =
                        query("MATCH (g:Goal) WHERE id(g) = $id SET g.gcal_last_sync = $sync_time")
                            .param("id", goal.id.unwrap_or(0))
                            .param("sync_time", Utc::now().timestamp_millis());

                    let _ = graph.run(update_sync_query).await;
                    eprintln!(
                        "✅ [GCAL→] Updated GCal event id={} for goal id={:?}",
                        gcal_event_id, goal.id
                    );
                }
                Err(e) => {
                    errors.push(format!("Failed to update event {}: {}", goal.name, e));
                    eprintln!(
                        "❌ [GCAL→] Failed to update goal id={:?} ('{}'): {}",
                        goal.id, goal.name, e
                    );
                }
            }
        } else {
            // Create new Google Calendar event
            eprintln!(
                "➕ [GCAL→] Creating new GCal event for goal id={:?} ('{}')",
                goal.id, goal.name
            );
            match create_event(&token, calendar_id, &goal).await {
                Ok(gcal_event_id) => {
                    exported_events += 1;
                    // Update goal with Google Calendar event ID and sync timestamp
                    let created_id_for_log = gcal_event_id.clone();
                    let update_query = query(
                        "MATCH (g:Goal) WHERE id(g) = $id 
                         SET g.gcal_event_id = $gcal_event_id,
                             g.gcal_calendar_id = $gcal_calendar_id,
                             g.gcal_last_sync = $sync_time",
                    )
                    .param("id", goal.id.unwrap_or(0))
                    .param("gcal_event_id", gcal_event_id)
                    .param("gcal_calendar_id", calendar_id)
                    .param("sync_time", Utc::now().timestamp_millis());

                    let _ = graph.run(update_query).await;
                    eprintln!(
                        "✅ [GCAL→] Created GCal event id={} for goal id={:?}",
                        created_id_for_log, goal.id
                    );
                }
                Err(e) => {
                    errors.push(format!("Failed to create event {}: {}", goal.name, e));
                    eprintln!(
                        "❌ [GCAL→] Failed to create GCal event for goal id={:?} ('{}'): {}",
                        goal.id, goal.name, e
                    );
                }
            }
        }
    }

    if candidate_count == 0 {
        eprintln!(
            "ℹ️  [GCAL→] No eligible local events found to export (check gcal_sync_enabled, direction, and scheduled time)"
        );
    }

    eprintln!(
        "📊 [GCAL→] Sync summary | candidates={} exported={} updated={} errors={}",
        candidate_count,
        exported_events,
        updated_events,
        errors.len()
    );

    Ok(Json(SyncResult {
        imported_events: 0,
        exported_events,
        updated_events,
        errors,
    }))
}

/// Delete a Google Calendar event
pub async fn delete_gcal_event_handler(
    graph: Graph,
    user_id: i64,
    goal_id: i64,
) -> Result<StatusCode, (StatusCode, String)> {
    // Get user's access token
    let token = token_manager::get_valid_token(&graph, user_id)
        .await
        .map_err(|e| (StatusCode::UNAUTHORIZED, e))?;

    // Fetch the goal to get the calendar_id and event_id
    let get_goal_query = query(
        "MATCH (g:Goal) WHERE id(g) = $id 
         RETURN g.gcal_calendar_id, g.gcal_event_id",
    )
    .param("id", goal_id);

    let mut result = graph.execute(get_goal_query).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )
    })?;

    if let Some(row) = result.next().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )
    })? {
        let calendar_id: Option<String> = row.get("g.gcal_calendar_id").ok();
        let event_id: Option<String> = row.get("g.gcal_event_id").ok();

        if let (Some(calendar_id), Some(event_id)) = (calendar_id, event_id) {
            // Delete the event from Google Calendar
            delete_event(&token, &calendar_id, &event_id)
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to delete Google Calendar event: {}", e),
                    )
                })?;

            // Remove GCal-related properties from the goal node
            let update_goal_query = query(
                "MATCH (g:Goal) WHERE id(g) = $id 
                 REMOVE g.gcal_event_id, g.gcal_calendar_id, g.gcal_sync_enabled, 
                        g.gcal_last_sync, g.is_gcal_imported, g.gcal_sync_direction",
            )
            .param("id", goal_id);

            graph.run(update_goal_query).await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to update goal after deletion: {}", e),
                )
            })?;
        }
    }

    Ok(StatusCode::NO_CONTENT)
}
