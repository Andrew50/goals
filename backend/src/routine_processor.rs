use chrono::{DateTime, Duration, TimeZone, Utc};
use neo4rs::Graph;
use serde_json;
use std::fmt;
use tokio::time;
use tracing::{error, info};

use crate::goal::{Goal, GoalType, GOAL_RETURN_QUERY};

// Custom error type
#[derive(Debug)]
pub enum RoutineError {
    Neo4j(neo4rs::Error),
    Serde(serde_json::Error),
    Deserialization(neo4rs::DeError),
}

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

pub struct RoutineProcessor {
    graph: Graph,
}

impl RoutineProcessor {
    pub fn new(graph: Graph) -> Self {
        Self { graph }
    }

    pub async fn process_routines(&self) -> Result<(), RoutineError> {
        let query = format!(
            "MATCH (g:Goal) 
             WHERE g.goal_type = 'routine' 
             AND g.next_timestamp IS NOT NULL 
             AND g.next_timestamp <= timestamp() 
             {}",
            GOAL_RETURN_QUERY
        );

        let mut result = self.graph.execute(neo4rs::query(&query)).await?;

        while let Some(row) = result.next().await? {
            let routine: Goal = serde_json::from_value(row.get("g")?)?;

            if let Err(e) = self.process_single_routine(&routine).await {
                error!(
                    "Error processing routine {}: {}",
                    routine.id.unwrap_or(0),
                    e
                );
            }
        }

        Ok(())
    }

    pub async fn process_single_routine(&self, routine: &Goal) -> Result<(), RoutineError> {
        let current_next_timestamp = routine.next_timestamp.unwrap_or_else(|| {
            routine
                .start_timestamp
                .unwrap_or_else(|| Utc::now().timestamp_millis())
        });

        let new_next_timestamp = calculate_next_timestamp(
            current_next_timestamp,
            &routine.frequency.clone().unwrap_or_default(),
        );

        // Calculate scheduled_timestamp by setting the time to routine_time
        let scheduled_timestamp = routine
            .routine_time
            .map(|routine_time| set_time_of_day(current_next_timestamp, routine_time));

        let child_goal = Goal {
            id: None,
            name: routine.name.clone(),
            goal_type: if routine.goal_type == GoalType::Routine {
                match routine.routine_type.as_deref() {
                    Some("achievement") => GoalType::Achievement,
                    _ => GoalType::Task,
                }
            } else {
                GoalType::Task
            },
            description: routine.description.clone(),
            user_id: routine.user_id,
            priority: routine.priority.clone(),
            start_timestamp: Some(current_next_timestamp),
            end_timestamp: Some(new_next_timestamp),
            completion_date: None,
            next_timestamp: None,
            scheduled_timestamp: scheduled_timestamp,
            duration: routine.duration,
            completed: Some(false),
            frequency: None,
            routine_type: None,
            routine_time: None,
        };

        let created_goal = child_goal.create_goal(&self.graph).await?;

        let relationship = format!(
            "MATCH (r:Goal), (c:Goal) 
             WHERE id(r) = $routine_id AND id(c) = $child_id 
             CREATE (r)-[:GENERATED]->(c)"
        );
        self.graph
            .execute(
                neo4rs::query(&relationship)
                    .param("routine_id", routine.id.unwrap())
                    .param("child_id", created_goal.id.unwrap()),
            )
            .await?;

        // Update the routine's next_timestamp to the new next_timestamp
        let update = neo4rs::query(
            "MATCH (g:Goal) WHERE id(g) = $id 
             SET g.next_timestamp = $next_timestamp",
        )
        .param("id", routine.id.unwrap())
        .param("next_timestamp", new_next_timestamp);

        self.graph.run(update).await?;

        Ok(())
    }

    pub async fn initialize_routines(&self) -> Result<(), RoutineError> {
        let query = format!(
            "MATCH (g:Goal) 
             WHERE g.goal_type = 'routine' 
             AND g.start_timestamp IS NOT NULL 
             AND (g.next_timestamp IS NULL OR g.next_timestamp < g.start_timestamp)
             SET g.next_timestamp = g.start_timestamp
             {}",
            GOAL_RETURN_QUERY
        );

        let mut result = self.graph.execute(neo4rs::query(&query)).await?;

        while let Some(row) = result.next().await? {
            let routine: Goal = serde_json::from_value(row.get("g")?)?;
            self.catch_up_routine(&routine).await?;
        }

        Ok(())
    }

    async fn catch_up_routine(&self, routine: &Goal) -> Result<(), RoutineError> {
        let mut current_next_timestamp = routine.next_timestamp.unwrap_or(
            routine
                .start_timestamp
                .unwrap_or_else(|| Utc::now().timestamp_millis()),
        );
        let now = Utc::now().timestamp_millis();

        while current_next_timestamp < now {
            let new_next_timestamp = calculate_next_timestamp(
                current_next_timestamp,
                &routine.frequency.clone().unwrap_or_default(),
            );

            // Calculate scheduled_timestamp by setting the time to routine_time
            let scheduled_timestamp = routine
                .routine_time
                .map(|routine_time| set_time_of_day(current_next_timestamp, routine_time));

            let child_goal = Goal {
                id: None,
                name: routine.name.clone(),
                goal_type: if routine.goal_type == GoalType::Routine {
                    match routine.routine_type.as_deref() {
                        Some("achievement") => GoalType::Achievement,
                        _ => GoalType::Task,
                    }
                } else {
                    GoalType::Task
                },
                description: routine.description.clone(),
                user_id: routine.user_id,
                priority: routine.priority.clone(),
                start_timestamp: Some(current_next_timestamp),
                end_timestamp: Some(new_next_timestamp),
                completion_date: None,
                next_timestamp: None,
                scheduled_timestamp: scheduled_timestamp,
                duration: routine.duration,
                completed: Some(false),
                frequency: None,
                routine_type: None,
                routine_time: None,
            };

            child_goal.create_goal(&self.graph).await?;

            // Update current_next_timestamp to new_next_timestamp for next iteration
            current_next_timestamp = new_next_timestamp;
        }

        // Update the routine's next_timestamp to the last new_next_timestamp
        let update = neo4rs::query(
            "MATCH (g:Goal) WHERE id(g) = $id 
             SET g.next_timestamp = $next_timestamp",
        )
        .param("id", routine.id.unwrap())
        .param("next_timestamp", current_next_timestamp);

        self.graph.run(update).await?;

        Ok(())
    }
}

fn calculate_next_timestamp(current: i64, frequency: &str) -> i64 {
    let current_dt = Utc.timestamp_millis(current);

    let next_dt = match frequency.to_lowercase().as_str() {
        "daily" => current_dt + Duration::days(1),
        "weekly" => current_dt + Duration::weeks(1),
        "monthly" => current_dt + Duration::days(30),
        "yearly" => current_dt + Duration::days(365),
        _ => current_dt + Duration::days(1),
    };

    next_dt.timestamp_millis()
}

fn set_time_of_day(base_timestamp: i64, time_of_day: i64) -> i64 {
    // Convert base_timestamp to start of day by integer division and multiplication
    let day_in_ms: i64 = 24 * 60 * 60 * 1000;
    let start_of_day = (base_timestamp / day_in_ms) * day_in_ms;

    // Add the time_of_day to get the final timestamp
    start_of_day + time_of_day
}
