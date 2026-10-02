use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use neo4rs::{query, Graph};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

const LIST_RETURN: &str = "RETURN {
    id: id(g),
    name: g.name,
    description: g.description,
    goal_type: g.goal_type,
    priority: g.priority,
    resolution_status: g.resolution_status,
    start_timestamp: g.start_timestamp,
    end_timestamp: g.end_timestamp,
    scheduled_timestamp: g.scheduled_timestamp,
    next_timestamp: g.next_timestamp,
    frequency: g.frequency,
    duration: g.duration,
    parent_id: g.parent_id,
    parent_type: g.parent_type,
    is_deleted: g.is_deleted
} AS g";

#[derive(Debug, Serialize)]
pub struct ListFacets {
    pub frequency: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ListPage {
    pub items: Vec<Value>,
    pub total: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub facets: Option<ListFacets>,
}

struct ListFilter {
    where_clause: String,
    strings: Vec<(String, String)>,
    ints: Vec<(String, i64)>,
}

fn csv(params: &HashMap<String, String>, key: &str) -> Vec<String> {
    params
        .get(key)
        .map(|raw| {
            raw.split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_i64(params: &HashMap<String, String>, key: &str) -> Option<i64> {
    params.get(key).and_then(|s| s.parse::<i64>().ok())
}

fn sort_property(sort: &str) -> Option<&'static str> {
    match sort {
        "name" => Some("g.name"),
        "goal_type" => Some("g.goal_type"),
        "description" => Some("g.description"),
        "priority" => Some("g.priority"),
        "resolution_status" => Some("g.resolution_status"),
        "start_timestamp" => Some("g.start_timestamp"),
        "end_timestamp" => Some("g.end_timestamp"),
        "scheduled_timestamp" => Some("g.scheduled_timestamp"),
        "next_timestamp" => Some("g.next_timestamp"),
        "frequency" => Some("g.frequency"),
        "duration" => Some("g.duration"),
        _ => None,
    }
}

fn order_clause(params: &HashMap<String, String>) -> String {
    let sort = params.get("sort").map(|s| s.as_str()).unwrap_or("");
    let dir = if params.get("dir").map(|s| s.eq_ignore_ascii_case("desc")).unwrap_or(false) {
        "DESC"
    } else {
        "ASC"
    };
    match sort_property(sort) {
        Some(prop) => format!("ORDER BY {prop} IS NULL, {prop} {dir}, id(g)"),
        None => "ORDER BY id(g)".to_string(),
    }
}

fn push_in(
    parts: &mut Vec<String>,
    strings: &mut Vec<(String, String)>,
    expr: &str,
    prefix: &str,
    values: Vec<String>,
) {
    if values.is_empty() {
        return;
    }
    let mut placeholders = Vec::new();
    for (i, value) in values.into_iter().enumerate() {
        let name = format!("{prefix}_{i}");
        placeholders.push(format!("${name}"));
        strings.push((name, value));
    }
    parts.push(format!("{expr} IN [{}]", placeholders.join(", ")));
}

fn push_i64(ints: &mut Vec<(String, i64)>, name: &str, value: i64) {
    ints.push((name.to_string(), value));
}

fn build_filter(params: &HashMap<String, String>) -> ListFilter {
    let mut parts = vec![
        "g.user_id = $user_id".to_string(),
        "NOT (g.goal_type = 'event' AND coalesce(g.is_deleted, false) = true)".to_string(),
    ];
    let mut strings = Vec::new();
    let mut ints = Vec::new();

    push_in(
        &mut parts,
        &mut strings,
        "g.goal_type",
        "goal_type",
        csv(params, "goal_type"),
    );

    let priority_values = csv(params, "priority");
    let include_null_priority = priority_values.iter().any(|p| p == "__none__");
    let priorities: Vec<String> = priority_values
        .into_iter()
        .filter(|p| p != "__none__")
        .collect();
    if include_null_priority && priorities.is_empty() {
        parts.push("g.priority IS NULL".to_string());
    } else if include_null_priority {
        let before = parts.len();
        push_in(&mut parts, &mut strings, "g.priority", "priority", priorities);
        if parts.len() > before {
            let inn = parts.pop().unwrap();
            parts.push(format!("(g.priority IS NULL OR {inn})"));
        }
    } else {
        push_in(&mut parts, &mut strings, "g.priority", "priority", priorities);
    }

    push_in(
        &mut parts,
        &mut strings,
        "coalesce(g.resolution_status, 'pending')",
        "status",
        csv(params, "resolution_status"),
    );
    push_in(
        &mut parts,
        &mut strings,
        "g.frequency",
        "frequency",
        csv(params, "frequency"),
    );

    if let Some(duration) = parse_i64(params, "duration") {
        parts.push("g.duration = $duration".to_string());
        push_i64(&mut ints, "duration", duration);
    }

    if let Some(q) = params
        .get("q")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        parts.push(
            "(toLower(coalesce(g.name, '')) CONTAINS toLower($q) OR toLower(coalesce(g.description, '')) CONTAINS toLower($q))"
                .to_string(),
        );
        strings.push(("q".to_string(), q));
    }

    let mut bind_range = |from_key: &str, to_key: &str, prop: &str, from_param: &str, to_param: &str| {
        if let Some(from) = parse_i64(params, from_key) {
            parts.push(format!("{prop} >= ${from_param}"));
            ints.push((from_param.to_string(), from));
        }
        if let Some(to) = parse_i64(params, to_key) {
            parts.push(format!("{prop} <= ${to_param}"));
            ints.push((to_param.to_string(), to));
        }
    };
    bind_range("start_from", "start_to", "g.start_timestamp", "start_from", "start_to");
    bind_range("end_from", "end_to", "g.end_timestamp", "end_from", "end_to");
    bind_range(
        "scheduled_from",
        "scheduled_to",
        "g.scheduled_timestamp",
        "scheduled_from",
        "scheduled_to",
    );
    bind_range("next_from", "next_to", "g.next_timestamp", "next_from", "next_to");

    ListFilter {
        where_clause: parts.join(" AND "),
        strings,
        ints,
    }
}

fn bind_filter(mut q: neo4rs::Query, user_id: i64, filter: &ListFilter) -> neo4rs::Query {
    q = q.param("user_id", user_id);
    for (name, value) in &filter.strings {
        q = q.param(name.as_str(), value.clone());
    }
    for (name, value) in &filter.ints {
        q = q.param(name.as_str(), *value);
    }
    q
}

async fn read_facets(graph: &Graph, user_id: i64) -> Result<ListFacets, (StatusCode, String)> {
    let q = query(
        "MATCH (g:Goal)
         WHERE g.user_id = $user_id
           AND NOT (g.goal_type = 'event' AND coalesce(g.is_deleted, false) = true)
           AND g.frequency IS NOT NULL
         RETURN DISTINCT g.frequency AS frequency
         ORDER BY frequency",
    )
    .param("user_id", user_id);

    let mut result = graph.execute(q).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error fetching list facets: {}", e),
        )
    })?;
    let mut frequency = Vec::new();
    while let Ok(Some(row)) = result.next().await {
        if let Ok(value) = row.get::<String>("frequency") {
            if !value.is_empty() {
                frequency.push(value);
            }
        }
    }
    Ok(ListFacets { frequency })
}

pub async fn get_list_data(
    graph: Graph,
    user_id: i64,
    params: &HashMap<String, String>,
) -> Result<Response, (StatusCode, String)> {
    let filter = build_filter(params);
    let order = order_clause(params);
    let paged = params.contains_key("limit");

    if !paged {
        let query_str = format!(
            "MATCH (g:Goal) WHERE {} WITH g {} {}",
            filter.where_clause, order, LIST_RETURN
        );
        let q = bind_filter(query(&query_str), user_id, &filter);
        let mut result = graph.execute(q).await.map_err(|e| {
            eprintln!("Error fetching goals: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Error fetching goals: {}", e),
            )
        })?;
        let mut goals = Vec::new();
        while let Ok(Some(row)) = result.next().await {
            if let Ok(goal) = row.get::<Value>("g") {
                goals.push(goal);
            }
        }
        return Ok(Json(goals).into_response());
    }

    let limit = params
        .get("limit")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(100)
        .clamp(1, 500);
    let offset = parse_i64(params, "offset").unwrap_or(0).max(0);
    let include_facets = params
        .get("include_facets")
        .map(|s| s == "1" || s.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    let count_str = format!(
        "MATCH (g:Goal) WHERE {} RETURN count(g) AS total",
        filter.where_clause
    );
    let page_str = format!(
        "MATCH (g:Goal) WHERE {} WITH g {} {} SKIP $offset LIMIT $limit",
        filter.where_clause, order, LIST_RETURN
    );
    let count_q = bind_filter(query(&count_str), user_id, &filter);
    let page_q = bind_filter(query(&page_str), user_id, &filter)
        .param("offset", offset)
        .param("limit", limit);

    let (count_res, page_res) = tokio::join!(graph.execute(count_q), graph.execute(page_q));
    let mut count_rows = count_res.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error counting goals: {}", e),
        )
    })?;
    let total = if let Ok(Some(row)) = count_rows.next().await {
        row.get::<i64>("total").unwrap_or(0)
    } else {
        0
    };
    let mut page_rows = page_res.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error fetching goals: {}", e),
        )
    })?;
    let mut items = Vec::new();
    while let Ok(Some(row)) = page_rows.next().await {
        if let Ok(goal) = row.get::<Value>("g") {
            items.push(goal);
        }
    }
    let facets = if include_facets {
        Some(read_facets(&graph, user_id).await?)
    } else {
        None
    };

    Ok(Json(ListPage {
        items,
        total,
        facets,
    })
    .into_response())
}
