mod auth;
mod db;
mod goal;

use axum::{
    http::Request,
    middleware::{self, Next},
    response::Response,
};
use axum::{Extension, Router};
use dotenvy::dotenv;
use hyper::header::HeaderValue;
use std::net::SocketAddr;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tracing::Level;
use tracing_subscriber;

async fn log_requests<B>(request: Request<B>, next: Next<B>) -> Response {
    println!("Incoming request: {} {}", request.method(), request.uri());
    let response = next.run(request).await;
    println!("Outgoing response: {}", response.status());
    response
}

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt().with_max_level(Level::INFO).init();
    dotenv().ok();

    // Create the database connection pool
    let pool = match db::create_pool().await {
        Ok(pool) => pool,
        Err(e) => {
            eprintln!("Error creating database pool: {}", e);
            return;
        }
    };

    println!("Database connection pool created successfully");

    // Configure CORS
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::exact(HeaderValue::from_static(
            "http://localhost:3000",
        )))
        .allow_methods(Any)
        .allow_headers(Any);

    // Middleware for request logging
    let log_layer = middleware::from_fn(log_requests);

    // Set up the application router
    let app = Router::new()
        .nest("/goals", goal::create_routes())
        .nest("/auth", auth::create_routes())
        .layer(Extension(pool)) // Add the database connection
        .layer(cors) // Add CORS handling
        .route_layer(log_layer); // Add request logging middleware

    // Set the server address
    let addr = SocketAddr::from(([0, 0, 0, 0], 5057));
    println!("Listening on {}", addr);

    // Run the server
    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}
