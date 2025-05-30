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

    // Query all events (tasks and achievements) for the year
    let query_str = "
        MATCH (g:Goal)
        WHERE g.user_id = $user_id
        AND (g.goal_type = 'task' OR g.goal_type = 'achievement')
        AND g.scheduled_timestamp >= $start_timestamp
        AND g.scheduled_timestamp <= $end_timestamp
        RETURN g.id as id,
               g.scheduled_timestamp as scheduled_timestamp,
               g.completed as completed,
               COALESCE(g.priority, 'medium') as priority
    ";

    let query = query(query_str)
        .param("user_id", user_id)
        .param("start_timestamp", start_timestamp)
        .param("end_timestamp", end_timestamp);

    match graph.execute(query).await {
        Ok(mut result) => {
            let mut daily_events: HashMap<String, Vec<(bool, String)>> = HashMap::new();
            
            while let Ok(Some(row)) = result.next().await {
                let timestamp = row.get::<i64>("scheduled_timestamp").unwrap_or(0);
                let completed = row.get::<bool>("completed").unwrap_or(false);
                let priority = row.get::<String>("priority").unwrap_or_else(|_| "medium".to_string());
                
                // Convert timestamp to date string (YYYY-MM-DD)
                let date = Utc.timestamp_millis_opt(timestamp)
                    .single()
                    .map(|dt| dt.format("%Y-%m-%d").to_string())
                    .unwrap_or_default();
                
                daily_events.entry(date)
                    .or_insert_with(Vec::new)
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