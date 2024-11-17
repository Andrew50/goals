use neo4rs::{Graph, Result};
use std::env;

pub async fn create_pool() -> Result<Graph> {
    // Retrieve connection parameters from environment variables
    let neo4j_uri = env::var("NEO4J_URI").expect("NEO4J_URI must be set");
    let neo4j_username = env::var("NEO4J_USERNAME").expect("NEO4J_USERNAME must be set");
    let neo4j_password = env::var("NEO4J_PASSWORD").expect("NEO4J_PASSWORD must be set");

    // Connect to the Neo4j database
    Graph::new(&neo4j_uri, &neo4j_username, &neo4j_password).await
}
