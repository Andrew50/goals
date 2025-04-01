use axum::{http::StatusCode, Json};
use bcrypt::{hash, verify, DEFAULT_COST};
use jsonwebtoken::{encode, DecodingKey, EncodingKey, Header, Validation};
use neo4rs::{Graph, Query};
use serde::{Deserialize, Serialize};
use std::env;

#[derive(Debug, Deserialize, Clone)]
pub struct AuthPayload {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub message: String,
    pub token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub user_id: i64,
    pub username: String,
    pub exp: usize,
}

// Business logic functions with regular parameters

// Sign-up function
pub async fn sign_up(
    graph: Graph,
    username: String,
    password: String,
) -> Result<(StatusCode, Json<AuthResponse>), (StatusCode, Json<AuthResponse>)> {
    // Check if user already exists
    let check_query = Query::new("MATCH (u:User {username: $username}) RETURN u".to_string())
        .param("username", username.clone());

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
    let hashed_password = match hash(password.as_bytes(), DEFAULT_COST) {
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
    .param("username", username)
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

// Sign-in function
pub async fn sign_in(
    graph: Graph,
    username: String,
    password: String,
) -> Result<Json<AuthResponse>, StatusCode> {
    let query = Query::new(
        "MATCH (u:User {username: $username}) 
         RETURN id(u) as user_id, u.password_hash AS password_hash"
            .to_string(),
    )
    .param("username", username.clone());

    let mut result = graph.execute(query).await.map_err(|e| {
        eprintln!("Database error: {:?}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if let Ok(Some(record)) = result.next().await {
        let password_hash: String = record.get("password_hash").unwrap();
        let user_id: i64 = record.get("user_id").unwrap();

        let is_valid =
            verify(&password, &password_hash).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        if is_valid {
            // Create the JWT token
            let claims = Claims {
                user_id,
                username,
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
