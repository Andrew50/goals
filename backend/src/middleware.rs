use axum::{
    body::Body,
    http::{Request, StatusCode},
    middleware::Next,
    response::Response,
};
use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use std::env;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub user_id: i64,
    pub username: String,
    pub exp: usize,
}

pub async fn auth_middleware(
    mut request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    // Log the incoming request
    println!("Incoming request: {} {}", request.method(), request.uri());

    let token = request
        .headers()
        .get("Authorization")
        .and_then(|auth_header| auth_header.to_str().ok())
        .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let jwt_secret = env::var("JWT_SECRET").unwrap_or_else(|_| "default_secret".to_string());

    let claims = decode::<Claims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)?
    .claims;

    // Add the user_id to the request extensions
    request.extensions_mut().insert(claims.user_id);

    // Run the next middleware or handler
    let response = next.run(request).await;

    // Log the outgoing response
    println!("Outgoing response: {}", response.status());

    Ok(response)
}
