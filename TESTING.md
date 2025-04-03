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

### Backend Tests

The backend uses Rust's native testing framework:

1. **Unit Tests**: Located inside the relevant modules with `#[cfg(test)]`
   - Tests individual components in isolation

2. **Integration Tests**: These can be added in the `backend/tests` directory

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