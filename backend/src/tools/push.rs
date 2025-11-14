use axum::http::StatusCode;
use chrono::Utc;
use neo4rs::{Graph, Query};
use serde::{Deserialize, Serialize};
use std::env;
use web_push::{
    ContentEncoding, SubscriptionInfo as WpSubscriptionInfo, VapidSignatureBuilder, WebPushClient,
    WebPushMessageBuilder,
};
/*
#[derive(Debug, Serialize, Deserialize)]
pub struct PushSubscription {
    pub endpoint: String,
    pub keys: PushKeys,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PushKeys {
    pub p256dh: String,
    pub auth: String,
}
*/

#[derive(Debug, Serialize)]
pub struct PushPayload {
    pub title: String,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub badge: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actions: Option<Vec<NotificationAction>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub require_interaction: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub renotify: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub silent: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NotificationAction {
    pub action: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

// Save a push subscription for a user
pub async fn save_subscription(
    graph: Graph,
    user_id: i64,
    subscription: serde_json::Value,
) -> Result<StatusCode, (StatusCode, String)> {
    println!("🔔 [PUSH] Saving subscription for user {}", user_id);

    // Extract subscription data
    let endpoint = subscription["endpoint"]
        .as_str()
        .ok_or((StatusCode::BAD_REQUEST, "Missing endpoint".to_string()))?;

    let p256dh = subscription["keys"]["p256dh"]
        .as_str()
        .ok_or((StatusCode::BAD_REQUEST, "Missing p256dh key".to_string()))?;

    let auth = subscription["keys"]["auth"]
        .as_str()
        .ok_or((StatusCode::BAD_REQUEST, "Missing auth key".to_string()))?;

    // Save or update subscription in database
    let query = Query::new(
        "MATCH (u:User) WHERE id(u) = $user_id
         MERGE (u)-[:HAS_SUBSCRIPTION]->(s:WebPushSubscription {endpoint: $endpoint})
         SET s.p256dh = $p256dh,
             s.auth = $auth,
             s.updated_at = $updated_at,
             s.created_at = COALESCE(s.created_at, $created_at)
         RETURN id(s) as subscription_id"
            .to_string(),
    )
    .param("user_id", user_id)
    .param("endpoint", endpoint.to_string())
    .param("p256dh", p256dh.to_string())
    .param("auth", auth.to_string())
    .param("updated_at", Utc::now().timestamp_millis())
    .param("created_at", Utc::now().timestamp_millis());

    graph.run(query).await.map_err(|e| {
        eprintln!("❌ [PUSH] Failed to save subscription: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save subscription".to_string(),
        )
    })?;

    println!("✅ [PUSH] Subscription saved for user {}", user_id);
    Ok(StatusCode::OK)
}

// Remove a push subscription for a user
pub async fn remove_subscription(
    graph: Graph,
    user_id: i64,
    payload: serde_json::Value,
) -> Result<StatusCode, (StatusCode, String)> {
    println!("🔔 [PUSH] Removing subscription for user {}", user_id);

    let endpoint = payload["endpoint"]
        .as_str()
        .ok_or((StatusCode::BAD_REQUEST, "Missing endpoint".to_string()))?;

    // Delete subscription from database
    let query = Query::new(
        "MATCH (u:User)-[r:HAS_SUBSCRIPTION]->(s:WebPushSubscription {endpoint: $endpoint})
         WHERE id(u) = $user_id
         DELETE r, s
         RETURN count(s) as deleted_count"
            .to_string(),
    )
    .param("user_id", user_id)
    .param("endpoint", endpoint.to_string());

    let mut result = graph.execute(query).await.map_err(|e| {
        eprintln!("❌ [PUSH] Failed to remove subscription: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to remove subscription".to_string(),
        )
    })?;

    if let Ok(Some(row)) = result.next().await {
        let deleted_count: i64 = row.get("deleted_count").unwrap_or(0);
        if deleted_count > 0 {
            println!("✅ [PUSH] Subscription removed for user {}", user_id);
            Ok(StatusCode::OK)
        } else {
            println!(
                "⚠️ [PUSH] No subscription found to remove for user {}",
                user_id
            );
            Ok(StatusCode::NOT_FOUND)
        }
    } else {
        Ok(StatusCode::NOT_FOUND)
    }
}

// Send a test notification to a user
pub async fn send_test_notification(
    graph: Graph,
    user_id: i64,
) -> Result<StatusCode, (StatusCode, String)> {
    println!("🔔 [PUSH] Sending test notification to user {}", user_id);

    // Get all subscriptions for the user
    let subscriptions = get_user_subscriptions(&graph, user_id).await?;

    if subscriptions.is_empty() {
        return Err((
            StatusCode::NOT_FOUND,
            "No push subscriptions found".to_string(),
        ));
    }

    // Create test payload
    let payload = PushPayload {
        title: "Test Notification".to_string(),
        body: "This is a test notification from Goals app!".to_string(),
        icon: Some("/logo192.png".to_string()),
        badge: Some("/logo192.png".to_string()),
        tag: Some("test".to_string()),
        data: Some(serde_json::json!({
            "url": "/",
            "test": true,
            "timestamp": Utc::now().timestamp_millis()
        })),
        actions: None,
        require_interaction: Some(false),
        renotify: Some(false),
        silent: Some(false),
        timestamp: Some(Utc::now().timestamp_millis()),
    };

    let payload_json = serde_json::to_vec(&payload).map_err(|e| {
        eprintln!("❌ [PUSH] Failed to serialize payload: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create notification".to_string(),
        )
    })?;

    let mut success_count = 0;
    let mut failed_endpoints = Vec::new();

    // Send to all subscriptions
    for sub in subscriptions {
        match send_push_notification(&sub, &payload_json).await {
            Ok(_) => {
                success_count += 1;
                println!("✅ [PUSH] Notification sent successfully to endpoint");
            }
            Err(e) => {
                eprintln!("❌ [PUSH] Failed to send to endpoint: {}", e);

                // Check if subscription is invalid (410 Gone or 404 Not Found)
                if e.contains("410") || e.contains("404") || e.contains("InvalidSubscription") {
                    failed_endpoints.push(sub.endpoint.clone());
                }
            }
        }
    }

    // Clean up invalid subscriptions
    for endpoint in failed_endpoints {
        let _ = remove_subscription_by_endpoint(&graph, user_id, &endpoint).await;
    }

    if success_count > 0 {
        println!(
            "✅ [PUSH] Test notification sent to {} subscription(s) for user {}",
            success_count, user_id
        );
        Ok(StatusCode::OK)
    } else {
        Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to send notification to any subscription".to_string(),
        ))
    }
}

// Send notification to a specific user with custom payload
pub async fn send_notification_to_user(
    graph: &Graph,
    user_id: i64,
    payload: &PushPayload,
) -> Result<(), String> {
    println!("🔔 [PUSH] Sending notification to user {}", user_id);

    // Get all subscriptions for the user
    let subscriptions = get_user_subscriptions(graph, user_id)
        .await
        .map_err(|e| format!("Failed to get subscriptions: {:?}", e))?;

    if subscriptions.is_empty() {
        return Err("No push subscriptions found".to_string());
    }

    let payload_json =
        serde_json::to_vec(payload).map_err(|e| format!("Failed to serialize payload: {}", e))?;

    let mut success_count = 0;
    let mut failed_endpoints = Vec::new();

    // Send to all subscriptions
    for sub in subscriptions {
        match send_push_notification(&sub, &payload_json).await {
            Ok(_) => {
                success_count += 1;
            }
            Err(e) => {
                eprintln!("❌ [PUSH] Failed to send notification: {}", e);

                // Check if subscription is invalid
                if e.contains("410") || e.contains("404") || e.contains("InvalidSubscription") {
                    failed_endpoints.push(sub.endpoint.clone());
                }
            }
        }
    }

    // Clean up invalid subscriptions
    for endpoint in failed_endpoints {
        let _ = remove_subscription_by_endpoint(graph, user_id, &endpoint).await;
    }

    if success_count > 0 {
        Ok(())
    } else {
        Err("Failed to send notification to any subscription".to_string())
    }
}

// Subscription info structure
#[derive(Debug)]
struct SubscriptionInfo {
    endpoint: String,
    p256dh: String,
    auth: String,
}

impl SubscriptionInfo {
    fn new(endpoint: String, p256dh: String, auth: String) -> Self {
        Self {
            endpoint,
            p256dh,
            auth,
        }
    }
}

// Helper function to get all subscriptions for a user
async fn get_user_subscriptions(
    graph: &Graph,
    user_id: i64,
) -> Result<Vec<SubscriptionInfo>, (StatusCode, String)> {
    let query = Query::new(
        "MATCH (u:User)-[:HAS_SUBSCRIPTION]->(s:WebPushSubscription)
         WHERE id(u) = $user_id
         RETURN s.endpoint as endpoint, s.p256dh as p256dh, s.auth as auth"
            .to_string(),
    )
    .param("user_id", user_id);

    let mut result = graph.execute(query).await.map_err(|e| {
        eprintln!("❌ [PUSH] Failed to get subscriptions: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to get subscriptions".to_string(),
        )
    })?;

    let mut subscriptions = Vec::new();

    while let Ok(Some(row)) = result.next().await {
        let endpoint: String = row.get("endpoint").unwrap_or_default();
        let p256dh: String = row.get("p256dh").unwrap_or_default();
        let auth: String = row.get("auth").unwrap_or_default();

        if !endpoint.is_empty() && !p256dh.is_empty() && !auth.is_empty() {
            subscriptions.push(SubscriptionInfo::new(endpoint, p256dh, auth));
        }
    }

    Ok(subscriptions)
}

// Helper function to send push notification
async fn send_push_notification(
    subscription: &SubscriptionInfo,
    payload: &[u8],
) -> Result<(), String> {
    // Ensure we have VAPID keys configured
    let public_key =
        env::var("VAPID_PUBLIC_KEY").map_err(|_| "VAPID_PUBLIC_KEY not configured".to_string())?;
    let private_key = env::var("VAPID_PRIVATE_KEY")
        .map_err(|_| "VAPID_PRIVATE_KEY not configured".to_string())?;
    let subject = env::var("VAPID_SUBJECT").unwrap_or_else(|_| "mailto:admin@yourdomain.com".into());

    // Map to web-push subscription type
    let wp_sub = WpSubscriptionInfo {
        endpoint: subscription.endpoint.clone(),
        keys: web_push::SubscriptionKeys {
            p256dh: subscription.p256dh.clone(),
            auth: subscription.auth.clone(),
        },
    };

    // Build message
    let client = WebPushClient::new().map_err(|e| format!("Client error: {e}"))?;
    let mut msg_builder =
        WebPushMessageBuilder::new(&wp_sub).map_err(|e| format!("Message build error: {e}"))?;
    msg_builder.set_ttl(60);
    msg_builder.set_payload(ContentEncoding::Aes128Gcm, payload);

    // VAPID signature
    let mut vapid_builder = VapidSignatureBuilder::from_base64(
        &private_key,
        base64_013::URL_SAFE_NO_PAD,
        &wp_sub,
    )
        .map_err(|e| format!("VAPID init error: {e}"))?;
    vapid_builder.add_claim("sub", subject);
    let signature = vapid_builder
        .build()
        .map_err(|e| format!("VAPID build error: {e}"))?;
    msg_builder.set_vapid_signature(signature);

    // Send
    client
        .send(
            msg_builder
                .build()
                .map_err(|e| format!("Build send message error: {e}"))?,
        )
        .await
        .map_err(|e| format!("Send error: {e}"))?;

    Ok(())
}

// Helper function to remove a subscription by endpoint
async fn remove_subscription_by_endpoint(
    graph: &Graph,
    user_id: i64,
    endpoint: &str,
) -> Result<(), String> {
    println!("🔔 [PUSH] Removing invalid subscription: {}", endpoint);

    let query = Query::new(
        "MATCH (u:User)-[r:HAS_SUBSCRIPTION]->(s:WebPushSubscription {endpoint: $endpoint})
         WHERE id(u) = $user_id
         DELETE r, s"
            .to_string(),
    )
    .param("user_id", user_id)
    .param("endpoint", endpoint.to_string());

    graph
        .run(query)
        .await
        .map_err(|e| format!("Failed to remove subscription: {}", e))?;

    println!("✅ [PUSH] Invalid subscription removed");
    Ok(())
}
/*
// Public function to send notifications for events
pub async fn send_event_reminder(
    graph: &Graph,
    user_id: i64,
    event_name: &str,
    event_time: i64,
    event_id: i64,
) -> Result<(), String> {
    let payload = PushPayload {
        title: "Event Reminder".to_string(),
        body: format!("'{}'  starts in 15 minutes", event_name),
        icon: Some("/logo192.png".to_string()),
        badge: Some("/logo192.png".to_string()),
        tag: Some(format!("event-{}", event_id)),
        data: Some(serde_json::json!({
            "url": format!("/calendar?event={}", event_id),
            "event_id": event_id,
            "event_time": event_time,
            "type": "event_reminder"
        })),
        actions: Some(vec![
            NotificationAction {
                action: "view".to_string(),
                title: "View Event".to_string(),
                icon: None,
            },
            NotificationAction {
                action: "snooze".to_string(),
                title: "Snooze 5 min".to_string(),
                icon: None,
            },
        ]),
        require_interaction: Some(true),
        renotify: Some(true),
        silent: Some(false),
        timestamp: Some(event_time),
    };

    send_notification_to_user(graph, user_id, &payload).await
}

// Public function to send notifications for task deadlines
pub async fn send_task_deadline_reminder(
    graph: &Graph,
    user_id: i64,
    task_name: &str,
    deadline: i64,
    task_id: i64,
) -> Result<(), String> {
    let payload = PushPayload {
        title: "Task Deadline".to_string(),
        body: format!("Task '{}' is due soon", task_name),
        icon: Some("/logo192.png".to_string()),
        badge: Some("/logo192.png".to_string()),
        tag: Some(format!("task-{}", task_id)),
        data: Some(serde_json::json!({
            "url": format!("/list?task={}", task_id),
            "task_id": task_id,
            "deadline": deadline,
            "type": "task_deadline"
        })),
        actions: Some(vec![
            NotificationAction {
                action: "complete".to_string(),
                title: "Mark Complete".to_string(),
                icon: None,
            },
            NotificationAction {
                action: "snooze".to_string(),
                title: "Remind Later".to_string(),
                icon: None,
            },
        ]),
        require_interaction: Some(true),
        renotify: Some(false),
        silent: Some(false),
        timestamp: Some(deadline),
    };

    send_notification_to_user(graph, user_id, &payload).await
}
*/
