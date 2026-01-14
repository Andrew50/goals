use neo4rs::{query, Graph};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::env;

#[derive(Debug, Serialize, Deserialize)]
pub struct TelegramSettings {
    pub chat_id: Option<String>,
    pub bot_token: Option<String>,
    pub has_bot_token: Option<bool>,
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

pub async fn save_telegram_settings(
    graph: &Graph,
    user_id: i64,
    settings: TelegramSettings,
) -> Result<(), String> {
    let mut set_clauses = Vec::new();
    
    if settings.chat_id.is_some() {
        set_clauses.push("u.telegram_chat_id = $chat_id");
    }
    if settings.bot_token.is_some() {
        set_clauses.push("u.telegram_bot_token = $bot_token");
    }

    if set_clauses.is_empty() {
        return Ok(());
    }

    let query_str = format!(
        "MATCH (u:User) WHERE id(u) = $user_id SET {} RETURN u",
        set_clauses.join(", ")
    );

    let mut q = query(&query_str).param("user_id", user_id);
    
    if let Some(chat_id) = settings.chat_id {
        q = q.param("chat_id", chat_id);
    }
    if let Some(bot_token) = settings.bot_token {
        q = q.param("bot_token", bot_token);
    }

    let mut result = graph
        .execute(q)
        .await
        .map_err(|e| format!("Failed to execute save query: {}", e))?;

    if result.next().await.map_err(|e| format!("{}", e))?.is_none() {
        return Err("User not found".to_string());
    }

    Ok(())
}

pub async fn get_telegram_settings(graph: &Graph, user_id: i64) -> Result<TelegramSettings, String> {
    let query_str = "
        MATCH (u:User)
        WHERE id(u) = $user_id
        RETURN u.telegram_chat_id as chat_id, u.telegram_bot_token as bot_token
    ";

    let mut result = graph
        .execute(query(query_str).param("user_id", user_id))
        .await
        .map_err(|e| format!("Failed to execute get query: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| format!("{}", e))? {
        let chat_id: Option<String> = row.get("chat_id").ok();
        let bot_token: Option<String> = row.get("bot_token").ok();
        
        Ok(TelegramSettings {
            chat_id,
            bot_token: None, // Don't return the token itself
            has_bot_token: Some(bot_token.is_some() && !bot_token.unwrap().is_empty()),
        })
    } else {
        Err("User not found".to_string())
    }
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
        .map_err(|e| format!("Failed to execute get chat_id query: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| format!("{}", e))? {
        let chat_id: Option<String> = row.get("chat_id").ok();
        Ok(chat_id)
    } else {
        Err("User not found".to_string())
    }
}

pub async fn get_telegram_bot_token(graph: &Graph, user_id: i64) -> Result<Option<String>, String> {
    let query_str = "
        MATCH (u:User)
        WHERE id(u) = $user_id
        RETURN u.telegram_bot_token as bot_token
    ";

    let mut result = graph
        .execute(query(query_str).param("user_id", user_id))
        .await
        .map_err(|e| format!("Failed to execute get token query: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| format!("{}", e))? {
        let bot_token: Option<String> = row.get("bot_token").ok();
        Ok(bot_token)
    } else {
        Err("User not found".to_string())
    }
}

pub async fn send_telegram_message_with_token(
    bot_token: &str,
    chat_id: &str,
    text: &str,
) -> Result<(), String> {
    let client = Client::new();
    let url = format!("https://api.telegram.org/bot{}/sendMessage", bot_token);

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

pub async fn send_test_message(graph: &Graph, user_id: i64) -> Result<(), String> {
    let chat_id_opt = get_telegram_chat_id(graph, user_id).await?;
    let bot_token_opt = get_telegram_bot_token(graph, user_id).await?;
    
    match (bot_token_opt, chat_id_opt) {
        (Some(token), Some(id)) => {
            send_telegram_message_with_token(&token, &id, "🔔 *Test Notification*\n\nThis is a test message from your Goals app!").await
        }
        (None, _) => Err("Telegram bot token not configured for this user".to_string()),
        (_, None) => Err("No Telegram chat ID configured for this user".to_string()),
    }
}
