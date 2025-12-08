use neo4rs::{ConfigBuilder, Graph, Result};
use std::env;

pub async fn create_pool() -> Result<Graph> {
    println!("🔄 Starting Neo4j database connection...");
    
    // Retrieve connection parameters from environment variables
    let neo4j_uri = env::var("NEO4J_URI").expect("NEO4J_URI must be set");
    let neo4j_username = env::var("NEO4J_USERNAME").expect("NEO4J_USERNAME must be set");
    let neo4j_password = env::var("NEO4J_PASSWORD").expect("NEO4J_PASSWORD must be set");

    // Log connection details (without password)
    println!("📡 Neo4j Connection Details:");
    println!("   URI: {}", neo4j_uri);
    println!("   Username: {}", neo4j_username);
    println!("   Password: [REDACTED] (length: {})", neo4j_password.len());
    
    // Check if URI looks valid
    if !neo4j_uri.starts_with("neo4j://") && !neo4j_uri.starts_with("bolt://") && !neo4j_uri.starts_with("neo4j+s://") && !neo4j_uri.starts_with("bolt+s://") {
        println!("⚠️  WARNING: URI format might be incorrect. Expected format: neo4j://host:port or bolt://host:port");
    }

    println!("🔧 Building Neo4j configuration...");

    // Configure the connection pool
    let max_connections = env::var("NEO4J_MAX_CONNECTIONS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(5);

    println!("   Max Connections: {}", max_connections);

    let config = match ConfigBuilder::default()
        .uri(&neo4j_uri)
        .user(&neo4j_username)
        .password(&neo4j_password)
        .max_connections(max_connections) // Limit max connections
        .build() {
            Ok(config) => {
                println!("✅ Neo4j configuration built successfully");
                config
            },
            Err(e) => {
                println!("❌ Failed to build Neo4j configuration: {:?}", e);
                return Err(e);
            }
        };

    println!("🔄 Attempting to connect to Neo4j database...");
    println!("   This may take a moment if the database is starting up...");

    // Connect to the Neo4j database with configuration
    match Graph::connect(config).await {
        Ok(graph) => {
            println!("✅ Successfully connected to Neo4j database!");
            
            // Test the connection with a simple query
            println!("🔍 Testing database connection with a simple query...");
            match graph.run(neo4rs::Query::new("RETURN 1 as test".to_string())).await {
                Ok(_) => {
                    println!("✅ Database connection test successful!");
                },
                Err(e) => {
                    println!("⚠️  Database connected but test query failed: {:?}", e);
                }
            }
            
            Ok(graph)
        },
        Err(e) => {
            println!("❌ Failed to connect to Neo4j database!");
            println!("   Error details: {:?}", e);
            println!("   Error type: {}", std::any::type_name_of_val(&e));
            
            // Provide troubleshooting tips
            println!("🔧 Troubleshooting tips:");
            println!("   1. Check if Neo4j is running: docker ps | grep neo4j");
            println!("   2. Verify the URI is correct (should be neo4j://host:port)");
            println!("   3. Check if the port is accessible: telnet host port");
            println!("   4. Verify Docker network connectivity if using containers");
            println!("   5. Check Neo4j logs for startup issues");
            
            Err(e)
        }
    }
}
