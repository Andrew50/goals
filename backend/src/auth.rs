use axum::{
    extract::{Extension, Json},
    http::StatusCode,
    response::IntoResponse,
    routing::{post, get},
    Router,
};
use bcrypt::{hash, verify, DEFAULT_COST};
use jsonwebtoken::{encode, EncodingKey, Header, DecodingKey, Validation};
use neo4rs::{Graph, Query};
use serde::{Deserialize, Serialize};
use std::env;

pub fn create_routes() -> Router {
    Router::new()
        .route("/signup", post(sign_up))
        .route("/signin", post(sign_in))
        .route("/validate", get(validate_token))
}

#[derive(Debug, Deserialize)]
struct AuthPayload {
    username: String,
    password: String,
}

#[derive(Debug, Serialize)]
struct AuthResponse {
    message: String,
    token: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    user_id: i64,
    username: String,
    exp: usize,
}

// Sign-up handler
async fn sign_up(
    Extension(graph): Extension<Graph>,
    Json(payload): Json<AuthPayload>,
) -> Result<impl IntoResponse, impl IntoResponse> {
    // Check if user already exists
    let check_query = Query::new("MATCH (u:User {username: $username}) RETURN u".to_string())
        .param("username", payload.username.clone());

    let mut result = match graph.execute(check_query).await {
        Ok(result) => result,
        Err(e) => {
            eprintln!("Database error checking user: {:?}", e);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AuthResponse {
                    message: "Database error".to_string(),
                    token: "".to_string(),
                }),
            ));
        }
    };

    if let Ok(Some(_)) = result.next().await {
        return Err((
            StatusCode::CONFLICT,
            Json(AuthResponse {
                message: "Username already exists".to_string(),
                token: "".to_string(),
            }),
        ));
    }

    // Hash the password
    let hashed_password = match hash(payload.password.as_bytes(), DEFAULT_COST) {
        Ok(hash) => hash,
        Err(e) => {
            eprintln!("Error hashing password: {:?}", e);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AuthResponse {
                    message: "Error processing password".to_string(),
                    token: "".to_string(),
                }),
            ));
        }
    };

    // Create user query
    let create_query = Query::new(
        "CREATE (u:User {username: $username, password_hash: $password_hash}) RETURN u".to_string(),
    )
    .param("username", payload.username)
    .param("password_hash", hashed_password);

    // Run the query
    match graph.run(create_query).await {
        Ok(_) => Ok((
            StatusCode::CREATED,
            Json(AuthResponse {
                message: "User created successfully".to_string(),
                token: "".to_string(),
            }),
        )),
        Err(e) => {
            eprintln!("Error creating user: {:?}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AuthResponse {
                    message: "Error creating user".to_string(),
                    token: "".to_string(),
                }),
            ))
        }
    }
}

// Sign-in handler
async fn sign_in(
    Extension(graph): Extension<Graph>,
    Json(payload): Json<AuthPayload>,
) -> Result<Json<AuthResponse>, StatusCode> {
    let query = Query::new(
        "MATCH (u:User {username: $username}) 
         RETURN id(u) as user_id, u.password_hash AS password_hash"
            .to_string(),
    )
    .param("username", payload.username.clone());

    let mut result = graph.execute(query).await.map_err(|e| {
        eprintln!("Database error: {:?}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if let Ok(Some(record)) = result.next().await {
        let password_hash: String = record.get("password_hash").unwrap();
        let user_id: i64 = record.get("user_id").unwrap();

        let is_valid = verify(&payload.password, &password_hash)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        if is_valid {
            // Create the JWT token
            let claims = Claims {
                user_id,
                username: payload.username,
                exp: (chrono::Utc::now() + chrono::Duration::hours(24)).timestamp() as usize,
            };

            let jwt_secret =
                env::var("JWT_SECRET").unwrap_or_else(|_| "default_secret".to_string());

            let token = encode(
                &Header::default(),
                &claims,
                &EncodingKey::from_secret(jwt_secret.as_bytes()),
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            Ok(Json(AuthResponse {
                message: "Sign-in successful".to_string(),
                token,
            }))
        } else {
            Err(StatusCode::UNAUTHORIZED)
        }
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

// Token validation handler
async fn validate_token(
    Extension(_graph): Extension<Graph>,
    headers: axum::http::HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    // Extract token from Authorization header
    let auth_header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let jwt_secret = env::var("JWT_SECRET").unwrap_or_else(|_| "default_secret".to_string());
    
    // Validate the token
    jsonwebtoken::decode::<Claims>(
        auth_header,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Token is valid, return success
    Ok(StatusCode::OK)
}
