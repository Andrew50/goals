use axum::http::StatusCode;
use chrono::{Datelike, Duration, TimeZone, Utc};
use neo4rs::Graph;
#[allow(clippy::single_component_path_imports)]
use serde_json;
use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::error;

use crate::tools::goal::{Goal, GoalType, GOAL_RETURN_QUERY};

// Custom error type
#[derive(Debug)]
pub enum RoutineError {
    Neo4j(neo4rs::Error),
    Serde(serde_json::Error),
    Deserialization(neo4rs::DeError),
}

pub type UserLocks = Arc<Mutex<HashMap<i64, Arc<Mutex<()>>>>>;

impl fmt::Display for RoutineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RoutineError::Neo4j(e) => write!(f, "Neo4j error: {}", e),
            RoutineError::Serde(e) => write!(f, "Serde error: {}", e),
            RoutineError::Deserialization(e) => write!(f, "Deserialization error: {}", e),
        }
    }
}

impl From<neo4rs::Error> for RoutineError {
    fn from(err: neo4rs::Error) -> Self {
        RoutineError::Neo4j(err)
    }
}
impl From<serde_json::Error> for RoutineError {
    fn from(err: serde_json::Error) -> Self {
        RoutineError::Serde(err)
    }
}
impl From<neo4rs::DeError> for RoutineError {
    fn from(err: neo4rs::DeError) -> Self {
        RoutineError::Deserialization(err)
    }
}
impl From<RoutineError> for (StatusCode, String) {
    fn from(err: RoutineError) -> Self {
        (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
    }
}

// Utility function for setting time of day on timestamps
pub fn set_time_of_day(base_timestamp: i64, time_of_day: i64) -> i64 {
    let day_in_ms: i64 = 24 * 60 * 60 * 1000;
    let start_of_day = (base_timestamp / day_in_ms) * day_in_ms;

    // Extract just the minutes since midnight from the timestamp
    let minutes_since_midnight = (time_of_day % day_in_ms) / (60 * 1000);
    let time_of_day_ms = minutes_since_midnight * 60 * 1000;

    start_of_day + time_of_day_ms
}
