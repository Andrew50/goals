use axum::{
    extract::{Extension, Json},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Router,
};
use bcrypt::{hash, verify, DEFAULT_COST};
use neo4rs::{Graph, Query};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

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
                }),
            ));
        }
    };

    if let Ok(Some(_)) = result.next().await {
        return Err((
            StatusCode::CONFLICT,
            Json(AuthResponse {
                message: "Username already exists".to_string(),
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
            }),
        )),
        Err(e) => {
            eprintln!("Error creating user: {:?}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AuthResponse {
                    message: "Error creating user".to_string(),
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
    // Match the user node by username
    let query = Query::new(
        "MATCH (u:User {username: $username}) RETURN u.password_hash AS password_hash".to_string(),
    )
    .param("username", payload.username);

    // Execute the query and retrieve the password hash
    let mut result = graph.execute(query).await.map_err(|e| {
        eprintln!("Database error: {:?}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    if let Ok(Some(record)) = result.next().await {
        let password_hash: String = record.get("password_hash").unwrap();
        let is_valid = verify(&payload.password, &password_hash)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        if is_valid {
            // Authentication successful
            Ok(Json(AuthResponse {
                message: "Sign-in successful".to_string(),
            }))
        } else {
            // Invalid password
            Err(StatusCode::UNAUTHORIZED)
        }
    } else {
        // User not found
        Err(StatusCode::UNAUTHORIZED)
    }
}
