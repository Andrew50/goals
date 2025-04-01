mod auth;
mod calendar;
mod day;
mod db;
mod goal;
mod http_handler;
mod list;
mod middleware;
mod network;
mod query;
mod routine;
mod traversal;

use dotenvy::dotenv;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};
use tracing::Level;
use tracing_subscriber;

type UserLocks = Arc<Mutex<HashMap<i64, Arc<Mutex<()>>>>>;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_max_level(Level::INFO).init();
    dotenv().ok();

    let pool = match db::create_pool().await {
        Ok(pool) => pool,
        Err(e) => {
            eprintln!("Error creating database pool: {}", e);
            return;
        }
    };

    println!("Database connection pool created successfully");

    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost:3000".parse().unwrap(),
            "https://goals.atlantis.trading".parse().unwrap(),
        ])
        .allow_methods(Any)
        .allow_headers(Any);

    let user_locks: UserLocks = Arc::new(Mutex::new(HashMap::new()));

    let app = http_handler::create_routes(pool.clone(), user_locks.clone()).layer(cors);

    let listener = TcpListener::bind("0.0.0.0:5057").await.unwrap();
    println!("Listening on 0.0.0.0:5057");
    axum::serve(listener, app.into_make_service())
        .await
        .unwrap();
}
