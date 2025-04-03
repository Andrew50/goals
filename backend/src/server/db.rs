use neo4rs::{ConfigBuilder, Graph, Result};
use std::env;

pub async fn create_pool() -> Result<Graph> {
    // Retrieve connection parameters from environment variables
    let neo4j_uri = env::var("NEO4J_URI").expect("NEO4J_URI must be set");
    let neo4j_username = env::var("NEO4J_USERNAME").expect("NEO4J_USERNAME must be set");
    let neo4j_password = env::var("NEO4J_PASSWORD").expect("NEO4J_PASSWORD must be set");

    // Configure the connection pool
    let config = ConfigBuilder::default()
        .uri(&neo4j_uri)
        .user(&neo4j_username)
        .password(&neo4j_password)
        .max_connections(5) // Limit max connections
        .build()?;

    // Connect to the Neo4j database with configuration
    Graph::connect(config).await
}
