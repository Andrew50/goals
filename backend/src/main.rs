// src/main.rs

mod auth;
mod db; // Updated from mod database;

use axum::{routing::get, Extension, Router};
use dotenvy::dotenv;
use std::net::SocketAddr;

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

    println!("Database connection pool created successfully");    let app = Router::new()
        .route("/", get(root))
        .nest("/auth", auth::create_routes())
        .layer(Extension(pool));

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

