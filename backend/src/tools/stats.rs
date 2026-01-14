use axum::{extract::Json, http::StatusCode};
use chrono::{Datelike, Duration, LocalResult, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use neo4rs::{query, Graph};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

fn priority_to_weight(priority: &str) -> f64 {
    match priority {
        "none" => 0.0,
        "low" => 1.0,
        "medium" => 2.0,
        "high" => 3.0,
        _ => 2.0,
    }
}

#[derive(Debug, Clone)]
struct RawGoalData {
    name: String,
    goal_type: String,
    priority: String,
    child_ids: Vec<i64>,
    events: Vec<RawEventData>,
}

#[derive(Debug, Clone)]
struct RawEventData {
    completed: bool,
    priority: String,
    duration: f64,
    date: String,
}

#[derive(Debug, Clone)]
struct RecursiveStats {
    total_events: i32,
    completed_events: i32,
    total_duration_minutes: f64,
    weighted_completion_rate: f64,
    children_count: i32,
    daily_stats: HashMap<String, DailyRecursiveStats>,
}

#[derive(Debug, Clone, Default)]
struct DailyRecursiveStats {
    weighted_total: f64,
    weighted_completed: f64,
    duration: f64,
    completed_count: i32,
    total_count: i32,
}

fn calculate_recursive_stats_internal(
    goal_id: i64,
    goals_map: &HashMap<i64, RawGoalData>,
    cache: &mut HashMap<i64, RecursiveStats>,
    visited: &mut HashSet<i64>,
) -> RecursiveStats {
    if let Some(cached) = cache.get(&goal_id) {
        return cached.clone();
    }
    if visited.contains(&goal_id) {
        // Break cycle
        return RecursiveStats {
            total_events: 0,
            completed_events: 0,
            total_duration_minutes: 0.0,
            weighted_completion_rate: 0.0,
            children_count: 0,
            daily_stats: HashMap::new(),
        };
    }
    visited.insert(goal_id);

    let goal = &goals_map[&goal_id];
    
    // 1. Gather stats from direct events
    let mut total_events = 0;
    let mut completed_events = 0;
    let mut total_duration_minutes = 0.0;
    let mut total_weight = 0.0;
    let mut completed_weight = 0.0;
    let mut children_count = 0;
    let mut daily_stats: HashMap<String, DailyRecursiveStats> = HashMap::new();

    for event in &goal.events {
        let weight = priority_to_weight(&event.priority);
        total_events += 1;
        total_weight += weight;
        if event.completed {
            completed_events += 1;
            completed_weight += weight;
            total_duration_minutes += event.duration;
        }

        let day = daily_stats.entry(event.date.clone()).or_default();
        day.total_count += 1;
        day.weighted_total += weight;
        if event.completed {
            day.completed_count += 1;
            day.weighted_completed += weight;
            day.duration += event.duration;
        }
    }

    // 2. Gather stats from children goals
    let mut child_completion_sum = 0.0;
    let mut child_weight_sum = 0.0;
    
    // We'll also track daily completion rates from children to aggregate them
    // Map of date -> (sum(child_rate * child_weight), sum(child_weight))
    let mut daily_child_agg: HashMap<String, (f64, f64)> = HashMap::new();

    for &child_id in &goal.child_ids {
        if let Some(child_raw) = goals_map.get(&child_id) {
            let child_stats = calculate_recursive_stats_internal(child_id, goals_map, cache, visited);
            
            // Flat aggregates
            total_events += child_stats.total_events;
            completed_events += child_stats.completed_events;
            total_duration_minutes += child_stats.total_duration_minutes;
            children_count += 1 + child_stats.children_count;

            // Weighted completion for parent
            let weight = priority_to_weight(&child_raw.priority);
            child_completion_sum += child_stats.weighted_completion_rate * weight;
            child_weight_sum += weight;

            // Aggregate child's daily stats into parent's daily stats
            for (date, child_daily) in child_stats.daily_stats {
                let parent_day = daily_stats.entry(date.clone()).or_default();
                parent_day.total_count += child_daily.total_count;
                parent_day.completed_count += child_daily.completed_count;
                parent_day.duration += child_daily.duration;
                
                // For daily completion rate, we use child's rate and child's weight
                let agg = daily_child_agg.entry(date).or_default();
                let child_day_rate = if child_daily.weighted_total > 0.0 {
                    child_daily.weighted_completed / child_daily.weighted_total
                } else {
                    0.0
                };
                agg.0 += child_day_rate * weight;
                agg.1 += weight;
            }
        }
    }

    // 3. Finalize total weighted completion rate
    // Combine children's completions and direct events' completions
    let combined_weight_sum = child_weight_sum + total_weight;
    let combined_completion_sum = child_completion_sum + completed_weight;

    let weighted_completion_rate = if combined_weight_sum > 0.0 {
        combined_completion_sum / combined_weight_sum
    } else {
        0.0
    };

    // 4. Finalize daily completion rates
    // Combine children's daily rates and direct events' completions for each day
    for (date, day) in daily_stats.iter_mut() {
        if let Some(&(child_sum, child_w_sum)) = daily_child_agg.get(date) {
            // day.weighted_completed/total currently contain direct events for this day
            let daily_combined_weight = child_w_sum + day.weighted_total;
            let daily_combined_completion = child_sum + day.weighted_completed;
            
            if daily_combined_weight > 0.0 {
                day.weighted_completed = daily_combined_completion;
                day.weighted_total = daily_combined_weight;
            }
        }
    }

    let stats = RecursiveStats {
        total_events,
        completed_events,
        total_duration_minutes,
        weighted_completion_rate,
        children_count,
        daily_stats,
    };

    visited.remove(&goal_id);
    cache.insert(goal_id, stats.clone());
    stats
}

fn normalize_tz(tz: &str) -> Result<String, (StatusCode, String)> {
    let tz = tz.trim();
    let tz = if tz.is_empty() { "UTC" } else { tz };
    let tz = if tz.eq_ignore_ascii_case("utc") {
        "UTC"
    } else {
        tz
    };

    tz.parse::<Tz>()
        .map(|tz| tz.to_string())
        .map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                format!(
                    "Invalid timezone '{}'. Expected an IANA timezone like 'America/New_York' or 'UTC'.",
                    tz
                ),
            )
        })
}

fn tz_local_datetime_to_utc_millis(tz: &Tz, naive: chrono::NaiveDateTime) -> i64 {
    match tz.from_local_datetime(&naive) {
        LocalResult::Single(dt) => dt.with_timezone(&Utc).timestamp_millis(),
        LocalResult::Ambiguous(dt1, _dt2) => dt1.with_timezone(&Utc).timestamp_millis(),
        // Extremely rare for midnights in IANA zones, but handle DST gaps defensively:
        LocalResult::None => {
            let fallback = naive + Duration::hours(1);
            match tz.from_local_datetime(&fallback) {
                LocalResult::Single(dt) => dt.with_timezone(&Utc).timestamp_millis(),
                LocalResult::Ambiguous(dt1, _dt2) => dt1.with_timezone(&Utc).timestamp_millis(),
                LocalResult::None => tz.from_utc_datetime(&naive).timestamp_millis(),
            }
        }
    }
}

fn tz_midnight_utc_millis(tz: &Tz, date: NaiveDate) -> i64 {
    tz_local_datetime_to_utc_millis(tz, date.and_hms_opt(0, 0, 0).unwrap())
}

fn tz_year_range_utc_millis(year: i32, tz: &Tz) -> (i64, i64) {
    let start_date = NaiveDate::from_ymd_opt(year, 1, 1).unwrap();
    let end_date = NaiveDate::from_ymd_opt(year, 12, 31).unwrap();

    let start = tz_local_datetime_to_utc_millis(tz, start_date.and_hms_opt(0, 0, 0).unwrap());
    let end = tz_local_datetime_to_utc_millis(tz, end_date.and_hms_opt(23, 59, 59).unwrap());
    (start, end)
}

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

#[derive(Debug, Serialize, Deserialize)]
pub struct ChildEffortTimeSeries {
    pub goal_id: i64,
    pub goal_name: String,
    pub goal_type: String,
    pub total_events: i32,
    pub completed_events: i32,
    pub total_duration_minutes: f64,
    pub weighted_completion_rate: f64,
    pub children_count: i32,
    pub daily_stats: Vec<DailyEffortPoint>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DailyEffortPoint {
    pub date: String,
    pub duration_minutes: f64,
    pub completed_events: i32,
    pub weighted_completion: f64,
    pub weighted_score: f64,
}

pub async fn get_year_stats(
    graph: Graph,
    user_id: i64,
    year: Option<i32>,
    tz: String,
) -> Result<Json<YearStats>, (StatusCode, String)> {
    let target_year = year.unwrap_or_else(|| Utc::now().year());
    let tz = normalize_tz(&tz)?;
    let tz_parsed: Tz = tz
        .parse()
        .expect("normalize_tz validated timezone; parse should not fail");

    // Get start and end timestamps for the year
    let start_date = NaiveDate::from_ymd_opt(target_year, 1, 1).unwrap();
    let end_date = NaiveDate::from_ymd_opt(target_year, 12, 31).unwrap();

    // Use the user's timezone for year boundaries so "year" matches their local calendar.
    let (start_timestamp, end_timestamp) = tz_year_range_utc_millis(target_year, &tz_parsed);

    // Query all events (Goal nodes with goal_type='event') linked to tasks, achievements, and routines for the year
    // Only include events that have passed their scheduled time (scheduled_timestamp + duration <= current_time)
    // Exclude skipped events from metrics entirely
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
             timestamp() as current_time,
             COALESCE(e.resolution_status, 'pending') as status
        WHERE event_end_time <= current_time
        AND status <> 'skipped'
        WITH e, g, status,
             datetime({epochMillis: e.scheduled_timestamp, timezone: $tz}) as dt
        RETURN toString(date(dt)) as date,
               CASE WHEN status = 'completed' THEN true ELSE false END as completed,
               COALESCE(e.priority, g.priority, 'medium') as priority
    ";

    let query = query(query_str)
        .param("user_id", user_id)
        .param("start_timestamp", start_timestamp)
        .param("end_timestamp", end_timestamp)
        .param("tz", tz);

    match graph.execute(query).await {
        Ok(mut result) => {
            let mut daily_events: HashMap<String, Vec<(bool, String)>> = HashMap::new();

            while let Ok(Some(row)) = result.next().await {
                let date = row.get::<String>("date").unwrap_or_default();
                let completed = row.get::<bool>("completed").unwrap_or(false);
                let priority = row
                    .get::<String>("priority")
                    .unwrap_or_else(|_| "medium".to_string());

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
    tz: String,
) -> Result<Json<Vec<EffortStat>>, (StatusCode, String)> {
    // Determine lower bound start timestamp from range (approximate months/years using days),
    // anchored to the user's local midnight to match their calendar expectations.
    let tz_parsed: Tz = normalize_tz(&tz)?
        .parse()
        .expect("normalize_tz validated timezone; parse should not fail");
    let today_local = Utc::now().with_timezone(&tz_parsed).date_naive();

    let start_timestamp_opt: Option<i64> = match range.as_deref() {
        Some("5y") => Some(tz_midnight_utc_millis(
            &tz_parsed,
            today_local - Duration::days(5 * 365),
        )),
        Some("1y") => Some(tz_midnight_utc_millis(
            &tz_parsed,
            today_local - Duration::days(365),
        )),
        Some("6m") => Some(tz_midnight_utc_millis(
            &tz_parsed,
            today_local - Duration::days(182),
        )),
        Some("3m") => Some(tz_midnight_utc_millis(
            &tz_parsed,
            today_local - Duration::days(91),
        )),
        Some("1m") => Some(tz_midnight_utc_millis(
            &tz_parsed,
            today_local - Duration::days(30),
        )),
        Some("2w") => Some(tz_midnight_utc_millis(
            &tz_parsed,
            today_local - Duration::days(14),
        )),
        Some("all") | None | Some("") => None,
        Some(_) => None,
    };

    // Fetch all non-event goals and their relationships for the user
    let tree_query_str = r#"
        MATCH (g:Goal)
        WHERE g.user_id = $user_id AND g.goal_type <> 'event'
        OPTIONAL MATCH (g)-[:CHILD]->(child:Goal)
        WHERE child.user_id = $user_id AND child.goal_type <> 'event'
        OPTIONAL MATCH (g)-[:HAS_EVENT]->(e:Goal)
        WHERE e.goal_type = 'event'
          AND (e.is_deleted IS NULL OR e.is_deleted = false)
          AND e.scheduled_timestamp < timestamp()
          AND ($start_timestamp IS NULL OR e.scheduled_timestamp >= $start_timestamp)
          AND COALESCE(e.resolution_status, 'pending') <> 'skipped'
        RETURN id(g) AS id,
               g.name AS name,
               g.goal_type AS goal_type,
               COALESCE(g.priority, 'medium') AS priority,
               collect(DISTINCT id(child)) AS child_ids,
               collect(DISTINCT {
                   status: COALESCE(e.resolution_status, 'pending'),
                   priority: COALESCE(e.priority, g.priority, 'medium'),
                   duration: CASE
                      WHEN e.end_timestamp IS NOT NULL AND e.end_timestamp > e.scheduled_timestamp
                        THEN toFloat(e.end_timestamp - e.scheduled_timestamp) / (1000.0*60.0)
                      ELSE toFloat(COALESCE(e.duration_minutes, e.duration, 60))
                    END,
                   date: toString(date(datetime({epochMillis: e.scheduled_timestamp, timezone: $tz})))
               }) AS events
    "#;

    let mut q = query(tree_query_str)
        .param("user_id", user_id)
        .param("tz", tz_parsed.to_string());

    if let Some(start) = start_timestamp_opt {
        q = q.param("start_timestamp", start);
    } else {
        q = q.param("start_timestamp", Option::<i64>::None);
    }

    match graph.execute(q).await {
        Ok(mut result) => {
            let mut goals_map = HashMap::new();
            let mut goal_ids = Vec::new();

            while let Ok(Some(row)) = result.next().await {
                let id = row.get::<i64>("id").unwrap_or(0);
                let name = row.get::<String>("name").unwrap_or_default();
                let goal_type = row.get::<String>("goal_type").unwrap_or_default();
                let priority = row.get::<String>("priority").unwrap_or_else(|_| "medium".to_string());
                let child_ids = row.get::<Vec<i64>>("child_ids").unwrap_or_default();
                let events_raw: Vec<serde_json::Value> = row.get("events").unwrap_or_default();

                let mut events = Vec::new();
                for ev in events_raw {
                    if let Some(status) = ev.get("status").and_then(|v| v.as_str()) {
                        events.push(RawEventData {
                            completed: status == "completed",
                            priority: ev.get("priority").and_then(|v| v.as_str()).unwrap_or("medium").to_string(),
                            duration: ev.get("duration").and_then(|v| v.as_f64()).unwrap_or(60.0),
                            date: ev.get("date").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        });
                    }
                }

                goals_map.insert(id, RawGoalData {
                    name,
                    goal_type,
                    priority,
                    child_ids,
                    events,
                });
                goal_ids.push(id);
            }

            // Calculate recursive stats for all goals
            let mut cache = HashMap::new();
            let mut stats = Vec::new();

            for id in goal_ids {
                let mut visited = HashSet::new();
                let res = calculate_recursive_stats_internal(id, &goals_map, &mut cache, &mut visited);
                
                let goal = &goals_map[&id];
                stats.push(EffortStat {
                    goal_id: id,
                    goal_name: goal.name.clone(),
                    goal_type: goal.goal_type.clone(),
                    total_events: res.total_events,
                    completed_events: res.completed_events,
                    total_duration_minutes: res.total_duration_minutes,
                    weighted_completion_rate: res.weighted_completion_rate,
                    children_count: res.children_count,
                });
            }

            // Original sorting: total_duration_minutes DESC
            stats.sort_by(|a, b| b.total_duration_minutes.partial_cmp(&a.total_duration_minutes).unwrap_or(std::cmp::Ordering::Equal));

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

pub async fn get_goal_children_effort(
    graph: Graph,
    user_id: i64,
    goal_id: i64,
    range: Option<String>,
    tz: String,
) -> Result<Json<Vec<ChildEffortTimeSeries>>, (StatusCode, String)> {
    let tz = normalize_tz(&tz)?;
    let tz_parsed: Tz = tz
        .parse()
        .expect("normalize_tz validated timezone; parse should not fail");
    // Determine lower bound start timestamp from range
    let today_local = Utc::now().with_timezone(&tz_parsed).date_naive();
    let start_timestamp_opt: Option<i64> = match range.as_deref() {
        Some("5y") => Some(tz_midnight_utc_millis(
            &tz_parsed,
            today_local - Duration::days(5 * 365),
        )),
        Some("1y") => Some(tz_midnight_utc_millis(
            &tz_parsed,
            today_local - Duration::days(365),
        )),
        Some("6m") => Some(tz_midnight_utc_millis(
            &tz_parsed,
            today_local - Duration::days(182),
        )),
        Some("3m") => Some(tz_midnight_utc_millis(
            &tz_parsed,
            today_local - Duration::days(91),
        )),
        Some("1m") => Some(tz_midnight_utc_millis(
            &tz_parsed,
            today_local - Duration::days(30),
        )),
        Some("2w") => Some(tz_midnight_utc_millis(
            &tz_parsed,
            today_local - Duration::days(14),
        )),
        Some("all") | None | Some("") => None,
        Some(_) => None,
    };

    // Fetch all non-event goals and their relationships for the user
    let tree_query_str = r#"
        MATCH (g:Goal)
        WHERE g.user_id = $user_id AND g.goal_type <> 'event'
        OPTIONAL MATCH (g)-[:CHILD]->(child:Goal)
        WHERE child.user_id = $user_id AND child.goal_type <> 'event'
        OPTIONAL MATCH (g)-[:HAS_EVENT]->(e:Goal)
        WHERE e.goal_type = 'event'
          AND (e.is_deleted IS NULL OR e.is_deleted = false)
          AND e.scheduled_timestamp < timestamp()
          AND ($start_timestamp IS NULL OR e.scheduled_timestamp >= $start_timestamp)
          AND COALESCE(e.resolution_status, 'pending') <> 'skipped'
        RETURN id(g) AS id,
               g.name AS name,
               g.goal_type AS goal_type,
               COALESCE(g.priority, 'medium') AS priority,
               collect(DISTINCT id(child)) AS child_ids,
               collect(DISTINCT {
                   status: COALESCE(e.resolution_status, 'pending'),
                   priority: COALESCE(e.priority, g.priority, 'medium'),
                   duration: CASE
                      WHEN e.end_timestamp IS NOT NULL AND e.end_timestamp > e.scheduled_timestamp
                        THEN toFloat(e.end_timestamp - e.scheduled_timestamp) / (1000.0*60.0)
                      ELSE toFloat(COALESCE(e.duration_minutes, e.duration, 60))
                    END,
                   date: toString(date(datetime({epochMillis: e.scheduled_timestamp, timezone: $tz})))
               }) AS events
    "#;

    let mut q = query(tree_query_str)
        .param("user_id", user_id)
        .param("tz", tz_parsed.to_string());

    if let Some(start) = start_timestamp_opt {
        q = q.param("start_timestamp", start);
    } else {
        q = q.param("start_timestamp", Option::<i64>::None);
    }

    match graph.execute(q).await {
        Ok(mut result) => {
            let mut goals_map = HashMap::new();
            let mut root_goal_child_ids = Vec::new();

            // First pass to build the map and find direct children of the target goal_id
            while let Ok(Some(row)) = result.next().await {
                let id = row.get::<i64>("id").unwrap_or(0);
                let name = row.get::<String>("name").unwrap_or_default();
                let goal_type = row.get::<String>("goal_type").unwrap_or_default();
                let priority = row.get::<String>("priority").unwrap_or_else(|_| "medium".to_string());
                let child_ids = row.get::<Vec<i64>>("child_ids").unwrap_or_default();
                let events_raw: Vec<serde_json::Value> = row.get("events").unwrap_or_default();

                let mut events = Vec::new();
                for ev in events_raw {
                    if let Some(status) = ev.get("status").and_then(|v| v.as_str()) {
                        events.push(RawEventData {
                            completed: status == "completed",
                            priority: ev.get("priority").and_then(|v| v.as_str()).unwrap_or("medium").to_string(),
                            duration: ev.get("duration").and_then(|v| v.as_f64()).unwrap_or(60.0),
                            date: ev.get("date").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        });
                    }
                }

                goals_map.insert(id, RawGoalData {
                    name,
                    goal_type,
                    priority,
                    child_ids: child_ids.clone(),
                    events,
                });

                if id == goal_id {
                    root_goal_child_ids = child_ids;
                }
            }

            // Calculate recursive stats for the relevant children
            let mut cache = HashMap::new();
            let mut children_stats = Vec::new();

            for child_id in root_goal_child_ids {
                if let Some(child_raw) = goals_map.get(&child_id) {
                    let mut visited = HashSet::new();
                    let res = calculate_recursive_stats_internal(child_id, &goals_map, &mut cache, &mut visited);
                    
                    // Convert daily stats to Vec<DailyEffortPoint>
                    let mut daily_stats: Vec<DailyEffortPoint> = res.daily_stats
                        .into_iter()
                        .map(|(date, day)| DailyEffortPoint {
                            date,
                            duration_minutes: day.duration,
                            completed_events: day.completed_count,
                            weighted_completion: if day.weighted_total > 0.0 {
                                day.weighted_completed / day.weighted_total
                            } else {
                                0.0
                            },
                            weighted_score: day.weighted_completed,
                        })
                        .collect();
                    daily_stats.sort_by(|a, b| a.date.cmp(&b.date));

                    children_stats.push(ChildEffortTimeSeries {
                        goal_id: child_id,
                        goal_name: child_raw.name.clone(),
                        goal_type: child_raw.goal_type.clone(),
                        total_events: res.total_events,
                        completed_events: res.completed_events,
                        total_duration_minutes: res.total_duration_minutes,
                        weighted_completion_rate: res.weighted_completion_rate,
                        children_count: res.children_count,
                        daily_stats,
                    });
                }
            }

            // Sort by name
            children_stats.sort_by(|a, b| a.goal_name.cmp(&b.goal_name));

            Ok(Json(children_stats))
        }
        Err(e) => {
            eprintln!("Error fetching goal children effort: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch goal children effort: {}", e),
            ))
        }
    }
}

pub async fn get_extended_stats(
    graph: Graph,
    user_id: i64,
    year: Option<i32>,
    tz: String,
) -> Result<Json<ExtendedStats>, (StatusCode, String)> {
    // First get the daily stats
    let year_stats_result = get_year_stats(graph.clone(), user_id, year, tz.clone()).await?;
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
    tz: String,
) -> Result<Json<Vec<RoutineStats>>, (StatusCode, String)> {
    let target_year = year.unwrap_or_else(|| Utc::now().year());
    let tz = normalize_tz(&tz)?;
    let tz_parsed: Tz = tz
        .parse()
        .expect("normalize_tz validated timezone; parse should not fail");
    let start_date = NaiveDate::from_ymd_opt(target_year, 1, 1).unwrap();
    let end_date = NaiveDate::from_ymd_opt(target_year, 12, 31).unwrap();

    let (start_timestamp, end_timestamp) = tz_year_range_utc_millis(target_year, &tz_parsed);

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
            AND COALESCE(e.resolution_status, 'pending') <> 'skipped'
            RETURN r.name as routine_name,
                   count(e) as total_events,
                   collect({
                       timestamp: e.scheduled_timestamp,
                       completed: CASE WHEN COALESCE(e.resolution_status, 'pending') = 'completed' THEN true ELSE false END,
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
            AND COALESCE(e.resolution_status, 'pending') <> 'skipped'
            WITH r, e,
                 (e.scheduled_timestamp + COALESCE(e.duration_minutes, e.duration, 60) * 60 * 1000) as event_end_time,
                 timestamp() as current_time,
                 COALESCE(e.resolution_status, 'pending') as status
            WHERE event_end_time <= current_time
            WITH r, e, status,
                 datetime({epochMillis: e.scheduled_timestamp, timezone: $tz}) as dt
            ORDER BY e.scheduled_timestamp
            RETURN r.name as routine_name,
                   collect({
                       date: toString(date(dt)),
                       completed: CASE WHEN status = 'completed' THEN true ELSE false END
                   }) as events
        ";

        let query = query(query_str)
            .param("routine_id", routine_id)
            .param("user_id", user_id)
            .param("start_timestamp", start_timestamp)
            .param("end_timestamp", end_timestamp)
            .param("tz", tz.clone());

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
                        if let (Some(date_str), Some(completed)) = (
                            event.get("date").and_then(|v| v.as_str()),
                            event.get("completed").and_then(|v| v.as_bool()),
                        ) {
                            total_events += 1;
                            if completed {
                                completed_events += 1;
                            }

                            // Group by date for smoothing (date is already a string from Cypher)
                            let date = date_str.to_string();

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
    tz: String,
) -> Result<Json<EventReschedulingStats>, (StatusCode, String)> {
    let target_year = year.unwrap_or_else(|| Utc::now().year());
    let tz_parsed: Tz = normalize_tz(&tz)?
        .parse()
        .expect("normalize_tz validated timezone; parse should not fail");
    let (start_timestamp, end_timestamp) = tz_year_range_utc_millis(target_year, &tz_parsed);

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
                let month = tz_parsed
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
    tz: String,
) -> Result<Json<EventAnalytics>, (StatusCode, String)> {
    let target_year = year.unwrap_or_else(|| Utc::now().year());
    let tz_parsed: Tz = normalize_tz(&tz)?
        .parse()
        .expect("normalize_tz validated timezone; parse should not fail");

    // Get start and end timestamps for the year
    let (start_timestamp, end_timestamp) = tz_year_range_utc_millis(target_year, &tz_parsed);

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
        AND COALESCE(e.resolution_status, 'pending') <> 'skipped'
        WITH e, g,
             (e.scheduled_timestamp + COALESCE(e.duration_minutes, e.duration, 60) * 60 * 1000) as event_end_time,
             timestamp() as current_time,
             COALESCE(e.resolution_status, 'pending') as status
        WHERE event_end_time <= current_time
        RETURN e.scheduled_timestamp as scheduled_timestamp,
               COALESCE(e.end_timestamp, e.scheduled_timestamp + COALESCE(e.duration_minutes, 60) * 60 * 1000) as end_timestamp,
               COALESCE(e.duration_minutes, 60) as duration_minutes,
               CASE WHEN status = 'completed' THEN true ELSE false END as completed,
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
