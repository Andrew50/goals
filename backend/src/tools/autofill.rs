use crate::ai::openrouter::call_openrouter;
use crate::tools::goal::GoalType;
use axum::{http::StatusCode, Json};
use neo4rs::{query, Graph};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Debug)]
pub struct AutofillRequest {
    pub field_name: String,
    pub current_value: Option<String>,
    pub goal_context: PartialGoalContext,
    pub parent_ids: Option<Vec<i64>>,
    pub child_ids: Option<Vec<i64>>,
}

#[derive(Deserialize, Debug)]
pub struct PartialGoalContext {
    pub name: Option<String>,
    pub description: Option<String>,
    pub goal_type: Option<GoalType>,
    pub start_timestamp: Option<i64>,
    pub scheduled_timestamp: Option<i64>,
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
         LIMIT 5",
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
    // +/- 7 days
    let start = timestamp - (7 * 24 * 60 * 60 * 1000);
    let end = timestamp + (7 * 24 * 60 * 60 * 1000);

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

async fn fetch_related_goals(
    graph: &Graph,
    ids: &[i64],
    relation: &str,
) -> Result<Vec<String>, neo4rs::Error> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    
    // Manual query construction since neo4rs might not support IN clause with param list easily in all versions, 
    // but usually it does. Let's try unwinding.
    let q = query(
        "UNWIND $ids as gid
         MATCH (g:Goal) WHERE id(g) = gid
         RETURN g.name, g.goal_type",
    )
    .param("ids", ids.to_vec());

    let mut result = graph.execute(q).await?;
    let mut goals = Vec::new();
    while let Some(row) = result.next().await? {
        let name: String = row.get("g.name").unwrap_or_default();
        let gt: String = row.get("g.goal_type").unwrap_or_default();
        if !name.is_empty() {
            goals.push(format!("{} ({}): {}", relation, gt, name));
        }
    }
    Ok(goals)
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

    // Related Goals
    if let Some(parents) = &request.parent_ids {
        if !parents.is_empty() {
            match fetch_related_goals(&graph, parents, "Parent").await {
                Ok(rels) => context_parts.extend(rels),
                Err(e) => eprintln!("Error fetching parents: {}", e),
            }
        }
    }
    if let Some(children) = &request.child_ids {
        if !children.is_empty() {
            match fetch_related_goals(&graph, children, "Child").await {
                Ok(rels) => context_parts.extend(rels),
                Err(e) => eprintln!("Error fetching children: {}", e),
            }
        }
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


