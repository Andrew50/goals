# Backend Integration Tests

This directory contains integration tests for the Goals backend, specifically testing routine event generation functionality.

## Setup

### Prerequisites

1. **Neo4j Test Database**: The tests require a separate Neo4j test database instance running on port 7688
2. **Environment Variables**: Set the following environment variables for test database connection:
   - `NEO4J_TEST_URI` (default: `bolt://localhost:7688`)
   - `NEO4J_TEST_USERNAME` (default: `neo4j`)
   - `NEO4J_TEST_PASSWORD` (default: `password123`)

### Starting Test Database

If you're using the existing docker setup, the test database should already be configured. Start it with:

```bash
docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml up -d goals_db_test
```

### Running Tests

Run the integration tests with:

```bash
cd backend
cargo test --test routine_integration_test
```

Or run all tests:

```bash
cargo test
```

## Test Coverage

### `routine_integration_test.rs`

Tests the complete routine event generation workflow from routine creation to event verification.

#### Test Cases

1. **`test_daily_routine_event_generation`**
   - Creates a daily routine with 7-day duration and 9 AM schedule time
   - Verifies correct number of events are generated (7-8 events)
   - Validates each event has correct properties (name, type, duration, parent relationship)
   - Confirms events are scheduled at the correct time of day (9 AM)
   - Verifies events are spaced exactly 1 day apart

2. **`test_weekly_routine_event_generation`**
   - Creates a weekly routine over 3 weeks with 2 PM schedule time
   - Verifies appropriate number of events for weekly frequency (3-4 events)
   - Validates event properties and timing
   - Ensures no duplicate timestamps

3. **`test_routine_without_end_date`**
   - Creates an open-ended routine with 2-day frequency
   - Verifies events are generated up to ~3 months ahead (90 days)
   - Confirms correct spacing between events (2 days apart)

4. **`test_routine_time_application`**
   - Creates a routine with specific time of day (3:30 PM)
   - Verifies all generated events are scheduled at the correct time
   - Tests time-of-day calculation accuracy

5. **`test_routine_event_relationship`**
   - Verifies that HAS_EVENT relationships are correctly created
   - Ensures database relationships between routines and their events

## Test Data

- Tests use `user_id: 999` as a test user to avoid conflicts with real data
- Each test clears its test data before running to ensure isolation
- Tests create temporary routines and events that are cleaned up

## Key Validations

### Event Properties
- **Name**: Matches parent routine name
- **Type**: Set to `GoalType::Event`
- **Duration**: Inherited from routine
- **Parent ID**: References the routine ID
- **Parent Type**: Set to "routine"
- **User ID**: Matches routine user (999 for tests)
- **Completion Status**: Initially false
- **Deletion Status**: Initially false

### Timing Validations
- **Frequency Compliance**: Events follow the specified frequency pattern
- **Time of Day**: When `routine_time` is set, all events use that time
- **Date Range**: Events fall within routine start/end dates (when specified)
- **Spacing**: Events are properly spaced according to frequency

### Database Relationships
- **HAS_EVENT Relationships**: Proper Neo4j relationships between routines and events
- **Data Integrity**: No orphaned events or broken relationships

## Error Scenarios

The tests also implicitly validate error handling:
- Database connection failures
- Invalid routine configurations
- Missing required fields

## Future Test Enhancements

Potential areas for additional test coverage:
1. **Complex Frequencies**: Test weekly routines with specific days (e.g., "1W:1,3,5")
2. **Timezone Handling**: Test routine generation across different timezones
3. **Edge Cases**: Test routines starting at midnight, end-of-month scenarios
4. **Concurrent Generation**: Test multiple routines generating events simultaneously
5. **Update Scenarios**: Test behavior when routines are modified after events are generated 