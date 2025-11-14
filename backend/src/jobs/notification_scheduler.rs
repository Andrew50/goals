use chrono::Utc;
use neo4rs::{query, Graph};
use crate::tools::push;

/// Check for upcoming high priority events and send notifications
pub async fn check_and_send_event_notifications(graph: &Graph) -> Result<(), String> {
    let now = Utc::now().timestamp_millis();
    
    // Look for high priority events starting in the next 15 minutes
    // that haven't been notified yet
    let fifteen_minutes = 15 * 60 * 1000; // 15 minutes in milliseconds
    let check_window_start = now;
    let check_window_end = now + fifteen_minutes;
    
    let query_str = "
        MATCH (u:User)-[:OWNS]->(g:Goal)
        WHERE g.goal_type = 'event'
        AND g.priority = 'high'
        AND g.scheduled_timestamp >= $window_start
        AND g.scheduled_timestamp <= $window_end
        AND (g.notification_sent IS NULL OR g.notification_sent = false)
        AND (g.is_deleted IS NULL OR g.is_deleted = false)
        AND (g.completed IS NULL OR g.completed = false)
        RETURN g, id(g) as event_id, u.user_id as user_id, id(u) as user_node_id
    ";
    
    let mut result = graph
        .execute(
            query(query_str)
                .param("window_start", check_window_start)
                .param("window_end", check_window_end)
        )
        .await
        .map_err(|e| format!("Failed to query upcoming events: {}", e))?;
    
    let mut notification_count = 0;
    let mut failed_count = 0;
    
    while let Some(row) = result
        .next()
        .await
        .map_err(|e| format!("Error fetching row: {}", e))?
    {
        let event_id: i64 = row.get("event_id").map_err(|e| format!("Failed to get event_id: {}", e))?;
        let user_node_id: i64 = row.get("user_node_id").map_err(|e| format!("Failed to get user_node_id: {}", e))?;
        
        // Get event details
        let event_name: String = row.get::<neo4rs::Node>("g")
            .ok()
            .and_then(|node| node.get::<String>("name").ok())
            .unwrap_or_else(|| "Event".to_string());
            
        let _event_description: Option<String> = row.get::<neo4rs::Node>("g")
            .ok()
            .and_then(|node| node.get::<String>("description").ok());
            
        let scheduled_timestamp: i64 = row.get::<neo4rs::Node>("g")
            .ok()
            .and_then(|node| node.get::<i64>("scheduled_timestamp").ok())
            .unwrap_or(now);
        
        // Calculate time until event
        let minutes_until = (scheduled_timestamp - now) / 60000;
        
        // Create notification payload
        let notification_body = if minutes_until <= 1 {
            format!("High priority: '{}' is starting now!", event_name)
        } else {
            format!("High priority: '{}' starts in {} minutes", event_name, minutes_until)
        };
        
        let payload = push::PushPayload {
            title: "⚡ High Priority Event".to_string(),
            body: notification_body,
            icon: Some("/logo192.png".to_string()),
            badge: Some("/logo192.png".to_string()),
            tag: Some(format!("event-{}", event_id)),
            data: Some(serde_json::json!({
                "url": format!("/calendar?event={}", event_id),
                "event_id": event_id,
                "event_name": event_name,
                "event_time": scheduled_timestamp,
                "type": "high_priority_event",
                "priority": "high"
            })),
            actions: Some(vec![
                push::NotificationAction {
                    action: "view".to_string(),
                    title: "View Event".to_string(),
                    icon: None,
                },
                push::NotificationAction {
                    action: "snooze".to_string(),
                    title: "Snooze 5 min".to_string(),
                    icon: None,
                },
            ]),
            require_interaction: Some(true), // High priority events require interaction
            renotify: Some(true),
            silent: Some(false),
            timestamp: Some(scheduled_timestamp),
        };
        
        // Send notification
        match push::send_notification_to_user(graph, user_node_id, &payload).await {
            Ok(_) => {
                notification_count += 1;
                println!(
                    "✅ [NOTIFICATION] Sent high priority notification for event '{}' (ID: {}) to user {}",
                    event_name, event_id, user_node_id
                );
                
                // Mark event as notified
                let mark_notified_query = query(
                    "MATCH (g:Goal)
                     WHERE id(g) = $event_id
                     SET g.notification_sent = true,
                         g.notification_sent_at = $sent_at
                     RETURN g"
                )
                .param("event_id", event_id)
                .param("sent_at", now);
                
                if let Err(e) = graph.run(mark_notified_query).await {
                    eprintln!("⚠️ [NOTIFICATION] Failed to mark event {} as notified: {}", event_id, e);
                }
            }
            Err(e) => {
                failed_count += 1;
                eprintln!(
                    "❌ [NOTIFICATION] Failed to send notification for event '{}' (ID: {}): {}",
                    event_name, event_id, e
                );
            }
        }
    }
    
    if notification_count > 0 || failed_count > 0 {
        println!(
            "📊 [NOTIFICATION] High priority event check complete: {} sent, {} failed",
            notification_count, failed_count
        );
    }
    
    Ok(())
}

/// Check for events that need reminder notifications (any priority)
pub async fn check_and_send_reminder_notifications(graph: &Graph) -> Result<(), String> {
    let now = Utc::now().timestamp_millis();
    
    // Look for events with reminders set
    // This could be expanded to support custom reminder times
    let reminder_windows = vec![
        (15 * 60 * 1000, "15 minutes"),  // 15 minutes before
        (60 * 60 * 1000, "1 hour"),       // 1 hour before
        (24 * 60 * 60 * 1000, "1 day"),   // 1 day before
    ];
    
    for (reminder_offset, reminder_text) in reminder_windows {
        let check_time = now + reminder_offset;
        
        let query_str = "
            MATCH (u:User)-[:OWNS]->(g:Goal)
            WHERE g.goal_type = 'event'
            AND g.scheduled_timestamp >= $check_start
            AND g.scheduled_timestamp < $check_end
            AND (g.reminder_sent IS NULL OR NOT $reminder_key IN g.reminder_sent)
            AND (g.is_deleted IS NULL OR g.is_deleted = false)
            AND (g.completed IS NULL OR g.completed = false)
            AND g.send_reminders = true
            RETURN g, id(g) as event_id, id(u) as user_id
        ";
        
        let reminder_key = format!("reminder_{}", reminder_offset);
        
        let mut result = graph
            .execute(
                query(query_str)
                    .param("check_start", check_time - 60000) // 1 minute window
                    .param("check_end", check_time + 60000)
                    .param("reminder_key", reminder_key.clone())
            )
            .await
            .map_err(|e| format!("Failed to query events for reminders: {}", e))?;
        
        while let Some(row) = result.next().await.map_err(|e| e.to_string())? {
            let event_id: i64 = row.get("event_id").unwrap_or(0);
            let user_id: i64 = row.get("user_id").unwrap_or(0);
            
            let event_name: String = row.get::<neo4rs::Node>("g")
                .ok()
                .and_then(|node| node.get::<String>("name").ok())
                .unwrap_or_else(|| "Event".to_string());
            
            let priority: Option<String> = row.get::<neo4rs::Node>("g")
                .ok()
                .and_then(|node| node.get::<String>("priority").ok());
            
            let scheduled_timestamp: i64 = row.get::<neo4rs::Node>("g")
                .ok()
                .and_then(|node| node.get::<i64>("scheduled_timestamp").ok())
                .unwrap_or(now);
            
            // Send reminder notification
            let payload = push::PushPayload {
                title: format!("⏰ Reminder: {}", reminder_text),
                body: format!("'{}' is coming up", event_name),
                icon: Some("/logo192.png".to_string()),
                badge: Some("/logo192.png".to_string()),
                tag: Some(format!("reminder-{}-{}", event_id, reminder_offset)),
                data: Some(serde_json::json!({
                    "url": format!("/calendar?event={}", event_id),
                    "event_id": event_id,
                    "event_time": scheduled_timestamp,
                    "type": "event_reminder",
                    "reminder_type": reminder_text
                })),
                actions: Some(vec![
                    push::NotificationAction {
                        action: "view".to_string(),
                        title: "View Event".to_string(),
                        icon: None,
                    },
                ]),
                require_interaction: Some(priority == Some("high".to_string())),
                renotify: Some(false),
                silent: Some(false),
                timestamp: Some(now),
            };
            
            if push::send_notification_to_user(graph, user_id, &payload).await.is_ok() {
                // Mark this reminder as sent
                let mark_query = query(
                    "MATCH (g:Goal)
                     WHERE id(g) = $event_id
                     SET g.reminder_sent = COALESCE(g.reminder_sent, []) + $reminder_key
                     RETURN g"
                )
                .param("event_id", event_id)
                .param("reminder_key", reminder_key.clone());
                
                let _ = graph.run(mark_query).await;
                
                println!(
                    "📨 [REMINDER] Sent {} reminder for event '{}' to user {}",
                    reminder_text, event_name, user_id
                );
            }
        }
    }
    
    Ok(())
}

/// Run all notification checks
pub async fn run_notification_checks(graph: Graph) {
    println!("🔔 [NOTIFICATION] Starting notification check job...");
    
    // Check for high priority events starting soon
    if let Err(e) = check_and_send_event_notifications(&graph).await {
        eprintln!("❌ [NOTIFICATION] Error checking high priority events: {}", e);
    }
    
    // Check for events needing reminders
    if let Err(e) = check_and_send_reminder_notifications(&graph).await {
        eprintln!("❌ [NOTIFICATION] Error checking event reminders: {}", e);
    }
    
    println!("✅ [NOTIFICATION] Notification check job completed");
}
