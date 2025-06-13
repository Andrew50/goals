use axum::{http::StatusCode, Json};
use chrono::{DateTime, TimeZone, Utc};
use google_calendar3::{
    api::{Event, EventDateTime},
    hyper, hyper_rustls, CalendarHub,
};
use neo4rs::{query, Graph};
use serde::{Deserialize, Serialize};
use yup_oauth2::{ServiceAccountAuthenticator, ServiceAccountKey};

use crate::tools::goal::{Goal, GoalType};

#[derive(Debug, Serialize, Deserialize)]
pub struct GCalSyncRequest {
    pub calendar_id: String,
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

#[derive(Debug, Serialize, Deserialize)]
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
        let end_time = start_time + (duration_minutes as i64 * 60 * 1000);

        let start_datetime = if goal.duration == Some(1440) {
            // All-day event
            EventDateTime {
                date: Utc
                    .timestamp_millis_opt(start_time)
                    .single()
                    .map(|dt| dt.date_naive()),
                date_time: None,
                time_zone: None,
                ..Default::default()
            }
        } else {
            EventDateTime {
                date: None,
                date_time: Utc.timestamp_millis_opt(start_time).single(),
                time_zone: Some("UTC".to_string()),
                ..Default::default()
            }
        };

        let end_datetime = if goal.duration == Some(1440) {
            // All-day event
            EventDateTime {
                date: Utc
                    .timestamp_millis_opt(end_time)
                    .single()
                    .map(|dt| dt.date_naive()),
                date_time: None,
                time_zone: None,
                ..Default::default()
            }
        } else {
            EventDateTime {
                date: None,
                date_time: Utc.timestamp_millis_opt(end_time).single(),
                time_zone: Some("UTC".to_string()),
                ..Default::default()
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
        let end_time = start_time + (duration_minutes as i64 * 60 * 1000);

        let start_datetime = if goal.duration == Some(1440) {
            EventDateTime {
                date: Utc
                    .timestamp_millis_opt(start_time)
                    .single()
                    .map(|dt| dt.date_naive()),
                date_time: None,
                time_zone: None,
                ..Default::default()
            }
        } else {
            EventDateTime {
                date: None,
                date_time: Utc.timestamp_millis_opt(start_time).single(),
                time_zone: Some("UTC".to_string()),
                ..Default::default()
            }
        };

        let end_datetime = if goal.duration == Some(1440) {
            EventDateTime {
                date: Utc
                    .timestamp_millis_opt(end_time)
                    .single()
                    .map(|dt| dt.date_naive()),
                date_time: None,
                time_zone: None,
                ..Default::default()
            }
        } else {
            EventDateTime {
                date: None,
                date_time: Utc.timestamp_millis_opt(end_time).single(),
                time_zone: Some("UTC".to_string()),
                ..Default::default()
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

    // Delete an event in Google Calendar
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

pub async fn sync_from_gcal(
    graph: Graph,
    user_id: i64,
    gcal_service: &GCalService,
    calendar_id: &str,
) -> Result<Json<SyncResult>, (StatusCode, String)> {
    let mut result = SyncResult {
        imported_events: 0,
        exported_events: 0,
        updated_events: 0,
        errors: vec![],
    };

    let time_min = Utc::now() - chrono::Duration::days(30);
    let time_max = Utc::now() + chrono::Duration::days(30);

    let gcal_events = match gcal_service
        .fetch_events(calendar_id, time_min, time_max)
        .await
    {
        Ok(events) => events,
        Err(e) => {
            result
                .errors
                .push(format!("Failed to fetch GCal events: {}", e));
            return Ok(Json(result));
        }
    };

    for gcal_event in gcal_events {
        let mut row = match graph
            .execute(
                query("MATCH (g:Goal) WHERE g.user_id = $user_id AND g.gcal_event_id = $gcal_event_id AND g.gcal_calendar_id = $gcal_calendar_id RETURN g")
                    .param("user_id", user_id)
                    .param("gcal_event_id", gcal_event.id.clone())
                    .param("gcal_calendar_id", gcal_event.calendar_id.clone()),
            )
            .await
        {
            Ok(row) => row,
            Err(e) => {
                result.errors.push(format!("DB error checking for event {}: {}", gcal_event.id, e));
                continue;
            }
        };

        let start_timestamp_res = gcal_event
            .start
            .date_time
            .map(|dt| dt.timestamp_millis())
            .or_else(|| {
                gcal_event.start.date.map(|d| {
                    d.and_hms_opt(0, 0, 0)
                        .unwrap()
                        .and_local_timezone(Utc)
                        .unwrap()
                        .timestamp_millis()
                })
            });

        if start_timestamp_res.is_none() {
            result
                .errors
                .push(format!("Invalid start time for event {}", gcal_event.id));
            continue;
        }
        let start_timestamp = start_timestamp_res.unwrap();

        let end_timestamp_res = gcal_event
            .end
            .date_time
            .map(|dt| dt.timestamp_millis())
            .or_else(|| {
                gcal_event.end.date.map(|d| {
                    d.and_hms_opt(0, 0, 0)
                        .unwrap()
                        .and_local_timezone(Utc)
                        .unwrap()
                        .timestamp_millis()
                })
            });

        if end_timestamp_res.is_none() {
            result
                .errors
                .push(format!("Invalid end time for event {}", gcal_event.id));
            continue;
        }
        let end_timestamp = end_timestamp_res.unwrap();

        let duration = if gcal_event.start.date.is_some() {
            1440
        } else {
            ((end_timestamp - start_timestamp) / 60000) as i32
        };

        if let Ok(Some(existing_goal_row)) = row.next().await {
            let mut existing_goal: Goal = existing_goal_row.get("g").unwrap();

            let local_last_sync = existing_goal.gcal_last_sync.unwrap_or(0);
            let gcal_last_updated = gcal_event
                .start
                .date_time
                .map(|dt| dt.timestamp_millis())
                .unwrap_or(0);

            if gcal_last_updated > local_last_sync {
                existing_goal.name = gcal_event.summary;
                existing_goal.description = gcal_event.description;
                existing_goal.scheduled_timestamp = Some(start_timestamp);
                existing_goal.duration = Some(duration);
                existing_goal.gcal_last_sync = Some(Utc::now().timestamp_millis());

                if let Err(e) = crate::tools::goal::update_goal_handler(
                    graph.clone(),
                    existing_goal.id.unwrap(),
                    existing_goal,
                )
                .await
                {
                    result
                        .errors
                        .push(format!("Failed to update event {}: {:?}", gcal_event.id, e));
                } else {
                    result.updated_events += 1;
                }
            }
        } else {
            // Create new event
            let new_goal = Goal {
                name: gcal_event.summary,
                description: gcal_event.description,
                goal_type: GoalType::Event,
                user_id: Some(user_id),
                scheduled_timestamp: Some(start_timestamp),
                duration: Some(duration),
                gcal_event_id: Some(gcal_event.id.clone()),
                gcal_calendar_id: Some(gcal_event.calendar_id.clone()),
                gcal_sync_enabled: Some(true),
                gcal_sync_direction: Some("from_gcal".to_string()),
                is_gcal_imported: Some(true),
                gcal_last_sync: Some(Utc::now().timestamp_millis()),
                ..Default::default()
            };

            if let Err(e) =
                crate::tools::goal::create_goal_handler(graph.clone(), user_id, new_goal).await
            {
                result
                    .errors
                    .push(format!("Failed to import event {}: {:?}", gcal_event.id, e));
            } else {
                result.imported_events += 1;
            }
        }
    }

    Ok(Json(result))
}

pub async fn sync_to_gcal(
    graph: Graph,
    user_id: i64,
    gcal_service: &GCalService,
    calendar_id: &str,
) -> Result<Json<SyncResult>, (StatusCode, String)> {
    let mut result = SyncResult {
        imported_events: 0,
        exported_events: 0,
        updated_events: 0,
        errors: vec![],
    };

    let mut row = match graph
        .execute(
            query("MATCH (g:Goal) WHERE g.user_id = $user_id AND g.goal_type = 'event' AND g.gcal_sync_enabled = true AND (g.gcal_sync_direction = 'to_gcal' OR g.gcal_sync_direction = 'bidirectional') RETURN g")
                .param("user_id", user_id),
        )
        .await
    {
        Ok(row) => row,
        Err(e) => {
            result.errors.push(format!("DB error fetching local events: {}", e));
            return Ok(Json(result));
        }
    };

    while let Ok(Some(r)) = row.next().await {
        let goal: Goal = r.get("g").unwrap();
        let sync_time = Utc::now().timestamp_millis();

        if let Some(gcal_event_id) = &goal.gcal_event_id {
            if goal.gcal_last_sync.unwrap_or(0) < goal.scheduled_timestamp.unwrap_or(sync_time) {
                match gcal_service
                    .update_event(calendar_id, gcal_event_id, &goal)
                    .await
                {
                    Ok(_) => {
                        result.updated_events += 1;
                        let _ = graph.run(query("MATCH (g:Goal) WHERE id(g) = $id SET g.gcal_last_sync = $sync_time").param("id", goal.id.unwrap()).param("sync_time", sync_time)).await;
                    }
                    Err(e) => result.errors.push(format!(
                        "Failed to update event {} to GCal: {}",
                        goal.id.unwrap(),
                        e
                    )),
                }
            }
        } else {
            match gcal_service.create_event(calendar_id, &goal).await {
                Ok(gcal_event_id) => {
                    result.exported_events += 1;
                    let _ = graph.run(
                        query("MATCH (g:Goal) WHERE id(g) = $id SET g.gcal_event_id = $gcal_event_id, g.gcal_calendar_id = $gcal_calendar_id, g.gcal_last_sync = $sync_time")
                        .param("id", goal.id.unwrap())
                        .param("gcal_event_id", gcal_event_id)
                        .param("gcal_calendar_id", calendar_id.to_string())
                        .param("sync_time", sync_time)
                    ).await;
                }
                Err(e) => result.errors.push(format!(
                    "Failed to create event {} in GCal: {}",
                    goal.id.unwrap(),
                    e
                )),
            }
        }
    }

    Ok(Json(result))
}
