# Timezone Testing Guide

## Background

Time and timezone handling is one of the most challenging aspects of software testing, especially in CI/CD environments where:

1. The system timezone might differ from local development machines
2. Different behavior can occur with Daylight Saving Time (DST) transitions
3. JavaScript's Date handling has subtle inconsistencies across environments

This document explains our approach to timezone testing and provides guidelines for writing reliable tests.

## Key Components

### 1. Time Conversion Functions (`time.ts`)

- `toLocalTimestamp`: Converts UTC timestamps to local time
- `toUTCTimestamp`: Converts local timestamps to UTC
- Various formatting and parsing functions

### 2. Testing Utilities (`testUtils.ts`)

- `mockTimezone`: Provides a stable environment with a fixed timezone offset
- `mockDSTTransition`: Simulates DST transitions with different timezone offsets

### 3. Test Strategies

- **Scenario Tests** (`timeScenarios.test.ts`): Tests specific timezone edge cases
- **Unit Tests** (`time.test.ts`): Tests basic functionality
- **Integration Tests** (`timeIntegration.test.ts`): Tests use in Goal objects

## Common Issues and Solutions

### 1. Environment Dependence

**Issue:** Tests that work locally may fail in CI due to timezone differences.

**Solution:**
- Use `mockTimezone` to create a consistent environment
- Create timestamps using `Date.UTC()` rather than local constructors
- Use relative comparisons where possible (e.g., check time differences, not absolute hours)

### 2. DST Transitions

**Issue:** DST transitions (especially "fall back") create ambiguous times that are hard to test consistently.

**Solution:**
- For "spring forward" transitions, use `mockDSTTransition` 
- For "fall back" transitions, use explicit timestamp values
- Focus on testing the round-trip conversion rather than specific timestamp values
- Use approximate comparisons for transition edge cases

### 3. Test Data Stability

**Issue:** Using `new Date()` or local machine time can create non-deterministic tests.

**Solution:**
- Use fixed reference dates (e.g., `Date.UTC(2023, 0, 1, 12, 0, 0)`)
- Avoid relying on the current date/time in tests
- Mock the Date object to provide consistent results

## Best Practices

1. **Avoid exact hour assertions:** Don't assert that a specific timestamp results in a specific hour, as this depends on environment.

2. **Test round-trip conversions:** Verify that converting to UTC and back preserves the original timestamp.

3. **Use relative assertions:** Test that the difference between two timestamps is correct, not that they have specific values.

4. **Isolate timezone tests:** Use the mocking utilities to control the environment completely.

5. **Document edge cases:** When testing DST transitions or other edge cases, document your approach.

6. **Use approximate assertions for ambiguous cases:** For DST transition tests, use `toBeLessThan` or `toBeGreaterThan` rather than exact equality.

## Example Test Pattern

```typescript
test('Converting between timezones preserves relative time differences', () => {
  // Create a consistent timezone environment
  const restoreMock = mockTimezone(480); // PST: UTC-8
  
  // Use UTC for creating test timestamps
  const timestamp1 = Date.UTC(2023, 0, 1, 12, 0, 0);
  const timestamp2 = Date.UTC(2023, 0, 1, 14, 0, 0);
  
  // Convert to local
  const local1 = toLocalTimestamp(timestamp1);
  const local2 = toLocalTimestamp(timestamp2);
  
  // Verify the time difference is preserved (2 hours)
  expect(local2! - local1!).toBe(2 * 60 * 60 * 1000);
  
  // Clean up
  restoreMock();
});
```

## Maintaining Tests

When updating time-related code:

1. Run tests in different environments to catch issues
2. Consider time edge cases: DST transitions, date boundaries, leap years
3. Update the mocking utilities if JavaScript Date behavior changes
 