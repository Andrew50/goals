use crate::ai::openrouter::call_openrouter;
use crate::tools::goal::GoalType;
use axum::{http::StatusCode, Json};
use neo4rs::{query, Graph};
use serde::{Deserialize, Serialize};

const NETWORK_COMPLETED_AGE_LIMIT_DAYS: i64 = 30;
const NETWORK_NODE_LIMIT: usize = 150;
const TEMPORAL_RANGE_DAYS: i64 = 3;

#[derive(Deserialize, Debug)]
pub struct AutofillRequest {
    pub field_name: String,
    pub current_value: Option<String>,
    pub goal_context: PartialGoalContext,
    pub parent_ids: Option<Vec<i64>>,
    pub child_ids: Option<Vec<i64>>,
    pub allowed_values: Option<Vec<String>>,
    pub allowed_goals: Option<Vec<AllowedGoal>>,
}

#[derive(Deserialize, Debug, Serialize)]
pub struct AllowedGoal {
    pub id: i64,
    pub name: String,
    pub goal_type: String,
}

#[derive(Deserialize, Debug)]
pub struct PartialGoalContext {
    pub name: Option<String>,
    pub description: Option<String>,
    pub goal_type: Option<GoalType>,
    pub start_timestamp: Option<i64>,
    #[allow(dead_code)]
    pub end_timestamp: Option<i64>,
    pub scheduled_timestamp: Option<i64>,
    pub duration: Option<i32>,
    pub priority: Option<String>,
    pub resolution_status: Option<String>,
    pub frequency: Option<String>,
    #[allow(dead_code)]
    pub routine_time: Option<i64>,
    #[allow(dead_code)]
    pub routine_type: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AutofillResponse {
    pub suggestions: Vec<String>,
}

async fn fetch_similar_goals(
    graph: &Graph,
    user_id: i64,
    goal_type: Option<GoalType>,
) -> Result<Vec<String>, neo4rs::Error> {
    if goal_type.is_none() {
        return Ok(vec![]);
    }
    let gt = goal_type.unwrap().as_str();
    let q = query(
        "MATCH (g:Goal) 
         WHERE g.user_id = $user_id AND g.goal_type = $goal_type
         RETURN g.name, g.description 
         ORDER BY id(g) DESC 
         LIMIT 10",
    )
    .param("user_id", user_id)
    .param("goal_type", gt);

    let mut result = graph.execute(q).await?;
    let mut goals = Vec::new();
    while let Some(row) = result.next().await? {
        let name: String = row.get("g.name").unwrap_or_default();
        let desc: String = row.get("g.description").unwrap_or_default();
        if !name.is_empty() {
            goals.push(format!("Name: {}, Description: {}", name, desc));
        }
    }
    Ok(goals)
}

async fn fetch_nearby_goals(
    graph: &Graph,
    user_id: i64,
    timestamp: i64,
) -> Result<Vec<String>, neo4rs::Error> {
    let start = timestamp - (TEMPORAL_RANGE_DAYS * 24 * 60 * 60 * 1000);
    let end = timestamp + (TEMPORAL_RANGE_DAYS * 24 * 60 * 60 * 1000);

    let q = query(
        "MATCH (g:Goal) 
         WHERE g.user_id = $user_id 
         AND (
            (g.start_timestamp >= $start AND g.start_timestamp <= $end) OR
            (g.scheduled_timestamp >= $start AND g.scheduled_timestamp <= $end)
         )
         RETURN g.name, g.start_timestamp, g.scheduled_timestamp
         LIMIT 10",
    )
    .param("user_id", user_id)
    .param("start", start)
    .param("end", end);

    let mut result = graph.execute(q).await?;
    let mut goals = Vec::new();
    while let Some(row) = result.next().await? {
        let name: String = row.get("g.name").unwrap_or_default();
        if !name.is_empty() {
            goals.push(format!("Goal: {}", name));
        }
    }
    Ok(goals)
}

async fn fetch_goal_network_map(
    graph: &Graph,
    user_id: i64,
) -> Result<String, neo4rs::Error> {
    let cutoff = chrono::Utc::now().timestamp_millis() - (NETWORK_COMPLETED_AGE_LIMIT_DAYS * 24 * 60 * 60 * 1000);
    
    let q = query(
        "MATCH (g:Goal)
         WHERE g.user_id = $user_id
           AND g.goal_type <> 'event'
           AND coalesce(g.is_deleted, false) = false
           AND (coalesce(g.resolution_status, 'pending') <> 'completed' OR g.resolved_at >= $cutoff)
         OPTIONAL MATCH (parent:Goal)-[:CHILD]->(g)
         WHERE coalesce(parent.is_deleted, false) = false
         RETURN id(g) as id, g.name as name, g.goal_type as type, collect(id(parent)) as parent_ids"
    )
    .param("user_id", user_id)
    .param("cutoff", cutoff);

    let mut result = graph.execute(q).await?;
    
    #[derive(Clone)]
    struct Node {
        id: i64,
        name: String,
        goal_type: String,
        parent_ids: Vec<i64>,
        children: Vec<i64>,
    }
    
    let mut nodes = std::collections::HashMap::new();
    while let Some(row) = result.next().await? {
        let id: i64 = row.get("id").unwrap_or(0);
        let name: String = row.get("name").unwrap_or_default();
        let goal_type: String = row.get("type").unwrap_or_default();
        let parent_ids: Vec<i64> = row.get("parent_ids").unwrap_or_default();
        
        nodes.insert(id, Node {
            id,
            name,
            goal_type,
            parent_ids,
            children: Vec::new(),
        });
    }
    
    // Populate children
    let mut roots = Vec::new();
    let node_ids: Vec<i64> = nodes.keys().copied().collect();
    for id in node_ids {
        let parent_ids = nodes.get(&id).unwrap().parent_ids.clone();
        if parent_ids.is_empty() {
            roots.push(id);
        } else {
            let mut is_root = true;
            for pid in parent_ids {
                if let Some(parent) = nodes.get_mut(&pid) {
                    parent.children.push(id);
                    is_root = false;
                }
            }
            if is_root {
                roots.push(id);
            }
        }
    }
    
    // Sort roots for deterministic traversal
    roots.sort_unstable();
    
    let mut visited = std::collections::HashSet::new();
    let mut ordered = Vec::new();
    
    fn dfs(
        node_id: i64, 
        nodes: &std::collections::HashMap<i64, Node>, 
        visited: &mut std::collections::HashSet<i64>,
        ordered: &mut Vec<i64>
    ) {
        if ordered.len() >= NETWORK_NODE_LIMIT {
            return;
        }
        if !visited.insert(node_id) {
            return;
        }
        ordered.push(node_id);
        
        if let Some(node) = nodes.get(&node_id) {
            let mut sorted_children = node.children.clone();
            sorted_children.sort_unstable();
            for child_id in sorted_children {
                dfs(child_id, nodes, visited, ordered);
            }
        }
    }
    
    for root in roots {
        dfs(root, &nodes, &mut visited, &mut ordered);
        if ordered.len() >= NETWORK_NODE_LIMIT {
            break;
        }
    }
    
    let mut out = Vec::new();
    for id in ordered {
        if let Some(n) = nodes.get(&id) {
            let parent_str = if n.parent_ids.is_empty() {
                "None".to_string()
            } else {
                format!("{:?}", n.parent_ids)
            };
            out.push(format!("[ID: {}] {}: \"{}\" (Parents: {})", n.id, n.goal_type, n.name, parent_str));
        }
    }
    
    Ok(out.join("\n"))
}

pub async fn get_autofill_suggestions(
    graph: Graph,
    user_id: i64,
    request: AutofillRequest,
) -> Result<Json<AutofillResponse>, (StatusCode, String)> {
    // 1. Gather Context
    let mut context_parts = Vec::new();

    // Goal Context
    context_parts.push(format!("Field to fill: {}", request.field_name));
    if let Some(val) = &request.current_value {
        context_parts.push(format!("Current value: {}", val));
    }
    if let Some(name) = &request.goal_context.name {
        context_parts.push(format!("Goal Name: {}", name));
    }
    if let Some(desc) = &request.goal_context.description {
        context_parts.push(format!("Goal Description: {}", desc));
    }
    if let Some(gt) = request.goal_context.goal_type {
        context_parts.push(format!("Goal Type: {:?}", gt));
    }
    if let Some(priority) = &request.goal_context.priority {
        context_parts.push(format!("Priority: {}", priority));
    }
    if let Some(status) = &request.goal_context.resolution_status {
        context_parts.push(format!("Resolution Status: {}", status));
    }
    if let Some(duration) = request.goal_context.duration {
        context_parts.push(format!("Duration: {} minutes", duration));
    }
    if let Some(freq) = &request.goal_context.frequency {
        context_parts.push(format!("Frequency: {}", freq));
    }
    if let Some(parents) = &request.parent_ids {
        if !parents.is_empty() {
            context_parts.push(format!("Direct Parent IDs: {:?}", parents));
        }
    }
    if let Some(children) = &request.child_ids {
        if !children.is_empty() {
            context_parts.push(format!("Direct Child IDs: {:?}", children));
        }
    }

    // Allowed options
    if let Some(allowed) = &request.allowed_values {
        if !allowed.is_empty() {
            context_parts.push(format!("Allowed values for this field: {:?}", allowed));
        }
    }
    if let Some(allowed_goals) = &request.allowed_goals {
        if !allowed_goals.is_empty() {
            context_parts.push("Selectable goals for this field:".to_string());
            for g in allowed_goals {
                context_parts.push(format!("ID: {}, Name: {}, Type: {}", g.id, g.name, g.goal_type));
            }
        }
    }

    // Goal Network Map
    match fetch_goal_network_map(&graph, user_id).await {
        Ok(network_map) => {
            if !network_map.is_empty() {
                context_parts.push("=== User's Goal Network ===".to_string());
                context_parts.push(network_map);
            }
        }
        Err(e) => eprintln!("Error fetching goal network map: {}", e),
    }

    // Nearby Goals
    let timestamp = request
        .goal_context
        .scheduled_timestamp
        .or(request.goal_context.start_timestamp);
    if let Some(ts) = timestamp {
        match fetch_nearby_goals(&graph, user_id, ts).await {
            Ok(nearby) => {
                if !nearby.is_empty() {
                    context_parts.push("Nearby Goals (Temporal):".to_string());
                    context_parts.extend(nearby);
                }
            }
            Err(e) => eprintln!("Error fetching nearby goals: {}", e),
        }
    }

    // Similar Goals
    match fetch_similar_goals(&graph, user_id, request.goal_context.goal_type).await {
        Ok(similar) => {
            if !similar.is_empty() {
                context_parts.push("Similar Recent Goals:".to_string());
                context_parts.extend(similar);
            }
        }
        Err(e) => eprintln!("Error fetching similar goals: {}", e),
    }

    let input_str = context_parts.join("\n");

    // 2. Call OpenRouter
    match call_openrouter("autofill_suggestions", Some(&input_str)).await {
        Ok(response_text) => {
            // 3. Parse Response
            // Expecting strict JSON from prompt: { "suggestions": ["..."] }
            // Clean up code blocks if present
            let clean_text = response_text
                .trim()
                .trim_start_matches("```json")
                .trim_start_matches("```")
                .trim_end_matches("```")
                .trim();

            match serde_json::from_str::<AutofillResponse>(clean_text) {
                Ok(resp) => Ok(Json(resp)),
                Err(e) => {
                    eprintln!("Failed to parse autofill response: {}. Text: {}", e, clean_text);
                    // Fallback: try to extract lines if not JSON
                    let suggestions: Vec<String> = clean_text
                        .lines()
                        .filter(|l| !l.trim().is_empty())
                        .take(3)
                        .map(|l| l.trim().trim_start_matches("- ").trim_start_matches("* ").to_string())
                        .collect();
                    Ok(Json(AutofillResponse { suggestions }))
                }
            }
        }
        Err(e) => {
            eprintln!("OpenRouter call failed: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("AI service failed: {}", e),
            ))
        }
    }
}


