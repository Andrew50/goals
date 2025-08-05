use axum::{http::StatusCode, Json};
use chrono::{DateTime, Utc};
use google_calendar3::{
    api::{Event, EventDateTime},
    hyper, hyper_rustls, CalendarHub,
};
use neo4rs::{query, Graph};
use serde::{Deserialize, Serialize};
use yup_oauth2::{ServiceAccountAuthenticator, ServiceAccountKey};

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
    pub calendar_id: String,
}

#[derive(Debug, Serialize)]
pub struct SyncResult {
    pub imported_events: i32,
    pub exported_events: i32,
    pub updated_events: i32,
    pub errors: Vec<String>,
}

pub struct GCalService {
    hub: CalendarHub<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>,
}

impl GCalService {
    pub async fn new(
        service_account_key: ServiceAccountKey,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let auth = ServiceAccountAuthenticator::builder(service_account_key)
            .build()
            .await?;

        let hub = CalendarHub::new(
            hyper::Client::builder().build(
                hyper_rustls::HttpsConnectorBuilder::new()
                    .with_native_roots()?
                    .https_or_http()
                    .enable_http1()
                    .enable_http2()
                    .build(),
            ),
            auth,
        );

        Ok(Self { hub })
    }

    // Fetch events from Google Calendar
    pub async fn fetch_events(
        &self,
        calendar_id: &str,
        time_min: DateTime<Utc>,
        time_max: DateTime<Utc>,
    ) -> Result<Vec<GCalEvent>, Box<dyn std::error::Error + Send + Sync>> {
        let result = self
            .hub
            .events()
            .list(calendar_id)
            .time_min(time_min)
            .time_max(time_max)
            .single_events(true)
            .order_by("startTime")
            .doit()
            .await?;

        let events = result
            .1
            .items
            .unwrap_or_default()
            .into_iter()
            .filter_map(|event| {
                let id = event.id?;
                let summary = event.summary.unwrap_or_default();
                let start = event.start?;
                let end = event.end?;

                Some(GCalEvent {
                    id,
                    summary,
                    description: event.description,
                    start,
                    end,
                    calendar_id: calendar_id.to_string(),
                })
            })
            .collect();

        Ok(events)
    }

    // Create an event in Google Calendar
    pub async fn create_event(
        &self,
        calendar_id: &str,
        goal: &Goal,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let start_time = goal
            .scheduled_timestamp
            .ok_or("Goal must have a scheduled timestamp")?;
        let duration_minutes = goal.duration.unwrap_or(60);
        let start_dt = DateTime::from_timestamp_millis(start_time).unwrap();
        let end_time = start_time + (duration_minutes as i64 * 60 * 1000);

        let start_datetime = if goal.duration == Some(1440) {
            // All-day event
            EventDateTime {
                date: Some(start_dt.date_naive()),
                date_time: None,
                time_zone: None,
            }
        } else {
            EventDateTime {
                date: None,
                date_time: Some(start_dt),
                time_zone: Some("UTC".to_string()),
            }
        };

        let end_datetime = if goal.duration == Some(1440) {
            // All-day event
            let end_date = DateTime::from_timestamp_millis(end_time).unwrap();
            EventDateTime {
                date: Some(end_date.date_naive()),
                date_time: None,
                time_zone: None,
            }
        } else {
            EventDateTime {
                date: None,
                date_time: Some(DateTime::from_timestamp_millis(end_time).unwrap()),
                time_zone: Some("UTC".to_string()),
            }
        };

        let event = Event {
            summary: Some(goal.name.clone()),
            description: goal.description.clone(),
            start: Some(start_datetime),
            end: Some(end_datetime),
            ..Default::default()
        };

        let result = self.hub.events().insert(event, calendar_id).doit().await?;

        Ok(result.1.id.unwrap_or_default())
    }

    // Update an event in Google Calendar
    pub async fn update_event(
        &self,
        calendar_id: &str,
        event_id: &str,
        goal: &Goal,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let start_time = goal
            .scheduled_timestamp
            .ok_or("Goal must have a scheduled timestamp")?;
        let duration_minutes = goal.duration.unwrap_or(60);
        let start_dt = DateTime::from_timestamp_millis(start_time).unwrap();
        let end_time = start_time + (duration_minutes as i64 * 60 * 1000);

        let start_datetime = if goal.duration == Some(1440) {
            EventDateTime {
                date: Some(start_dt.date_naive()),
                date_time: None,
                time_zone: None,
            }
        } else {
            EventDateTime {
                date: None,
                date_time: Some(start_dt),
                time_zone: Some("UTC".to_string()),
            }
        };

        let end_datetime = if goal.duration == Some(1440) {
            let end_date = DateTime::from_timestamp_millis(end_time).unwrap();
            EventDateTime {
                date: Some(end_date.date_naive()),
                date_time: None,
                time_zone: None,
            }
        } else {
            EventDateTime {
                date: None,
                date_time: Some(DateTime::from_timestamp_millis(end_time).unwrap()),
                time_zone: Some("UTC".to_string()),
            }
        };

        let event = Event {
            summary: Some(goal.name.clone()),
            description: goal.description.clone(),
            start: Some(start_datetime),
            end: Some(end_datetime),
            ..Default::default()
        };

        self.hub
            .events()
            .update(event, calendar_id, event_id)
            .doit()
            .await?;

        Ok(())
    }

    // Delete an event from Google Calendar
    pub async fn delete_event(
        &self,
        calendar_id: &str,
        event_id: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.hub
            .events()
            .delete(calendar_id, event_id)
            .doit()
            .await?;

        Ok(())
    }
}

// Sync events from Google Calendar to the local database
pub async fn sync_from_gcal(
    graph: Graph,
    user_id: i64,
    gcal_service: &GCalService,
    calendar_id: &str,
) -> Result<Json<SyncResult>, (StatusCode, String)> {
    let now = Utc::now();
    let time_min = now - chrono::Duration::days(30);
    let time_max = now + chrono::Duration::days(60);

    let gcal_events = gcal_service
        .fetch_events(calendar_id, time_min, time_max)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch Google Calendar events: {}", e),
            )
        })?;

    let mut imported_events = 0;
    let mut updated_events = 0;
    let mut errors = Vec::new();

    for gcal_event in gcal_events {
        // Check if this event already exists in our database
        let existing_query = query(
            "MATCH (g:Goal) 
             WHERE g.user_id = $user_id 
             AND g.gcal_event_id = $gcal_event_id 
             AND g.gcal_calendar_id = $gcal_calendar_id
             RETURN g",
        )
        .param("user_id", user_id)
        .param("gcal_event_id", gcal_event.id.clone())
        .param("gcal_calendar_id", gcal_event.calendar_id.clone());

        let mut existing_result = graph.execute(existing_query).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {}", e),
            )
        })?;

        let start_timestamp = match &gcal_event.start {
            event_datetime if event_datetime.date.is_some() => {
                // All-day event
                let date = event_datetime.date.as_ref().unwrap();
                date.and_hms_opt(0, 0, 0)
                    .unwrap()
                    .and_utc()
                    .timestamp_millis()
            }
            event_datetime if event_datetime.date_time.is_some() => event_datetime
                .date_time
                .as_ref()
                .unwrap()
                .timestamp_millis(),
            _ => {
                errors.push(format!("Invalid start time for event {}", gcal_event.id));
                continue;
            }
        };

        let end_timestamp = match &gcal_event.end {
            event_datetime if event_datetime.date.is_some() => {
                let date = event_datetime.date.as_ref().unwrap();
                date.and_hms_opt(23, 59, 59)
                    .unwrap()
                    .and_utc()
                    .timestamp_millis()
            }
            event_datetime if event_datetime.date_time.is_some() => event_datetime
                .date_time
                .as_ref()
                .unwrap()
                .timestamp_millis(),
            _ => {
                errors.push(format!("Invalid end time for event {}", gcal_event.id));
                continue;
            }
        };

        let duration = if gcal_event.start.date.is_some() {
            1440 // All-day event
        } else {
            ((end_timestamp - start_timestamp) / (60 * 1000)) as i32
        };

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
                gcal_calendar_id: Some(gcal_event.calendar_id),
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

    Ok(Json(SyncResult {
        imported_events,
        exported_events: 0,
        updated_events,
        errors,
    }))
}

// Sync events from local database to Google Calendar
pub async fn sync_to_gcal(
    graph: Graph,
    user_id: i64,
    gcal_service: &GCalService,
    calendar_id: &str,
) -> Result<Json<SyncResult>, (StatusCode, String)> {
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

    let mut exported_events = 0;
    let mut updated_events = 0;
    let mut errors = Vec::new();

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

        if let Some(gcal_event_id) = &goal.gcal_event_id {
            // Update existing Google Calendar event
            match gcal_service
                .update_event(calendar_id, gcal_event_id, &goal)
                .await
            {
                Ok(_) => {
                    updated_events += 1;
                    // Update sync timestamp
                    let update_sync_query =
                        query("MATCH (g:Goal) WHERE id(g) = $id SET g.gcal_last_sync = $sync_time")
                            .param("id", goal.id.unwrap_or(0))
                            .param("sync_time", Utc::now().timestamp_millis());

                    let _ = graph.run(update_sync_query).await;
                }
                Err(e) => {
                    errors.push(format!("Failed to update event {}: {}", goal.name, e));
                }
            }
        } else {
            // Create new Google Calendar event
            match gcal_service.create_event(calendar_id, &goal).await {
                Ok(gcal_event_id) => {
                    exported_events += 1;
                    // Update goal with Google Calendar event ID and sync timestamp
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
                }
                Err(e) => {
                    errors.push(format!("Failed to create event {}: {}", goal.name, e));
                }
            }
        }
    }

    Ok(Json(SyncResult {
        imported_events: 0,
        exported_events,
        updated_events,
        errors,
    }))
}

pub async fn delete_gcal_event_handler(
    graph: Graph,
    gcal_service: &GCalService,
    goal_id: i64,
) -> Result<StatusCode, (StatusCode, String)> {
    // Fetch the goal to get the calendar_id and event_id
    let get_goal_query = query("MATCH (g:Goal) WHERE id(g) = $id RETURN g.gcal_calendar_id, g.gcal_event_id")
        .param("id", goal_id);

    let mut result = graph.execute(get_goal_query).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))?;

    if let Some(row) = result.next().await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)))? {
        let calendar_id: Option<String> = row.get("g.gcal_calendar_id").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to parse calendar_id: {}", e)))?;
        let event_id: Option<String> = row.get("g.gcal_event_id").map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to parse event_id: {}", e)))?;

        if let (Some(calendar_id), Some(event_id)) = (calendar_id, event_id) {
            // Delete the event from Google Calendar
            gcal_service.delete_event(&calendar_id, &event_id).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to delete Google Calendar event: {}", e)))?;

            // Remove GCal-related properties from the goal node
            let update_goal_query = query("MATCH (g:Goal) WHERE id(g) = $id REMOVE g.gcal_event_id, g.gcal_calendar_id, g.gcal_sync_enabled, g.gcal_last_sync, g.is_gcal_imported, g.gcal_sync_direction")
                .param("id", goal_id);

            graph.run(update_goal_query).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to update goal after deletion: {}", e)))?;
        }
    }

    Ok(StatusCode::NO_CONTENT)
}
