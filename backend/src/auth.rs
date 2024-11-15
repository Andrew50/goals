use axum::{
    extract::{Extension, Json},
    http::StatusCode,
    routing::post,
    Router,
};
use bcrypt::{hash, verify, DEFAULT_COST};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};

pub fn create_routes() -> Router {
    Router::new()
        .route("/signup", post(sign_up))
        .route("/signin", post(sign_in))
}

#[derive(Debug, Deserialize)]
struct AuthPayload {
    username: String,
    password: String,
}

#[derive(Debug, Serialize)]
struct AuthResponse {
    message: String,
}

// Sign-up handler
async fn sign_up(
    Extension(pool): Extension<PgPool>,
    Json(payload): Json<AuthPayload>,
) -> Result<Json<AuthResponse>, StatusCode> {
    // Hash the password
    let hashed_password = hash(&payload.password, DEFAULT_COST).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Insert the new user into the database
    let result = sqlx::query(
        "INSERT INTO users (username, password_hash) VALUES ($1, $2)"
    )
    .bind(&payload.username)
    .bind(&hashed_password)
    .execute(&pool)
    .await;

    match result {
        Ok(_) => Ok(Json(AuthResponse {
            message: "User created successfully".to_string(),
        })),
        Err(sqlx::Error::Database(err)) => {
            if let Some(constraint) = err.constraint() {
                if constraint == "users_username_key" {
                    // Username already exists
                    Err(StatusCode::CONFLICT)
                } else {
                    Err(StatusCode::INTERNAL_SERVER_ERROR)
                }
            } else {
                Err(StatusCode::INTERNAL_SERVER_ERROR)
            }
        }
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

// Sign-in handler
async fn sign_in(
    Extension(pool): Extension<PgPool>,
    Json(payload): Json<AuthPayload>,
) -> Result<Json<AuthResponse>, StatusCode> {
    // Retrieve the user from the database
    let user = sqlx::query(
        "SELECT user_id, username, password_hash FROM users WHERE username = $1"
    )
    .bind(&payload.username)
    .fetch_one(&pool)
    .await
    .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Verify the password
    let password_hash: String = user.get("password_hash");
    let is_valid = verify(&payload.password, &password_hash).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if is_valid {
        // Authentication successful
        Ok(Json(AuthResponse {
            message: "Sign-in successful".to_string(),
        }))
    } else {
        // Invalid password
        Err(StatusCode::UNAUTHORIZED)
    }
}

