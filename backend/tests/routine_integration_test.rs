use std::env;
use chrono::Utc;
use neo4rs::{query, Graph};
use serde_json;
use std::collections::HashSet;

// Import the modules we need for testing
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
        let event_data: serde_json::Value = row.get("event").map_err(|_| neo4rs::Error::ConversionError)?;
        let event: Goal = serde_json::from_value(event_data).map_err(|_| {
            neo4rs::Error::ConversionError
        })?;
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

/// Helper function to generate events for a specific test routine (more controlled than the full generator)
async fn generate_events_for_test_routine(
    graph: &Graph,
    routine_id: i64,
    start_timestamp: i64,
    end_timestamp: i64,
) -> Result<(), neo4rs::Error> {
    // Fetch the routine details
    let routine_query = query(
        "MATCH (r:Goal) WHERE id(r) = $routine_id RETURN r"
    ).param("routine_id", routine_id);
    
    let mut result = graph.execute(routine_query).await?;
    let routine_row = result.next().await?
        .ok_or_else(|| neo4rs::Error::ConversionError)?;
    let routine: Goal = routine_row.get("r")
        .map_err(|_| neo4rs::Error::ConversionError)?;
    
    let frequency = routine.frequency.as_ref()
        .ok_or_else(|| neo4rs::Error::ConversionError)?;
    
    let instance_id = format!("{}-{}", routine_id, Utc::now().timestamp_millis());
    let mut current_time = start_timestamp;
    let mut event_count = 0;
    
    while current_time <= end_timestamp {
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
                 RETURN count(e) as existing_count"
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
                     CREATE (r)-[:HAS_EVENT]->(e)"
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
            _ => current_time + (24 * 60 * 60 * 1000), // Default daily
        };
    }
    
    if event_count > 0 {
        println!("Created {} events for test routine {}", event_count, routine_id);
    }
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
        ).await.expect("Failed to create test routine");

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
            let prev_timestamp = events[i-1].scheduled_timestamp.unwrap();
            let curr_timestamp = events[i].scheduled_timestamp.unwrap();
            let diff_days = (curr_timestamp - prev_timestamp) / (24 * 60 * 60 * 1000);
            
            assert_eq!(
                diff_days, 1,
                "Events {} and {} are not exactly 1 day apart. Diff: {} days",
                i-1, i, diff_days
            );
        }
    }

    #[tokio::test]
    async fn test_weekly_routine_event_generation() {
        // Set up test database connection
        let graph = create_test_graph().await.expect("Failed to create test database connection");
        
        // Clear any existing test data
        clear_test_data(&graph).await.expect("Failed to clear test data");

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
        ).await.expect("Failed to create test routine");

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
    async fn test_routine_without_end_date() {
        // Set up test database connection
        let graph = create_test_graph().await.expect("Failed to create test database connection");
        
        // Clear any existing test data
        clear_test_data(&graph).await.expect("Failed to clear test data");

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
        ).await.expect("Failed to create test routine");

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
        ).await.expect("Failed to create test routine");

        // Generate events specifically for this test routine
        generate_events_for_test_routine(&graph, routine_id, start_timestamp, end_timestamp)
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
                time_of_day_minutes, routine_time_minutes as i64,
                "Event scheduled at wrong time of day. Expected {}:{:02}, got {}:{:02}",
                routine_time_minutes / 60,
                routine_time_minutes % 60,
                time_of_day_minutes / 60,
                time_of_day_minutes % 60
            );
        }
    }

    #[tokio::test]
    async fn test_routine_event_relationship() {
        // Set up test database connection
        let graph = create_test_graph().await.expect("Failed to create test database connection");
        
        // Clear any existing test data
        clear_test_data(&graph).await.expect("Failed to clear test data");

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
        ).await.expect("Failed to create test routine");

        // Generate events specifically for this test routine
        generate_events_for_test_routine(&graph, routine_id, start_timestamp, end_timestamp)
            .await
            .expect("Failed to generate routine events");

        // Verify HAS_EVENT relationships exist
        let relationship_query = query(
            "MATCH (r:Goal)-[:HAS_EVENT]->(e:Goal)
             WHERE id(r) = $routine_id
             RETURN count(e) as event_count"
        ).param("routine_id", routine_id);

        let mut result = graph.execute(relationship_query).await.expect("Failed to execute relationship query");
        if let Some(row) = result.next().await.expect("Failed to get relationship result") {
            let event_count: i64 = row.get("event_count").expect("Failed to get event count");
            assert!(event_count > 0, "No HAS_EVENT relationships found between routine and events");
        } else {
            panic!("No relationship query result returned");
        }
    }
} 