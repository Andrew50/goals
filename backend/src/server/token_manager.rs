use chrono::Utc;
use neo4rs::{Graph, Query};
use oauth2::{reqwest::async_http_client, RefreshToken, TokenResponse};

use super::auth::create_google_oauth_client;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct UserTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
}

/// Get a valid access token for a user, refreshing if necessary
pub async fn get_valid_token(graph: &Graph, user_id: i64) -> Result<String, String> {
    eprintln!("🔍 [TOKEN] Getting valid token for user {}", user_id);

    // Fetch current tokens from database
    let query = Query::new(
        "MATCH (u:User) WHERE id(u) = $user_id 
         RETURN u.google_access_token as access_token, 
                u.google_refresh_token as refresh_token,
                u.google_token_expiry as expires_at,
                u.google_email as email"
            .to_string(),
    )
    .param("user_id", user_id);

    let mut result = graph
        .execute(query)
        .await
        .map_err(|e| format!("Failed to fetch user tokens: {}", e))?;

    let row = result
        .next()
        .await
        .map_err(|e| format!("Failed to read user data: {}", e))?
        .ok_or_else(|| "User not found".to_string())?;

    let access_token: Option<String> = row.get("access_token").ok();
    let refresh_token: Option<String> = row.get("refresh_token").ok();
    let expires_at: Option<i64> = row.get("expires_at").ok();
    let email: Option<String> = row.get("email").ok();

    eprintln!("👤 [TOKEN] User email: {:?}", email);
    eprintln!("🔑 [TOKEN] Has access token: {}", access_token.is_some());
    eprintln!("🔄 [TOKEN] Has refresh token: {}", refresh_token.is_some());
    eprintln!("⏰ [TOKEN] Token expires at: {:?}", expires_at);

    // Check if we have tokens
    let access_token = access_token.ok_or_else(|| {
        let msg = format!(
            "User {} has not linked their Google account",
            email.unwrap_or_else(|| user_id.to_string())
        );
        eprintln!("❌ [TOKEN] {}", msg);
        msg
    })?;

    let refresh_token = refresh_token.ok_or_else(|| {
        let msg =
            "No refresh token available. User needs to re-authenticate with Google".to_string();
        eprintln!("❌ [TOKEN] {}", msg);
        msg
    })?;

    // Check if token is expired or about to expire (5 minutes buffer)
    let now = Utc::now().timestamp_millis();
    let expires_at = expires_at.unwrap_or(0);

    if expires_at > now + 300000 {
        // Token is still valid for more than 5 minutes
        eprintln!("✅ [TOKEN] Token is still valid for user {}", user_id);
        return Ok(access_token);
    }

    // Token is expired or about to expire, refresh it
    eprintln!("Token expired or expiring soon, refreshing...");
    refresh_access_token(graph, user_id, &refresh_token).await
}

/// Refresh an access token using the refresh token
pub async fn refresh_access_token(
    graph: &Graph,
    user_id: i64,
    refresh_token: &str,
) -> Result<String, String> {
    let client = create_google_oauth_client()
        .map_err(|e| format!("Failed to create OAuth client: {}", e))?;

    // Exchange refresh token for new access token
    let token_result = client
        .exchange_refresh_token(&RefreshToken::new(refresh_token.to_string()))
        .request_async(async_http_client)
        .await
        .map_err(|e| format!("Failed to refresh token: {:?}", e))?;

    let new_access_token = token_result.access_token().secret().to_string();
    let expires_in = token_result.expires_in().map(|d| d.as_secs() as i64);
    let new_expires_at = expires_in.map(|secs| Utc::now().timestamp_millis() + (secs * 1000));

    // Update the database with new token
    let update_query = Query::new(
        "MATCH (u:User) WHERE id(u) = $user_id 
         SET u.google_access_token = $access_token,
             u.google_token_expiry = $expires_at,
             u.updated_at = timestamp()
         RETURN u"
            .to_string(),
    )
    .param("user_id", user_id)
    .param("access_token", new_access_token.clone())
    .param("expires_at", new_expires_at.unwrap_or(0));

    graph
        .run(update_query)
        .await
        .map_err(|e| format!("Failed to update tokens in database: {}", e))?;

    eprintln!("Successfully refreshed access token for user {}", user_id);
    Ok(new_access_token)
}

/// Revoke Google tokens for a user
#[allow(dead_code)]
pub async fn revoke_tokens(graph: &Graph, user_id: i64) -> Result<(), String> {
    // Fetch current tokens
    let query = Query::new(
        "MATCH (u:User) WHERE id(u) = $user_id 
         RETURN u.google_access_token as access_token, 
                u.google_refresh_token as refresh_token"
            .to_string(),
    )
    .param("user_id", user_id);

    let mut result = graph
        .execute(query)
        .await
        .map_err(|e| format!("Failed to fetch user tokens: {}", e))?;

    if let Some(row) = result.next().await.ok().flatten() {
        // Try to revoke the refresh token first, then access token
        if let Ok(refresh_token) = row.get::<String>("refresh_token") {
            let _ = revoke_token_at_google(&refresh_token).await;
        } else if let Ok(access_token) = row.get::<String>("access_token") {
            let _ = revoke_token_at_google(&access_token).await;
        }
    }

    // Clear tokens from database
    let clear_query = Query::new(
        "MATCH (u:User) WHERE id(u) = $user_id 
         REMOVE u.google_access_token, u.google_refresh_token, u.google_token_expiry
         SET u.updated_at = timestamp()
         RETURN u"
            .to_string(),
    )
    .param("user_id", user_id);

    graph
        .run(clear_query)
        .await
        .map_err(|e| format!("Failed to clear tokens from database: {}", e))?;

    Ok(())
}

/// Revoke a token at Google's revocation endpoint
#[allow(dead_code)]
async fn revoke_token_at_google(token: &str) -> Result<(), String> {
    let client = reqwest::Client::new();
    let response = client
        .post("https://oauth2.googleapis.com/revoke")
        .form(&[("token", token)])
        .send()
        .await
        .map_err(|e| format!("Failed to revoke token: {}", e))?;

    if !response.status().is_success() {
        eprintln!(
            "Warning: Token revocation returned status: {}",
            response.status()
        );
    }

    Ok(())
}
