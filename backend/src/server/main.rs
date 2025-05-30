use dotenvy::dotenv;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};
use tracing::Level;
use tokio_cron_scheduler::{Job, JobScheduler};

use crate::server::db;
use crate::server::http_handler;
use crate::jobs::routine_generator;

type UserLocks = Arc<Mutex<HashMap<i64, Arc<Mutex<()>>>>>;

#[tokio::main]
pub async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt().with_max_level(Level::INFO).init();
    dotenv().ok();

    let pool = match db::create_pool().await {
        Ok(pool) => pool,
        Err(e) => {
            eprintln!("Error creating database pool: {}", e);
            return Err(e.into());
        }
    };

    println!("Database connection pool created successfully");

    // Set up the scheduler for background jobs
    let scheduler = JobScheduler::new().await?;
    
    // Clone the pool for the scheduler
    let scheduler_pool = pool.clone();
    
    // Schedule routine event generation to run every hour
    let routine_job = Job::new_async("0 0 * * * *", move |_uuid, _l| {
        let pool = scheduler_pool.clone();
        Box::pin(async move {
            println!("Running scheduled routine event generation...");
            routine_generator::run_routine_generator(pool).await;
        })
    })?;
    
    scheduler.add(routine_job).await?;
    
    // Start the scheduler
    scheduler.start().await?;
    println!("Scheduler started - routine events will be generated hourly");

    let host_url = std::env::var("HOST_URL").unwrap_or_else(|_| "http://localhost".to_string());
    let frontend_origin = format!("{host_url}:3030");

    let cors = CorsLayer::new()
        .allow_origin([
            frontend_origin.parse().unwrap(),
            "https://goals.atlantis.trading".parse().unwrap(),
        ])
        .allow_methods(Any)
        .allow_headers(Any);

    let user_locks: UserLocks = Arc::new(Mutex::new(HashMap::new()));

    let app = http_handler::create_routes(pool.clone(), user_locks.clone()).layer(cors);

    let listener = TcpListener::bind("0.0.0.0:5059").await.unwrap();
    println!("Listening on 0.0.0.0:5059");
    axum::serve(listener, app.into_make_service())
        .await
        .unwrap();

    Ok(())
}
