use dotenvy::dotenv;
use neo4rs::{Config, Graph};
use std::collections::HashMap;
use std::env;
use std::sync::Arc;
use tokio::sync::Mutex;

mod ai;
mod jobs;
mod server;
mod tools;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load environment variables
    dotenv().ok();

    // Check for command line arguments
    let args: Vec<String> = env::args().collect();

    if args.len() > 1 {
        match args[1].as_str() {
            "migrate" => {
                run_migration().await?;
                return Ok(());
            }
            "verify-migration" => {
                verify_migration().await?;
                return Ok(());
            }
            "rollback-migration" => {
                if args.len() < 3 {
                    eprintln!("Usage: cargo run rollback-migration <backup_file>");
                    std::process::exit(1);
                }
                rollback_migration(&args[2]).await?;
                return Ok(());
            }
            _ => {
                eprintln!("Unknown command: {}", args[1]);
                eprintln!("Available commands:");
                eprintln!("  migrate           - Run the event migration");
                eprintln!("  verify-migration  - Verify migration integrity");
                eprintln!("  rollback-migration <backup_file> - Rollback migration from backup");
                std::process::exit(1);
            }
        }
    }

    // Default: Start the server
    start_server().await
}

async fn run_migration() -> Result<(), Box<dyn std::error::Error>> {
    println!("🚀 Starting event migration...");

    let graph = create_graph_connection().await?;

    match tools::migration::migrate_to_events(&graph).await {
        Ok(_) => {
            println!("✅ Migration completed successfully!");

            // Automatically run verification
            println!("🔍 Running verification...");
            match tools::migration::verify_migration_integrity(&graph).await {
                Ok(result) => {
                    println!("✅ Migration verification completed!");
                    println!("📊 Verification results:");
                    println!("{}", serde_json::to_string_pretty(&result)?);
                }
                Err(e) => {
                    eprintln!("⚠️ Migration verification failed: {}", e);
                    eprintln!("Migration completed but data integrity issues detected.");
                }
            }
        }
        Err(e) => {
            eprintln!("❌ Migration failed: {}", e);
            eprintln!("Please check the error details and try again.");
            std::process::exit(1);
        }
    }

    Ok(())
}

async fn verify_migration() -> Result<(), Box<dyn std::error::Error>> {
    println!("🔍 Verifying migration integrity...");

    let graph = create_graph_connection().await?;

    match tools::migration::verify_migration_integrity(&graph).await {
        Ok(result) => {
            println!("✅ Migration verification completed!");
            println!("📊 Verification results:");
            println!("{}", serde_json::to_string_pretty(&result)?);

            let is_healthy = result
                .get("migration_healthy")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            if !is_healthy {
                println!("⚠️ Warning: Migration issues detected. Please review the results above.");
                std::process::exit(1);
            }
        }
        Err(e) => {
            eprintln!("❌ Migration verification failed: {}", e);
            std::process::exit(1);
        }
    }

    Ok(())
}

async fn rollback_migration(backup_file: &str) -> Result<(), Box<dyn std::error::Error>> {
    println!("⏪ Rolling back migration...");
    eprintln!("❌ Rollback from backup file not implemented yet.");
    eprintln!("Note: Rollback should be implemented based on your backup strategy.");
    eprintln!("Backup file specified: {}", backup_file);

    // TODO: Implement rollback from backup
    // This would involve:
    // 1. Loading the backup file
    // 2. Restoring the database state
    // 3. Verifying the rollback

    Ok(())
}

async fn create_graph_connection() -> Result<Graph, Box<dyn std::error::Error>> {
    let neo4j_uri = env::var("NEO4J_URI").unwrap_or_else(|_| "bolt://localhost:7687".to_string());
    let neo4j_user = env::var("NEO4J_USER").unwrap_or_else(|_| "neo4j".to_string());
    let neo4j_password = env::var("NEO4J_PASSWORD").unwrap_or_else(|_| "password".to_string());

    println!("🔗 Connecting to Neo4j at {}...", neo4j_uri);

    let config = Config::new()
        .uri(&neo4j_uri)
        .user(&neo4j_user)
        .password(&neo4j_password)
        .db("neo4j");

    let graph = Graph::connect(config).await?;
    println!("✅ Connected to Neo4j successfully!");

    Ok(graph)
}

async fn start_server() -> Result<(), Box<dyn std::error::Error>> {
    println!("🚀 Starting Goals server...");

    let graph = create_graph_connection().await?;

    // Initialize user locks for routine processing
    let user_locks: Arc<Mutex<HashMap<i64, Arc<Mutex<()>>>>> = Arc::new(Mutex::new(HashMap::new()));

    // Create router with the graph connection and user locks
    let app = server::http_handler::create_routes(graph.clone(), user_locks.clone());

    // Start background job for routine processing (optional)
    let routine_graph = graph.clone();
    tokio::spawn(async move {
        // Run routine generator periodically
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(3600)); // Every hour
        loop {
            interval.tick().await;
            jobs::routine_generator::run_routine_generator(routine_graph.clone()).await;
        }
    });

    // Start the server
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await?;
    println!("✅ Server running on http://0.0.0.0:3001");

    axum::serve(listener, app).await?;

    Ok(())
}
