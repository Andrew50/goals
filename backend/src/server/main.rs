use dotenvy::dotenv;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;
use tracing::Level;
use tokio_cron_scheduler::{Job, JobScheduler};
use std::env;

use crate::server::db;
use crate::server::http_handler;
use crate::jobs::routine_generator;

type UserLocks = Arc<Mutex<HashMap<i64, Arc<Mutex<()>>>>>;

#[tokio::main]
pub async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🚀 Starting Goals Backend Server...");
    
    tracing_subscriber::fmt().with_max_level(Level::INFO).init();
    println!("✅ Tracing subscriber initialized");
    
    println!("🔧 Loading environment variables...");
    dotenv().ok();
    
    // Log environment variables (without sensitive data)
    println!("🌍 Environment Configuration:");
    println!("   NEO4J_URI: {}", env::var("NEO4J_URI").unwrap_or_else(|_| "[NOT SET]".to_string()));
    println!("   NEO4J_USERNAME: {}", env::var("NEO4J_USERNAME").unwrap_or_else(|_| "[NOT SET]".to_string()));
    println!("   NEO4J_PASSWORD: [{}]", if env::var("NEO4J_PASSWORD").is_ok() { "SET" } else { "NOT SET" });
    println!("   JWT_SECRET: [{}]", if env::var("JWT_SECRET").is_ok() { "SET" } else { "NOT SET" });
    println!("   HOST_URL: {}", env::var("HOST_URL").unwrap_or_else(|_| "[NOT SET - will use localhost]".to_string()));

    println!("🔄 Creating database connection pool...");
    println!("   This is the critical step that's been failing...");
    
    let pool = match db::create_pool().await {
        Ok(pool) => {
            println!("✅ Database connection pool created successfully!");
            pool
        },
        Err(e) => {
            println!("❌ CRITICAL ERROR: Failed to create database pool!");
            println!("   Error details: {:?}", e);
            println!("   Error type: {}", std::any::type_name_of_val(&e));
            
            // More detailed error analysis
            let error_string = format!("{:?}", e);
            if error_string.contains("Connection refused") {
                println!("🚨 DIAGNOSIS: Connection refused error detected!");
                println!("   This typically means:");
                println!("   - Neo4j database is not running");
                println!("   - Wrong host/port in NEO4J_URI");
                println!("   - Docker networking issues");
                println!("   - Firewall blocking connections");
            } else if error_string.contains("Network is unreachable") {
                println!("🚨 DIAGNOSIS: Network unreachable error!");
                println!("   Check Docker network configuration");
            } else if error_string.contains("Invalid") {
                println!("🚨 DIAGNOSIS: Configuration error!");
                println!("   Check NEO4J_URI format and credentials");
            }
            
            eprintln!("Error creating database pool: {}", e);
            return Err(e.into());
        }
    };

    println!("✅ Database connection pool created successfully");

    println!("🔧 Setting up background job scheduler...");
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
    println!("✅ Scheduler started - routine events will be generated hourly");

    println!("🌐 Configuring CORS and server settings...");
    let host_url = std::env::var("HOST_URL").unwrap_or_else(|_| "localhost".to_string());
    

    // Determine if we're in development or production based on HOST_URL
    let is_development = host_url == "localhost" || host_url.starts_with("127.0.0.1");
    
    let frontend_origin = if is_development {
        format!("http://{}:3030", host_url)
    } else {
        // In production, use HTTPS and no port (goes through router)
        format!("https://{}", host_url)
    };
    
    println!("   Environment: {}", if is_development { "Development" } else { "Production" });
    println!("   Frontend origin: {}", frontend_origin);

    let cors = CorsLayer::new()
        .allow_origin([
            frontend_origin.parse().unwrap(),
        ])
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PUT,
            axum::http::Method::DELETE,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
            axum::http::header::ACCEPT,
        ])
        .allow_credentials(false);

    println!("🔐 Initializing user locks for routine processing...");
    let user_locks: UserLocks = Arc::new(Mutex::new(HashMap::new()));

    println!("🛣️ Setting up HTTP routes...");
    let app = http_handler::create_routes(pool.clone(), user_locks.clone()).layer(cors);

    println!("🔌 Binding to server address...");
    let listener = TcpListener::bind("0.0.0.0:5059").await.unwrap();
    println!("✅ Server successfully bound to 0.0.0.0:5059");
    println!("🚀 Server is now listening and ready to accept connections!");
    println!("   Access the API at: http://localhost:5059");
    
    axum::serve(listener, app.into_make_service())
        .await
        .unwrap();

    Ok(())
}
