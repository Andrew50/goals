use axum::{
    extract::{Request, WebSocketUpgrade},
    http::header,
    middleware::Next,
    response::{IntoResponse, Response},
};
use jsonwebtoken::{decode, DecodingKey, Validation};
use std::env;
use tracing::{error, info, warn};
use urlencoding;

use crate::server::auth::Claims;

pub async fn auth_middleware(mut request: Request, next: Next) -> Result<Response, Response> {
    // Get the token either from Authorization header or query parameter for WebSocket
    let token = get_token_from_request(&request)?;

    // Get JWT secret from environment variables or use a default
    let jwt_secret = env::var("JWT_SECRET").unwrap_or_else(|_| "default_secret".to_string());

    // Validate the JWT
    let token_data = match decode::<Claims>(
        &token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::default(),
    ) {
        Ok(token_data) => token_data,
        Err(e) => {
            error!("JWT validation error: {:?}", e);
            return Err((axum::http::StatusCode::UNAUTHORIZED, "Invalid token").into_response());
        }
    };

    // Extract the user ID from the validated token
    let user_id = token_data.claims.user_id;

    // Add the user ID to the request extensions
    request.extensions_mut().insert(user_id);

    // Log the authenticated request
    info!("Authenticated request for user ID: {}", user_id);

    // Continue processing the request
    Ok(next.run(request).await)
}

// Extract token from request (either from Authorization header or query parameter)
fn get_token_from_request(request: &Request) -> Result<String, Response> {
    // First try to get token from Authorization header
    if let Some(auth_header) = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    {
        if let Some(token) = auth_header.strip_prefix("Bearer ") {
            info!("Extracted token from Authorization header");
            return Ok(token.to_string());
        }
    }

    // If not found in header, *always* check query parameters as a fallback
    if let Some(query) = request.uri().query() {
        info!(query = %query, "Checking query parameters for token");
        for pair in query.split('&') {
            let mut parts = pair.split('=');
            if let (Some(key), Some(value)) = (parts.next(), parts.next()) {
                if key == "token" {
                    info!("Extracted token from query parameter");
                    match urlencoding::decode(value) {
                        Ok(decoded_token) => return Ok(decoded_token.into_owned()),
                        Err(e) => {
                            error!("Failed to URL decode token from query parameter: {}", e);
                            return Err((
                                axum::http::StatusCode::BAD_REQUEST,
                                "Invalid token encoding",
                            )
                                .into_response());
                        }
                    }
                }
            }
        }
    }

    // No token found by either method
    warn!("No token found in Authorization header or query parameters");
    Err((axum::http::StatusCode::UNAUTHORIZED, "Unauthorized").into_response())
}
