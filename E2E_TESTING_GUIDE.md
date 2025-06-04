# E2E Testing Guide

## Overview

This project uses Playwright for end-to-end testing of the Goals application. The tests validate the full user experience from frontend interactions to backend data persistence.

## Setup

### Prerequisites

- Docker and Docker Compose
- Node.js 18+
- npm

### Environment Configuration

1. Ensure you have a `.env` file in the project root with the required variables:
   ```bash
   JWT_SECRET=your_jwt_secret_here
   REACT_APP_API_URL=http://localhost:5057
   GOALS_GEMINI_API_KEY=your_gemini_key_here
   # ... other environment variables
   ```

2. Install frontend dependencies:
   ```bash
   cd frontend
   npm install
   npx playwright install --with-deps chromium
   ```

## Running Tests

### Quick Validation

Use the provided validation script to test the entire setup:

```bash
./test-e2e-setup.sh
```

This script will:
- Check all required files and dependencies
- Start the test environment
- Validate database and backend connectivity
- Seed the test database
- Run a basic test validation

### Manual Test Execution

1. **Start the test environment:**
   ```bash
   docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml up -d
   ```

2. **Wait for services to be ready:**
   ```bash
   # Check database
   docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml exec goals_db_test /var/lib/neo4j/bin/cypher-shell -a bolt://localhost:7687 -u neo4j -p password123 "RETURN 1;"
   
   # Check backend (if health endpoint exists)
   curl http://localhost:5057/health
   ```

3. **Seed the test database:**
   ```bash
   docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml exec goals_db_test /data/seed_test_db.sh
   ```

4. **Run the tests:**
   ```bash
   cd frontend
   npx playwright test
   ```

5. **Cleanup:**
   ```bash
   docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml down -v
   ```

### Specific Test Suites

Run individual test suites:

```bash
cd frontend

# Calendar tests
npx playwright test calendar/

# API tests  
npx playwright test api/

# Timestamp tests
npx playwright test timestamp/

# Interactive debugging
npx playwright test --debug

# UI mode for test development
npx playwright test --ui
```

## Test Environment Architecture

### Services

1. **goals_db_test**: Isolated Neo4j database for testing
   - Port 7688 (Bolt) / 7475 (Web UI)
   - Separate data volume from development database
   - Pre-seeded with test data

2. **goals_backend**: Application backend
   - Port 5057 (mapped from internal 5059)
   - Connected to test database
   - `TEST_MODE=true` environment variable

3. **goals_frontend**: React application
   - Port 3030
   - Configured to connect to test backend

### Test Data

The test database is seeded with:
- Test user (ID: 1, username: 'testuser')
- Sample tasks with different priorities and schedules
- Sample routine and achievement goals
- Goal relationships (dependencies, parent-child)

### Authentication

Tests use a mock JWT authentication system:
- JWT tokens are generated in test setup
- Storage state is pre-configured with test user credentials
- No need for actual login during tests

## Test Structure

### Page-based Organization

```
frontend/tests/
├── .auth/                 # Authentication storage
├── helpers/               # Test utilities and auth helpers
├── api/                   # API endpoint tests
├── calendar/              # Calendar page interaction tests
├── timestamp/             # Date/time handling tests
└── global-setup.ts        # Test environment setup
```

### Test Categories

1. **Calendar Tests** (`calendar/calendar.spec.ts`)
   - Calendar view switching (month/week/day)
   - Event creation, editing, deletion
   - Drag and drop functionality
   - Task scheduling and unscheduling
   - Event resizing and moving

2. **API Tests** (`api/calendar-api.spec.ts`)
   - Backend endpoint validation
   - Data persistence verification
   - Error handling

3. **Timestamp Tests** (`timestamp/timestamp.spec.ts`)
   - Date/time picker interactions
   - Timezone handling
   - Date validation and formatting

## Key Fixes Applied

### 1. Cypher-shell Installation Issue
- **Problem**: CI workflow failed downloading external cypher-shell package
- **Fix**: Use built-in cypher-shell from Neo4j Docker image (`/var/lib/neo4j/bin/cypher-shell`)

### 2. Port Configuration Mismatch
- **Problem**: Backend ports didn't match between dev and test environments
- **Fix**: Added explicit port mapping in test compose file (5057:5059)

### 3. Service Startup Timing
- **Problem**: Tests started before services were fully ready
- **Fix**: Added proper health checks and increased wait times

### 4. Environment Configuration
- **Problem**: Missing environment variables and configuration mismatches
- **Fix**: Updated Playwright config to use environment variables and proper timeouts

## Troubleshooting

### Common Issues

1. **Database Connection Failures**
   ```bash
   # Check if Neo4j is running
   docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml logs goals_db_test
   
   # Manually test connection
   docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml exec goals_db_test /var/lib/neo4j/bin/cypher-shell -a bolt://localhost:7687 -u neo4j -p password123 "RETURN 1;"
   ```

2. **Backend Not Responding**
   ```bash
   # Check backend logs
   docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml logs goals_backend
   
   # Test backend directly
   curl http://localhost:5057/health
   ```

3. **Frontend Build Issues**
   ```bash
   # Clear and reinstall dependencies
   cd frontend
   rm -rf node_modules package-lock.json
   npm install
   ```

4. **Playwright Issues**
   ```bash
   # Reinstall browsers
   cd frontend
   npx playwright install --with-deps chromium
   ```

### Debug Mode

For detailed debugging:

```bash
cd frontend
DEBUG=pw:* npx playwright test --debug
```

This enables verbose Playwright logging and opens the browser in debug mode.

## CI/CD Integration

The GitHub Actions workflow (`.github/workflows/e2e-tests.yml`) automatically:

1. Sets up the test environment
2. Installs dependencies
3. Starts services with health checks
4. Seeds the test database
5. Runs the full test suite
6. Uploads test reports as artifacts
7. Cleans up the environment

### Workflow Triggers

- Manual workflow calls
- Pull requests (when configured)
- Scheduled runs (when configured)

## Best Practices

1. **Test Data Isolation**
   - Each test run uses a fresh database
   - No test data persistence between runs
   - Isolated from development data

2. **Stable Selectors**
   - Use semantic CSS classes and test IDs
   - Avoid brittle selectors based on DOM structure
   - Prefer role-based and text-based selectors

3. **Wait Strategies**
   - Use `waitForSelector` for element visibility
   - Use `waitForLoadState` for page loads
   - Add appropriate timeouts for CI environments

4. **Error Handling**
   - Tests include proper error scenarios
   - Graceful degradation testing
   - Network failure simulation

5. **Parallel Execution**
   - Tests are designed to run in parallel
   - No shared state between test files
   - Database isolation per test session

## Future Improvements

1. **Visual Regression Testing**
   - Add screenshot comparisons
   - Test responsive design breakpoints

2. **Performance Testing**
   - Measure page load times
   - Test with large datasets

3. **Accessibility Testing**
   - Add automated a11y checks
   - Test keyboard navigation

4. **Cross-browser Testing**
   - Currently Chrome-only for CI speed
   - Can be extended to Firefox and Safari

5. **API Contract Testing**
   - Add comprehensive API validation
   - Test error scenarios and edge cases 