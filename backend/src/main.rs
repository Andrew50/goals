// src/main.rs
mod auth;
mod db;

use axum::{routing::get, Extension, Router};
use dotenvy::dotenv;
use hyper::header::HeaderValue;
use std::net::SocketAddr;
use tower_http::cors::{CorsLayer, Any, AllowOrigin};

#[tokio::main]
async fn main() {
    // Load environment variables
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
        .allow_origin(AllowOrigin::exact(HeaderValue::from_static("http://localhost:3000"))) // Allow frontend origin
        .allow_methods(Any) // Allow all HTTP methods (GET, POST, etc.)
        .allow_headers(Any); // Allow all headers (e.g., Content-Type)

    // Set up the application router
    let app = Router::new()
        .route("/", get(root))
        .nest("/auth", auth::create_routes())
        .layer(Extension(pool))
        .layer(cors); // Apply the CORS middleware

    // Set the server address
    let addr = SocketAddr::from(([0, 0, 0, 0], 5057));
    println!("Listening on {}", addr);

    // Run the server
    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}

async fn root() -> &'static str {
    "Welcome to the Rust server!"
}

