use neo4rs::{query, Graph};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::env;

#[derive(Debug, Serialize, Deserialize)]
pub struct TelegramSettings {
    pub chat_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct TelegramMessage {
    chat_id: String,
    text: String,
    parse_mode: String,
}

fn get_bot_token() -> Result<String, String> {
    env::var("TELEGRAM_BOT_TOKEN")
        .map_err(|_| "TELEGRAM_BOT_TOKEN not set in environment".to_string())
}

pub async fn send_telegram_message(chat_id: &str, text: &str) -> Result<(), String> {
    let token = get_bot_token()?;
    let client = Client::new();
    let url = format!("https://api.telegram.org/bot{}/sendMessage", token);

    let message = TelegramMessage {
        chat_id: chat_id.to_string(),
        text: text.to_string(),
        parse_mode: "Markdown".to_string(),
    };

    let response = client
        .post(&url)
        .json(&message)
        .send()
        .await
        .map_err(|e| format!("Failed to send Telegram request: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Telegram API error ({}): {}", status, text));
    }

    Ok(())
}

pub async fn save_telegram_chat_id(
    graph: &Graph,
    user_id: i64,
    chat_id: String,
) -> Result<(), String> {
    let query_str = "
        MATCH (u:User)
        WHERE id(u) = $user_id
        SET u.telegram_chat_id = $chat_id
        RETURN u
    ";

    let mut result = graph
        .execute(
            query(query_str)
                .param("user_id", user_id)
                .param("chat_id", chat_id),
        )
        .await
        .map_err(|e| format!("Failed to execute save query: {}", e))?;

    if result.next().await.map_err(|e| format!("{}", e))?.is_none() {
        return Err("User not found".to_string());
    }

    Ok(())
}

pub async fn get_telegram_chat_id(graph: &Graph, user_id: i64) -> Result<Option<String>, String> {
    let query_str = "
        MATCH (u:User)
        WHERE id(u) = $user_id
        RETURN u.telegram_chat_id as chat_id
    ";

    let mut result = graph
        .execute(query(query_str).param("user_id", user_id))
        .await
        .map_err(|e| format!("Failed to execute get query: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| format!("{}", e))? {
        // chat_id might be null in the DB
        let chat_id: Option<String> = row.get("chat_id").ok();
        Ok(chat_id)
    } else {
        Err("User not found".to_string())
    }
}

pub async fn send_test_message(graph: &Graph, user_id: i64) -> Result<(), String> {
    let chat_id = get_telegram_chat_id(graph, user_id).await?;
    
    if let Some(id) = chat_id {
        send_telegram_message(&id, "🔔 *Test Notification*\n\nThis is a test message from your Goals app!").await
    } else {
        Err("No Telegram chat ID configured for this user".to_string())
    }
}



