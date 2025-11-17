use axum::{extract::Json, http::StatusCode};
use chrono::{Datelike, Duration, NaiveDate, TimeZone, Utc};
use neo4rs::{query, Graph};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
pub struct DailyStats {
    pub date: String,
    pub score: f64,
    pub total_events: i32,
    pub completed_events: i32,
    pub weighted_total: f64,
    pub weighted_completed: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct YearStats {
    pub year: i32,
    pub daily_stats: Vec<DailyStats>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PeriodStats {
    pub period: String,       // "2024-W01", "2024-01", "2024"
    pub completion_rate: f64, // 0.0 to 1.0
    pub total_events: i32,
    pub completed_events: i32,
    pub days_with_tasks: i32,
    pub days_with_no_tasks_complete: i32,
    pub weighted_total: f64,
    pub weighted_completed: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExtendedStats {
    pub year: i32,
    pub daily_stats: Vec<DailyStats>,
    pub weekly_stats: Vec<PeriodStats>,
    pub monthly_stats: Vec<PeriodStats>,
    pub yearly_stats: PeriodStats,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RoutineStats {
    pub routine_id: i64,
    pub routine_name: String,
    pub completion_rate: f64,
    pub total_events: i32,
    pub completed_events: i32,
    pub smoothed_completion: Vec<SmoothedPoint>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SmoothedPoint {
    pub date: String,
    pub completion_rate: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RoutineSearchResult {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EventReschedulingStats {
    pub total_reschedules: i32,
    pub avg_reschedule_distance_hours: f64,
    pub reschedule_frequency_by_month: Vec<MonthlyRescheduleStats>,
    pub most_rescheduled_events: Vec<RescheduledEventInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MonthlyRescheduleStats {
    pub month: String, // "2024-01"
    pub reschedule_count: i32,
    pub total_events: i32,
    pub reschedule_rate: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RescheduledEventInfo {
    pub event_name: String,
    pub reschedule_count: i32,
    pub parent_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EventMove {
    pub id: Option<i64>,
    pub event_id: i64,
    pub user_id: i64,
    pub old_timestamp: i64,
    pub new_timestamp: i64,
    pub move_type: String, // "reschedule", "cancel", "complete_early"
    pub move_timestamp: i64,
    pub reason: Option<String>,
}

// New statistics structures
#[derive(Debug, Serialize, Deserialize)]
pub struct EventAnalytics {
    pub duration_stats: Vec<DurationStats>,
    pub priority_stats: Vec<PriorityStats>,
    pub source_stats: SourceStats,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DurationStats {
    pub duration_range: String, // "0-30 min", "30-60 min", "1-2 hours", etc.
    pub completion_rate: f64,
    pub total_events: i32,
    pub completed_events: i32,
    pub avg_duration_minutes: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PriorityStats {
    pub priority: String,
    pub completion_rate: f64,
    pub total_events: i32,
    pub completed_events: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SourceStats {
    pub routine_events: SourceBreakdown,
    pub task_events: SourceBreakdown,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SourceBreakdown {
    pub completion_rate: f64,
    pub total_events: i32,
    pub completed_events: i32,
    pub avg_priority_weight: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EffortStat {
    pub goal_id: i64,
    pub goal_name: String,
    pub goal_type: String,
    pub total_events: i32,
    pub completed_events: i32,
    pub total_duration_minutes: f64,
    pub weighted_completion_rate: f64,
    pub children_count: i32,
}

pub async fn get_year_stats(
    graph: Graph,
    user_id: i64,
    year: Option<i32>,
) -> Result<Json<YearStats>, (StatusCode, String)> {
    let target_year = year.unwrap_or_else(|| Utc::now().year());

    // Get start and end timestamps for the year
    let start_date = NaiveDate::from_ymd_opt(target_year, 1, 1).unwrap();
    let end_date = NaiveDate::from_ymd_opt(target_year, 12, 31).unwrap();

    let start_timestamp = start_date
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis();
    let end_timestamp = end_date
        .and_hms_opt(23, 59, 59)
        .unwrap()
        .and_utc()
        .timestamp_millis();

    // Query all events (Goal nodes with goal_type='event') linked to tasks, achievements, and routines for the year
    // Only include events that have passed their scheduled time (scheduled_timestamp + duration <= current_time)
    let query_str = "
        MATCH (e:Goal)<-[:HAS_EVENT]-(g:Goal)
        WHERE e.goal_type = 'event'
        AND g.user_id = $user_id
        AND (g.goal_type = 'task' OR g.goal_type = 'achievement' OR g.goal_type = 'routine')
        AND e.scheduled_timestamp >= $start_timestamp
        AND e.scheduled_timestamp <= $end_timestamp
        AND (e.is_deleted IS NULL OR e.is_deleted = false)
        WITH e, g, 
             (e.scheduled_timestamp + COALESCE(e.duration_minutes, e.duration, 60) * 60 * 1000) as event_end_time,
             timestamp() as current_time
        WHERE event_end_time <= current_time
        RETURN e.scheduled_timestamp as date,
               COALESCE(e.completed, false) as completed,
               COALESCE(e.priority, g.priority, 'medium') as priority
    ";

    let query = query(query_str)
        .param("user_id", user_id)
        .param("start_timestamp", start_timestamp)
        .param("end_timestamp", end_timestamp);

    match graph.execute(query).await {
        Ok(mut result) => {
            let mut daily_events: HashMap<String, Vec<(bool, String)>> = HashMap::new();

            while let Ok(Some(row)) = result.next().await {
                let timestamp = row.get::<i64>("date").unwrap_or(0);
                let completed = row.get::<bool>("completed").unwrap_or(false);
                let priority = row
                    .get::<String>("priority")
                    .unwrap_or_else(|_| "medium".to_string());

                // Convert timestamp to date string (YYYY-MM-DD)
                let date = Utc
                    .timestamp_millis_opt(timestamp)
                    .single()
                    .map(|dt| dt.format("%Y-%m-%d").to_string())
                    .unwrap_or_default();

                daily_events
                    .entry(date)
                    .or_default()
                    .push((completed, priority));
            }

            // Calculate daily stats for each day of the year
            let mut daily_stats = Vec::new();
            let mut current_date = start_date;

            while current_date <= end_date {
                let date_str = current_date.format("%Y-%m-%d").to_string();
                let events = daily_events.get(&date_str).cloned().unwrap_or_default();

                let mut total_events = 0;
                let mut completed_events = 0;
                let mut weighted_total = 0.0;
                let mut weighted_completed = 0.0;

                for (completed, priority) in events {
                    let weight = match priority.as_str() {
                        "none" => 0.0,
                        "low" => 1.0,
                        "medium" => 2.0,
                        "high" => 3.0,
                        _ => 2.0, // default to medium
                    };

                    total_events += 1;
                    weighted_total += weight;

                    if completed {
                        completed_events += 1;
                        weighted_completed += weight;
                    }
                }

                let score = if weighted_total > 0.0 {
                    weighted_completed / weighted_total
                } else {
                    0.0
                };

                daily_stats.push(DailyStats {
                    date: date_str,
                    score,
                    total_events,
                    completed_events,
                    weighted_total,
                    weighted_completed,
                });

                current_date += Duration::days(1);
            }

            Ok(Json(YearStats {
                year: target_year,
                daily_stats,
            }))
        }
        Err(e) => {
            eprintln!("Error fetching year stats: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch year stats: {}", e),
            ))
        }
    }
}

pub async fn get_effort_stats(
    graph: Graph,
    user_id: i64,
    range: Option<String>,
) -> Result<Json<Vec<EffortStat>>, (StatusCode, String)> {
    // Determine lower bound start timestamp from range (approximate months/years using days)
    let start_timestamp_opt: Option<i64> = match range.as_deref() {
        Some("5y") => Some((Utc::now() - Duration::days(5 * 365)).timestamp_millis()),
        Some("1y") => Some((Utc::now() - Duration::days(365)).timestamp_millis()),
        Some("6m") => Some((Utc::now() - Duration::days(182)).timestamp_millis()),
        Some("3m") => Some((Utc::now() - Duration::days(91)).timestamp_millis()),
        Some("1m") => Some((Utc::now() - Duration::days(30)).timestamp_millis()),
        Some("2w") => Some((Utc::now() - Duration::days(14)).timestamp_millis()),
        Some("all") | None | Some("") => None,
        Some(_) => None,
    };

    // All-time effort per non-event goal, aggregating descendant events
    let query_str_with_range = r#"
        MATCH (g:Goal)
        WHERE g.user_id = $user_id AND g.goal_type <> 'event'
        OPTIONAL MATCH (g)-[:CHILD*0..]->(desc:Goal)
        WHERE desc.user_id = $user_id
        OPTIONAL MATCH (desc)-[:HAS_EVENT]->(e:Goal)
        WHERE e.goal_type = 'event'
          AND (e.is_deleted IS NULL OR e.is_deleted = false)
          AND e.scheduled_timestamp < timestamp()
          AND e.scheduled_timestamp >= $start_timestamp
        WITH g, collect(DISTINCT {e: e, parent: desc}) AS epairs, collect(DISTINCT desc) AS descendants
        WITH g, epairs, descendants,
             size([d IN descendants WHERE d.goal_type <> 'event' AND id(d) <> id(g)]) AS children_count,
             // weights across all past events (completed or not) for denominator
             [p IN epairs | CASE COALESCE(p.e.priority, p.parent.priority, 'medium')
                  WHEN 'none' THEN 0.0
                  WHEN 'low' THEN 1.0
                  WHEN 'medium' THEN 2.0
                  WHEN 'high' THEN 3.0
                  ELSE 2.0
             END] AS weights_all,
             // weights across completed past events for numerator
             [p IN epairs WHERE COALESCE(p.e.completed,false) | CASE COALESCE(p.e.priority, p.parent.priority, 'medium')
                  WHEN 'none' THEN 0.0
                  WHEN 'low' THEN 1.0
                  WHEN 'medium' THEN 2.0
                  WHEN 'high' THEN 3.0
                  ELSE 2.0
             END] AS completed_weights,
             // duration only for completed past events
             [p IN epairs WHERE COALESCE(p.e.completed,false) |
                CASE
                  WHEN (
                    CASE
                      WHEN p.e.end_timestamp IS NOT NULL AND p.e.end_timestamp > p.e.scheduled_timestamp
                        THEN toFloat(p.e.end_timestamp - p.e.scheduled_timestamp) / (1000.0*60.0)
                      ELSE toFloat(COALESCE(p.e.duration_minutes, p.e.duration, 60))
                    END
                  ) >= 1440.0
                    THEN 0.0
                  ELSE
                    CASE
                      WHEN p.e.end_timestamp IS NOT NULL AND p.e.end_timestamp > p.e.scheduled_timestamp
                        THEN toFloat(p.e.end_timestamp - p.e.scheduled_timestamp) / (1000.0*60.0)
                      ELSE toFloat(COALESCE(p.e.duration_minutes, p.e.duration, 60))
                    END
                END
             ] AS durations_completed,
             // flags for counting completed past events
             [p IN epairs WHERE COALESCE(p.e.completed,false) | 1] AS completed_flags
        RETURN id(g) AS goal_id,
               g.name AS goal_name,
               g.goal_type AS goal_type,
               size(completed_flags) AS total_events,
               reduce(s=0.0, d IN durations_completed | s + d) AS total_duration_minutes,
               size(completed_flags) AS completed_events,
               CASE reduce(s=0.0, w IN weights_all | s + w)
                    WHEN 0.0 THEN 0.0
                    ELSE reduce(c=0.0, w IN completed_weights | c + w) / reduce(s=0.0, w IN weights_all | s + w)
               END AS weighted_completion_rate,
               children_count
        ORDER BY total_duration_minutes DESC
    "#;

    let query_str_no_range = r#"
        MATCH (g:Goal)
        WHERE g.user_id = $user_id AND g.goal_type <> 'event'
        OPTIONAL MATCH (g)-[:CHILD*0..]->(desc:Goal)
        WHERE desc.user_id = $user_id
        OPTIONAL MATCH (desc)-[:HAS_EVENT]->(e:Goal)
        WHERE e.goal_type = 'event'
          AND (e.is_deleted IS NULL OR e.is_deleted = false)
          AND e.scheduled_timestamp < timestamp()
        WITH g, collect(DISTINCT {e: e, parent: desc}) AS epairs, collect(DISTINCT desc) AS descendants
        WITH g, epairs, descendants,
             size([d IN descendants WHERE d.goal_type <> 'event' AND id(d) <> id(g)]) AS children_count,
             [p IN epairs | CASE COALESCE(p.e.priority, p.parent.priority, 'medium')
                  WHEN 'none' THEN 0.0
                  WHEN 'low' THEN 1.0
                  WHEN 'medium' THEN 2.0
                  WHEN 'high' THEN 3.0
                  ELSE 2.0
             END] AS weights_all,
             [p IN epairs WHERE COALESCE(p.e.completed,false) | CASE COALESCE(p.e.priority, p.parent.priority, 'medium')
                  WHEN 'none' THEN 0.0
                  WHEN 'low' THEN 1.0
                  WHEN 'medium' THEN 2.0
                  WHEN 'high' THEN 3.0
                  ELSE 2.0
             END] AS completed_weights,
             [p IN epairs WHERE COALESCE(p.e.completed,false) |
                CASE
                  WHEN (
                    CASE
                      WHEN p.e.end_timestamp IS NOT NULL AND p.e.end_timestamp > p.e.scheduled_timestamp
                        THEN toFloat(p.e.end_timestamp - p.e.scheduled_timestamp) / (1000.0*60.0)
                      ELSE toFloat(COALESCE(p.e.duration_minutes, p.e.duration, 60))
                    END
                  ) >= 1440.0
                    THEN 0.0
                  ELSE
                    CASE
                      WHEN p.e.end_timestamp IS NOT NULL AND p.e.end_timestamp > p.e.scheduled_timestamp
                        THEN toFloat(p.e.end_timestamp - p.e.scheduled_timestamp) / (1000.0*60.0)
                      ELSE toFloat(COALESCE(p.e.duration_minutes, p.e.duration, 60))
                    END
                END
             ] AS durations_completed,
             [p IN epairs WHERE COALESCE(p.e.completed,false) | 1] AS completed_flags
        RETURN id(g) AS goal_id,
               g.name AS goal_name,
               g.goal_type AS goal_type,
               size(completed_flags) AS total_events,
               reduce(s=0.0, d IN durations_completed | s + d) AS total_duration_minutes,
               size(completed_flags) AS completed_events,
               CASE reduce(s=0.0, w IN weights_all | s + w)
                    WHEN 0.0 THEN 0.0
                    ELSE reduce(c=0.0, w IN completed_weights | c + w) / reduce(s=0.0, w IN weights_all | s + w)
               END AS weighted_completion_rate,
               children_count
        ORDER BY total_duration_minutes DESC
    "#;

    let mut query = if let Some(_start) = start_timestamp_opt {
        query(query_str_with_range).param("user_id", user_id)
    } else {
        query(query_str_no_range).param("user_id", user_id)
    };
    if let Some(start) = start_timestamp_opt {
        query = query.param("start_timestamp", start);
    }

    match graph.execute(query).await {
        Ok(mut result) => {
            let mut stats = Vec::new();

            while let Ok(Some(row)) = result.next().await {
                let goal_id = row.get::<i64>("goal_id").unwrap_or(0);
                let goal_name = row.get::<String>("goal_name").unwrap_or_default();
                let goal_type = row.get::<String>("goal_type").unwrap_or_default();
                let total_events = row.get::<i64>("total_events").unwrap_or(0) as i32;
                let completed_events = row.get::<i64>("completed_events").unwrap_or(0) as i32;
                let total_duration_minutes = row
                    .get::<f64>("total_duration_minutes")
                    .unwrap_or(0.0);
                let weighted_completion_rate = row
                    .get::<f64>("weighted_completion_rate")
                    .unwrap_or(0.0);
                let children_count = row.get::<i64>("children_count").unwrap_or(0) as i32;

                stats.push(EffortStat {
                    goal_id,
                    goal_name,
                    goal_type,
                    total_events,
                    completed_events,
                    total_duration_minutes,
                    weighted_completion_rate,
                    children_count,
                });
            }

            Ok(Json(stats))
        }
        Err(e) => {
            eprintln!("Error fetching effort stats: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch effort stats: {}", e),
            ))
        }
    }
}

pub async fn get_extended_stats(
    graph: Graph,
    user_id: i64,
    year: Option<i32>,
) -> Result<Json<ExtendedStats>, (StatusCode, String)> {
    // First get the daily stats
    let year_stats_result = get_year_stats(graph.clone(), user_id, year).await?;
    let year_stats = year_stats_result.0;

    // Aggregate into weekly and monthly stats
    let weekly_stats = aggregate_weekly_stats(&year_stats.daily_stats, year_stats.year);
    let monthly_stats = aggregate_monthly_stats(&year_stats.daily_stats, year_stats.year);
    let yearly_stats = aggregate_yearly_stats(&year_stats.daily_stats, year_stats.year);

    Ok(Json(ExtendedStats {
        year: year_stats.year,
        daily_stats: year_stats.daily_stats,
        weekly_stats,
        monthly_stats,
        yearly_stats,
    }))
}

pub async fn search_routines(
    graph: Graph,
    user_id: i64,
    search_term: String,
) -> Result<Json<Vec<RoutineSearchResult>>, (StatusCode, String)> {
    eprintln!(
        "🔍 [SEARCH_ROUTINES] Searching for: '{}' for user_id: {}",
        search_term, user_id
    );

    let query_str = "
        MATCH (r:Goal)
        WHERE r.user_id = $user_id 
        AND r.goal_type = 'routine'
        AND (toLower(r.name) CONTAINS toLower($search_term) 
             OR toLower(COALESCE(r.description, '')) CONTAINS toLower($search_term))
        RETURN id(r) as id, r.name as name, r.description as description
        ORDER BY r.name
        LIMIT 20
    ";

    let query = query(query_str)
        .param("user_id", user_id)
        .param("search_term", search_term);

    match graph.execute(query).await {
        Ok(mut result) => {
            let mut routines = Vec::new();

            while let Ok(Some(row)) = result.next().await {
                let id = row.get::<i64>("id").unwrap_or(0);
                let name = row.get::<String>("name").unwrap_or_default();
                let description = row.get::<String>("description").ok();

                eprintln!(
                    "🔍 [SEARCH_ROUTINES] Found routine: id={}, name='{}'",
                    id, name
                );

                routines.push(RoutineSearchResult {
                    id,
                    name,
                    description,
                });
            }

            eprintln!(
                "🔍 [SEARCH_ROUTINES] Total routines found: {}",
                routines.len()
            );
            Ok(Json(routines))
        }
        Err(e) => {
            eprintln!("Error searching routines: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to search routines: {}", e),
            ))
        }
    }
}

pub async fn get_routine_stats(
    graph: Graph,
    user_id: i64,
    routine_ids: Vec<i64>,
    year: Option<i32>,
) -> Result<Json<Vec<RoutineStats>>, (StatusCode, String)> {
    let target_year = year.unwrap_or_else(|| Utc::now().year());
    let start_date = NaiveDate::from_ymd_opt(target_year, 1, 1).unwrap();
    let end_date = NaiveDate::from_ymd_opt(target_year, 12, 31).unwrap();

    let start_timestamp = start_date
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis();
    let end_timestamp = end_date
        .and_hms_opt(23, 59, 59)
        .unwrap()
        .and_utc()
        .timestamp_millis();

    eprintln!(
        "🔍 [ROUTINE_STATS] Getting stats for routine_ids: {:?}, year: {}",
        routine_ids, target_year
    );

    let mut routine_stats = Vec::new();

    for routine_id in routine_ids {
        eprintln!("🔍 [ROUTINE_STATS] Processing routine_id: {}", routine_id);

        // Check for all events first to see what years have data
        let events_query_str = "
            MATCH (r:Goal)
            WHERE id(r) = $routine_id
            OPTIONAL MATCH (r)-[:HAS_EVENT]->(e:Goal)
            WHERE e.goal_type = 'event'
            RETURN r.name as routine_name,
                   count(e) as total_events,
                   collect({
                       timestamp: e.scheduled_timestamp,
                       completed: COALESCE(e.completed, false),
                       is_deleted: COALESCE(e.is_deleted, false)
                   }) as all_events
        ";

        let events_query = query(events_query_str).param("routine_id", routine_id);

        match graph.execute(events_query).await {
            Ok(mut result) => {
                if let Ok(Some(row)) = result.next().await {
                    let routine_name = row.get::<String>("routine_name").unwrap_or_default();
                    let total_events_count = row.get::<i64>("total_events").unwrap_or(0);
                    let all_events: Vec<serde_json::Value> =
                        row.get("all_events").unwrap_or_default();

                    eprintln!(
                        "🔍 [ROUTINE_STATS] Routine '{}' has {} total events",
                        routine_name, total_events_count
                    );

                    if total_events_count == 0 {
                        eprintln!("🔍 [ROUTINE_STATS] No events found for routine '{}' - routine may need to be processed to create events", routine_name);

                        // Check if routine has any relationships at all
                        let relations_query_str = "
                            MATCH (r:Goal)
                            WHERE id(r) = $routine_id
                            OPTIONAL MATCH (r)-[rel]->(connected)
                            RETURN type(rel) as rel_type, connected.goal_type as connected_type, count(connected) as count
                        ";

                        let relations_query =
                            query(relations_query_str).param("routine_id", routine_id);

                        if let Ok(mut rel_result) = graph.execute(relations_query).await {
                            eprintln!(
                                "🔍 [ROUTINE_STATS] Checking relationships for routine {}:",
                                routine_id
                            );
                            while let Ok(Some(rel_row)) = rel_result.next().await {
                                if let (Ok(rel_type), Ok(conn_type), Ok(count)) = (
                                    rel_row.get::<String>("rel_type"),
                                    rel_row.get::<String>("connected_type"),
                                    rel_row.get::<i64>("count"),
                                ) {
                                    eprintln!(
                                        "  -> {} -> {} (count: {})",
                                        rel_type, conn_type, count
                                    );
                                } else {
                                    eprintln!("  -> No relationships found");
                                }
                            }
                        }
                    } else {
                        // Check what years events are in
                        let mut years_with_events = std::collections::HashMap::new();

                        for event in &all_events {
                            if let Some(timestamp) = event.get("timestamp").and_then(|v| v.as_i64())
                            {
                                if timestamp > 0 {
                                    let year = Utc
                                        .timestamp_millis_opt(timestamp)
                                        .single()
                                        .map(|dt| dt.year())
                                        .unwrap_or(0);
                                    *years_with_events.entry(year).or_insert(0) += 1;
                                }
                            }
                        }

                        if !years_with_events.is_empty() {
                            eprintln!("🔍 [ROUTINE_STATS] Events by year: {:?}", years_with_events);
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("Error in events query: {}", e);
            }
        }

        // Main query with time filtering
        // Only include events that have passed their scheduled time (scheduled_timestamp + duration <= current_time)
        let query_str = "
            MATCH (r:Goal)-[:HAS_EVENT]->(e:Goal)
            WHERE id(r) = $routine_id
            AND r.user_id = $user_id
            AND e.goal_type = 'event'
            AND e.scheduled_timestamp >= $start_timestamp
            AND e.scheduled_timestamp <= $end_timestamp
            AND (e.is_deleted IS NULL OR e.is_deleted = false)
            WITH r, e,
                 (e.scheduled_timestamp + COALESCE(e.duration_minutes, e.duration, 60) * 60 * 1000) as event_end_time,
                 timestamp() as current_time
            WHERE event_end_time <= current_time
            ORDER BY e.scheduled_timestamp
            RETURN r.name as routine_name,
                   collect({
                       date: e.scheduled_timestamp,
                       completed: COALESCE(e.completed, false)
                   }) as events
        ";

        let query = query(query_str)
            .param("routine_id", routine_id)
            .param("user_id", user_id)
            .param("start_timestamp", start_timestamp)
            .param("end_timestamp", end_timestamp);

        match graph.execute(query).await {
            Ok(mut result) => {
                if let Ok(Some(row)) = result.next().await {
                    let routine_name = row.get::<String>("routine_name").unwrap_or_default();
                    let events: Vec<serde_json::Value> = row.get("events").unwrap_or_default();

                    eprintln!(
                        "🔍 [ROUTINE_STATS] Found routine: {}, events in time range: {}",
                        routine_name,
                        events.len()
                    );

                    let mut total_events = 0;
                    let mut completed_events = 0;
                    let mut daily_completion: HashMap<String, (i32, i32)> = HashMap::new();

                    for event in events {
                        if let (Some(timestamp), Some(completed)) = (
                            event.get("date").and_then(|v| v.as_i64()),
                            event.get("completed").and_then(|v| v.as_bool()),
                        ) {
                            total_events += 1;
                            if completed {
                                completed_events += 1;
                            }

                            // Group by date for smoothing
                            let date = Utc
                                .timestamp_millis_opt(timestamp)
                                .single()
                                .map(|dt| dt.format("%Y-%m-%d").to_string())
                                .unwrap_or_default();

                            let entry = daily_completion.entry(date).or_insert((0, 0));
                            entry.0 += 1; // total
                            if completed {
                                entry.1 += 1; // completed
                            }
                        }
                    }

                    let completion_rate = if total_events > 0 {
                        completed_events as f64 / total_events as f64
                    } else {
                        0.0
                    };

                    eprintln!(
                        "🔍 [ROUTINE_STATS] Stats - total: {}, completed: {}, rate: {:.2}",
                        total_events, completed_events, completion_rate
                    );

                    // Create smoothed completion data
                    let smoothed_completion =
                        create_smoothed_completion(&daily_completion, &start_date, &end_date);

                    routine_stats.push(RoutineStats {
                        routine_id,
                        routine_name,
                        completion_rate,
                        total_events,
                        completed_events,
                        smoothed_completion,
                    });
                } else {
                    eprintln!(
                        "🔍 [ROUTINE_STATS] No data found for routine_id: {}",
                        routine_id
                    );
                }
            }
            Err(e) => {
                eprintln!(
                    "Error fetching routine stats for routine {}: {}",
                    routine_id, e
                );
            }
        }
    }

    eprintln!(
        "🔍 [ROUTINE_STATS] Total routine stats returned: {}",
        routine_stats.len()
    );
    Ok(Json(routine_stats))
}

pub async fn get_rescheduling_stats(
    graph: Graph,
    user_id: i64,
    year: Option<i32>,
) -> Result<Json<EventReschedulingStats>, (StatusCode, String)> {
    let target_year = year.unwrap_or_else(|| Utc::now().year());
    let start_date = NaiveDate::from_ymd_opt(target_year, 1, 1).unwrap();
    let end_date = NaiveDate::from_ymd_opt(target_year, 12, 31).unwrap();

    let start_timestamp = start_date
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis();
    let end_timestamp = end_date
        .and_hms_opt(23, 59, 59)
        .unwrap()
        .and_utc()
        .timestamp_millis();

    // Query event moves - for events that belong to tasks, achievements, or routines
    // Only include events that have passed their scheduled time (scheduled_timestamp + duration <= current_time)
    let query_str = "
        MATCH (em:EventMove)
        WHERE em.user_id = $user_id
        AND em.move_timestamp >= $start_timestamp
        AND em.move_timestamp <= $end_timestamp
        AND em.move_type = 'reschedule'
        MATCH (e:Goal)<-[:HAS_EVENT]-(g:Goal)
        WHERE id(e) = em.event_id
        AND e.goal_type = 'event'
        AND g.user_id = $user_id
        AND (g.goal_type = 'task' OR g.goal_type = 'achievement' OR g.goal_type = 'routine')
        AND (e.is_deleted IS NULL OR e.is_deleted = false)
        WITH em, e, g,
             (e.scheduled_timestamp + COALESCE(e.duration_minutes, e.duration, 60) * 60 * 1000) as event_end_time,
             timestamp() as current_time
        WHERE event_end_time <= current_time
        RETURN em.event_id as event_id,
               em.old_timestamp as old_timestamp,
               em.new_timestamp as new_timestamp,
               em.move_timestamp as move_timestamp,
               e.name as event_name,
               g.goal_type as parent_type
        ORDER BY em.move_timestamp
    ";

    let query = query(query_str)
        .param("user_id", user_id)
        .param("start_timestamp", start_timestamp)
        .param("end_timestamp", end_timestamp);

    match graph.execute(query).await {
        Ok(mut result) => {
            let mut reschedules = Vec::new();
            let mut total_distance_hours = 0.0;
            let mut monthly_counts: HashMap<String, i32> = HashMap::new();
            let mut event_reschedule_counts: HashMap<String, (String, i32)> = HashMap::new();

            while let Ok(Some(row)) = result.next().await {
                let old_timestamp = row.get::<i64>("old_timestamp").unwrap_or(0);
                let new_timestamp = row.get::<i64>("new_timestamp").unwrap_or(0);
                let move_timestamp = row.get::<i64>("move_timestamp").unwrap_or(0);
                let event_name = row.get::<String>("event_name").unwrap_or_default();
                let parent_type = row.get::<String>("parent_type").unwrap_or_default();

                // Calculate distance in hours
                let distance_hours =
                    (new_timestamp - old_timestamp).abs() as f64 / (1000.0 * 60.0 * 60.0);
                total_distance_hours += distance_hours;

                // Group by month
                let month = Utc
                    .timestamp_millis_opt(move_timestamp)
                    .single()
                    .map(|dt| dt.format("%Y-%m").to_string())
                    .unwrap_or_default();
                *monthly_counts.entry(month).or_insert(0) += 1;

                // Count reschedules per event
                let entry = event_reschedule_counts
                    .entry(event_name.clone())
                    .or_insert((parent_type.clone(), 0));
                entry.1 += 1;

                reschedules.push((old_timestamp, new_timestamp, move_timestamp));
            }

            let total_reschedules = reschedules.len() as i32;
            let avg_reschedule_distance_hours = if total_reschedules > 0 {
                total_distance_hours / total_reschedules as f64
            } else {
                0.0
            };

            // Create monthly stats
            let mut reschedule_frequency_by_month = Vec::new();
            for (month, count) in monthly_counts {
                reschedule_frequency_by_month.push(MonthlyRescheduleStats {
                    month,
                    reschedule_count: count,
                    total_events: 100, // TODO: Calculate actual total events for the month
                    reschedule_rate: count as f64 / 100.0, // TODO: Use actual total
                });
            }

            // Get most rescheduled events
            let mut most_rescheduled_events: Vec<_> = event_reschedule_counts
                .into_iter()
                .map(|(name, (parent_type, count))| RescheduledEventInfo {
                    event_name: name,
                    reschedule_count: count,
                    parent_type,
                })
                .collect();
            most_rescheduled_events.sort_by(|a, b| b.reschedule_count.cmp(&a.reschedule_count));
            most_rescheduled_events.truncate(10);

            Ok(Json(EventReschedulingStats {
                total_reschedules,
                avg_reschedule_distance_hours,
                reschedule_frequency_by_month,
                most_rescheduled_events,
            }))
        }
        Err(e) => {
            eprintln!("Error fetching rescheduling stats: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch rescheduling stats: {}", e),
            ))
        }
    }
}

pub async fn record_event_move(
    graph: Graph,
    event_move: EventMove,
) -> Result<Json<EventMove>, (StatusCode, String)> {
    let query_str = "
        CREATE (em:EventMove {
            event_id: $event_id,
            user_id: $user_id,
            old_timestamp: $old_timestamp,
            new_timestamp: $new_timestamp,
            move_type: $move_type,
            move_timestamp: $move_timestamp,
            reason: $reason
        })
        RETURN id(em) as id
    ";

    let query = query(query_str)
        .param("event_id", event_move.event_id)
        .param("user_id", event_move.user_id)
        .param("old_timestamp", event_move.old_timestamp)
        .param("new_timestamp", event_move.new_timestamp)
        .param("move_type", event_move.move_type.clone())
        .param("move_timestamp", event_move.move_timestamp)
        .param("reason", event_move.reason.clone());

    match graph.execute(query).await {
        Ok(mut result) => {
            let mut created_move = event_move;
            if let Ok(Some(row)) = result.next().await {
                created_move.id = Some(row.get::<i64>("id").unwrap_or(0));
            }
            Ok(Json(created_move))
        }
        Err(e) => {
            eprintln!("Error recording event move: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to record event move: {}", e),
            ))
        }
    }
}

// Helper functions

fn aggregate_weekly_stats(daily_stats: &[DailyStats], _year: i32) -> Vec<PeriodStats> {
    let mut weekly_stats = HashMap::new();

    for day_stat in daily_stats {
        if let Ok(date) = NaiveDate::parse_from_str(&day_stat.date, "%Y-%m-%d") {
            let iso_week = date.iso_week();
            let week_key = format!("{}-W{:02}", iso_week.year(), iso_week.week());

            let entry = weekly_stats.entry(week_key.clone()).or_insert(PeriodStats {
                period: week_key,
                completion_rate: 0.0,
                total_events: 0,
                completed_events: 0,
                days_with_tasks: 0,
                days_with_no_tasks_complete: 0,
                weighted_total: 0.0,
                weighted_completed: 0.0,
            });

            entry.total_events += day_stat.total_events;
            entry.completed_events += day_stat.completed_events;
            entry.weighted_total += day_stat.weighted_total;
            entry.weighted_completed += day_stat.weighted_completed;

            if day_stat.total_events > 0 {
                entry.days_with_tasks += 1;
                if day_stat.completed_events == 0 {
                    entry.days_with_no_tasks_complete += 1;
                }
            }
        }
    }

    // Calculate completion rates
    for stat in weekly_stats.values_mut() {
        stat.completion_rate = if stat.weighted_total > 0.0 {
            stat.weighted_completed / stat.weighted_total
        } else {
            0.0
        };
    }

    let mut result: Vec<_> = weekly_stats.into_values().collect();
    result.sort_by(|a, b| a.period.cmp(&b.period));
    result
}

fn aggregate_monthly_stats(daily_stats: &[DailyStats], _year: i32) -> Vec<PeriodStats> {
    let mut monthly_stats = HashMap::new();

    for day_stat in daily_stats {
        if let Ok(date) = NaiveDate::parse_from_str(&day_stat.date, "%Y-%m-%d") {
            let month_key = format!("{}-{:02}", date.year(), date.month());

            let entry = monthly_stats
                .entry(month_key.clone())
                .or_insert(PeriodStats {
                    period: month_key,
                    completion_rate: 0.0,
                    total_events: 0,
                    completed_events: 0,
                    days_with_tasks: 0,
                    days_with_no_tasks_complete: 0,
                    weighted_total: 0.0,
                    weighted_completed: 0.0,
                });

            entry.total_events += day_stat.total_events;
            entry.completed_events += day_stat.completed_events;
            entry.weighted_total += day_stat.weighted_total;
            entry.weighted_completed += day_stat.weighted_completed;

            if day_stat.total_events > 0 {
                entry.days_with_tasks += 1;
                if day_stat.completed_events == 0 {
                    entry.days_with_no_tasks_complete += 1;
                }
            }
        }
    }

    // Calculate completion rates
    for stat in monthly_stats.values_mut() {
        stat.completion_rate = if stat.weighted_total > 0.0 {
            stat.weighted_completed / stat.weighted_total
        } else {
            0.0
        };
    }

    let mut result: Vec<_> = monthly_stats.into_values().collect();
    result.sort_by(|a, b| a.period.cmp(&b.period));
    result
}

fn aggregate_yearly_stats(daily_stats: &[DailyStats], year: i32) -> PeriodStats {
    let mut yearly_stat = PeriodStats {
        period: year.to_string(),
        completion_rate: 0.0,
        total_events: 0,
        completed_events: 0,
        days_with_tasks: 0,
        days_with_no_tasks_complete: 0,
        weighted_total: 0.0,
        weighted_completed: 0.0,
    };

    for day_stat in daily_stats {
        yearly_stat.total_events += day_stat.total_events;
        yearly_stat.completed_events += day_stat.completed_events;
        yearly_stat.weighted_total += day_stat.weighted_total;
        yearly_stat.weighted_completed += day_stat.weighted_completed;

        if day_stat.total_events > 0 {
            yearly_stat.days_with_tasks += 1;
            if day_stat.completed_events == 0 {
                yearly_stat.days_with_no_tasks_complete += 1;
            }
        }
    }

    yearly_stat.completion_rate = if yearly_stat.weighted_total > 0.0 {
        yearly_stat.weighted_completed / yearly_stat.weighted_total
    } else {
        0.0
    };

    yearly_stat
}

fn create_smoothed_completion(
    daily_completion: &HashMap<String, (i32, i32)>,
    start_date: &NaiveDate,
    end_date: &NaiveDate,
) -> Vec<SmoothedPoint> {
    let mut points = Vec::new();
    let window_size = 7; // 7-day smoothing window

    let mut current_date = *start_date;
    while current_date <= *end_date {
        let date_str = current_date.format("%Y-%m-%d").to_string();

        // Calculate smoothed completion rate using surrounding days
        let mut total_events = 0;
        let mut completed_events = 0;

        for i in -(window_size / 2)..=(window_size / 2) {
            let check_date = current_date + Duration::days(i);
            let check_date_str = check_date.format("%Y-%m-%d").to_string();

            if let Some((total, completed)) = daily_completion.get(&check_date_str) {
                total_events += total;
                completed_events += completed;
            }
        }

        let completion_rate = if total_events > 0 {
            completed_events as f64 / total_events as f64
        } else {
            0.0
        };

        points.push(SmoothedPoint {
            date: date_str,
            completion_rate,
        });

        current_date += Duration::days(1);
    }

    points
}

pub async fn get_event_analytics(
    graph: Graph,
    user_id: i64,
    year: Option<i32>,
) -> Result<Json<EventAnalytics>, (StatusCode, String)> {
    let target_year = year.unwrap_or_else(|| Utc::now().year());

    // Get start and end timestamps for the year
    let start_date = NaiveDate::from_ymd_opt(target_year, 1, 1).unwrap();
    let end_date = NaiveDate::from_ymd_opt(target_year, 12, 31).unwrap();

    let start_timestamp = start_date
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis();
    let end_timestamp = end_date
        .and_hms_opt(23, 59, 59)
        .unwrap()
        .and_utc()
        .timestamp_millis();

    // Query all events with their parent information and duration
    // Only include events that have passed their scheduled time (scheduled_timestamp + duration <= current_time)
    let query_str = "
        MATCH (e:Goal)<-[:HAS_EVENT]-(g:Goal)
        WHERE e.goal_type = 'event'
        AND g.user_id = $user_id
        AND (g.goal_type = 'task' OR g.goal_type = 'routine')
        AND e.scheduled_timestamp >= $start_timestamp
        AND e.scheduled_timestamp <= $end_timestamp
        AND (e.is_deleted IS NULL OR e.is_deleted = false)
        WITH e, g,
             (e.scheduled_timestamp + COALESCE(e.duration_minutes, e.duration, 60) * 60 * 1000) as event_end_time,
             timestamp() as current_time
        WHERE event_end_time <= current_time
        RETURN e.scheduled_timestamp as scheduled_timestamp,
               COALESCE(e.end_timestamp, e.scheduled_timestamp + COALESCE(e.duration_minutes, 60) * 60 * 1000) as end_timestamp,
               COALESCE(e.duration_minutes, 60) as duration_minutes,
               COALESCE(e.completed, false) as completed,
               COALESCE(e.priority, g.priority, 'medium') as priority,
               g.goal_type as parent_type,
               g.name as parent_name
    ";

    let query = query(query_str)
        .param("user_id", user_id)
        .param("start_timestamp", start_timestamp)
        .param("end_timestamp", end_timestamp);

    match graph.execute(query).await {
        Ok(mut result) => {
            let mut events = Vec::new();

            while let Ok(Some(row)) = result.next().await {
                let scheduled_timestamp = row.get::<i64>("scheduled_timestamp").unwrap_or(0);
                let end_timestamp = row.get::<i64>("end_timestamp").unwrap_or(0);
                let duration_minutes = row.get::<i64>("duration_minutes").unwrap_or(60);
                let completed = row.get::<bool>("completed").unwrap_or(false);
                let priority = row
                    .get::<String>("priority")
                    .unwrap_or_else(|_| "medium".to_string());
                let parent_type = row
                    .get::<String>("parent_type")
                    .unwrap_or_else(|_| "unknown".to_string());

                // Calculate actual duration if end_timestamp is available
                let actual_duration = if end_timestamp > scheduled_timestamp {
                    ((end_timestamp - scheduled_timestamp) / (60 * 1000)) as f64
                } else {
                    duration_minutes as f64
                };

                events.push((actual_duration, completed, priority, parent_type));
            }

            // Generate analytics
            let duration_stats = calculate_duration_stats(&events);
            let priority_stats = calculate_priority_stats(&events);
            let source_stats = calculate_source_stats(&events);

            Ok(Json(EventAnalytics {
                duration_stats,
                priority_stats,
                source_stats,
            }))
        }
        Err(e) => {
            eprintln!("Error fetching event analytics: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch event analytics: {}", e),
            ))
        }
    }
}

fn calculate_duration_stats(events: &[(f64, bool, String, String)]) -> Vec<DurationStats> {
    let mut duration_buckets: HashMap<String, (i32, i32, f64)> = HashMap::new();

    for (duration, completed, _, _) in events {
        let bucket = match *duration as i64 {
            0..=15 => "0-15 min",
            16..=30 => "16-30 min",
            31..=60 => "31-60 min",
            61..=120 => "1-2 hours",
            121..=240 => "2-4 hours",
            _ => "4+ hours",
        };

        let entry = duration_buckets
            .entry(bucket.to_string())
            .or_insert((0, 0, 0.0));
        entry.0 += 1; // total events
        if *completed {
            entry.1 += 1; // completed events
        }
        entry.2 += duration; // sum of durations
    }

    let mut stats = Vec::new();
    for (range, (total, completed, duration_sum)) in duration_buckets {
        let completion_rate = if total > 0 {
            completed as f64 / total as f64
        } else {
            0.0
        };
        let avg_duration = if total > 0 {
            duration_sum / total as f64
        } else {
            0.0
        };

        stats.push(DurationStats {
            duration_range: range,
            completion_rate,
            total_events: total,
            completed_events: completed,
            avg_duration_minutes: avg_duration,
        });
    }

    // Sort by duration range
    stats.sort_by(|a, b| {
        let order = [
            "0-15 min",
            "16-30 min",
            "31-60 min",
            "1-2 hours",
            "2-4 hours",
            "4+ hours",
        ];
        let a_index = order
            .iter()
            .position(|&x| x == a.duration_range)
            .unwrap_or(999);
        let b_index = order
            .iter()
            .position(|&x| x == b.duration_range)
            .unwrap_or(999);
        a_index.cmp(&b_index)
    });

    stats
}

fn calculate_priority_stats(events: &[(f64, bool, String, String)]) -> Vec<PriorityStats> {
    let mut priority_buckets: HashMap<String, (i32, i32)> = HashMap::new();

    for (_, completed, priority, _) in events {
        let entry = priority_buckets.entry(priority.clone()).or_insert((0, 0));
        entry.0 += 1; // total events
        if *completed {
            entry.1 += 1; // completed events
        }
    }

    let mut stats = Vec::new();
    for (priority, (total, completed)) in priority_buckets {
        let completion_rate = if total > 0 {
            completed as f64 / total as f64
        } else {
            0.0
        };

        stats.push(PriorityStats {
            priority,
            completion_rate,
            total_events: total,
            completed_events: completed,
        });
    }

    // Sort by priority order
    stats.sort_by(|a, b| {
        let order = ["none", "low", "medium", "high"];
        let a_index = order.iter().position(|&x| x == a.priority).unwrap_or(999);
        let b_index = order.iter().position(|&x| x == b.priority).unwrap_or(999);
        a_index.cmp(&b_index)
    });

    stats
}

fn calculate_source_stats(events: &[(f64, bool, String, String)]) -> SourceStats {
    let mut routine_stats = (0, 0, 0.0);
    let mut task_stats = (0, 0, 0.0);

    for (_, completed, priority, parent_type) in events {
        let priority_weight = match priority.as_str() {
            "none" => 0.0,
            "low" => 1.0,
            "medium" => 2.0,
            "high" => 3.0,
            _ => 2.0,
        };

        match parent_type.as_str() {
            "routine" => {
                routine_stats.0 += 1;
                if *completed {
                    routine_stats.1 += 1;
                }
                routine_stats.2 += priority_weight;
            }
            "task" => {
                task_stats.0 += 1;
                if *completed {
                    task_stats.1 += 1;
                }
                task_stats.2 += priority_weight;
            }
            _ => {}
        }
    }

    SourceStats {
        routine_events: SourceBreakdown {
            completion_rate: if routine_stats.0 > 0 {
                routine_stats.1 as f64 / routine_stats.0 as f64
            } else {
                0.0
            },
            total_events: routine_stats.0,
            completed_events: routine_stats.1,
            avg_priority_weight: if routine_stats.0 > 0 {
                routine_stats.2 / routine_stats.0 as f64
            } else {
                0.0
            },
        },
        task_events: SourceBreakdown {
            completion_rate: if task_stats.0 > 0 {
                task_stats.1 as f64 / task_stats.0 as f64
            } else {
                0.0
            },
            total_events: task_stats.0,
            completed_events: task_stats.1,
            avg_priority_weight: if task_stats.0 > 0 {
                task_stats.2 / task_stats.0 as f64
            } else {
                0.0
            },
        },
    }
}
