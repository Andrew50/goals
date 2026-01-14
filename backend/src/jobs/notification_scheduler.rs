use chrono::Utc;
use neo4rs::{query, Graph};
use crate::tools::{push, telegram};

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
        AND (g.resolution_status IS NULL OR g.resolution_status = 'pending')
        // Honor user settings
        AND COALESCE(u.notifications_enabled, true) = true
        AND COALESCE(u.notify_high_priority_events, true) = true
        RETURN g, id(g) as event_id, u.user_id as user_id, id(u) as user_node_id, 
               u.telegram_chat_id as telegram_chat_id, u.telegram_bot_token as telegram_bot_token,
               COALESCE(u.notify_via_push, true) as notify_via_push,
               COALESCE(u.notify_via_telegram, true) as notify_via_telegram
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
        let telegram_chat_id: Option<String> = row.get("telegram_chat_id").ok();
        let telegram_bot_token: Option<String> = row.get("telegram_bot_token").ok();
        let notify_via_push: bool = row.get("notify_via_push").unwrap_or(true);
        let notify_via_telegram: bool = row.get("notify_via_telegram").unwrap_or(true);
        
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
            body: notification_body.clone(),
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
        let mut sent = false;
        
        // Try Push
        if notify_via_push {
            match push::send_notification_to_user(graph, user_node_id, &payload).await {
                Ok(_) => {
                    sent = true;
                    println!(
                        "✅ [NOTIFICATION] Sent high priority notification for event '{}' (ID: {}) to user {}",
                        event_name, event_id, user_node_id
                    );
                }
                Err(e) => {
                    eprintln!(
                        "❌ [NOTIFICATION] Failed to send push notification for event '{}' (ID: {}): {}",
                        event_name, event_id, e
                    );
                }
            }
        }

        // Try Telegram
        if notify_via_telegram {
            if let (Some(chat_id), Some(bot_token)) = (telegram_chat_id, telegram_bot_token) {
                let msg = format!("⚡ *High Priority Event*\n\n{}", notification_body);
                match telegram::send_telegram_message_with_token(&bot_token, &chat_id, &msg).await {
                    Ok(_) => {
                        sent = true;
                        println!(
                            "✅ [NOTIFICATION] Sent Telegram message for event '{}' (ID: {})",
                            event_name, event_id
                        );
                    }
                    Err(e) => {
                        eprintln!(
                            "❌ [NOTIFICATION] Failed to send Telegram message for event '{}' (ID: {}): {}",
                            event_name, event_id, e
                        );
                    }
                }
            }
        }
        
        if sent {
            notification_count += 1;
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
        } else {
            failed_count += 1;
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
    
    // Reminders logic:
    // 1. Find all users who have reminders enabled and their custom offsets.
    // 2. For each offset, find events due in that window that haven't had that reminder sent.
    
    let user_offsets_query = "
        MATCH (u:User)
        WHERE COALESCE(u.notifications_enabled, true) = true
        AND COALESCE(u.notify_event_reminders, true) = true
        RETURN id(u) as user_node_id, 
               COALESCE(u.reminder_offsets_minutes, [15, 60, 1440]) as offsets,
               u.telegram_chat_id as telegram_chat_id,
               u.telegram_bot_token as telegram_bot_token,
               COALESCE(u.notify_via_push, true) as notify_via_push,
               COALESCE(u.notify_via_telegram, true) as notify_via_telegram
    ";

    let mut user_results = graph.execute(query(user_offsets_query)).await.map_err(|e| e.to_string())?;

    while let Some(user_row) = user_results.next().await.map_err(|e| e.to_string())? {
        let user_node_id: i64 = user_row.get("user_node_id").unwrap();
        let offsets: Vec<i64> = user_row.get("offsets").unwrap_or_else(|_| vec![15, 60, 1440]);
        let telegram_chat_id: Option<String> = user_row.get("telegram_chat_id").ok();
        let telegram_bot_token: Option<String> = user_row.get("telegram_bot_token").ok();
        let notify_via_push: bool = user_row.get("notify_via_push").unwrap_or(true);
        let notify_via_telegram: bool = user_row.get("notify_via_telegram").unwrap_or(true);

        for offset_min in offsets {
            let reminder_offset = offset_min * 60 * 1000;
            let reminder_text = if offset_min >= 1440 {
                format!("{} day(s)", offset_min / 1440)
            } else if offset_min >= 60 {
                format!("{} hour(s)", offset_min / 60)
            } else {
                format!("{} minutes", offset_min)
            };

            let check_time = now + reminder_offset;
            let reminder_key = format!("reminder_{}", reminder_offset);

            let event_query = "
                MATCH (u:User)-[:OWNS]->(g:Goal)
                WHERE id(u) = $user_node_id
                AND g.goal_type = 'event'
                AND g.scheduled_timestamp >= $check_start
                AND g.scheduled_timestamp < $check_end
                AND (g.reminder_sent IS NULL OR NOT $reminder_key IN g.reminder_sent)
                AND (g.is_deleted IS NULL OR g.is_deleted = false)
                AND (g.resolution_status IS NULL OR g.resolution_status = 'pending')
                AND g.send_reminders = true
                RETURN g, id(g) as event_id
            ";

            let mut event_results = graph.execute(
                query(event_query)
                    .param("user_node_id", user_node_id)
                    .param("check_start", check_time - 60000)
                    .param("check_end", check_time + 60000)
                    .param("reminder_key", reminder_key.clone())
            ).await.map_err(|e| e.to_string())?;

            while let Some(event_row) = event_results.next().await.map_err(|e| e.to_string())? {
                let event_id: i64 = event_row.get("event_id").unwrap();
                let event_name: String = event_row.get::<neo4rs::Node>("g")
                    .ok()
                    .and_then(|node| node.get::<String>("name").ok())
                    .unwrap_or_else(|| "Event".to_string());
                
                let priority: Option<String> = event_row.get::<neo4rs::Node>("g")
                    .ok()
                    .and_then(|node| node.get::<String>("priority").ok());
                
                let scheduled_timestamp: i64 = event_row.get::<neo4rs::Node>("g")
                    .ok()
                    .and_then(|node| node.get::<i64>("scheduled_timestamp").ok())
                    .unwrap_or(now);

                let mut sent = false;

                if notify_via_push {
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

                    if push::send_notification_to_user(graph, user_node_id, &payload).await.is_ok() {
                        sent = true;
                    }
                }

                if notify_via_telegram {
                    if let (Some(chat_id), Some(bot_token)) = (&telegram_chat_id, &telegram_bot_token) {
                        let msg = format!("⏰ *Reminder: {}*\n\n'{}' is coming up", reminder_text, event_name);
                        if telegram::send_telegram_message_with_token(bot_token, chat_id, &msg).await.is_ok() {
                            sent = true;
                        }
                    }
                }

                if sent {
                    let mark_query = query(
                        "MATCH (g:Goal)
                         WHERE id(g) = $event_id
                         SET g.reminder_sent = COALESCE(g.reminder_sent, []) + $reminder_key
                         RETURN g"
                    )
                    .param("event_id", event_id)
                    .param("reminder_key", reminder_key.clone());
                    
                    let _ = graph.run(mark_query).await;
                }
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
