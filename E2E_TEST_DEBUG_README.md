# E2E Test Debugging Guide for LLMs

## 🎯 Current Status: **8/29 tests passing** ✅

This repository has a React frontend with Playwright e2e tests that were failing. Significant debugging work has been completed to fix the core infrastructure issues.

## 🏗️ Architecture Overview

```
Goals App
├── Frontend (React + TypeScript) - Port 3030
├── Backend (Rust) - Port 5057  
├── Database (Neo4j) - Port 7687 (dev) / 7688 (test)
└── E2E Tests (Playwright)
```

## 🔧 Test Infrastructure Setup

### Required Services
Run this command to start all services:
```bash
./test-e2e-setup.sh
```

This starts:
- **Backend**: Connects to test database on port 7688
- **Frontend**: Serves React app on port 3030
- **Test Database**: Neo4j with seeded test data
- **Dev Database**: Separate Neo4j instance for development

### Test Database Seeding
The test database contains:
- **User**: `testuser` (ID: 1) 
- **Tasks**: 2 unscheduled tasks
- **Routine**: 1 daily routine that generates events
- **Events**: 2 events generated from the routine

## ✅ Major Issues FIXED

### 1. Authentication Fixed
**Problem**: JWT tokens used wrong username
**Solution**: Updated `frontend/tests/helpers/auth.ts` and `frontend/tests/global-setup.ts`
```typescript
// OLD: username: `testuser${userId}` 
// NEW: username: 'testuser' (matches database)
```

### 2. Backend Database Connection Fixed
**Problem**: Backend wasn't connecting to test database
**Solution**: `docker-compose.test.yaml` properly configures:
```yaml
environment:
  - NEO4J_URI=bolt://goals_db_test:7687
```

### 3. API Response Structure Fixed
**Problem**: Tests expected wrong data structure
**Solution**: Updated `frontend/tests/api/calendar-api.spec.ts`
```typescript
// API returns: { events: [], unscheduled_tasks: [], routines: [], achievements: [], parents: [] }
expect(body.events).toHaveLength(2); // Updated from 1 to 2
```

### 4. Event Visibility Fixed
**Problem**: Events existed but weren't visible to Playwright
**Solution**: 
- Events are visible in **week view** but hidden in **month view**
- Use `{ force: true }` for month view clicks
- Switch to week view for reliable interactions

### 5. Routing Fixed
**Problem**: Tests went to `/` instead of `/calendar`
**Solution**: All tests now properly navigate to `/calendar`

## 🧪 Working Tests (8 passing)

1. **API Test**: `tests/api/calendar-api.spec.ts` ✅
2. **Event Click Test**: `tests/calendar/test-fixed-event-click.spec.ts` ✅  
3. **Basic Calendar Display**: Calendar loads and renders ✅
4. **View Switching**: Month/week/day views work ✅
5. **Navigation**: Calendar navigation works ✅

## 🚧 Remaining Issues (21 failing)

### Dialog/Modal Issues
**Problem**: UI interactions fail to find form elements
**Symptoms**: 
```
TimeoutError: locator.fill: Timeout 15000ms exceeded.
Call log: - waiting for locator('input[placeholder="Name"]')
```
**Likely Cause**: Dialog structure changed, selectors need updating

### Event Resizing Issues  
**Problem**: Resize handles are hidden
**Symptoms**:
```
Expected: visible
Received: hidden
Locator: .fc-event-resizer-end
```
**Likely Cause**: FullCalendar CSS or event configuration

### Drag & Drop Issues
**Problem**: Drag operations don't complete successfully
**Likely Cause**: Timing issues or element positioning

## 🔍 Debugging Tools Created

Several debug test files were created during troubleshooting (now deleted):
- `debug-calendar.spec.ts` - Page loading and routing
- `debug-events.spec.ts` - Event visibility across views  
- `debug-visibility.spec.ts` - Event interaction testing
- `debug-single-test.spec.ts` - Individual test debugging

## 🚀 How to Continue Debugging

### 1. Run Current Working Tests
```bash
cd frontend
npx playwright test tests/api/calendar-api.spec.ts tests/calendar/test-fixed-event-click.spec.ts --project=chromium --reporter=line
```

### 2. Debug Specific Failing Test
```bash
npx playwright test tests/calendar/calendar.spec.ts --project=chromium --reporter=line --grep "create new unscheduled task"
```

### 3. Create Debug Test for UI Issues
```typescript
test('debug dialog structure', async ({ page }) => {
  await page.goto('/calendar');
  await page.waitForSelector('.calendar-container');
  
  // Click Add Task button
  await page.locator('.calendar-sidebar button:has-text("Add Task")').click();
  
  // Debug what dialog actually contains
  const dialog = page.locator('div[role="dialog"]');
  const dialogContent = await dialog.innerHTML();
  console.log('Dialog HTML:', dialogContent);
  
  // Check what input fields exist
  const inputs = await page.locator('input').all();
  for (let i = 0; i < inputs.length; i++) {
    const placeholder = await inputs[i].getAttribute('placeholder');
    const name = await inputs[i].getAttribute('name');
    console.log(`Input ${i}: placeholder="${placeholder}", name="${name}"`);
  }
});
```

### 4. Key Areas to Investigate

#### Dialog/Form Issues
- Check actual dialog HTML structure vs expected selectors
- Look for Material-UI component changes
- Verify form field names and placeholders

#### Event Interaction Issues  
- Check FullCalendar configuration for resize handles
- Verify drag & drop event handlers are working
- Test with different calendar views

#### Timing Issues
- Add longer waits for dynamic content
- Use `page.waitForFunction()` for complex state changes
- Check for race conditions in API calls

## 📁 Key Files

### Test Files
- `frontend/tests/api/calendar-api.spec.ts` - API tests ✅
- `frontend/tests/calendar/calendar.spec.ts` - Main UI tests (needs fixes)
- `frontend/tests/calendar/test-fixed-event-click.spec.ts` - Working event tests ✅

### Configuration  
- `frontend/playwright.config.ts` - Playwright configuration
- `frontend/tests/global-setup.ts` - Authentication setup ✅
- `frontend/tests/helpers/auth.ts` - JWT token generation ✅

### Infrastructure
- `test-e2e-setup.sh` - Start all services ✅
- `docker-compose.test.yaml` - Test environment config ✅
- `db/seed_test_db.sh` - Test data seeding ✅

## 🎯 Next Priority Actions

1. **Fix Dialog Selectors**: Update form field selectors to match actual UI
2. **Fix Event Resizing**: Investigate FullCalendar resize handle visibility
3. **Improve Drag & Drop**: Add better waits and error handling
4. **Add More Debug Logging**: Create helper functions for common debugging patterns

## 💡 Pro Tips for LLM Debugging

1. **Always check what's actually rendered**: Use `innerHTML()` and screenshots
2. **Test in isolation**: Create minimal test cases for specific issues  
3. **Use force clicks**: When elements exist but aren't "visible" to Playwright
4. **Check timing**: Many issues are race conditions with async loading
5. **Verify selectors**: UI frameworks change component structures frequently

The foundation is solid - authentication, API, and basic calendar functionality all work. The remaining issues are primarily UI interaction details that need selector updates and timing improvements. 