use axum::{http::StatusCode, Json};
use neo4rs::{query, Graph};
use serde::Serialize;

use crate::tools::goal::{Goal, GoalType, GOAL_RETURN_QUERY};

#[derive(Debug, Serialize)]
pub struct GoalRelationsResponse {
    pub parents: Vec<Goal>,
    pub children: Vec<Goal>,
}

#[derive(Debug, Serialize)]
pub struct GoalSubgraphResponse {
    pub nodes: Vec<Goal>,
    pub edges: Vec<SubgraphEdge>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct SubgraphEdge {
    pub from: i64,
    pub to: i64,
    pub relationship_type: String,
}

const MAX_DEPTH: i32 = 50;
const MAX_NODES: usize = 2000;

pub async fn get_goal_relations(
    graph: Graph,
    user_id: i64,
    goal_id: i64,
) -> Result<Json<GoalRelationsResponse>, (StatusCode, String)> {
    // First, fetch the goal to determine its type
    let goal_query = query(&format!(
        "MATCH (g:Goal) 
         WHERE id(g) = $goal_id AND g.user_id = $user_id
         {}",
        GOAL_RETURN_QUERY
    ))
    .param("goal_id", goal_id)
    .param("user_id", user_id);

    let mut goal_result = graph.execute(goal_query).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error fetching goal: {}", e),
        )
    })?;

    let goal_row = goal_result.next().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error fetching goal row: {}", e),
        )
    })?;

    let goal: Goal = match goal_row {
        Some(row) => {
            row.get("g").map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Error deserializing goal: {}", e),
                )
            })?
        },
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                format!("Goal with id {} not found", goal_id),
            ));
        }
    };

    let mut parents = Vec::new();
    let mut children = Vec::new();

    if goal.goal_type == GoalType::Event {
        // For events: get parent via HAS_EVENT relationship or parent_id fallback
        // Try HAS_EVENT relationship first
        let has_event_query_str = format!(
            "MATCH (p:Goal)-[:HAS_EVENT]->(e:Goal)
             WHERE id(e) = $event_id 
               AND p.user_id = $user_id 
               AND e.user_id = $user_id
             RETURN {{
                    name: p.name,
                    description: p.description,
                    goal_type: p.goal_type,
                    user_id: p.user_id,
                    priority: p.priority,
                    start_timestamp: p.start_timestamp,
                    end_timestamp: p.end_timestamp,
                    resolution_status: p.resolution_status,
                    resolved_at: p.resolved_at,
                    next_timestamp: p.next_timestamp,
                    scheduled_timestamp: p.scheduled_timestamp,
                    duration: p.duration,
                    frequency: p.frequency,
                    routine_type: p.routine_type,
                    routine_time: p.routine_time,
                    position_x: p.position_x,
                    position_y: p.position_y,
                    parent_id: p.parent_id,
                    parent_type: p.parent_type,
                    routine_instance_id: p.routine_instance_id,
                    is_deleted: p.is_deleted,
                    due_date: p.due_date,
                    start_date: p.start_date,
                    gcal_event_id: p.gcal_event_id,
                    gcal_calendar_id: p.gcal_calendar_id,
                    gcal_sync_enabled: p.gcal_sync_enabled,
                    gcal_last_sync: p.gcal_last_sync,
                    gcal_sync_direction: p.gcal_sync_direction,
                    is_gcal_imported: p.is_gcal_imported,
                    updated_at: p.updated_at,
                    id: id(p)
                 }} as p"
        );
        let has_event_query = query(&has_event_query_str)
            .param("event_id", goal_id)
            .param("user_id", user_id);

        let mut has_event_result = graph.execute(has_event_query).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error fetching event parent via HAS_EVENT: {}", e),
            )
        })?;

        let mut found_via_relationship = false;
        while let Ok(Some(row)) = has_event_result.next().await {
            if let Ok(parent) = row.get::<Goal>("p") {
                parents.push(parent);
                found_via_relationship = true;
            }
        }

        // If not found via relationship, try parent_id fallback
        if !found_via_relationship {
            if let Some(parent_id) = goal.parent_id {
                // Now query with user_id filter
                let parent_id_query_str = format!(
                    "MATCH (parent:Goal)
                     WHERE id(parent) = $parent_id AND parent.user_id = $user_id
                     RETURN {{
                    name: parent.name,
                    description: parent.description,
                    goal_type: parent.goal_type,
                    user_id: parent.user_id,
                    priority: parent.priority,
                    start_timestamp: parent.start_timestamp,
                    end_timestamp: parent.end_timestamp,
                    resolution_status: parent.resolution_status,
                    resolved_at: parent.resolved_at,
                    next_timestamp: parent.next_timestamp,
                    scheduled_timestamp: parent.scheduled_timestamp,
                    duration: parent.duration,
                    frequency: parent.frequency,
                    routine_type: parent.routine_type,
                    routine_time: parent.routine_time,
                    position_x: parent.position_x,
                    position_y: parent.position_y,
                    parent_id: parent.parent_id,
                    parent_type: parent.parent_type,
                    routine_instance_id: parent.routine_instance_id,
                    is_deleted: parent.is_deleted,
                    due_date: parent.due_date,
                    start_date: parent.start_date,
                    gcal_event_id: parent.gcal_event_id,
                    gcal_calendar_id: parent.gcal_calendar_id,
                    gcal_sync_enabled: parent.gcal_sync_enabled,
                    gcal_last_sync: parent.gcal_last_sync,
                    gcal_sync_direction: parent.gcal_sync_direction,
                    is_gcal_imported: parent.is_gcal_imported,
                    updated_at: parent.updated_at,
                    id: id(parent)
                 }} as parent"
                );
                eprintln!("[relations] Executing parent_id query for parent_id={}", parent_id);
                let parent_id_query = query(&parent_id_query_str)
                    .param("parent_id", parent_id)
                    .param("user_id", user_id);

                let mut parent_id_result = graph.execute(parent_id_query).await.map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Error fetching event parent via parent_id: {}", e),
                    )
                })?;

                while let Ok(Some(row)) = parent_id_result.next().await {
                    if let Ok(parent) = row.get::<Goal>("parent") {
                        parents.push(parent);
                    }
                }
            }
        }
        children = Vec::new();
    } else {
        // For non-event goals: get parents and children via CHILD relationships
        // Parents: goals that have this goal as a child
        let parents_query_str = format!(
            "MATCH (parent:Goal)-[:CHILD]->(g:Goal)
             WHERE id(g) = $goal_id AND parent.user_id = $user_id AND g.user_id = $user_id
             RETURN {{
                    name: parent.name,
                    description: parent.description,
                    goal_type: parent.goal_type,
                    user_id: parent.user_id,
                    priority: parent.priority,
                    start_timestamp: parent.start_timestamp,
                    end_timestamp: parent.end_timestamp,
                    resolution_status: parent.resolution_status,
                    resolved_at: parent.resolved_at,
                    next_timestamp: parent.next_timestamp,
                    scheduled_timestamp: parent.scheduled_timestamp,
                    duration: parent.duration,
                    frequency: parent.frequency,
                    routine_type: parent.routine_type,
                    routine_time: parent.routine_time,
                    position_x: parent.position_x,
                    position_y: parent.position_y,
                    parent_id: parent.parent_id,
                    parent_type: parent.parent_type,
                    routine_instance_id: parent.routine_instance_id,
                    is_deleted: parent.is_deleted,
                    due_date: parent.due_date,
                    start_date: parent.start_date,
                    gcal_event_id: parent.gcal_event_id,
                    gcal_calendar_id: parent.gcal_calendar_id,
                    gcal_sync_enabled: parent.gcal_sync_enabled,
                    gcal_last_sync: parent.gcal_last_sync,
                    gcal_sync_direction: parent.gcal_sync_direction,
                    is_gcal_imported: parent.is_gcal_imported,
                    updated_at: parent.updated_at,
                    id: id(parent)
                 }} as parent",
        );
        let parents_query = query(&parents_query_str)
            .param("goal_id", goal_id)
            .param("user_id", user_id);

        let mut parents_result = graph.execute(parents_query).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error fetching parents: {}", e),
            )
        })?;

        while let Ok(Some(row)) = parents_result.next().await {
            if let Ok(parent) = row.get::<Goal>("parent") {
                parents.push(parent);
            }
        }

        // Children: goals that have this goal as a parent
        // Skip for tasks (they can't have children)
        if goal.goal_type != GoalType::Task {
            let children_query_str = format!(
                "MATCH (g:Goal)-[:CHILD]->(child:Goal)
                 WHERE id(g) = $goal_id AND g.user_id = $user_id AND child.user_id = $user_id
                 RETURN {{
                    name: child.name,
                    description: child.description,
                    goal_type: child.goal_type,
                    user_id: child.user_id,
                    priority: child.priority,
                    start_timestamp: child.start_timestamp,
                    end_timestamp: child.end_timestamp,
                    resolution_status: child.resolution_status,
                    resolved_at: child.resolved_at,
                    next_timestamp: child.next_timestamp,
                    scheduled_timestamp: child.scheduled_timestamp,
                    duration: child.duration,
                    frequency: child.frequency,
                    routine_type: child.routine_type,
                    routine_time: child.routine_time,
                    position_x: child.position_x,
                    position_y: child.position_y,
                    parent_id: child.parent_id,
                    parent_type: child.parent_type,
                    routine_instance_id: child.routine_instance_id,
                    is_deleted: child.is_deleted,
                    due_date: child.due_date,
                    start_date: child.start_date,
                    gcal_event_id: child.gcal_event_id,
                    gcal_calendar_id: child.gcal_calendar_id,
                    gcal_sync_enabled: child.gcal_sync_enabled,
                    gcal_last_sync: child.gcal_last_sync,
                    gcal_sync_direction: child.gcal_sync_direction,
                    is_gcal_imported: child.is_gcal_imported,
                    updated_at: child.updated_at,
                    id: id(child)
                 }} as child",
            );
            let children_query = query(&children_query_str)
                .param("goal_id", goal_id)
                .param("user_id", user_id);

            let mut children_result = graph.execute(children_query).await.map_err(|e| {
                eprintln!("Error fetching children: {:?}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Error fetching children: {}", e),
                )
            })?;

            while let Ok(Some(row)) = children_result.next().await {
                if let Ok(child) = row.get::<Goal>("child") {
                    eprintln!("[relations] Found child: id={:?}, name={}", child.id, child.name);
                    children.push(child);
                }
            }
            eprintln!("[relations] Children count: {}", children.len());
        }
    }

    Ok(Json(GoalRelationsResponse { parents, children }))
}

pub async fn get_goal_subgraph(
    graph: Graph,
    user_id: i64,
    goal_id: i64,
) -> Result<Json<GoalSubgraphResponse>, (StatusCode, String)> {
    // Verify goal exists and belongs to user
    let verify_query = query(
        "MATCH (g:Goal)
         WHERE id(g) = $goal_id AND g.user_id = $user_id
         RETURN id(g) as id",
    )
    .param("goal_id", goal_id)
    .param("user_id", user_id);

    let mut verify_result = graph.execute(verify_query).await.map_err(|e| {
        eprintln!("Error verifying goal: {:?}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error verifying goal: {}", e),
        )
    })?;

    if verify_result.next().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error checking goal existence: {}", e),
        )
    })?.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            format!("Goal with id {} not found", goal_id),
        ));
    }

    // Collect all ancestor and descendant IDs recursively
    // Using a depth-limited traversal to prevent infinite loops
    let ancestors_query_str = format!(
        "MATCH path = (ancestor:Goal)-[:CHILD*1..{}]->(g:Goal)
         WHERE id(g) = $goal_id 
           AND ancestor.user_id = $user_id 
           AND g.user_id = $user_id
           AND ancestor.goal_type <> 'event'
         WITH path, id(g) as center_id
         UNWIND nodes(path) as node
         WITH DISTINCT node, center_id
         WHERE id(node) <> center_id AND node.goal_type <> 'event'
         RETURN {{
                    name: node.name,
                    description: node.description,
                    goal_type: node.goal_type,
                    user_id: node.user_id,
                    priority: node.priority,
                    start_timestamp: node.start_timestamp,
                    end_timestamp: node.end_timestamp,
                    resolution_status: node.resolution_status,
                    resolved_at: node.resolved_at,
                    next_timestamp: node.next_timestamp,
                    scheduled_timestamp: node.scheduled_timestamp,
                    duration: node.duration,
                    frequency: node.frequency,
                    routine_type: node.routine_type,
                    routine_time: node.routine_time,
                    position_x: node.position_x,
                    position_y: node.position_y,
                    parent_id: node.parent_id,
                    parent_type: node.parent_type,
                    routine_instance_id: node.routine_instance_id,
                    is_deleted: node.is_deleted,
                    due_date: node.due_date,
                    start_date: node.start_date,
                    gcal_event_id: node.gcal_event_id,
                    gcal_calendar_id: node.gcal_calendar_id,
                    gcal_sync_enabled: node.gcal_sync_enabled,
                    gcal_last_sync: node.gcal_last_sync,
                    gcal_sync_direction: node.gcal_sync_direction,
                    is_gcal_imported: node.is_gcal_imported,
                    updated_at: node.updated_at,
                    id: id(node)
                 }} as node",
        MAX_DEPTH
    );
    let ancestors_query = query(&ancestors_query_str)
        .param("goal_id", goal_id)
        .param("user_id", user_id);

    let mut ancestors_result = graph.execute(ancestors_query).await.map_err(|e| {
        eprintln!("Error fetching ancestors: {:?}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error fetching ancestors: {}", e),
        )
    })?;

    let mut ancestor_nodes = Vec::new();
    while let Ok(Some(row)) = ancestors_result.next().await {
        if let Ok(node) = row.get::<Goal>("node") {
            ancestor_nodes.push(node);
        }
    }

    // Get descendants (children recursively)
    let descendants_query_str = format!(
        "MATCH path = (g:Goal)-[:CHILD*1..{}]->(descendant:Goal)
         WHERE id(g) = $goal_id 
           AND g.user_id = $user_id 
           AND descendant.user_id = $user_id
           AND descendant.goal_type <> 'event'
         WITH path, id(g) as center_id
         UNWIND nodes(path) as node
         WITH DISTINCT node, center_id
         WHERE id(node) <> center_id AND node.goal_type <> 'event'
         RETURN {{
                    name: node.name,
                    description: node.description,
                    goal_type: node.goal_type,
                    user_id: node.user_id,
                    priority: node.priority,
                    start_timestamp: node.start_timestamp,
                    end_timestamp: node.end_timestamp,
                    resolution_status: node.resolution_status,
                    resolved_at: node.resolved_at,
                    next_timestamp: node.next_timestamp,
                    scheduled_timestamp: node.scheduled_timestamp,
                    duration: node.duration,
                    frequency: node.frequency,
                    routine_type: node.routine_type,
                    routine_time: node.routine_time,
                    position_x: node.position_x,
                    position_y: node.position_y,
                    parent_id: node.parent_id,
                    parent_type: node.parent_type,
                    routine_instance_id: node.routine_instance_id,
                    is_deleted: node.is_deleted,
                    due_date: node.due_date,
                    start_date: node.start_date,
                    gcal_event_id: node.gcal_event_id,
                    gcal_calendar_id: node.gcal_calendar_id,
                    gcal_sync_enabled: node.gcal_sync_enabled,
                    gcal_last_sync: node.gcal_last_sync,
                    gcal_sync_direction: node.gcal_sync_direction,
                    is_gcal_imported: node.is_gcal_imported,
                    updated_at: node.updated_at,
                    id: id(node)
                 }} as node",
        MAX_DEPTH
    );
    let descendants_query = query(&descendants_query_str)
        .param("goal_id", goal_id)
        .param("user_id", user_id);

    let mut descendants_result = graph.execute(descendants_query).await.map_err(|e| {
        eprintln!("Error fetching descendants: {:?}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error fetching descendants: {}", e),
        )
    })?;

    let mut descendant_nodes = Vec::new();
    while let Ok(Some(row)) = descendants_result.next().await {
        if let Ok(node) = row.get::<Goal>("node") {
            descendant_nodes.push(node);
        }
    }

    // Get the center goal itself
    let center_query = query(&format!(
        "MATCH (g:Goal)
         WHERE id(g) = $goal_id AND g.user_id = $user_id
         {}",
        GOAL_RETURN_QUERY
    ))
    .param("goal_id", goal_id)
    .param("user_id", user_id);

    let mut center_result = graph.execute(center_query).await.map_err(|e| {
        eprintln!("Error fetching center goal: {:?}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error fetching center goal: {}", e),
        )
    })?;

    let center_goal: Goal = center_result
        .next()
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error fetching center goal row: {}", e),
            )
        })?
        .ok_or((
            StatusCode::NOT_FOUND,
            format!("Center goal {} not found", goal_id),
        ))?
        .get("g")
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error deserializing center goal: {}", e),
            )
        })?;

    // Combine all nodes (center + ancestors + descendants)
    let mut all_nodes = Vec::new();
    all_nodes.push(center_goal);
    all_nodes.extend(ancestor_nodes);
    all_nodes.extend(descendant_nodes);

    // Check if we hit the node limit
    let truncated = all_nodes.len() > MAX_NODES;
    if truncated {
        all_nodes.truncate(MAX_NODES);
    }

    // Build a set of node IDs for efficient lookup
    let node_ids: std::collections::HashSet<i64> = all_nodes
        .iter()
        .filter_map(|g| g.id)
        .collect();

    // Fetch all CHILD edges between these nodes
    let edges_query = query(
        "MATCH (from:Goal)-[:CHILD]->(to:Goal)
         WHERE from.user_id = $user_id 
           AND to.user_id = $user_id
           AND from.goal_type <> 'event'
           AND to.goal_type <> 'event'
         RETURN id(from) as from_id, id(to) as to_id",
    )
    .param("user_id", user_id);

    let mut edges_result = graph.execute(edges_query).await.map_err(|e| {
        eprintln!("Error fetching edges: {:?}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error fetching edges: {}", e),
        )
    })?;

    let mut edges = Vec::new();
    while let Ok(Some(row)) = edges_result.next().await {
        let from_id: i64 = row.get("from_id").unwrap_or(0);
        let to_id: i64 = row.get("to_id").unwrap_or(0);

        // Only include edges where both nodes are in our subgraph
        if node_ids.contains(&from_id) && node_ids.contains(&to_id) {
            edges.push(SubgraphEdge {
                from: from_id,
                to: to_id,
                relationship_type: "child".to_string(),
            });
        }
    }

    Ok(Json(GoalSubgraphResponse {
        nodes: all_nodes,
        edges,
        truncated,
    }))
}

