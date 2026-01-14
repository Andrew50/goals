use neo4rs::{query, Graph};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotificationSettings {
    pub notifications_enabled: bool,
    pub notify_via_push: bool,
    pub notify_via_telegram: bool,
    pub notify_high_priority_events: bool,
    pub notify_event_reminders: bool,
    pub reminder_offsets_minutes: Vec<i64>,
}

impl Default for NotificationSettings {
    fn default() -> Self {
        Self {
            notifications_enabled: true,
            notify_via_push: true,
            notify_via_telegram: true,
            notify_high_priority_events: true,
            notify_event_reminders: true,
            reminder_offsets_minutes: vec![15, 60, 1440],
        }
    }
}

pub async fn get_notification_settings(graph: &Graph, user_id: i64) -> Result<NotificationSettings, String> {
    let query_str = "
        MATCH (u:User)
        WHERE id(u) = $user_id
        RETURN 
            COALESCE(u.notifications_enabled, true) as notifications_enabled,
            COALESCE(u.notify_via_push, true) as notify_via_push,
            COALESCE(u.notify_via_telegram, true) as notify_via_telegram,
            COALESCE(u.notify_high_priority_events, true) as notify_high_priority_events,
            COALESCE(u.notify_event_reminders, true) as notify_event_reminders,
            COALESCE(u.reminder_offsets_minutes, [15, 60, 1440]) as reminder_offsets_minutes
    ";

    let mut result = graph
        .execute(query(query_str).param("user_id", user_id))
        .await
        .map_err(|e| format!("Failed to get notification settings: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        Ok(NotificationSettings {
            notifications_enabled: row.get("notifications_enabled").unwrap_or(true),
            notify_via_push: row.get("notify_via_push").unwrap_or(true),
            notify_via_telegram: row.get("notify_via_telegram").unwrap_or(true),
            notify_high_priority_events: row.get("notify_high_priority_events").unwrap_or(true),
            notify_event_reminders: row.get("notify_event_reminders").unwrap_or(true),
            reminder_offsets_minutes: row.get("reminder_offsets_minutes").unwrap_or_else(|_| vec![15, 60, 1440]),
        })
    } else {
        Err("User not found".to_string())
    }
}

pub async fn update_notification_settings(
    graph: &Graph,
    user_id: i64,
    settings: NotificationSettings,
) -> Result<(), String> {
    let query_str = "
        MATCH (u:User)
        WHERE id(u) = $user_id
        SET u.notifications_enabled = $notifications_enabled,
            u.notify_via_push = $notify_via_push,
            u.notify_via_telegram = $notify_via_telegram,
            u.notify_high_priority_events = $notify_high_priority_events,
            u.notify_event_reminders = $notify_event_reminders,
            u.reminder_offsets_minutes = $reminder_offsets_minutes
        RETURN u
    ";

    graph
        .run(
            query(query_str)
                .param("user_id", user_id)
                .param("notifications_enabled", settings.notifications_enabled)
                .param("notify_via_push", settings.notify_via_push)
                .param("notify_via_telegram", settings.notify_via_telegram)
                .param("notify_high_priority_events", settings.notify_high_priority_events)
                .param("notify_event_reminders", settings.notify_event_reminders)
                .param("reminder_offsets_minutes", settings.reminder_offsets_minutes),
        )
        .await
        .map_err(|e| format!("Failed to update notification settings: {}", e))?;

    Ok(())
}

