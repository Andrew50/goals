use dotenvy::dotenv;
use neo4rs::{ConfigBuilder, Graph};
use std::env;

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
                let force = args.len() > 2 && args[2] == "--force";
                run_migration(force).await?;
                return Ok(());
            }
            "verify-migration" => {
                verify_migration().await?;
                return Ok(());
            }
            "reset-migration" => {
                reset_migration().await?;
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
            "migrate-resolution-status" => {
                run_resolution_status_migration().await?;
                return Ok(());
            }
            _ => {
                eprintln!("Unknown command: {}", args[1]);
                eprintln!("Available commands:");
                eprintln!("  migrate [--force]            - Run the event migration");
                eprintln!("  migrate-resolution-status    - Migrate from completed to resolution_status");
                eprintln!("  verify-migration             - Verify migration integrity");
                eprintln!("  reset-migration              - Reset migration status (for development)");
                eprintln!("  rollback-migration <backup>  - Rollback migration from backup");
                std::process::exit(1);
            }
        }
    }

    // Default: Start the server (delegate to server/main.rs)
    server::main::start_server().await
}

async fn run_migration(force: bool) -> Result<(), Box<dyn std::error::Error>> {
    println!("🚀 Starting event migration...");

    if force {
        println!("⚠️ Force flag detected - bypassing migration status check");
    }

    let graph = create_graph_connection().await?;

    let result = if force {
        tools::migration::migrate_to_events_force(&graph).await
    } else {
        tools::migration::migrate_to_events(&graph).await
    };

    match result {
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

async fn reset_migration() -> Result<(), Box<dyn std::error::Error>> {
    println!("🔄 Resetting migration status...");

    let graph = create_graph_connection().await?;

    match tools::migration::reset_migration_status(&graph).await {
        Ok(_) => {
            println!("✅ Migration status reset successfully!");
            println!("💡 You can now run the migration again.");
        }
        Err(e) => {
            eprintln!("❌ Failed to reset migration status: {}", e);
            std::process::exit(1);
        }
    }

    Ok(())
}

async fn run_resolution_status_migration() -> Result<(), Box<dyn std::error::Error>> {
    println!("🚀 Running resolution_status migration...");

    let graph = create_graph_connection().await?;

    match tools::migration::migrate_to_resolution_status(&graph).await {
        Ok(result) => {
            println!("✅ Migration completed successfully!");
            println!("📊 Migration results:");
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Err(e) => {
            eprintln!("❌ Migration failed: {}", e);
            std::process::exit(1);
        }
    }

    Ok(())
}

async fn create_graph_connection() -> Result<Graph, Box<dyn std::error::Error>> {
    let neo4j_uri = env::var("NEO4J_URI").unwrap_or_else(|_| "bolt://localhost:7687".to_string());
    let neo4j_user = env::var("NEO4J_USER").unwrap_or_else(|_| "neo4j".to_string());
    let neo4j_password = env::var("NEO4J_PASSWORD").unwrap_or_else(|_| "password".to_string());
    let max_connections = env::var("NEO4J_MAX_CONNECTIONS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(5);

    println!("🔗 Connecting to Neo4j at {}...", neo4j_uri);
    println!("   Max Connections: {}", max_connections);

    let config = ConfigBuilder::default()
        .uri(&neo4j_uri)
        .user(&neo4j_user)
        .password(&neo4j_password)
        .max_connections(max_connections)
        .db("neo4j")
        .build()?;

    let graph = Graph::connect(config).await?;
    println!("✅ Connected to Neo4j successfully!");

    Ok(graph)
}
