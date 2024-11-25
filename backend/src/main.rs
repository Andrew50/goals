mod auth;
mod calender;
mod db;
mod goal;
mod middleware;
mod network;
mod traversal;

use axum::{middleware::from_fn, Extension, Router};
use dotenvy::dotenv;
use hyper::header::HeaderValue;
use tokio::net::TcpListener;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tracing::Level;
use tracing_subscriber;

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

    // Set up the application router
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
        .layer(Extension(pool))
        .layer(cors);

    // Set the server address
    //let addr = SocketAddr::from(([0, 0, 0, 0], 5057));
    let listener = TcpListener::bind("0.0.0.0:5057").await.unwrap();
    println!("Listening on {}", "0.0.0.0:5057");
    axum::serve(listener, app.into_make_service())
        .await
        .unwrap();

    // Start the server
    /*Server::bind(&addr)
    .serve(app.into_make_service())
        .await
        .unwrap();*/
}
