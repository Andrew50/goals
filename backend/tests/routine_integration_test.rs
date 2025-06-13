use chrono::{Datelike, TimeZone, Utc};
use neo4rs::{query, Graph};
use serde_json;
use std::collections::HashSet;
use std::env;

// Import the modules we need for testing
use backend::jobs::routine_generator::generate_future_routine_events;
use backend::tools::goal::{Goal, GoalType};

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
        let event_data: serde_json::Value = row
            .get("event")
            .map_err(|_| neo4rs::Error::ConversionError)?;
        let event: Goal =
            serde_json::from_value(event_data).map_err(|_| neo4rs::Error::ConversionError)?;
        events.push(event);
    }

    Ok(events)
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

// Helper function to validate if a given timestamp matches the routine's frequency pattern
fn is_valid_day_for_routine(timestamp: i64, frequency: &str) -> Result<bool, String> {
    let current_dt = Utc
        .timestamp_millis_opt(timestamp)
        .earliest()
        .ok_or("Invalid timestamp")?;

    // frequency pattern: {multiplier}{unit}[:days]
    let parts: Vec<&str> = frequency.split(':').collect();
    let freq_part = parts[0];

    if let Some(unit_pos) = freq_part.find(|c: char| !c.is_numeric()) {
        let unit = &freq_part[unit_pos..];

        match unit {
            "W" => {
                if let Some(days) = parts.get(1) {
                    // Get selected days as numbers (0-6)
                    let selected_days: Vec<u32> =
                        days.split(',').filter_map(|d| d.parse().ok()).collect();

                    if selected_days.is_empty() {
                        // If no specific days are selected, all days are valid for weekly
                        return Ok(true);
                    } else {
                        // Check if current day is one of the selected days
                        let current_weekday = current_dt.weekday().num_days_from_sunday();
                        return Ok(selected_days.contains(&current_weekday));
                    }
                } else {
                    // Weekly without specific days - all days are valid
                    return Ok(true);
                }
            }
            "D" | "M" | "Y" => {
                // For daily, monthly, yearly - all days are valid (the frequency calculation handles the intervals)
                return Ok(true);
            }
            _ => {
                // Unknown unit - assume valid
                return Ok(true);
            }
        }
    } else {
        // No unit found - assume daily, so all days are valid
        return Ok(true);
    }
}

/// Helper function to generate events for a specific test routine (more controlled than the full generator)
async fn generate_events_for_test_routine(
    graph: &Graph,
    routine_id: i64,
    start_timestamp: i64,
    end_timestamp: i64,
) -> Result<(), neo4rs::Error> {
    // Fetch the routine details
    let routine_query =
        query("MATCH (r:Goal) WHERE id(r) = $routine_id RETURN r").param("routine_id", routine_id);

    let mut result = graph.execute(routine_query).await?;
    let routine_row = result
        .next()
        .await?
        .ok_or_else(|| neo4rs::Error::ConversionError)?;
    let routine: Goal = routine_row
        .get("r")
        .map_err(|_| neo4rs::Error::ConversionError)?;

    let frequency = routine
        .frequency
        .as_ref()
        .ok_or_else(|| neo4rs::Error::ConversionError)?;

    let instance_id = format!("{}-{}", routine_id, Utc::now().timestamp_millis());
    let mut current_time = start_timestamp;
    let mut event_count = 0;

    while current_time <= end_timestamp {
        // Check if this day is valid for the routine's frequency pattern
        if !is_valid_day_for_routine(current_time, frequency)
            .map_err(|_| neo4rs::Error::ConversionError)?
        {
            // Skip to next occurrence if this day doesn't match the pattern
            current_time = match frequency.as_str() {
                "1D" => current_time + (24 * 60 * 60 * 1000), // Daily
                "1W" => current_time + (7 * 24 * 60 * 60 * 1000), // Weekly
                "2D" => current_time + (2 * 24 * 60 * 60 * 1000), // Every 2 days
                _ => current_time + (24 * 60 * 60 * 1000),    // Default daily
            };
            continue;
        }

        // Apply the routine's time of day
        let scheduled_timestamp = if let Some(routine_time) = routine.routine_time {
            set_time_of_day(current_time, routine_time)
        } else {
            current_time
        };

        // Ensure we only create events in or after the start window
        if scheduled_timestamp >= start_timestamp {
            // Check if an event already exists at this timestamp
            let check_query = query(
                "MATCH (r:Goal)-[:HAS_EVENT]->(e:Goal)
                 WHERE id(r) = $routine_id 
                 AND e.scheduled_timestamp = $timestamp
                 AND (e.is_deleted IS NULL OR e.is_deleted = false)
                 RETURN count(e) as existing_count",
            )
            .param("routine_id", routine_id)
            .param("timestamp", scheduled_timestamp);

            let mut check_result = graph.execute(check_query).await?;
            let existing_count: i64 = if let Some(row) = check_result.next().await? {
                row.get("existing_count").unwrap_or(0)
            } else {
                0
            };

            if existing_count == 0 {
                if let Some(end_ts) = routine.end_timestamp {
                    if scheduled_timestamp > end_ts {
                        break;
                    }
                }

                // Create the event since it doesn't exist yet.
                let create_query = query(
                    "MATCH (r:Goal) WHERE id(r) = $routine_id
                     CREATE (e:Goal {
                         name: r.name,
                         goal_type: 'event',
                         scheduled_timestamp: $timestamp,
                         duration: r.duration,
                         parent_id: id(r),
                         parent_type: 'routine',
                         routine_instance_id: $instance_id,
                         user_id: r.user_id,
                         priority: r.priority,
                         description: r.description,
                         completed: false,
                         is_deleted: false
                     })
                     CREATE (r)-[:HAS_EVENT]->(e)",
                )
                .param("routine_id", routine_id)
                .param("timestamp", scheduled_timestamp)
                .param("instance_id", instance_id.clone());

                graph.run(create_query).await?;
                event_count += 1;
            }
        }

        // Calculate next occurrence
        current_time = match frequency.as_str() {
            "1D" => current_time + (24 * 60 * 60 * 1000), // Daily
            "1W" => current_time + (7 * 24 * 60 * 60 * 1000), // Weekly
            "2D" => current_time + (2 * 24 * 60 * 60 * 1000), // Every 2 days
            _ => current_time + (24 * 60 * 60 * 1000),    // Default daily
        };
    }

    if event_count > 0 {
        println!(
            "Created {} events for test routine {}",
            event_count, routine_id
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn test_daily_routine_event_generation() {
        // Set up test database connection
        let graph = create_test_graph()
            .await
            .expect("Failed to create test database connection");

        // Clear any existing test data
        clear_test_data(&graph)
            .await
            .expect("Failed to clear test data");

        // Define test parameters
        let now = Utc::now().timestamp_millis();
        let start_timestamp = now;
        let end_timestamp = now + (7 * 24 * 60 * 60 * 1000); // 7 days from now
        let routine_time = Some(9 * 60 * 60 * 1000); // 9 AM in milliseconds from midnight
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
        )
        .await
        .expect("Failed to create test routine");

        // Generate events specifically for this test routine
        generate_events_for_test_routine(&graph, routine_id, start_timestamp, end_timestamp)
            .await
            .expect("Failed to generate routine events");

        // Retrieve generated events
        let events = get_routine_events(&graph, routine_id)
            .await
            .expect("Failed to retrieve routine events");

        // Verify events were created (should be approximately 7-8 events)
        assert!(
            events.len() >= 7 && events.len() <= 8,
            "Expected 7-8 events for a 7-day period, but got {}",
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

            // Verify the scheduled timestamp is within our expected range
            let scheduled = event.scheduled_timestamp.unwrap();
            assert!(
                scheduled >= start_timestamp && scheduled <= end_timestamp,
                "Event {} timestamp {} is outside expected range [{}, {}]",
                i,
                scheduled,
                start_timestamp,
                end_timestamp
            );

            // Verify that routine_time is applied correctly (9 AM)
            if let Some(rt) = routine_time {
                let time_of_day_ms = scheduled % (24 * 60 * 60 * 1000);
                let expected_time_of_day_ms = rt % (24 * 60 * 60 * 1000);

                assert_eq!(
                    time_of_day_ms, expected_time_of_day_ms,
                    "Event {} has incorrect time of day. Expected {} (9 AM), got {}",
                    i, expected_time_of_day_ms, time_of_day_ms
                );
            }
        }

        // Verify events are spaced exactly 1 day apart
        for i in 1..events.len() {
            let prev_timestamp = events[i - 1].scheduled_timestamp.unwrap();
            let curr_timestamp = events[i].scheduled_timestamp.unwrap();
            let diff_days = (curr_timestamp - prev_timestamp) / (24 * 60 * 60 * 1000);

            assert_eq!(
                diff_days,
                1,
                "Events {} and {} are not exactly 1 day apart. Diff: {} days",
                i - 1,
                i,
                diff_days
            );
        }
    }

    #[tokio::test]
    #[ignore]
    async fn test_weekly_routine_event_generation() {
        // Set up test database connection
        let graph = create_test_graph()
            .await
            .expect("Failed to create test database connection");

        // Clear any existing test data
        clear_test_data(&graph)
            .await
            .expect("Failed to clear test data");

        // Define test parameters for weekly routine
        let now = Utc::now().timestamp_millis();
        let start_timestamp = now;
        let end_timestamp = now + (21 * 24 * 60 * 60 * 1000); // 3 weeks from now
        let routine_time = Some(14 * 60 * 60 * 1000); // 2 PM
        let frequency = "1W"; // Weekly
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
        )
        .await
        .expect("Failed to create test routine");

        // Generate events specifically for this test routine
        generate_events_for_test_routine(&graph, routine_id, start_timestamp, end_timestamp)
            .await
            .expect("Failed to generate routine events");

        // Retrieve generated events
        let events = get_routine_events(&graph, routine_id)
            .await
            .expect("Failed to retrieve routine events");

        // Verify events were created (should be 3-4 events for 3 weeks)
        assert!(
            events.len() >= 3 && events.len() <= 4,
            "Expected 3-4 events for weekly routine over 3 weeks, got {}",
            events.len()
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
    #[ignore]
    async fn test_routine_without_end_date() {
        // Set up test database connection
        let graph = create_test_graph()
            .await
            .expect("Failed to create test database connection");

        // Clear any existing test data
        clear_test_data(&graph)
            .await
            .expect("Failed to clear test data");

        // Define test parameters for open-ended routine
        let now = Utc::now().timestamp_millis();
        let start_timestamp = now;
        let routine_time = Some(8 * 60 * 60 * 1000); // 8 AM
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
        )
        .await
        .expect("Failed to create test routine");

        // For open-ended routines, generate events up to 90 days ahead
        let ninety_days_ahead = start_timestamp + (90 * 24 * 60 * 60 * 1000);
        generate_events_for_test_routine(&graph, routine_id, start_timestamp, ninety_days_ahead)
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
    #[ignore]
    async fn test_routine_time_application() {
        // Set up test database connection
        let graph = create_test_graph()
            .await
            .expect("Failed to create test database connection");

        // Clear any existing test data
        clear_test_data(&graph)
            .await
            .expect("Failed to clear test data");

        // Define test parameters with specific routine time
        let now = Utc::now().timestamp_millis();
        let start_of_today = (now / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
        let start_timestamp = start_of_today;
        let end_timestamp = start_of_today + (3 * 24 * 60 * 60 * 1000); // 3 days

        // Set routine time to 3:30 PM (15:30 = 15*60 + 30 = 930 minutes from midnight)
        let routine_time_minutes = 15 * 60 + 30; // 3:30 PM in minutes
        let routine_time = Some(routine_time_minutes as i64 * 60 * 1000); // Convert to milliseconds

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
        )
        .await
        .expect("Failed to create test routine");

        // Generate events specifically for this test routine
        generate_events_for_test_routine(&graph, routine_id, start_timestamp, end_timestamp)
            .await
            .expect("Failed to generate routine events");

        // Retrieve generated events
        let events = get_routine_events(&graph, routine_id)
            .await
            .expect("Failed to retrieve routine events");

        // Verify events were created
        assert!(
            events.len() > 0,
            "Expected at least one event to be created"
        );

        // Verify each event is scheduled at the correct time of day
        for event in &events {
            let scheduled_timestamp = event.scheduled_timestamp.unwrap();

            // Extract the time of day from the timestamp
            let time_of_day_ms = scheduled_timestamp % (24 * 60 * 60 * 1000);
            let time_of_day_minutes = time_of_day_ms / (60 * 1000);

            assert_eq!(
                time_of_day_minutes,
                routine_time_minutes as i64,
                "Event scheduled at wrong time of day. Expected {}:{:02}, got {}:{:02}",
                routine_time_minutes / 60,
                routine_time_minutes % 60,
                time_of_day_minutes / 60,
                time_of_day_minutes % 60
            );
        }
    }

    #[tokio::test]
    #[ignore]
    async fn test_routine_event_relationship() {
        // Set up test database connection
        let graph = create_test_graph()
            .await
            .expect("Failed to create test database connection");

        // Clear any existing test data
        clear_test_data(&graph)
            .await
            .expect("Failed to clear test data");

        // Create a simple daily routine
        let now = Utc::now().timestamp_millis();
        let start_timestamp = now;
        let end_timestamp = now + (3 * 24 * 60 * 60 * 1000); // 3 days
        let routine_time = Some(10 * 60 * 60 * 1000); // 10 AM
        let frequency = "1D";
        let duration = 30;

        let routine_id = create_test_routine(
            &graph,
            "Relationship Test Routine",
            frequency,
            start_timestamp,
            Some(end_timestamp),
            routine_time,
            duration,
        )
        .await
        .expect("Failed to create test routine");

        // Generate events specifically for this test routine
        generate_events_for_test_routine(&graph, routine_id, start_timestamp, end_timestamp)
            .await
            .expect("Failed to generate routine events");

        // Verify HAS_EVENT relationships exist
        let relationship_query = query(
            "MATCH (r:Goal)-[:HAS_EVENT]->(e:Goal)
             WHERE id(r) = $routine_id
             RETURN count(e) as event_count",
        )
        .param("routine_id", routine_id);

        let mut result = graph
            .execute(relationship_query)
            .await
            .expect("Failed to execute relationship query");
        if let Some(row) = result
            .next()
            .await
            .expect("Failed to get relationship result")
        {
            let event_count: i64 = row.get("event_count").expect("Failed to get event count");
            assert!(
                event_count > 0,
                "No HAS_EVENT relationships found between routine and events"
            );
        } else {
            panic!("No relationship query result returned");
        }
    }

    #[tokio::test]
    #[ignore]
    async fn test_weekly_routine_specific_days_validation() {
        // Set up test database connection
        let graph = create_test_graph()
            .await
            .expect("Failed to create test database connection");

        // Clear any existing test data
        clear_test_data(&graph)
            .await
            .expect("Failed to clear test data");

        // Create a Monday/Wednesday routine starting on a different day (like Tuesday)
        // This tests the specific bug reported: routine should not create event on current day
        // if current day is not one of the selected days

        let now = Utc::now();
        let current_weekday = now.weekday().num_days_from_sunday();

        // Find a start day that is NOT Monday (1) or Wednesday (3)
        let mut start_day_offset = 0;
        let mut start_weekday = current_weekday;

        // If today is Monday or Wednesday, move to a different day for testing
        if current_weekday == 1 || current_weekday == 3 {
            start_day_offset = 1; // Move to tomorrow
            start_weekday = (current_weekday + 1) % 7;
        }

        let start_timestamp = now.timestamp_millis() + (start_day_offset * 24 * 60 * 60 * 1000);
        let end_timestamp = start_timestamp + (14 * 24 * 60 * 60 * 1000); // 2 weeks
        let routine_time = Some(14 * 60 * 60 * 1000); // 2 PM
        let frequency = "1W:1,3"; // Weekly on Monday (1) and Wednesday (3)
        let duration = 60;

        println!("Test setup:");
        println!(
            "  Current weekday: {} (0=Sunday, 1=Monday, etc.)",
            current_weekday
        );
        println!("  Start weekday: {} (should NOT be 1 or 3)", start_weekday);
        println!("  Frequency: {}", frequency);

        // Ensure our test setup is valid (start day should not be Monday or Wednesday)
        assert!(
            start_weekday != 1 && start_weekday != 3,
            "Test setup error: start day {} should not be Monday (1) or Wednesday (3)",
            start_weekday
        );

        let routine_id = create_test_routine(
            &graph,
            "Monday Wednesday Test Routine",
            frequency,
            start_timestamp,
            Some(end_timestamp),
            routine_time,
            duration,
        )
        .await
        .expect("Failed to create test routine");

        // Generate events specifically for this test routine
        generate_events_for_test_routine(&graph, routine_id, start_timestamp, end_timestamp)
            .await
            .expect("Failed to generate routine events");

        // Retrieve generated events
        let events = get_routine_events(&graph, routine_id)
            .await
            .expect("Failed to retrieve routine events");

        println!("Generated {} events", events.len());

        // Verify that NO event was created on the start day (since it's not Monday or Wednesday)
        let start_day_ms = (start_timestamp / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
        let start_day_end_ms = start_day_ms + (24 * 60 * 60 * 1000);

        let events_on_start_day: Vec<_> = events
            .iter()
            .filter(|event| {
                let event_ts = event.scheduled_timestamp.unwrap();
                event_ts >= start_day_ms && event_ts < start_day_end_ms
            })
            .collect();

        assert_eq!(
            events_on_start_day.len(),
            0,
            "Expected NO events on start day (weekday {}), but found {}",
            start_weekday,
            events_on_start_day.len()
        );

        // Verify that all generated events are on Monday (1) or Wednesday (3)
        for event in &events {
            let event_timestamp = event.scheduled_timestamp.unwrap();
            let event_dt = Utc.timestamp_millis_opt(event_timestamp).unwrap();
            let event_weekday = event_dt.weekday().num_days_from_sunday();

            assert!(
                event_weekday == 1 || event_weekday == 3,
                "Event scheduled on wrong day: weekday {} (expected Monday=1 or Wednesday=3)",
                event_weekday
            );
        }

        // Should have at least 4 events (2 Mondays + 2 Wednesdays in 2 weeks)
        assert!(
            events.len() >= 4,
            "Expected at least 4 events (2 weeks of Mon/Wed), got {}",
            events.len()
        );
    }

    #[tokio::test]
    #[ignore]
    async fn test_specific_user_issue_thursday_to_mwf() {
        // This test specifically reproduces the user's issue:
        // Create routine by clicking on Thursday, then set frequency to Monday/Wednesday/Friday
        // Should NOT create events on Sunday/Tuesday/Thursday but on Monday/Wednesday/Friday

        let graph = create_test_graph()
            .await
            .expect("Failed to create test database connection");

        clear_test_data(&graph)
            .await
            .expect("Failed to clear test data");

        // Simulate clicking on a Thursday (day 4)
        let base_time = Utc::now();
        let days_to_thursday = (4 + 7 - base_time.weekday().num_days_from_sunday()) % 7;
        let thursday_timestamp =
            base_time.timestamp_millis() + (days_to_thursday as i64 * 24 * 60 * 60 * 1000);

        // Verify this is actually a Thursday
        let thursday_dt = Utc.timestamp_millis_opt(thursday_timestamp).unwrap();
        let thursday_weekday = thursday_dt.weekday().num_days_from_sunday();
        assert_eq!(
            thursday_weekday, 4,
            "Test setup error: should be Thursday (4), got {}",
            thursday_weekday
        );

        println!("Test setup:");
        println!(
            "  Click timestamp (Thursday): {}",
            thursday_dt.format("%A %Y-%m-%d")
        );
        println!("  Thursday weekday: {}", thursday_weekday);

        // Create routine with Monday/Wednesday/Friday frequency (like user would do)
        let frequency = "1W:1,3,5"; // Monday=1, Wednesday=3, Friday=5
        let end_timestamp = thursday_timestamp + (14 * 24 * 60 * 60 * 1000); // 2 weeks
        let routine_time = Some(10 * 60 * 60 * 1000); // 10 AM

        let routine_id = create_test_routine(
            &graph,
            "Thursday Click MWF Routine",
            frequency,
            thursday_timestamp, // Start from Thursday click
            Some(end_timestamp),
            routine_time,
            60, // 1 hour duration
        )
        .await
        .expect("Failed to create test routine");

        // Generate events for this routine
        generate_events_for_test_routine(&graph, routine_id, thursday_timestamp, end_timestamp)
            .await
            .expect("Failed to generate routine events");

        // Retrieve generated events
        let events = get_routine_events(&graph, routine_id)
            .await
            .expect("Failed to retrieve routine events");

        println!("Generated {} events", events.len());

        // Print all event details for debugging
        for (i, event) in events.iter().enumerate() {
            let event_timestamp = event.scheduled_timestamp.unwrap();
            let event_dt = Utc.timestamp_millis_opt(event_timestamp).unwrap();
            let event_weekday = event_dt.weekday().num_days_from_sunday();
            let weekday_name = match event_weekday {
                0 => "Sunday",
                1 => "Monday",
                2 => "Tuesday",
                3 => "Wednesday",
                4 => "Thursday",
                5 => "Friday",
                6 => "Saturday",
                _ => "Unknown",
            };
            println!(
                "  Event {}: {} ({}) - weekday {}",
                i + 1,
                event_dt.format("%A %Y-%m-%d %H:%M"),
                weekday_name,
                event_weekday
            );
        }

        // Critical test: NO event should be created on Thursday (the click day)
        let thursday_start_ms =
            (thursday_timestamp / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
        let thursday_end_ms = thursday_start_ms + (24 * 60 * 60 * 1000);

        let events_on_thursday: Vec<_> = events
            .iter()
            .filter(|event| {
                let event_ts = event.scheduled_timestamp.unwrap();
                event_ts >= thursday_start_ms && event_ts < thursday_end_ms
            })
            .collect();

        assert_eq!(
            events_on_thursday.len(),
            0,
            "Expected NO events on Thursday (click day), but found {}. This is the bug!",
            events_on_thursday.len()
        );

        // Verify that ALL events are on Monday (1), Wednesday (3), or Friday (5)
        for (i, event) in events.iter().enumerate() {
            let event_timestamp = event.scheduled_timestamp.unwrap();
            let event_dt = Utc.timestamp_millis_opt(event_timestamp).unwrap();
            let event_weekday = event_dt.weekday().num_days_from_sunday();

            assert!(
                event_weekday == 1 || event_weekday == 3 || event_weekday == 5,
                "Event {} scheduled on wrong day: weekday {} ({}). Expected Monday=1, Wednesday=3, or Friday=5",
                i+1,
                event_weekday,
                event_dt.format("%A")
            );
        }

        // Should have events for 2 weeks: 2 Mondays + 2 Wednesdays + 2 Fridays = 6 events
        assert!(
            events.len() >= 6,
            "Expected at least 6 events (2 weeks of Mon/Wed/Fri), got {}",
            events.len()
        );

        // Additional validation: check that we have roughly equal distribution of M/W/F
        let mut monday_count = 0;
        let mut wednesday_count = 0;
        let mut friday_count = 0;

        for event in &events {
            let event_timestamp = event.scheduled_timestamp.unwrap();
            let event_dt = Utc.timestamp_millis_opt(event_timestamp).unwrap();
            let event_weekday = event_dt.weekday().num_days_from_sunday();

            match event_weekday {
                1 => monday_count += 1,
                3 => wednesday_count += 1,
                5 => friday_count += 1,
                _ => {}
            }
        }

        println!(
            "Event distribution: Monday={}, Wednesday={}, Friday={}",
            monday_count, wednesday_count, friday_count
        );

        // Each day should have at least 2 occurrences in a 2-week period
        assert!(
            monday_count >= 2,
            "Expected at least 2 Monday events, got {}",
            monday_count
        );
        assert!(
            wednesday_count >= 2,
            "Expected at least 2 Wednesday events, got {}",
            wednesday_count
        );
        assert!(
            friday_count >= 2,
            "Expected at least 2 Friday events, got {}",
            friday_count
        );
    }

    #[tokio::test]
    #[ignore]
    async fn test_exact_user_scenario_thursday_click_mwf_frequency() {
        // This test exactly reproduces the user's bug report:
        // 1. Click on Thursday in calendar to create routine
        // 2. Set frequency to Monday/Wednesday/Friday (MWF)
        // 3. Verify NO events are created on Thursday
        // 4. Verify events are ONLY created on Monday, Wednesday, Friday

        let graph = create_test_graph()
            .await
            .expect("Failed to create test database connection");

        clear_test_data(&graph)
            .await
            .expect("Failed to clear test data");

        // Get next Thursday
        let base_time = Utc::now();
        let days_to_thursday = (4 + 7 - base_time.weekday().num_days_from_sunday()) % 7;
        let thursday_click_timestamp =
            base_time.timestamp_millis() + (days_to_thursday as i64 * 24 * 60 * 60 * 1000);

        // Verify this is actually Thursday
        let thursday_dt = Utc.timestamp_millis_opt(thursday_click_timestamp).unwrap();
        let thursday_weekday = thursday_dt.weekday().num_days_from_sunday();
        assert_eq!(
            thursday_weekday, 4,
            "Test setup error: should be Thursday, got {}",
            thursday_weekday
        );

        println!(
            "📅 Simulating user clicking on Thursday: {}",
            thursday_dt.format("%A %Y-%m-%d")
        );

        // Simulate the frontend workflow:
        // 1. User clicks on Thursday -> scheduled_timestamp is set to Thursday
        // 2. User selects goal type "routine"
        // 3. Frontend auto-sets frequency to "1W:4" (Thursday) based on scheduled_timestamp
        // 4. User manually changes frequency to "1W:1,3,5" (Monday, Wednesday, Friday)

        let routine = Goal {
            id: None,
            name: "User MWF Routine".to_string(),
            goal_type: backend::tools::goal::GoalType::Routine,
            description: Some("Testing exact user workflow".to_string()),
            user_id: Some(999),
            priority: Some("medium".to_string()),
            start_timestamp: Some(base_time.timestamp_millis()),
            end_timestamp: None,
            completion_date: None,
            next_timestamp: None,
            scheduled_timestamp: Some(thursday_click_timestamp), // This is set from the Thursday click
            duration: Some(60),
            completed: Some(false),
            frequency: Some("1W:1,3,5".to_string()), // Final frequency: Monday, Wednesday, Friday
            routine_type: Some("task".to_string()),
            routine_time: Some(thursday_click_timestamp), // This would be set from the click time
            position_x: None,
            position_y: None,
            parent_id: None,
            parent_type: None,
            routine_instance_id: None,
            is_deleted: Some(false),
            due_date: None,
            start_date: None,
        };

        // Create the routine via API (like frontend does)
        let created_routine = routine
            .create_goal(&graph)
            .await
            .expect("Failed to create routine");

        println!(
            "✅ Created routine with final frequency: {}",
            created_routine.frequency.as_ref().unwrap()
        );

        // Generate events (this simulates what happens when updateRoutines is called)
        generate_future_routine_events(&graph)
            .await
            .expect("Failed to generate routine events");

        // Verify the events
        let events = get_routine_events(&graph, created_routine.id.unwrap())
            .await
            .expect("Failed to retrieve routine events");

        println!("📊 Generated {} events", events.len());

        // Critical verification: NO events should be on Thursday
        let thursday_start_ms =
            (thursday_click_timestamp / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
        let thursday_end_ms = thursday_start_ms + (24 * 60 * 60 * 1000);

        let thursday_events: Vec<_> = events
            .iter()
            .filter(|event| {
                let event_ts = event.scheduled_timestamp.unwrap();
                event_ts >= thursday_start_ms && event_ts < thursday_end_ms
            })
            .collect();

        if !thursday_events.is_empty() {
            println!("❌ FOUND EVENTS ON THURSDAY (this is the bug!):");
            for event in &thursday_events {
                let event_dt = Utc
                    .timestamp_millis_opt(event.scheduled_timestamp.unwrap())
                    .unwrap();
                println!("  Thursday event: {}", event_dt.format("%A %Y-%m-%d %H:%M"));
            }
        }

        assert_eq!(
            thursday_events.len(),
            0,
            "BUG REPRODUCED: Found {} events on Thursday (click day)! This should be 0.",
            thursday_events.len()
        );

        // Verify events are ONLY on Monday (1), Wednesday (3), Friday (5)
        let mut monday_count = 0;
        let mut wednesday_count = 0;
        let mut friday_count = 0;
        let mut other_day_count = 0;

        for event in &events {
            let event_timestamp = event.scheduled_timestamp.unwrap();
            let event_dt = Utc.timestamp_millis_opt(event_timestamp).unwrap();
            let event_weekday = event_dt.weekday().num_days_from_sunday();

            println!(
                "📅 Event: {} (weekday {})",
                event_dt.format("%A %Y-%m-%d"),
                event_weekday
            );

            match event_weekday {
                1 => monday_count += 1,
                3 => wednesday_count += 1,
                5 => friday_count += 1,
                _ => {
                    other_day_count += 1;
                    println!(
                        "❌ Event on wrong day: {} (weekday {})",
                        event_dt.format("%A"),
                        event_weekday
                    );
                }
            }
        }

        println!(
            "📊 Event distribution: Monday={}, Wednesday={}, Friday={}, Other={}",
            monday_count, wednesday_count, friday_count, other_day_count
        );

        // All events should be on Monday, Wednesday, or Friday
        assert_eq!(
            other_day_count, 0,
            "Found {} events on wrong days (not MWF)",
            other_day_count
        );

        // Should have at least some events
        assert!(events.len() > 0, "No events were generated");

        println!("✅ Test PASSED: Events correctly placed only on Monday, Wednesday, Friday");
        println!("✅ NO events found on Thursday (click day)");
    }

    #[tokio::test]
    #[ignore]
    async fn test_api_routine_creation_with_specific_days() {
        // This test simulates the full API flow:
        // 1. Create routine via API (like frontend does)
        // 2. Call updateRoutines (like frontend does after routine creation)
        // 3. Verify events are correct

        let graph = create_test_graph()
            .await
            .expect("Failed to create test database connection");

        clear_test_data(&graph)
            .await
            .expect("Failed to clear test data");

        // Simulate creating a routine on Thursday with MWF frequency via API
        let base_time = Utc::now();
        let days_to_thursday = (4 + 7 - base_time.weekday().num_days_from_sunday()) % 7;
        let thursday_timestamp =
            base_time.timestamp_millis() + (days_to_thursday as i64 * 24 * 60 * 60 * 1000);

        let thursday_dt = Utc.timestamp_millis_opt(thursday_timestamp).unwrap();
        println!(
            "Simulating API routine creation on Thursday: {}",
            thursday_dt.format("%A %Y-%m-%d")
        );

        // Create the routine directly using the API style creation
        let routine = Goal {
            id: None,
            name: "API MWF Routine".to_string(),
            goal_type: backend::tools::goal::GoalType::Routine,
            description: Some("Test routine created via API simulation".to_string()),
            user_id: Some(999),
            priority: Some("medium".to_string()),
            start_timestamp: Some(thursday_timestamp),
            end_timestamp: None,
            completion_date: None,
            next_timestamp: None,
            scheduled_timestamp: Some(thursday_timestamp), // This would be set from calendar click
            duration: Some(60),
            completed: Some(false),
            frequency: Some("1W:1,3,5".to_string()), // Monday, Wednesday, Friday
            routine_type: Some("task".to_string()),
            routine_time: Some(thursday_timestamp), // Set from the click time initially
            position_x: None,
            position_y: None,
            parent_id: None,
            parent_type: None,
            routine_instance_id: None,
            is_deleted: Some(false),
            due_date: None,
            start_date: None,
        };

        // Create via Goal API (simulates what the frontend does)
        let created_routine = routine
            .create_goal(&graph)
            .await
            .expect("Failed to create routine via API");

        println!("Created routine with ID: {}", created_routine.id.unwrap());

        // Now simulate what happens when updateRoutines is called (like frontend does)
        // This should trigger the routine generator which uses our validation logic
        generate_future_routine_events(&graph)
            .await
            .expect("Failed to generate routine events");

        // Retrieve the generated events
        let events = get_routine_events(&graph, created_routine.id.unwrap())
            .await
            .expect("Failed to retrieve routine events");

        println!("Generated {} events via API flow", events.len());

        // Print all event details for debugging
        for (i, event) in events.iter().enumerate() {
            let event_timestamp = event.scheduled_timestamp.unwrap();
            let event_dt = Utc.timestamp_millis_opt(event_timestamp).unwrap();
            let event_weekday = event_dt.weekday().num_days_from_sunday();
            let weekday_name = match event_weekday {
                0 => "Sunday",
                1 => "Monday",
                2 => "Tuesday",
                3 => "Wednesday",
                4 => "Thursday",
                5 => "Friday",
                6 => "Saturday",
                _ => "Unknown",
            };
            println!(
                "  API Event {}: {} ({}) - weekday {}",
                i + 1,
                event_dt.format("%A %Y-%m-%d %H:%M"),
                weekday_name,
                event_weekday
            );
        }

        // Critical validation: NO event should be on Thursday
        let thursday_start_ms =
            (thursday_timestamp / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
        let thursday_end_ms = thursday_start_ms + (24 * 60 * 60 * 1000);

        let events_on_thursday: Vec<_> = events
            .iter()
            .filter(|event| {
                let event_ts = event.scheduled_timestamp.unwrap();
                event_ts >= thursday_start_ms && event_ts < thursday_end_ms
            })
            .collect();

        if !events_on_thursday.is_empty() {
            println!(
                "ERROR: Found {} events on Thursday (should be 0):",
                events_on_thursday.len()
            );
            for event in &events_on_thursday {
                let event_timestamp = event.scheduled_timestamp.unwrap();
                let event_dt = Utc.timestamp_millis_opt(event_timestamp).unwrap();
                println!("  Thursday event: {}", event_dt.format("%A %Y-%m-%d %H:%M"));
            }
        }

        assert_eq!(
            events_on_thursday.len(),
            0,
            "API test failed: Found events on Thursday (click day), this indicates the bug is in the API flow!"
        );

        // Verify all events are on correct days (Monday=1, Wednesday=3, Friday=5)
        for (i, event) in events.iter().enumerate() {
            let event_timestamp = event.scheduled_timestamp.unwrap();
            let event_dt = Utc.timestamp_millis_opt(event_timestamp).unwrap();
            let event_weekday = event_dt.weekday().num_days_from_sunday();

            assert!(
                event_weekday == 1 || event_weekday == 3 || event_weekday == 5,
                "API Event {} on wrong day: weekday {} ({}). Expected Mon/Wed/Fri only",
                i + 1,
                event_weekday,
                event_dt.format("%A")
            );
        }

        println!("✅ API routine creation test passed - all events on correct days");
    }

    #[tokio::test]
    #[ignore]
    async fn test_frontend_frequency_change_sequence() {
        // This test simulates the exact frontend sequence:
        // 1. Click Thursday (creates routine with scheduled_timestamp = Thursday)
        // 2. Change goal type to 'routine' (triggers default frequency)
        // 3. Change to weekly dropdown (frontend automatically sets frequency to clicked day: "1W:4")
        // 4. Change to Monday/Wednesday/Friday ("1W:1,3,5")
        // This tests if there are race conditions during frequency changes

        let graph = create_test_graph()
            .await
            .expect("Failed to create test database connection");

        clear_test_data(&graph)
            .await
            .expect("Failed to clear test data");

        // Step 1: Simulate clicking on Thursday (like user would do)
        let base_time = Utc::now();
        let days_to_thursday = (4 + 7 - base_time.weekday().num_days_from_sunday()) % 7;
        let thursday_timestamp =
            base_time.timestamp_millis() + (days_to_thursday as i64 * 24 * 60 * 60 * 1000);

        println!(
            "Step 1: User clicks Thursday: {}",
            Utc.timestamp_millis_opt(thursday_timestamp)
                .unwrap()
                .format("%A %Y-%m-%d")
        );

        // Step 2: Frontend would create initial goal with goal_type='routine'
        // This triggers default frequency in frontend: frequency = '1D'
        let mut routine = Goal {
            id: None,
            name: "Frontend Sequence Test".to_string(),
            goal_type: backend::tools::goal::GoalType::Routine,
            description: Some("Testing frontend frequency change sequence".to_string()),
            user_id: Some(999),
            priority: Some("medium".to_string()),
            start_timestamp: Some(thursday_timestamp),
            end_timestamp: None,
            completion_date: None,
            next_timestamp: None,
            scheduled_timestamp: Some(thursday_timestamp), // From Thursday click
            duration: Some(60),
            completed: Some(false),
            frequency: Some("1D".to_string()), // Default when changing to routine
            routine_type: Some("task".to_string()),
            routine_time: Some(thursday_timestamp),
            position_x: None,
            position_y: None,
            parent_id: None,
            parent_type: None,
            routine_instance_id: None,
            is_deleted: Some(false),
            due_date: None,
            start_date: None,
        };

        println!(
            "Step 2: Goal type changed to 'routine', default frequency: {}",
            routine.frequency.as_ref().unwrap()
        );

        // Step 3: User changes frequency dropdown to "weekly"
        // Frontend automatically sets frequency to clicked day: "1W:4" (Thursday)
        routine.frequency = Some("1W:4".to_string());
        println!(
            "Step 3: User selects 'weekly', frequency auto-set to: {}",
            routine.frequency.as_ref().unwrap()
        );

        // Step 4: User manually selects Monday, Wednesday, Friday
        routine.frequency = Some("1W:1,3,5".to_string());
        println!(
            "Step 4: User selects Mon/Wed/Fri, final frequency: {}",
            routine.frequency.as_ref().unwrap()
        );

        // NOW create the routine (simulate user clicking "Create")
        let created_routine = routine
            .create_goal(&graph)
            .await
            .expect("Failed to create routine via API");

        println!(
            "Created routine with final frequency: {}",
            created_routine.frequency.as_ref().unwrap()
        );

        // Generate events (this should only use the FINAL frequency: 1W:1,3,5)
        generate_future_routine_events(&graph)
            .await
            .expect("Failed to generate routine events");

        // Retrieve the generated events
        let events = get_routine_events(&graph, created_routine.id.unwrap())
            .await
            .expect("Failed to retrieve routine events");

        println!(
            "Generated {} events after frequency change sequence",
            events.len()
        );

        // Print all event details for debugging
        for (i, event) in events.iter().enumerate() {
            let event_timestamp = event.scheduled_timestamp.unwrap();
            let event_dt = Utc.timestamp_millis_opt(event_timestamp).unwrap();
            let event_weekday = event_dt.weekday().num_days_from_sunday();
            let weekday_name = match event_weekday {
                0 => "Sunday",
                1 => "Monday",
                2 => "Tuesday",
                3 => "Wednesday",
                4 => "Thursday",
                5 => "Friday",
                6 => "Saturday",
                _ => "Unknown",
            };
            println!(
                "  Event {}: {} ({}) - weekday {}",
                i + 1,
                event_dt.format("%A %Y-%m-%d %H:%M"),
                weekday_name,
                event_weekday
            );
        }

        // Critical test: NO event should be on Thursday
        let thursday_start_ms =
            (thursday_timestamp / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
        let thursday_end_ms = thursday_start_ms + (24 * 60 * 60 * 1000);

        let events_on_thursday: Vec<_> = events
            .iter()
            .filter(|event| {
                let event_ts = event.scheduled_timestamp.unwrap();
                event_ts >= thursday_start_ms && event_ts < thursday_end_ms
            })
            .collect();

        if !events_on_thursday.is_empty() {
            println!("❌ FOUND EVENTS ON THURSDAY (this would be the bug):");
            for event in &events_on_thursday {
                let event_dt = Utc
                    .timestamp_millis_opt(event.scheduled_timestamp.unwrap())
                    .unwrap();
                println!("  Thursday event: {}", event_dt.format("%A %Y-%m-%d %H:%M"));
            }
        }

        assert_eq!(
            events_on_thursday.len(),
            0,
            "Frontend sequence test failed: Found {} events on Thursday (click day)! This means intermediate frequency states are being saved.",
            events_on_thursday.len()
        );

        // Verify all events are on correct days (Monday=1, Wednesday=3, Friday=5)
        for (i, event) in events.iter().enumerate() {
            let event_timestamp = event.scheduled_timestamp.unwrap();
            let event_dt = Utc.timestamp_millis_opt(event_timestamp).unwrap();
            let event_weekday = event_dt.weekday().num_days_from_sunday();

            assert!(
                event_weekday == 1 || event_weekday == 3 || event_weekday == 5,
                "Event {} on wrong day: weekday {} ({}). Expected Mon/Wed/Fri only",
                i + 1,
                event_weekday,
                event_dt.format("%A")
            );
        }

        println!("✅ Frontend frequency change sequence test passed - all events on correct days");
    }

    #[tokio::test]
    #[ignore]
    async fn test_routine_with_future_start_date_no_current_day_events() {
        // This test covers the bug where creating a routine on Tuesday with:
        // - Start date: Saturday (future)
        // - Frequency: Monday/Wednesday (1W:1,3)
        // Incorrectly creates a task on current day (Tuesday)

        let graph = create_test_graph()
            .await
            .expect("Failed to create test database connection");

        clear_test_data(&graph)
            .await
            .expect("Failed to clear test data");

        // Get current time and day of week
        let now = Utc::now();
        let current_weekday = now.weekday().num_days_from_sunday();

        println!("Test setup:");
        println!(
            "  Current day: {} (weekday {})",
            now.format("%A %Y-%m-%d"),
            current_weekday
        );

        // Set start date to Saturday (future date)
        let days_to_saturday = if (6 + 7 - current_weekday) % 7 == 0 {
            // If today is Saturday, use next Saturday
            7
        } else {
            (6 + 7 - current_weekday) % 7
        };
        let saturday_start =
            now.timestamp_millis() + (days_to_saturday as i64 * 24 * 60 * 60 * 1000);

        let saturday_dt = Utc.timestamp_millis_opt(saturday_start).unwrap();
        let saturday_weekday = saturday_dt.weekday().num_days_from_sunday();

        // Verify our Saturday calculation is correct
        assert_eq!(
            saturday_weekday, 6,
            "Start date should be Saturday (6), got {}",
            saturday_weekday
        );

        println!(
            "  Start date (Saturday): {} (weekday {})",
            saturday_dt.format("%A %Y-%m-%d"),
            saturday_weekday
        );

        // Test parameters
        let current_timestamp = now.timestamp_millis();
        let end_timestamp = saturday_start + (21 * 24 * 60 * 60 * 1000); // 3 weeks after start
        let routine_time = Some(9 * 60 * 60 * 1000); // 9 AM
        let frequency = "1W:1,3"; // Monday (1) and Wednesday (3) only
        let duration = 60;

        println!("  Frequency: {} (Monday and Wednesday only)", frequency);
        println!(
            "  Routine should NOT create events before: {}",
            saturday_dt.format("%A %Y-%m-%d")
        );

        // Create the routine with future start date
        let routine_id = create_test_routine(
            &graph,
            "Future Start Monday Wednesday Routine",
            frequency,
            saturday_start, // Start from Saturday (future)
            Some(end_timestamp),
            routine_time,
            duration,
        )
        .await
        .expect("Failed to create test routine");

        // Generate events for this routine
        generate_events_for_test_routine(&graph, routine_id, current_timestamp, end_timestamp)
            .await
            .expect("Failed to generate routine events");

        // Retrieve generated events
        let events = get_routine_events(&graph, routine_id)
            .await
            .expect("Failed to retrieve routine events");

        println!("Generated {} events", events.len());

        // Print all event details for debugging
        for (i, event) in events.iter().enumerate() {
            let event_timestamp = event.scheduled_timestamp.unwrap();
            let event_dt = Utc.timestamp_millis_opt(event_timestamp).unwrap();
            let event_weekday = event_dt.weekday().num_days_from_sunday();
            let weekday_name = match event_weekday {
                0 => "Sunday",
                1 => "Monday",
                2 => "Tuesday",
                3 => "Wednesday",
                4 => "Thursday",
                5 => "Friday",
                6 => "Saturday",
                _ => "Unknown",
            };
            println!(
                "  Event {}: {} ({}) - weekday {}",
                i + 1,
                event_dt.format("%A %Y-%m-%d %H:%M"),
                weekday_name,
                event_weekday
            );
        }

        // CRITICAL TEST 1: NO events should be created on the current day
        let current_day_start = (current_timestamp / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
        let current_day_end = current_day_start + (24 * 60 * 60 * 1000);

        let events_on_current_day: Vec<_> = events
            .iter()
            .filter(|event| {
                let event_ts = event.scheduled_timestamp.unwrap();
                event_ts >= current_day_start && event_ts < current_day_end
            })
            .collect();

        if !events_on_current_day.is_empty() {
            println!("❌ FOUND EVENTS ON CURRENT DAY (this is the bug!):");
            for event in &events_on_current_day {
                let event_dt = Utc
                    .timestamp_millis_opt(event.scheduled_timestamp.unwrap())
                    .unwrap();
                println!(
                    "  Current day event: {}",
                    event_dt.format("%A %Y-%m-%d %H:%M")
                );
            }
        }

        assert_eq!(
            events_on_current_day.len(),
            0,
            "BUG REPRODUCED: Found {} events on current day! Should be 0 since routine starts in the future.",
            events_on_current_day.len()
        );

        // CRITICAL TEST 2: NO events should be created before the start date (Saturday)
        let events_before_start: Vec<_> = events
            .iter()
            .filter(|event| {
                let event_ts = event.scheduled_timestamp.unwrap();
                event_ts < saturday_start
            })
            .collect();

        if !events_before_start.is_empty() {
            println!("❌ FOUND EVENTS BEFORE START DATE:");
            for event in &events_before_start {
                let event_dt = Utc
                    .timestamp_millis_opt(event.scheduled_timestamp.unwrap())
                    .unwrap();
                println!(
                    "  Pre-start event: {} (before start: {})",
                    event_dt.format("%A %Y-%m-%d %H:%M"),
                    saturday_dt.format("%A %Y-%m-%d")
                );
            }
        }

        assert_eq!(
            events_before_start.len(),
            0,
            "Found {} events before start date! All events should be on or after {}",
            events_before_start.len(),
            saturday_dt.format("%A %Y-%m-%d")
        );

        // CRITICAL TEST 3: ALL events should be on Monday (1) or Wednesday (3) only
        let mut monday_count = 0;
        let mut wednesday_count = 0;
        let mut other_day_count = 0;

        for (i, event) in events.iter().enumerate() {
            let event_timestamp = event.scheduled_timestamp.unwrap();
            let event_dt = Utc.timestamp_millis_opt(event_timestamp).unwrap();
            let event_weekday = event_dt.weekday().num_days_from_sunday();

            match event_weekday {
                1 => monday_count += 1,    // Monday
                3 => wednesday_count += 1, // Wednesday
                _ => {
                    other_day_count += 1;
                    println!(
                        "❌ Event {} on wrong day: {} (weekday {}). Expected Monday or Wednesday only.",
                        i + 1,
                        event_dt.format("%A"),
                        event_weekday
                    );
                }
            }
        }

        println!(
            "📊 Event distribution: Monday={}, Wednesday={}, Other={}",
            monday_count, wednesday_count, other_day_count
        );

        assert_eq!(
            other_day_count, 0,
            "Found {} events on wrong days! All events should be on Monday or Wednesday only.",
            other_day_count
        );

        // CRITICAL TEST 4: ALL events should be on or after the start date
        for (i, event) in events.iter().enumerate() {
            let event_timestamp = event.scheduled_timestamp.unwrap();
            assert!(
                event_timestamp >= saturday_start,
                "Event {} is scheduled before start date! Event: {}, Start: {}",
                i + 1,
                Utc.timestamp_millis_opt(event_timestamp)
                    .unwrap()
                    .format("%Y-%m-%d"),
                saturday_dt.format("%Y-%m-%d")
            );
        }

        // Should have some events (expect at least 6 events: 3 weeks * 2 days/week)
        assert!(
            events.len() >= 6,
            "Expected at least 6 events (3 weeks of Mon/Wed), got {}",
            events.len()
        );

        // Additional validation: verify time of day is correct (9 AM)
        if let Some(routine_time) = routine_time {
            for event in &events {
                let event_timestamp = event.scheduled_timestamp.unwrap();
                let time_of_day_ms = event_timestamp % (24 * 60 * 60 * 1000);
                let expected_time_ms = routine_time % (24 * 60 * 60 * 1000);

                assert_eq!(
                    time_of_day_ms, expected_time_ms,
                    "Event has wrong time of day. Expected 9 AM, got {}ms since midnight",
                    time_of_day_ms
                );
            }
        }

        println!("✅ ALL TESTS PASSED:");
        println!("✅ No events created on current day");
        println!("✅ No events created before start date");
        println!("✅ All events are on Monday or Wednesday only");
        println!("✅ All events are on or after the start date");
    }

    #[tokio::test]
    #[ignore]
    async fn test_edge_case_routine_created_on_frequency_day_with_future_start() {
        // Edge case: Create routine on Monday, set frequency to Monday/Wednesday,
        // but with start date in the future (next Saturday)
        // Should NOT create event on current Monday

        let graph = create_test_graph()
            .await
            .expect("Failed to create test database connection");

        clear_test_data(&graph)
            .await
            .expect("Failed to clear test data");

        // Force test to run on a Monday (or simulate it)
        let now = Utc::now();
        let days_to_monday = (1 + 7 - now.weekday().num_days_from_sunday()) % 7;
        let monday_timestamp = if days_to_monday == 0 {
            now.timestamp_millis() // Today is Monday
        } else {
            now.timestamp_millis() + (days_to_monday as i64 * 24 * 60 * 60 * 1000)
        };

        let monday_dt = Utc.timestamp_millis_opt(monday_timestamp).unwrap();
        let monday_weekday = monday_dt.weekday().num_days_from_sunday();
        assert_eq!(
            monday_weekday, 1,
            "Should be Monday, got {}",
            monday_weekday
        );

        // Set start date to next Saturday (future)
        let saturday_start = monday_timestamp + (5 * 24 * 60 * 60 * 1000); // 5 days after Monday
        let saturday_dt = Utc.timestamp_millis_opt(saturday_start).unwrap();
        let saturday_weekday = saturday_dt.weekday().num_days_from_sunday();
        assert_eq!(
            saturday_weekday, 6,
            "Start should be Saturday, got {}",
            saturday_weekday
        );

        println!("Edge case test setup:");
        println!(
            "  Creation day (Monday): {}",
            monday_dt.format("%A %Y-%m-%d")
        );
        println!(
            "  Start date (Saturday): {}",
            saturday_dt.format("%A %Y-%m-%d")
        );
        println!("  Frequency: 1W:1,3 (Monday and Wednesday)");

        let end_timestamp = saturday_start + (14 * 24 * 60 * 60 * 1000); // 2 weeks after start
        let routine_time = Some(14 * 60 * 60 * 1000); // 2 PM
        let frequency = "1W:1,3"; // Monday and Wednesday

        // Create routine on Monday with future Saturday start
        let routine_id = create_test_routine(
            &graph,
            "Monday Created Future Start Routine",
            frequency,
            saturday_start, // Start from Saturday (future)
            Some(end_timestamp),
            routine_time,
            60,
        )
        .await
        .expect("Failed to create test routine");

        // Generate events starting from the creation time (Monday)
        generate_events_for_test_routine(&graph, routine_id, monday_timestamp, end_timestamp)
            .await
            .expect("Failed to generate routine events");

        let events = get_routine_events(&graph, routine_id)
            .await
            .expect("Failed to retrieve routine events");

        println!("Generated {} events", events.len());

        // Print event details
        for (i, event) in events.iter().enumerate() {
            let event_timestamp = event.scheduled_timestamp.unwrap();
            let event_dt = Utc.timestamp_millis_opt(event_timestamp).unwrap();
            let event_weekday = event_dt.weekday().num_days_from_sunday();
            println!(
                "  Event {}: {} (weekday {})",
                i + 1,
                event_dt.format("%A %Y-%m-%d %H:%M"),
                event_weekday
            );
        }

        // NO event should be on the creation day (Monday) since start is in future
        let monday_day_start = (monday_timestamp / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
        let monday_day_end = monday_day_start + (24 * 60 * 60 * 1000);

        let events_on_creation_monday: Vec<_> = events
            .iter()
            .filter(|event| {
                let event_ts = event.scheduled_timestamp.unwrap();
                event_ts >= monday_day_start && event_ts < monday_day_end
            })
            .collect();

        assert_eq!(
            events_on_creation_monday.len(),
            0,
            "Found {} events on creation day (Monday)! Should be 0 since start date is in future.",
            events_on_creation_monday.len()
        );

        // All events should be on or after Saturday start date
        for event in &events {
            let event_timestamp = event.scheduled_timestamp.unwrap();
            assert!(
                event_timestamp >= saturday_start,
                "Event before start date: {} < {}",
                Utc.timestamp_millis_opt(event_timestamp)
                    .unwrap()
                    .format("%Y-%m-%d"),
                saturday_dt.format("%Y-%m-%d")
            );
        }

        // All events should be on Monday or Wednesday only
        for event in &events {
            let event_timestamp = event.scheduled_timestamp.unwrap();
            let event_dt = Utc.timestamp_millis_opt(event_timestamp).unwrap();
            let event_weekday = event_dt.weekday().num_days_from_sunday();
            assert!(
                event_weekday == 1 || event_weekday == 3,
                "Event on wrong day: weekday {} ({})",
                event_weekday,
                event_dt.format("%A")
            );
        }

        println!("✅ Edge case test passed: No events on creation day when start is in future");
    }
}
