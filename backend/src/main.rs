mod auth;
mod calender;
mod day;
mod db;
mod goal;
mod list;
mod middleware;
mod network;
mod routine_processor;
mod traversal;

use axum::{middleware::from_fn, Extension, Router};
use dotenvy::dotenv;
use routine_processor::RoutineProcessor;
use tokio::net::TcpListener;
use tokio::time;
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, Level};
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

    let routine_processor = RoutineProcessor::new(pool.clone());

    if let Err(e) = routine_processor.process_routines().await {
        eprintln!("Error initializing routines: {}", e);
    }

    let processor_pool = pool.clone();
    tokio::spawn(async move {
        let processor = RoutineProcessor::new(processor_pool);
        let mut interval = time::interval(time::Duration::from_secs(60));

        loop {
            interval.tick().await;
            if let Err(e) = processor.process_routines().await {
                error!("Error processing routines: {}", e);
            }
        }
    });

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
        .layer(Extension(pool))
        .layer(cors);
    let listener = TcpListener::bind("0.0.0.0:5057").await.unwrap();
    println!("Listening on {}", "0.0.0.0:5057");
    axum::serve(listener, app.into_make_service())
        .await
        .unwrap();
}
