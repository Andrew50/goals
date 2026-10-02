use axum::{http::StatusCode, Json};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use neo4rs::{Graph, Query};
use oauth2::{
    basic::BasicClient, reqwest::async_http_client, AuthUrl, AuthorizationCode, ClientId,
    ClientSecret, CsrfToken, RedirectUrl, Scope, TokenResponse, TokenUrl,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::env;
use uuid::Uuid;

#[derive(Debug, Deserialize, Clone)]
pub struct AuthPayload {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub message: String,
    pub token: String,
    pub username: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GoogleAuthUrlResponse {
    pub auth_url: String,
    pub state: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub user_id: i64,
    pub username: String,
    pub exp: usize,
}

/// Short-lived API credential. The long-lived credential is the refresh cookie.
const ACCESS_TOKEN_TTL: Duration = Duration::hours(1);
const REFRESH_SLIDING_MS: i64 = 30 * 24 * 60 * 60 * 1000;
const REFRESH_ABSOLUTE_MS: i64 = 90 * 24 * 60 * 60 * 1000;
const REFRESH_REUSE_GRACE_MS: i64 = 60_000;

/// Tokens issued together: a 1-hour access JWT and a rotating refresh token.
pub struct IssuedSession {
    pub access_token: String,
    pub refresh_token: String,
    pub refresh_max_age_secs: i64,
    pub username: String,
}

fn hash_token(token: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = Sha256::digest(token.as_bytes());
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn new_refresh_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn issue_access_token(user_id: i64, username: &str) -> Result<String, String> {
    let claims = Claims {
        user_id,
        username: username.to_string(),
        exp: (Utc::now() + ACCESS_TOKEN_TTL).timestamp() as usize,
    };
    let jwt_secret = env::var("JWT_SECRET").unwrap_or_else(|_| "default_secret".to_string());
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )
    .map_err(|e| format!("Token creation failed: {e}"))
}

fn auth_error(
    status: StatusCode,
    message: impl Into<String>,
) -> (StatusCode, Json<AuthResponse>) {
    (
        status,
        Json(AuthResponse {
            message: message.into(),
            token: "".to_string(),
            username: None,
        }),
    )
}

/// Create a server-side session and an access JWT. The raw refresh token is returned
/// once so the caller can set an HttpOnly cookie; only its hash is stored.
pub async fn issue_session(
    graph: &Graph,
    user_id: i64,
    jwt_username: &str,
    display_name: String,
) -> Result<IssuedSession, String> {
    let refresh_token = new_refresh_token();
    let now = Utc::now().timestamp_millis();
    let expires_at = now + REFRESH_SLIDING_MS;
    let absolute_expires_at = now + REFRESH_ABSOLUTE_MS;

    let query = Query::new(
        "MATCH (u:User) WHERE id(u) = $user_id
         CREATE (u)-[:HAS_SESSION]->(s:AuthSession {
            token_hash: $token_hash,
            previous_token_hash: '',
            created_at: $now,
            last_used_at: $now,
            rotated_at: $now,
            expires_at: $expires_at,
            absolute_expires_at: $absolute_expires_at
         })"
        .to_string(),
    )
    .param("user_id", user_id)
    .param("token_hash", hash_token(&refresh_token))
    .param("now", now)
    .param("expires_at", expires_at)
    .param("absolute_expires_at", absolute_expires_at);

    graph
        .run(query)
        .await
        .map_err(|e| format!("Failed to create session: {e}"))?;

    let access_token = issue_access_token(user_id, jwt_username)?;
    Ok(IssuedSession {
        access_token,
        refresh_token,
        refresh_max_age_secs: REFRESH_SLIDING_MS / 1000,
        username: display_name,
    })
}

struct SessionRow {
    session_id: i64,
    user_id: i64,
    jwt_username: String,
    display_name: String,
    token_hash: String,
    previous_token_hash: String,
    rotated_at: i64,
    expires_at: i64,
    absolute_expires_at: i64,
}

async fn find_session(graph: &Graph, token_hash: &str) -> Result<Option<SessionRow>, String> {
    let query = Query::new(
        "MATCH (u:User)-[:HAS_SESSION]->(s:AuthSession)
         WHERE s.token_hash = $hash OR s.previous_token_hash = $hash
         RETURN id(s) as session_id,
                id(u) as user_id,
                u.username as username,
                COALESCE(u.display_name, u.username) as display_name,
                s.token_hash as token_hash,
                s.previous_token_hash as previous_token_hash,
                s.rotated_at as rotated_at,
                s.expires_at as expires_at,
                s.absolute_expires_at as absolute_expires_at
         LIMIT 1"
            .to_string(),
    )
    .param("hash", token_hash.to_string());

    let mut result = graph
        .execute(query)
        .await
        .map_err(|e| format!("Failed to look up session: {e}"))?;

    let Some(row) = result
        .next()
        .await
        .map_err(|e| format!("Failed to read session: {e}"))?
    else {
        return Ok(None);
    };

    Ok(Some(SessionRow {
        session_id: row.get("session_id").unwrap_or(0),
        user_id: row.get("user_id").unwrap_or(0),
        jwt_username: row.get("username").unwrap_or_default(),
        display_name: row.get("display_name").unwrap_or_default(),
        token_hash: row.get("token_hash").unwrap_or_default(),
        previous_token_hash: row.get("previous_token_hash").unwrap_or_default(),
        rotated_at: row.get("rotated_at").unwrap_or(0),
        expires_at: row.get("expires_at").unwrap_or(0),
        absolute_expires_at: row.get("absolute_expires_at").unwrap_or(0),
    }))
}

pub async fn revoke_all_sessions(graph: &Graph, user_id: i64) -> Result<(), String> {
    let query = Query::new(
        "MATCH (u:User)-[:HAS_SESSION]->(s:AuthSession)
         WHERE id(u) = $user_id
         DETACH DELETE s"
            .to_string(),
    )
    .param("user_id", user_id);
    graph
        .run(query)
        .await
        .map_err(|e| format!("Failed to revoke sessions: {e}"))?;
    Ok(())
}

async fn revoke_session(graph: &Graph, session_id: i64) -> Result<(), String> {
    let query = Query::new(
        "MATCH (s:AuthSession) WHERE id(s) = $session_id DETACH DELETE s".to_string(),
    )
    .param("session_id", session_id);
    graph
        .run(query)
        .await
        .map_err(|e| format!("Failed to revoke session: {e}"))?;
    Ok(())
}

/// Identify the user from a refresh cookie without rotating it.
/// Used after the Google redirect, when the in-memory access token is gone.
pub async fn user_id_from_refresh_token(graph: &Graph, refresh_token: &str) -> Option<i64> {
    if refresh_token.is_empty() {
        return None;
    }
    let hash = hash_token(refresh_token);
    let session = match find_session(graph, &hash).await {
        Ok(Some(session)) => session,
        _ => return None,
    };
    let now = Utc::now().timestamp_millis();
    if session.token_hash != hash {
        return None;
    }
    if now >= session.expires_at || now >= session.absolute_expires_at {
        return None;
    }
    Some(session.user_id)
}

pub async fn revoke_refresh_token(graph: &Graph, refresh_token: &str) -> Result<(), String> {
    if refresh_token.is_empty() {
        return Ok(());
    }
    let hash = hash_token(refresh_token);
    if let Some(session) = find_session(graph, &hash).await? {
        if session.token_hash == hash || session.previous_token_hash == hash {
            revoke_session(graph, session.session_id).await?;
        }
    }
    Ok(())
}

/// Rotate the refresh token and issue a new access JWT.
/// A previous token presented within 60 seconds is treated as another tab.
/// Reuse after that grace period revokes every session for the user.
pub async fn refresh_session(
    graph: &Graph,
    refresh_token: &str,
) -> Result<IssuedSession, (StatusCode, Json<AuthResponse>)> {
    if refresh_token.is_empty() {
        return Err(auth_error(StatusCode::UNAUTHORIZED, "Missing refresh token"));
    }

    let hash = hash_token(refresh_token);
    let session = find_session(graph, &hash)
        .await
        .map_err(|e| auth_error(StatusCode::INTERNAL_SERVER_ERROR, e))?
        .ok_or_else(|| auth_error(StatusCode::UNAUTHORIZED, "Session not found"))?;

    let now = Utc::now().timestamp_millis();
    if now >= session.expires_at || now >= session.absolute_expires_at {
        let _ = revoke_session(graph, session.session_id).await;
        return Err(auth_error(StatusCode::UNAUTHORIZED, "Session expired"));
    }

    let is_current = session.token_hash == hash;
    let is_previous = !session.previous_token_hash.is_empty() && session.previous_token_hash == hash;
    if is_previous && now - session.rotated_at > REFRESH_REUSE_GRACE_MS {
        let _ = revoke_all_sessions(graph, session.user_id).await;
        return Err(auth_error(StatusCode::UNAUTHORIZED, "Session revoked"));
    }
    if !is_current && !is_previous {
        return Err(auth_error(StatusCode::UNAUTHORIZED, "Session not found"));
    }

    let new_refresh = new_refresh_token();
    let expires_at = std::cmp::min(now + REFRESH_SLIDING_MS, session.absolute_expires_at);
    let rotate = Query::new(
        "MATCH (s:AuthSession) WHERE id(s) = $session_id
         SET s.previous_token_hash = s.token_hash,
             s.token_hash = $token_hash,
             s.rotated_at = $now,
             s.last_used_at = $now,
             s.expires_at = $expires_at"
            .to_string(),
    )
    .param("session_id", session.session_id)
    .param("token_hash", hash_token(&new_refresh))
    .param("now", now)
    .param("expires_at", expires_at);

    graph
        .run(rotate)
        .await
        .map_err(|e| auth_error(StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to rotate session: {e}")))?;

    let access_token = issue_access_token(session.user_id, &session.jwt_username)
        .map_err(|e| auth_error(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let max_age = std::cmp::max((expires_at - now) / 1000, 0);

    Ok(IssuedSession {
        access_token,
        refresh_token: new_refresh,
        refresh_max_age_secs: max_age,
        username: session.display_name,
    })
}

pub fn decode_access_token(token: &str) -> Option<i64> {
    let jwt_secret = env::var("JWT_SECRET").unwrap_or_else(|_| "default_secret".to_string());
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .ok()
    .map(|data| data.claims.user_id)
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct GoogleUserInfo {
    pub id: String,
    pub email: String,
    pub name: String,
    pub picture: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserAccount {
    pub user_id: i64,
    pub username: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub auth_methods: Vec<AuthMethod>,
    pub is_email_verified: bool,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthMethod {
    pub method_type: String, // "password", "google", "github", etc.
    pub is_primary: bool,
    pub created_at: i64,
    pub last_used: Option<i64>,
}

// OAuth client setup
pub fn create_google_oauth_client() -> Result<BasicClient, String> {
    let google_client_id =
        env::var("GOOGLE_CLIENT_ID").map_err(|_| "GOOGLE_CLIENT_ID must be set")?;
    let google_client_secret =
        env::var("GOOGLE_CLIENT_SECRET").map_err(|_| "GOOGLE_CLIENT_SECRET must be set")?;

    // The redirect URL should always point to the frontend callback route
    // In dev: http://localhost:3030/auth/callback
    // In prod: https://goals.atlantis.trading/auth/callback (no /api prefix)
    let redirect_url = env::var("GOOGLE_REDIRECT_URL")
        .unwrap_or_else(|_| "http://localhost:3030/auth/callback".to_string());

    let auth_url = AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".to_string())
        .map_err(|_| "Invalid authorization endpoint URL")?;
    let token_url = TokenUrl::new("https://www.googleapis.com/oauth2/v3/token".to_string())
        .map_err(|_| "Invalid token endpoint URL")?;

    let client = BasicClient::new(
        ClientId::new(google_client_id),
        Some(ClientSecret::new(google_client_secret)),
        auth_url,
        Some(token_url),
    )
    .set_redirect_uri(RedirectUrl::new(redirect_url).map_err(|_| "Invalid redirect URL")?);

    Ok(client)
}

// Generate Google OAuth authorization URL.
// Login asks only for identity. Calendar scopes are requested later, once,
// from Account Settings (`connect_calendar = true`).
pub async fn generate_google_auth_url(
    connect_calendar: bool,
) -> Result<Json<GoogleAuthUrlResponse>, (StatusCode, Json<AuthResponse>)> {
    let client = create_google_oauth_client().map_err(|e| {
        eprintln!("OAuth client creation error: {}", e);
        auth_error(StatusCode::INTERNAL_SERVER_ERROR, "OAuth configuration error")
    })?;

    let mut auth_request = client
        .authorize_url(CsrfToken::new_random)
        .add_scope(Scope::new("openid".to_string()))
        .add_scope(Scope::new("profile".to_string()))
        .add_scope(Scope::new("email".to_string()));

    if connect_calendar {
        auth_request = auth_request
            .add_scope(Scope::new(
                "https://www.googleapis.com/auth/calendar.events".to_string(),
            ))
            .add_scope(Scope::new(
                "https://www.googleapis.com/auth/calendar.readonly".to_string(),
            ))
            .add_extra_param("access_type", "offline")
            .add_extra_param("prompt", "consent")
            .add_extra_param("include_granted_scopes", "true");
    }

    let (auth_url, csrf_token) = auth_request.url();

    Ok(Json(GoogleAuthUrlResponse {
        auth_url: auth_url.to_string(),
        state: csrf_token.secret().clone(),
    }))
}

// Handle Google OAuth callback (updated to use improved function)
pub async fn handle_google_callback(
    graph: Graph,
    code: String,
    state: String,
    existing_user_id: Option<i64>,
    connect_calendar: bool,
) -> Result<IssuedSession, (StatusCode, Json<AuthResponse>)> {
    eprintln!("🔄 Starting Google OAuth callback processing...");
    eprintln!(
        "📄 Received code: {}",
        &code[..std::cmp::min(code.len(), 50)]
    );
    eprintln!("🔑 Received state: {}", state);

    let client = create_google_oauth_client().map_err(|e| {
        eprintln!("❌ OAuth client creation error: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(AuthResponse {
                message: "OAuth configuration error".to_string(),
                token: "".to_string(),
                username: None,
            }),
        )
    })?;

    eprintln!("✅ OAuth client created successfully");

    // Exchange the code with a token
    eprintln!("🔄 Exchanging authorization code for access token...");
    let token_result = client
        .exchange_code(AuthorizationCode::new(code))
        .request_async(async_http_client)
        .await
        .map_err(|e| {
            eprintln!("❌ Token exchange error: {:?}", e);
            (
                StatusCode::BAD_REQUEST,
                Json(AuthResponse {
                    message: "Failed to exchange authorization code".to_string(),
                    token: "".to_string(),
                    username: None,
                }),
            )
        })?;

    eprintln!("✅ Successfully exchanged code for access token");

    // Extract tokens
    let access_token = token_result.access_token().secret().to_string();
    let refresh_token = token_result.refresh_token().map(|t| t.secret().to_string());
    let expires_in = token_result.expires_in().map(|d| d.as_secs() as i64);
    let expires_at = expires_in.map(|secs| Utc::now().timestamp_millis() + (secs * 1000));

    // Get user info from Google
    eprintln!("🔄 Fetching user info from Google...");
    let user_info = get_google_user_info(&access_token).await.map_err(|e| {
        eprintln!("❌ Failed to get user info: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(AuthResponse {
                message: "Failed to get user information".to_string(),
                token: "".to_string(),
                username: None,
            }),
        )
    })?;

    eprintln!(
        "✅ Successfully fetched user info: email={}, name={}",
        user_info.email, user_info.name
    );

    if connect_calendar && existing_user_id.is_none() {
        return Err(auth_error(
            StatusCode::UNAUTHORIZED,
            "Sign in before connecting Google Calendar",
        ));
    }

    // If we have an existing logged-in user, link Google to that account to avoid creating a new user
    let user_id = if let Some(current_user_id) = existing_user_id {
        eprintln!(
            "🔗 Existing session detected (user_id={}), linking Google account...",
            current_user_id
        );

        // Ensure this Google account isn't already linked to a different user
        let check_conflict = Query::new(
            "MATCH (u:User {google_id: $google_id}) WHERE id(u) <> $user_id RETURN id(u) as uid"
                .to_string(),
        )
        .param("google_id", user_info.id.clone())
        .param("user_id", current_user_id);

        let mut conflict_res = graph.execute(check_conflict).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AuthResponse {
                    message: format!("Database error during account link check: {}", e),
                    token: "".to_string(),
                    username: None,
                }),
            )
        })?;

        if conflict_res.next().await.ok().flatten().is_some() {
            return Err((
                StatusCode::CONFLICT,
                Json(AuthResponse {
                    message: "This Google account is already linked to another user".to_string(),
                    token: "".to_string(),
                    username: None,
                }),
            ));
        }

        // Identity login must not touch Calendar tokens. Calendar connect writes
        // them, and keeps an existing refresh token when Google omits a new one.
        let link_update = if connect_calendar {
            Query::new(
                "MATCH (u:User) WHERE id(u) = $user_id
                 SET u.google_id = $google_id,
                     u.google_email = $google_email,
                     u.display_name = COALESCE(u.display_name, $display_name),
                     u.is_email_verified = true,
                     u.google_access_token = $access_token,
                     u.google_token_expiry = $token_expiry,
                     u.google_refresh_token = CASE
                        WHEN $refresh_token = '' THEN u.google_refresh_token
                        ELSE $refresh_token
                     END,
                     u.updated_at = timestamp()
                 RETURN id(u) as user_id"
                    .to_string(),
            )
            .param("user_id", current_user_id)
            .param("google_id", user_info.id.clone())
            .param("google_email", user_info.email.clone())
            .param("display_name", user_info.name.clone())
            .param("access_token", access_token.to_string())
            .param("refresh_token", refresh_token.clone().unwrap_or_default())
            .param("token_expiry", expires_at.unwrap_or(0))
        } else {
            Query::new(
                "MATCH (u:User) WHERE id(u) = $user_id
                 SET u.google_id = $google_id,
                     u.google_email = $google_email,
                     u.display_name = COALESCE(u.display_name, $display_name),
                     u.is_email_verified = true,
                     u.updated_at = timestamp()
                 RETURN id(u) as user_id"
                    .to_string(),
            )
            .param("user_id", current_user_id)
            .param("google_id", user_info.id.clone())
            .param("google_email", user_info.email.clone())
            .param("display_name", user_info.name.clone())
        };

        graph.run(link_update).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AuthResponse {
                    message: format!("Failed to link Google account: {}", e),
                    token: "".to_string(),
                    username: None,
                }),
            )
        })?;

        current_user_id
    } else {
        // Create or get user in database using improved function
        eprintln!("🔄 Creating or retrieving user in database...");
        improved_create_or_get_google_user(&graph, &user_info)
        .await
        .map_err(|e| {
            eprintln!("❌ Database error: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AuthResponse {
                    message: format!("Account linking error: {}", e),
                    token: "".to_string(),
                    username: None,
                }),
            )
        })?
    };

    eprintln!(
        "✅ Successfully created/retrieved user with ID: {}",
        user_id
    );

    eprintln!("🔄 Creating app session...");
    let session = issue_session(
        &graph,
        user_id,
        &user_info.email,
        user_info.name.clone(),
    )
    .await
    .map_err(|e| {
        eprintln!("❌ Failed to create session: {}", e);
        auth_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create session")
    })?;

    eprintln!(
        "🎉 Google OAuth callback completed successfully for user: {}",
        user_info.email
    );

    Ok(session)
}

// Get user info from Google (make public for use in handlers)
pub async fn get_google_user_info(access_token: &str) -> Result<GoogleUserInfo, String> {
    eprintln!("🔄 Making request to Google userinfo API...");
    let client = reqwest::Client::new();
    let response = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| {
            eprintln!("❌ HTTP request to Google failed: {}", e);
            format!("Request failed: {}", e)
        })?;

    eprintln!("📡 Google API response status: {}", response.status());

    if !response.status().is_success() {
        let error_msg = format!("API request failed with status: {}", response.status());
        eprintln!("❌ {}", error_msg);
        return Err(error_msg);
    }

    let user_info: GoogleUserInfo = response.json().await.map_err(|e| {
        eprintln!("❌ Failed to parse Google API response: {}", e);
        format!("Failed to parse response: {}", e)
    })?;

    eprintln!("✅ Successfully parsed user info from Google API");
    Ok(user_info)
}

// Business logic functions with regular parameters

// Sign-up function
pub async fn sign_up(
    graph: Graph,
    username: String,
    password: String,
) -> Result<(StatusCode, Json<AuthResponse>), (StatusCode, Json<AuthResponse>)> {
    println!("🔄 Starting sign-up process for user: {}", username);

    // Check if user already exists
    println!("🔍 Checking if user already exists in database...");
    let check_query = Query::new("MATCH (u:User {username: $username}) RETURN u".to_string())
        .param("username", username.clone());

    let mut result = match graph.execute(check_query).await {
        Ok(result) => {
            println!("✅ Successfully executed user existence check query");
            result
        }
        Err(e) => {
            println!("❌ Database error checking user existence: {:?}", e);
            eprintln!("Database error checking user: {:?}", e);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AuthResponse {
                    message: "Database error".to_string(),
                    token: "".to_string(),
                    username: None,
                }),
            ));
        }
    };

    if let Ok(Some(_)) = result.next().await {
        println!("⚠️  User already exists: {}", username);
        return Err((
            StatusCode::CONFLICT,
            Json(AuthResponse {
                message: "Username already exists".to_string(),
                token: "".to_string(),
                username: None,
            }),
        ));
    }

    println!("✅ User does not exist, proceeding with creation");

    // Hash the password
    println!("🔐 Hashing password...");
    let hashed_password = match hash(password.as_bytes(), DEFAULT_COST) {
        Ok(hash) => {
            println!("✅ Password hashed successfully");
            hash
        }
        Err(e) => {
            println!("❌ Error hashing password: {:?}", e);
            eprintln!("Error hashing password: {:?}", e);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AuthResponse {
                    message: "Error processing password".to_string(),
                    token: "".to_string(),
                    username: None,
                }),
            ));
        }
    };

    // Create user query
    println!("🔄 Creating user in database...");
    let create_query = Query::new(
        "CREATE (u:User {username: $username, password_hash: $password_hash}) RETURN u".to_string(),
    )
    .param("username", username)
    .param("password_hash", hashed_password);

    // Run the query
    match graph.run(create_query).await {
        Ok(_) => {
            println!("✅ User created successfully in database");
            Ok((
                StatusCode::CREATED,
                Json(AuthResponse {
                    message: "User created successfully".to_string(),
                    token: "".to_string(),
                    username: None,
                }),
            ))
        }
        Err(e) => {
            println!("❌ Error creating user in database: {:?}", e);
            eprintln!("Error creating user: {:?}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AuthResponse {
                    message: "Error creating user".to_string(),
                    token: "".to_string(),
                    username: None,
                }),
            ))
        }
    }
}

// Enhanced sign-in function
pub async fn enhanced_sign_in(
    graph: Graph,
    username: String,
    password: String,
) -> Result<IssuedSession, (StatusCode, Json<AuthResponse>)> {
    println!(
        "🔄 Starting enhanced sign-in process for user: {}",
        username
    );

    println!("🔍 Querying user from database...");
    let query = Query::new(
        "MATCH (u:User {username: $username}) 
         RETURN id(u) as user_id, 
                u.password_hash AS password_hash,
                u.google_id as google_id,
                u.display_name as display_name"
            .to_string(),
    )
    .param("username", username.clone());

    let mut result = match graph.execute(query).await {
        Ok(result) => {
            println!("✅ Successfully executed user lookup query");
            result
        }
        Err(e) => {
            println!("❌ Database error during sign-in: {:?}", e);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AuthResponse {
                    message: "Database error".to_string(),
                    token: "".to_string(),
                    username: None,
                }),
            ));
        }
    };

    if let Ok(Some(record)) = result.next().await {
        println!("✅ User found in database");
        let user_id: i64 = record.get("user_id").unwrap();
        let _password_hash: Option<String> = record.get("password_hash").ok();
        let google_id: Option<String> = record.get("google_id").ok();
        let display_name: Option<String> = record.get("display_name").ok();

        // Check if user has password authentication
        if let Some(hash) = _password_hash {
            println!("🔍 Verifying password...");
            let is_valid = match verify(&password, &hash) {
                Ok(valid) => {
                    println!("✅ Password verification completed: {}", valid);
                    valid
                }
                Err(e) => {
                    println!("❌ Password verification error: {:?}", e);
                    return Err((
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(AuthResponse {
                            message: "Authentication error".to_string(),
                            token: "".to_string(),
                            username: None,
                        }),
                    ));
                }
            };

            if is_valid {
                println!("🔄 Creating app session...");
                let display = display_name.unwrap_or_else(|| username.clone());
                let session = issue_session(&graph, user_id, &username, display)
                    .await
                    .map_err(|e| {
                        println!("❌ Session creation error: {}", e);
                        auth_error(StatusCode::INTERNAL_SERVER_ERROR, "Token creation failed")
                    })?;

                println!("✅ Sign-in successful for user: {}", username);
                Ok(session)
            } else {
                println!("❌ Password verification failed for user: {}", username);
                Err((
                    StatusCode::UNAUTHORIZED,
                    Json(AuthResponse {
                        message: "Invalid username or password".to_string(),
                        token: "".to_string(),
                        username: None,
                    }),
                ))
            }
        } else if google_id.is_some() {
            // User has Google auth but no password
            println!("⚠️  User has Google authentication but no password set");
            Err((
                StatusCode::BAD_REQUEST,
                Json(AuthResponse {
                    message: "This account uses Google sign-in. Please sign in with Google or set a password.".to_string(),
                    token: "".to_string(),
                    username: None,
                }),
            ))
        } else {
            // User exists but has no authentication methods (shouldn't happen)
            println!("❌ User exists but has no authentication methods");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AuthResponse {
                    message: "Account configuration error. Please contact support.".to_string(),
                    token: "".to_string(),
                    username: None,
                }),
            ))
        }
    } else {
        println!("❌ User not found in database: {}", username);
        Err((
            StatusCode::UNAUTHORIZED,
            Json(AuthResponse {
                message: "Invalid username or password".to_string(),
                token: "".to_string(),
                username: None,
            }),
        ))
    }
}

// Token validation function
pub async fn validate_token(token: &str) -> Result<StatusCode, StatusCode> {
    let jwt_secret = env::var("JWT_SECRET").unwrap_or_else(|_| "default_secret".to_string());

    // Validate the token
    jsonwebtoken::decode::<Claims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Token is valid, return success
    Ok(StatusCode::OK)
}

// Enhanced user management functions

// Get user account information with all auth methods
#[allow(dead_code)]
pub async fn get_user_account(graph: &Graph, user_id: i64) -> Result<UserAccount, String> {
    let query = Query::new(
        "MATCH (u:User) WHERE id(u) = $user_id 
         RETURN u.username as username,
                COALESCE(u.google_email, u.username) as email,
                u.display_name as display_name,
                u.google_id as google_id,
                u.password_hash as password_hash,
                u.created_via as created_via,
                u.is_email_verified as is_email_verified"
            .to_string(),
    )
    .param("user_id", user_id);

    let mut result = graph
        .execute(query)
        .await
        .map_err(|e| format!("Database query failed: {}", e))?;

    if let Ok(Some(record)) = result.next().await {
        let username: String = record.get("username").unwrap_or_default();
        let email: Option<String> = record.get("email").ok();
        let display_name: Option<String> = record.get("display_name").ok();
        let google_id: Option<String> = record.get("google_id").ok();
        let _password_hash: Option<String> = record.get("password_hash").ok();
        let created_via: Option<String> = record.get("created_via").ok();
        let is_email_verified: bool = record.get("is_email_verified").unwrap_or(false);

        let mut auth_methods = Vec::new();

        // Add password auth method if exists
        if _password_hash.is_some() {
            auth_methods.push(AuthMethod {
                method_type: "password".to_string(),
                is_primary: created_via.as_deref() != Some("google"),
                created_at: chrono::Utc::now().timestamp_millis(),
                last_used: None,
            });
        }

        // Add Google auth method if exists
        if google_id.is_some() {
            auth_methods.push(AuthMethod {
                method_type: "google".to_string(),
                is_primary: created_via.as_deref() == Some("google"),
                created_at: chrono::Utc::now().timestamp_millis(),
                last_used: None,
            });
        }

        Ok(UserAccount {
            user_id,
            username,
            email,
            display_name,
            auth_methods,
            is_email_verified,
            created_at: None,
            updated_at: None,
        })
    } else {
        Err("User not found".to_string())
    }
}

// Set password for Google-only users
#[allow(dead_code)]
pub async fn set_password_for_user(
    graph: &Graph,
    user_id: i64,
    password: String,
) -> Result<(), String> {
    // Hash the password
    let hashed_password = hash(password.as_bytes(), DEFAULT_COST)
        .map_err(|e| format!("Error hashing password: {}", e))?;

    let update_query = Query::new(
        "MATCH (u:User) WHERE id(u) = $user_id 
         SET u.password_hash = $password_hash
         RETURN u"
            .to_string(),
    )
    .param("user_id", user_id)
    .param("password_hash", hashed_password);

    graph
        .run(update_query)
        .await
        .map_err(|e| format!("Failed to set password: {}", e))?;

    Ok(())
}

// Improved Google user creation/lookup
async fn improved_create_or_get_google_user(
    graph: &Graph,
    user_info: &GoogleUserInfo,
) -> Result<i64, String> {
    println!("🔄 Starting improved Google user creation/lookup process");
    eprintln!("🔄 Checking if user exists by Google ID: {}", user_info.id);

    // First, check if user exists by Google ID
    println!("🔍 Querying database for existing user by Google ID...");
    let check_google_query =
        Query::new("MATCH (u:User {google_id: $google_id}) RETURN id(u) as user_id".to_string())
            .param("google_id", user_info.id.clone());

    let mut result = match graph.execute(check_google_query).await {
        Ok(result) => {
            println!("✅ Successfully executed Google ID lookup query");
            result
        }
        Err(e) => {
            println!("❌ Database error during Google ID lookup: {:?}", e);
            eprintln!("❌ Database query failed (Google ID check): {}", e);
            return Err(format!("Database query failed: {}", e));
        }
    };

    if let Ok(Some(record)) = result.next().await {
        let user_id: i64 = record.get("user_id").unwrap();
        println!("✅ Found existing user by Google ID: {}", user_id);
        eprintln!("✅ Found existing user by Google ID: {}", user_id);

        // Identity sign-in must not replace Calendar tokens already stored for this user.
        let update_profile = Query::new(
            "MATCH (u:User) WHERE id(u) = $user_id
             SET u.google_email = $google_email,
                 u.display_name = COALESCE(u.display_name, $display_name),
                 u.is_email_verified = true,
                 u.updated_at = timestamp()
             RETURN u"
                .to_string(),
        )
        .param("user_id", user_id)
        .param("google_email", user_info.email.clone())
        .param("display_name", user_info.name.clone());

        let _ = graph.run(update_profile).await;

        return Ok(user_id);
    }

    println!("🔍 User not found by Google ID, checking by email...");
    eprintln!(
        "🔄 User not found by Google ID, checking by email: {}",
        user_info.email
    );

    // Check if user exists by email (for existing users who want to link Google)
    println!("🔍 Querying database for existing user by email...");
    let check_email_query = Query::new(
        "MATCH (u:User {username: $email}) 
         RETURN id(u) as user_id, u.google_id as existing_google_id, u.password_hash as password_hash".to_string()
    )
    .param("email", user_info.email.clone());

    let mut result = match graph.execute(check_email_query).await {
        Ok(result) => {
            println!("✅ Successfully executed email lookup query");
            result
        }
        Err(e) => {
            println!("❌ Database error during email lookup: {:?}", e);
            eprintln!("❌ Database query failed (email check): {}", e);
            return Err(format!("Database query failed: {}", e));
        }
    };

    if let Ok(Some(record)) = result.next().await {
        let user_id: i64 = record.get("user_id").unwrap();
        let _existing_google_id: Option<String> = record.get("existing_google_id").ok();
        let _password_hash: Option<String> = record.get("password_hash").ok();

        println!("✅ Found existing user by email: {}", user_id);
        eprintln!("✅ Found existing user by email: {}", user_id);

        // Check if this user already has a different Google ID linked
        if let Some(existing_id) = _existing_google_id {
            if existing_id != user_info.id {
                println!("⚠️  User already has a different Google account linked");
                return Err(
                    "This email is already associated with a different Google account".to_string(),
                );
            } else {
                // Same Google ID, just return the user_id
                return Ok(user_id);
            }
        }

        // Link Google account to existing user
        println!("🔄 Updating existing user with Google information...");
        let update_query = Query::new(
            "MATCH (u:User) WHERE id(u) = $user_id 
             SET u.google_id = $google_id, 
                 u.google_email = $google_email, 
                 u.display_name = COALESCE(u.display_name, $display_name),
                 u.is_email_verified = true,
                 u.updated_at = timestamp()
             RETURN id(u) as user_id"
                .to_string(),
        )
        .param("user_id", user_id)
        .param("google_id", user_info.id.clone())
        .param("google_email", user_info.email.clone())
        .param("display_name", user_info.name.clone());

        match graph.run(update_query).await {
            Ok(_) => {
                println!("✅ Successfully updated existing user with Google info");
                eprintln!("✅ Successfully updated existing user with Google info");
                return Ok(user_id);
            }
            Err(e) => {
                println!("❌ Failed to update existing user: {:?}", e);
                eprintln!("❌ Failed to update existing user: {}", e);
                return Err(format!("Failed to update user: {}", e));
            }
        }
    }

    println!("🔄 User not found, creating new user...");
    eprintln!("🔄 User not found, creating new user: {}", user_info.email);

    // Create new user with comprehensive information
    println!("🔄 Creating new Google user in database...");
    let create_query = Query::new(
        "CREATE (u:User {
            username: $email, 
            google_id: $google_id, 
            google_email: $google_email, 
            display_name: $display_name,
            created_via: 'google',
            is_email_verified: true,
            created_at: timestamp(),
            updated_at: timestamp()
        }) RETURN id(u) as user_id"
            .to_string(),
    )
    .param("email", user_info.email.clone())
    .param("google_id", user_info.id.clone())
    .param("google_email", user_info.email.clone())
    .param("display_name", user_info.name.clone());

    let mut result = match graph.execute(create_query).await {
        Ok(result) => {
            println!("✅ Successfully executed user creation query");
            result
        }
        Err(e) => {
            println!("❌ Database error during user creation: {:?}", e);
            eprintln!("❌ Failed to create new user: {}", e);
            return Err(format!("Failed to create user: {}", e));
        }
    };

    if let Ok(Some(record)) = result.next().await {
        let user_id: i64 = record.get("user_id").unwrap();
        println!("✅ Successfully created new user with ID: {}", user_id);
        eprintln!("✅ Successfully created new user with ID: {}", user_id);
        Ok(user_id)
    } else {
        println!("❌ Failed to create user: no record returned");
        eprintln!("❌ Failed to create user: no record returned");
        Err("Failed to create user".to_string())
    }
}

// Additional response structs for new endpoints

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct SetPasswordPayload {
    pub password: String,
}

/// Response for Google account status check
#[derive(Debug, Serialize)]
pub struct GoogleStatusResponse {
    pub linked: bool,
    pub email: Option<String>,
    pub calendars_synced: i32,
}

/// Check if user has linked their Google account
pub async fn get_google_status(
    graph: &Graph,
    user_id: i64,
) -> Result<Json<GoogleStatusResponse>, (StatusCode, String)> {
    let status_query = Query::new(
        "MATCH (u:User) WHERE id(u) = $user_id 
         OPTIONAL MATCH (s:SyncState {user_id: $user_id})
         RETURN u.google_id as google_id, 
                u.google_email as email,
                u.google_refresh_token as refresh_token,
                count(s) as sync_states"
            .to_string(),
    )
    .param("user_id", user_id);

    let mut result = graph.execute(status_query).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to check Google status: {}", e),
        )
    })?;

    if let Some(row) = result.next().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read result: {}", e),
        )
    })? {
        let google_id: Option<String> = row.get("google_id").ok();
        let email: Option<String> = row.get("email").ok();
        let refresh_token: Option<String> = row.get("refresh_token").ok();
        let sync_states: i64 = row.get("sync_states").unwrap_or(0);
        let has_refresh = refresh_token
            .as_ref()
            .map(|token| !token.is_empty())
            .unwrap_or(false);

        let linked = google_id.is_some() && has_refresh;

        Ok(Json(GoogleStatusResponse {
            linked,
            email: if linked { email } else { None },
            calendars_synced: sync_states as i32,
        }))
    } else {
        Err((StatusCode::NOT_FOUND, "User not found".to_string()))
    }
}

/// Unlink Google account from user
pub async fn unlink_google_account(
    graph: &Graph,
    user_id: i64,
) -> Result<StatusCode, (StatusCode, String)> {
    eprintln!("🔓 [AUTH] Unlinking Google account for user {}", user_id);

    // First, revoke tokens if they exist
    if let Err(e) = crate::server::token_manager::revoke_tokens(graph, user_id).await {
        eprintln!("⚠️ [AUTH] Warning: Failed to revoke tokens: {}", e);
        // Continue anyway - we'll clear the data from the database
    }

    // Clear all Google-related data from the user node
    let clear_query = Query::new(
        "MATCH (u:User) WHERE id(u) = $user_id 
         REMOVE u.google_id, u.google_email, u.google_access_token, 
                u.google_refresh_token, u.google_token_expiry,
                u.gcal_auto_sync_enabled, u.gcal_default_calendar_id
         SET u.updated_at = timestamp()
         RETURN u"
            .to_string(),
    )
    .param("user_id", user_id);

    graph.run(clear_query).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to unlink Google account: {}", e),
        )
    })?;

    // Delete all SyncState nodes for this user
    let delete_sync_states = Query::new(
        "MATCH (s:SyncState {user_id: $user_id}) DELETE s".to_string(),
    )
    .param("user_id", user_id);

    let _ = graph.run(delete_sync_states).await;

    eprintln!("✅ [AUTH] Google account unlinked for user {}", user_id);
    Ok(StatusCode::OK)
}
