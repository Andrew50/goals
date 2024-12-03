mod auth;
mod calender;
mod day;
mod db;
mod goal;
mod list;
mod middleware;
mod network;
mod routine;
mod traversal;

use axum::{middleware::from_fn, Extension, Router};
use dotenvy::dotenv;
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};
use tracing::Level;
use tracing_subscriber;

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

    let app = Router::new()
        .nest("/auth", auth::create_routes())
        .nest(
            "/goals",
            goal::create_routes().route_layer(from_fn(middleware::auth_middleware)),
        )
        .nest(
            "/network",
            network::create_routes().route_layer(from_fn(middleware::auth_middleware)),
        )
        .nest(
            "/traversal",
            traversal::create_routes().route_layer(from_fn(middleware::auth_middleware)),
        )
        .nest(
            "/calender",
            calender::create_routes().route_layer(from_fn(middleware::auth_middleware)),
        )
        .nest(
            "/list",
            list::create_routes().route_layer(from_fn(middleware::auth_middleware)),
        )
        .nest(
            "/day",
            day::create_routes().route_layer(from_fn(middleware::auth_middleware)),
        )
        .nest(
            "/routine",
            routine::create_routes().route_layer(from_fn(middleware::auth_middleware)),
        )
        .layer(Extension(pool))
        .layer(cors);
    let listener = TcpListener::bind("0.0.0.0:5057").await.unwrap();
    println!("Listening on {}", "0.0.0.0:5057");
    axum::serve(listener, app.into_make_service())
        .await
        .unwrap();
}
