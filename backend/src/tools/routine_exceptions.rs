use neo4rs::{query, Graph};

/// Create (or keep) a skip exception for a given routine occurrence timestamp (ms).
/// This is used to prevent the routine generator from backfilling a user-deleted/moved occurrence.
pub async fn create_skip_exception(
    graph: &Graph,
    user_id: i64,
    routine_id: i64,
    timestamp: i64,
) -> Result<(), neo4rs::Error> {
    let now = chrono::Utc::now().timestamp_millis();
    graph
        .run(
            query(
                "MATCH (r:Goal)
                 WHERE id(r) = $routine_id AND r.goal_type = 'routine'
                 MERGE (r)-[:HAS_EXCEPTION]->(x:RoutineException { timestamp: $timestamp, kind: 'skip' })
                 ON CREATE SET x.created_at = $now, x.user_id = $user_id
                 RETURN id(x) as id",
            )
            .param("routine_id", routine_id)
            .param("timestamp", timestamp)
            .param("now", now)
            .param("user_id", user_id),
        )
        .await?;
    Ok(())
}

/// Fetch all skip exception timestamps in a given range (inclusive).
pub async fn get_skip_exception_timestamps_in_range(
    graph: &Graph,
    routine_id: i64,
    start_ts: i64,
    end_ts: i64,
) -> Result<Vec<i64>, neo4rs::Error> {
    let mut result = graph
        .execute(
            query(
                "MATCH (r:Goal)-[:HAS_EXCEPTION]->(x:RoutineException)
                 WHERE id(r) = $routine_id
                   AND x.kind = 'skip'
                   AND x.timestamp >= $start_ts
                   AND x.timestamp <= $end_ts
                 RETURN collect(x.timestamp) as ts",
            )
            .param("routine_id", routine_id)
            .param("start_ts", start_ts)
            .param("end_ts", end_ts),
        )
        .await?;

    if let Some(row) = result.next().await? {
        Ok(row.get::<Vec<i64>>("ts").unwrap_or_default())
    } else {
        Ok(vec![])
    }
}

/// Clear (delete) all routine exceptions at-or-after `from_timestamp`.
pub async fn clear_exceptions_from(
    graph: &Graph,
    routine_id: i64,
    from_timestamp: i64,
) -> Result<i64, neo4rs::Error> {
    let mut result = graph
        .execute(
            query(
                "MATCH (r:Goal)-[:HAS_EXCEPTION]->(x:RoutineException)
                 WHERE id(r) = $routine_id
                   AND x.timestamp >= $from_timestamp
                 WITH x
                 DETACH DELETE x
                 RETURN count(x) as deleted",
            )
            .param("routine_id", routine_id)
            .param("from_timestamp", from_timestamp),
        )
        .await?;

    if let Some(row) = result.next().await? {
        Ok(row.get::<i64>("deleted").unwrap_or(0))
    } else {
        Ok(0)
    }
}

/// Clear (delete) all routine exceptions for a routine.
pub async fn clear_all_exceptions(graph: &Graph, routine_id: i64) -> Result<i64, neo4rs::Error> {
    let mut result = graph
        .execute(
            query(
                "MATCH (r:Goal)-[:HAS_EXCEPTION]->(x:RoutineException)
                 WHERE id(r) = $routine_id
                 WITH x
                 DETACH DELETE x
                 RETURN count(x) as deleted",
            )
            .param("routine_id", routine_id),
        )
        .await?;

    if let Some(row) = result.next().await? {
        Ok(row.get::<i64>("deleted").unwrap_or(0))
    } else {
        Ok(0)
    }
}
