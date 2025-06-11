use std::env;
use chrono::{Duration, TimeZone, Utc};
use neo4rs::{query, Graph};
use serde_json::json;

// Re-export the modules we need for testing
use backend::jobs::routine_generator;
use backend::tools::goal::{Goal, GoalType};
use backend::server::db;

/// Helper function to create a test database connection
async fn create_test_graph() -> Result<Graph, neo4rs::Error> {
    // Use test database configuration
    let uri = env::var("NEO4J_TEST_URI").unwrap_or_else(|_| "bolt://localhost:7688".to_string());
    let username = env::var("NEO4J_TEST_USERNAME").unwrap_or_else(|_| "neo4j".to_string());
    let password = env::var("NEO4J_TEST_PASSWORD").unwrap_or_else(|_| "password123".to_string());

    let config = neo4rs::ConfigBuilder::default()
        .uri(&uri)
        .user(&username)
        .password(&password)
        .build()
        .unwrap();

    Graph::connect(config).await
}

/// Helper function to clear test data from database
async fn clear_test_data(graph: &Graph) -> Result<(), neo4rs::Error> {
    // Clear all existing goals for user_id 999 (test user)
    let clear_query = query("MATCH (g:Goal) WHERE g.user_id = 999 DETACH DELETE g");
    graph.run(clear_query).await?;
    Ok(())
}

/// Helper function to create a test routine in the database
async fn create_test_routine(
    graph: &Graph,
    name: &str,
    frequency: &str,
    start_timestamp: i64,
    end_timestamp: Option<i64>,
    routine_time: Option<i64>,
    duration: i32,
) -> Result<i64, neo4rs::Error> {
    let routine = Goal {
        id: None,
        name: name.to_string(),
        goal_type: GoalType::Routine,
        description: Some("Test routine for integration testing".to_string()),
        user_id: Some(999), // Test user ID
        priority: Some("medium".to_string()),
        start_timestamp: Some(start_timestamp),
        end_timestamp,
        completion_date: None,
        next_timestamp: None,
        scheduled_timestamp: None,
        duration: Some(duration),
        completed: Some(false),
        frequency: Some(frequency.to_string()),
        routine_type: Some("test".to_string()),
        routine_time,
        position_x: None,
        position_y: None,
        parent_id: None,
        parent_type: None,
        routine_instance_id: None,
        is_deleted: Some(false),
        due_date: None,
        start_date: None,
    };

    // Create the routine using the goal creation logic
    let created_routine = routine.create_goal(graph).await?;
    Ok(created_routine.id.unwrap())
}

/// Helper function to get events for a routine
async fn get_routine_events(graph: &Graph, routine_id: i64) -> Result<Vec<Goal>, neo4rs::Error> {
    let query_str = "
        MATCH (r:Goal)-[:HAS_EVENT]->(e:Goal)
        WHERE id(r) = $routine_id
        AND e.is_deleted <> true
        RETURN {
            id: id(e),
            name: e.name,
            goal_type: e.goal_type,
            scheduled_timestamp: e.scheduled_timestamp,
            duration: e.duration,
            parent_id: e.parent_id,
            parent_type: e.parent_type,
            routine_instance_id: e.routine_instance_id,
            user_id: e.user_id,
            priority: e.priority,
            description: e.description,
            completed: e.completed,
            is_deleted: e.is_deleted
        } as event
        ORDER BY e.scheduled_timestamp ASC
    ";

    let mut result = graph
        .execute(query(query_str).param("routine_id", routine_id))
        .await?;

    let mut events = Vec::new();
    while let Some(row) = result.next().await? {
        let event_data: serde_json::Value = row.get("event")?;
        let event: Goal = serde_json::from_value(event_data).map_err(|_| {
            neo4rs::Error::ConversionError
        })?;
        events.push(event);
    }

    Ok(events)
}

/// Helper function to calculate expected event timestamps
fn calculate_expected_timestamps(
    start_timestamp: i64,
    end_timestamp: i64,
    frequency: &str,
    routine_time: Option<i64>,
) -> Vec<i64> {
    let mut expected_timestamps = Vec::new();
    let mut current_time = start_timestamp;

    while current_time <= end_timestamp {
        // Apply routine_time to the current timestamp if provided
        let scheduled_timestamp = if let Some(routine_time) = routine_time {
            set_time_of_day(current_time, routine_time)
        } else {
            current_time
        };

        expected_timestamps.push(scheduled_timestamp);

        // Calculate next occurrence based on frequency
        match calculate_next_occurrence(current_time, frequency) {
            Ok(next_time) => current_time = next_time,
            Err(_) => break, // Stop if we can't calculate next occurrence
        }
    }

    expected_timestamps
}

/// Helper function from routine_generator.rs for calculating next occurrence
fn calculate_next_occurrence(current_time: i64, frequency: &str) -> Result<i64, String> {
    let current_dt = Utc
        .timestamp_millis_opt(current_time)
        .earliest()
        .ok_or("Invalid timestamp")?;

    // frequency pattern: {multiplier}{unit}[:days]
    let parts: Vec<&str> = frequency.split(':').collect();
    let freq_part = parts[0];

    if let Some(unit_pos) = freq_part.find(|c: char| !c.is_numeric()) {
        let multiplier: i64 = freq_part[..unit_pos]
            .parse()
            .map_err(|_| format!("Invalid frequency multiplier: {}", &freq_part[..unit_pos]))?;
        let unit = &freq_part[unit_pos..];

        // Calculate next date
        let next_date = match unit {
            "D" => current_dt.date_naive() + Duration::days(multiplier),
            "W" => {
                if let Some(days) = parts.get(1) {
                    // Get selected days as numbers (0-6)
                    let selected_days: Vec<u32> =
                        days.split(',').filter_map(|d| d.parse().ok()).collect();

                    if selected_days.is_empty() {
                        // Fallback if no days specified
                        current_dt.date_naive() + Duration::weeks(multiplier)
                    } else {
                        let mut next_dt = current_dt + Duration::days(1);

                        // Find the next occurrence of any selected day
                        while !selected_days.contains(&next_dt.weekday().num_days_from_sunday()) {
                            next_dt += Duration::days(1);
                        }

                        // If multiplier > 1, add additional weeks after finding next day
                        if multiplier > 1 {
                            next_dt += Duration::weeks(multiplier - 1);
                        }

                        next_dt.date_naive()
                    }
                } else {
                    current_dt.date_naive() + Duration::weeks(multiplier)
                }
            }
            "M" => current_dt.date_naive() + Duration::days(multiplier * 30),
            "Y" => current_dt.date_naive() + Duration::days(multiplier * 365),
            _ => current_dt.date_naive() + Duration::days(multiplier),
        };

        // Return timestamp with time set to beginning of day
        Ok(next_date
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis())
    } else {
        // Default to daily if format is invalid
        let next_date = current_dt.date_naive() + Duration::days(1);
        Ok(next_date
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis())
    }
}

/// Helper function from routine_generator.rs for setting time of day
fn set_time_of_day(base_timestamp: i64, time_of_day: i64) -> i64 {
    let day_in_ms: i64 = 24 * 60 * 60 * 1000;
    let start_of_day = (base_timestamp / day_in_ms) * day_in_ms;

    // Extract just the minutes since midnight from the timestamp
    let minutes_since_midnight = (time_of_day % day_in_ms) / (60 * 1000);
    let time_of_day_ms = minutes_since_midnight * 60 * 1000;

    start_of_day + time_of_day_ms
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[tokio::test]
    async fn test_daily_routine_event_generation() {
        // Set up test database connection
        let graph = create_test_graph().await.expect("Failed to create test database connection");
        
        // Clear any existing test data
        clear_test_data(&graph).await.expect("Failed to clear test data");

        // Define test parameters
        let now = Utc::now().timestamp_millis();
        let start_timestamp = now;
        let end_timestamp = now + (7 * 24 * 60 * 60 * 1000); // 7 days from now
        let routine_time = Some(now + (9 * 60 * 60 * 1000)); // 9 AM (9 hours from midnight)
        let frequency = "1D"; // Daily
        let duration = 60; // 60 minutes

        // Create test routine
        let routine_id = create_test_routine(
            &graph,
            "Daily Test Routine",
            frequency,
            start_timestamp,
            Some(end_timestamp),
            routine_time,
            duration,
        ).await.expect("Failed to create test routine");

        // Run the routine generator
        routine_generator::generate_future_routine_events(&graph)
            .await
            .expect("Failed to generate routine events");

        // Retrieve generated events
        let events = get_routine_events(&graph, routine_id)
            .await
            .expect("Failed to retrieve routine events");

        // Calculate expected timestamps
        let expected_timestamps = calculate_expected_timestamps(
            start_timestamp,
            end_timestamp,
            frequency,
            routine_time,
        );

        // Verify correct number of events were created
        assert_eq!(
            events.len(),
            expected_timestamps.len(),
            "Expected {} events, but got {}",
            expected_timestamps.len(),
            events.len()
        );

        // Verify each event has correct properties
        for (i, event) in events.iter().enumerate() {
            // Check basic properties
            assert_eq!(event.name, "Daily Test Routine");
            assert_eq!(event.goal_type, GoalType::Event);
            assert_eq!(event.duration, Some(duration));
            assert_eq!(event.parent_id, Some(routine_id));
            assert_eq!(event.parent_type, Some("routine".to_string()));
            assert_eq!(event.user_id, Some(999));
            assert_eq!(event.completed, Some(false));
            assert_eq!(event.is_deleted, Some(false));

            // Check scheduled timestamp matches expected
            let expected_timestamp = expected_timestamps[i];
            assert_eq!(
                event.scheduled_timestamp,
                Some(expected_timestamp),
                "Event {} has incorrect timestamp. Expected {}, got {:?}",
                i,
                expected_timestamp,
                event.scheduled_timestamp
            );
        }
    }

    #[tokio::test]
    async fn test_weekly_routine_event_generation() {
        // Set up test database connection
        let graph = create_test_graph().await.expect("Failed to create test database connection");
        
        // Clear any existing test data
        clear_test_data(&graph).await.expect("Failed to clear test data");

        // Define test parameters for weekly routine (Mondays and Wednesdays)
        let now = Utc::now().timestamp_millis();
        let start_timestamp = now;
        let end_timestamp = now + (21 * 24 * 60 * 60 * 1000); // 3 weeks from now
        let routine_time = Some(now + (14 * 60 * 60 * 1000)); // 2 PM
        let frequency = "1W:1,3"; // Weekly on Monday(1) and Wednesday(3)
        let duration = 90; // 90 minutes

        // Create test routine
        let routine_id = create_test_routine(
            &graph,
            "Weekly Test Routine",
            frequency,
            start_timestamp,
            Some(end_timestamp),
            routine_time,
            duration,
        ).await.expect("Failed to create test routine");

        // Run the routine generator
        routine_generator::generate_future_routine_events(&graph)
            .await
            .expect("Failed to generate routine events");

        // Retrieve generated events
        let events = get_routine_events(&graph, routine_id)
            .await
            .expect("Failed to retrieve routine events");

        // Verify events were created (exact count depends on start date)
        assert!(
            events.len() > 0,
            "Expected at least one event to be created"
        );

        // Verify each event has correct properties
        for event in &events {
            assert_eq!(event.name, "Weekly Test Routine");
            assert_eq!(event.goal_type, GoalType::Event);
            assert_eq!(event.duration, Some(duration));
            assert_eq!(event.parent_id, Some(routine_id));
            assert_eq!(event.parent_type, Some("routine".to_string()));
            assert_eq!(event.user_id, Some(999));
            assert_eq!(event.completed, Some(false));
            assert_eq!(event.is_deleted, Some(false));

            // Verify the scheduled timestamp is within our expected range
            let scheduled = event.scheduled_timestamp.unwrap();
            assert!(
                scheduled >= start_timestamp && scheduled <= end_timestamp,
                "Event timestamp {} is outside expected range [{}, {}]",
                scheduled,
                start_timestamp,
                end_timestamp
            );
        }

        // Verify events are properly spaced (no duplicate timestamps)
        let timestamps: HashSet<i64> = events
            .iter()
            .map(|e| e.scheduled_timestamp.unwrap())
            .collect();
        assert_eq!(
            timestamps.len(),
            events.len(),
            "Found duplicate event timestamps"
        );
    }

    #[tokio::test]
    async fn test_routine_without_end_date() {
        // Set up test database connection
        let graph = create_test_graph().await.expect("Failed to create test database connection");
        
        // Clear any existing test data
        clear_test_data(&graph).await.expect("Failed to clear test data");

        // Define test parameters for open-ended routine
        let now = Utc::now().timestamp_millis();
        let start_timestamp = now;
        let routine_time = Some(now + (8 * 60 * 60 * 1000)); // 8 AM
        let frequency = "2D"; // Every 2 days
        let duration = 45; // 45 minutes

        // Create test routine without end date
        let routine_id = create_test_routine(
            &graph,
            "Open-ended Test Routine",
            frequency,
            start_timestamp,
            None, // No end date
            routine_time,
            duration,
        ).await.expect("Failed to create test routine");

        // Run the routine generator
        routine_generator::generate_future_routine_events(&graph)
            .await
            .expect("Failed to generate routine events");

        // Retrieve generated events
        let events = get_routine_events(&graph, routine_id)
            .await
            .expect("Failed to retrieve routine events");

        // Should generate events up to ~3 months ahead (90 days)
        // With every 2 days frequency, expect around 45 events
        assert!(
            events.len() >= 40 && events.len() <= 50,
            "Expected around 45 events for 90-day horizon, got {}",
            events.len()
        );

        // Verify each event has correct properties
        for event in &events {
            assert_eq!(event.name, "Open-ended Test Routine");
            assert_eq!(event.goal_type, GoalType::Event);
            assert_eq!(event.duration, Some(duration));
            assert_eq!(event.parent_id, Some(routine_id));
            assert_eq!(event.parent_type, Some("routine".to_string()));
            assert_eq!(event.user_id, Some(999));
        }

        // Verify events are roughly 2 days apart
        if events.len() >= 2 {
            let first_timestamp = events[0].scheduled_timestamp.unwrap();
            let second_timestamp = events[1].scheduled_timestamp.unwrap();
            let diff_days = (second_timestamp - first_timestamp) / (24 * 60 * 60 * 1000);
            assert_eq!(
                diff_days, 2,
                "Expected 2-day interval between events, got {} days",
                diff_days
            );
        }
    }

    #[tokio::test]
    async fn test_routine_time_application() {
        // Set up test database connection
        let graph = create_test_graph().await.expect("Failed to create test database connection");
        
        // Clear any existing test data
        clear_test_data(&graph).await.expect("Failed to clear test data");

        // Define test parameters with specific routine time
        let now = Utc::now().timestamp_millis();
        let start_of_today = (now / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
        let start_timestamp = start_of_today;
        let end_timestamp = start_of_today + (3 * 24 * 60 * 60 * 1000); // 3 days
        
        // Set routine time to 3:30 PM (15:30 = 15*60 + 30 = 930 minutes from midnight)
        let routine_time_minutes = 15 * 60 + 30; // 3:30 PM in minutes
        let routine_time = Some(routine_time_minutes * 60 * 1000); // Convert to milliseconds
        
        let frequency = "1D"; // Daily
        let duration = 30; // 30 minutes

        // Create test routine
        let routine_id = create_test_routine(
            &graph,
            "Timed Test Routine",
            frequency,
            start_timestamp,
            Some(end_timestamp),
            routine_time,
            duration,
        ).await.expect("Failed to create test routine");

        // Run the routine generator
        routine_generator::generate_future_routine_events(&graph)
            .await
            .expect("Failed to generate routine events");

        // Retrieve generated events
        let events = get_routine_events(&graph, routine_id)
            .await
            .expect("Failed to retrieve routine events");

        // Verify events were created
        assert!(events.len() > 0, "Expected at least one event to be created");

        // Verify each event is scheduled at the correct time of day
        for event in &events {
            let scheduled_timestamp = event.scheduled_timestamp.unwrap();
            
            // Extract the time of day from the timestamp
            let time_of_day_ms = scheduled_timestamp % (24 * 60 * 60 * 1000);
            let time_of_day_minutes = time_of_day_ms / (60 * 1000);
            
            assert_eq!(
                time_of_day_minutes as i64, routine_time_minutes,
                "Event scheduled at wrong time of day. Expected {}:{:02}, got {}:{:02}",
                routine_time_minutes / 60,
                routine_time_minutes % 60,
                time_of_day_minutes / 60,
                time_of_day_minutes % 60
            );
        }
    }
} 