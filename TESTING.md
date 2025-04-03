# Testing and CI/CD Setup

This document explains the testing infrastructure and CI/CD pipelines for the Goals application.

## Testing Infrastructure

### Frontend Tests

The frontend uses Playwright for end-to-end and API tests:

1. **End-to-End Tests**: Located in `frontend/tests/*.spec.ts`
   - Tests the UI functionality through browser automation
   - Includes calendar view navigation and interaction tests

2. **API Tests**: Located in `frontend/tests/api/*.spec.ts` 
   - Tests backend API endpoints directly
   - Validates response structure and data

3. **Unit and Integration Tests**: Located alongside components
   - Component tests: `*.test.tsx` files adjacent to components
   - Utility tests: `*.test.ts` files in the same directory as utilities

### Backend Tests

The backend uses Rust's native testing framework:

1. **Unit Tests**: Located inside the relevant modules with `#[cfg(test)]`
   - Tests individual components in isolation

2. **Integration Tests**: These can be added in the `backend/tests` directory

## Timestamp and Timezone Testing

The application handles timestamps in the following way:

1. **Backend/Database**: ALWAYS stores times as UTC timestamps (milliseconds since epoch)
2. **API Communication**: ALWAYS transmits times as UTC timestamps
3. **Frontend Display**: ALWAYS displays times in the user's local timezone

### Key Timestamp Conversion Points

- `goalToLocal(goal)`: Converts UTC timestamps in a goal object to local timezone (sets `_tz: 'user'`)
- `goalToUTC(goal)`: Converts local timestamps back to UTC for API submission (sets `_tz: 'utc'`)
- `toLocalTimestamp(timestamp)`: Utility to convert individual UTC timestamp to local
- `toUTCTimestamp(timestamp)`: Utility to convert individual local timestamp to UTC

### Timezone Testing Strategy

Our testing strategy ensures correct timestamp handling across different timezones and scenarios:

#### 1. Unit Testing (`time.test.ts`, `timeScenarios.test.ts`)

- Tests conversions in multiple timezone offsets (positive, negative, half-hour, zero)
- Tests DST transitions (spring forward, fall back, events spanning transitions)
- Tests date boundary conditions (midnight, month/year boundaries, leap years)
- Verifies all timestamp fields in Goal objects are properly converted

#### 2. Component Integration Testing (`GoalMenu.test.tsx`, `Calendar.test.tsx`)

- Tests form input/output of timestamps in GoalMenu component
- Tests calendar drag, resize, and click operations with proper timezone conversions
- Tests all-day event handling
- Mocks different timezones to verify correct behavior across zones

#### 3. End-to-End Testing (`timestamp-e2e.spec.ts`)

- Tests the complete user flows with real backend
- Creates tasks with specific times and verifies persistence after reload
- Tests drag-and-drop operations and persistence
- Tests resize operations and duration handling
- Simulates timezone changes with Playwright's timezone emulation

### Running Timezone Tests

#### Unit and Integration Tests

```bash
cd frontend
npm test -- --testPathPattern=time
```

#### E2E Timezone Tests with Specific Browser Timezone

```bash
# Regular timezone
cd frontend
npx playwright test timestamp-e2e.spec.ts

# With specific timezone
npx playwright test timestamp-e2e.spec.ts --timezone="America/New_York"
npx playwright test timestamp-e2e.spec.ts --timezone="Asia/Kolkata" 
npx playwright test timestamp-e2e.spec.ts --timezone="Europe/London"
```

## Continuous Integration

We have two GitHub Actions workflows:

### 1. Main Branch Checks (`.github/workflows/main-checks.yml`)

Runs on every push to the `main` branch:
- Fast, lightweight checks
- Lints code (ESLint for frontend, Clippy for backend)
- Validates types (TypeScript for frontend)
- Does NOT run the full test suite or e2e tests

Purpose: Quick feedback on code quality for active development

### 2. Full CI Suite (`.github/workflows/ci.yml`)

Runs only on pull requests to the `prod` branch:
- Complete code quality checks
- Full backend test suite
- End-to-end tests with Playwright
- API integration tests
- Uses a test database with seeded data

Purpose: Thorough validation before production deployment

## Test Database

For e2e and API testing, we use a dedicated test database:
- Configured in `docker-compose.test.yaml`
- Seeded with test data via `db/seed_test_db.sh`
- Contains sample goals, users, and relationships for testing
- Completely isolated from development and production databases

## Running Tests Locally

### Frontend E2E Tests

```bash
# Install dependencies if not already installed
cd frontend
npm install
npm install -D @playwright/test @types/jsonwebtoken jsonwebtoken

# Install Playwright browsers
npx playwright install

# Run tests
npm run test:e2e
```

### Backend Unit Tests

```bash
cd backend
cargo test
```

## Adding New Tests

### Adding Frontend E2E Tests

1. Create a new file in `frontend/tests/*.spec.ts`
2. Use the Playwright API to interact with the UI
3. Make sure to handle authentication if needed

### Adding API Tests

1. Create a new file in `frontend/tests/api/*.spec.ts`
2. Use the Playwright `request` context to make API calls
3. Use the `generateTestToken()` helper for authentication

### Adding Backend Tests

Add tests within the relevant module file using Rust's testing framework:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_some_functionality() {
        // Test code here
    }
}
```

## Test Data Management

Test data is managed through the seed script. If you need to add or modify test data:

1. Edit `db/seed_test_db.sh`
2. Make sure to include all required fields for each entity type
3. Update any corresponding tests if data structure changes 