# Routine Event Rescheduling Feature

## Overview
When rescheduling an event that belongs to a routine, the system now asks the user which events they want to update:

1. **Only this occurrence** - Updates just the specific event that was moved
2. **This and all future occurrences** - Updates the moved event and all events scheduled after it for the same routine to the same time-of-day
3. **All occurrences of this routine** - Updates all events for the routine to the same time-of-day (regardless of previous individual reschedules)

## Key Fix: Time-of-Day Synchronization

The system now properly handles cases where individual events were previously rescheduled. Instead of applying a time delta (which would preserve individual offsets), it extracts the **time-of-day** from the new timestamp and applies that same time-of-day to all affected events.

### Example Scenario:
1. Daily routine originally at 9:00 AM
2. Monday event individually rescheduled to 10:00 AM  
3. User drags Tuesday event to 11:00 AM and chooses "All occurrences"

**Previous (incorrect) behavior:**
- Time delta = 11:00 AM - 9:00 AM = +2 hours
- Monday: 10:00 AM + 2 hours = 12:00 PM ❌
- Tuesday: 9:00 AM + 2 hours = 11:00 AM ✅

**New (correct) behavior:**
- Extract time-of-day = 11:00 AM
- Monday: Set to 11:00 AM ✅  
- Tuesday: Set to 11:00 AM ✅

## Implementation Details

### Frontend Changes (Calendar.tsx)

- **New Dialog**: Added a Material-UI dialog that appears when a routine event is dragged to a new time
- **State Management**: Added `routineRescheduleDialog` state to track dialog visibility and event details
- **Event Detection**: Modified `handleEventDrop` to detect routine events (`parent_type === 'routine'`) and show the dialog instead of immediately updating
- **Dialog Handlers**: Added `handleRoutineRescheduleConfirm` and `handleRoutineRescheduleCancel` functions

### Frontend API (api.ts)

- **New Function**: Added `updateRoutineEvent(eventId, newTimestamp, updateScope)` function
- **Update Scopes**: Supports 'single', 'all', and 'future' scope options

### Backend Changes (event.rs)

- **New Request Struct**: Added `UpdateRoutineEventRequest` with `new_timestamp` and `update_scope` fields
- **New Handler**: Added `update_routine_event_handler` function with logic for all three update scopes:
  - **Single**: Updates only the specific event
  - **All**: Sets all events to the same time-of-day (preserving their dates)
  - **Future**: Sets all future events to the same time-of-day (preserving their dates)

### Backend Routes (http_handler.rs)

- **New Route**: Added `PUT /events/:id/routine-update` route
- **New Handler**: Added `handle_update_routine_event` function to map the route to the handler

## Database Queries

The backend uses different Cypher queries based on the update scope:

### Single Event Update
```cypher
MATCH (e:Goal)
WHERE id(e) = $event_id
SET e.scheduled_timestamp = $new_timestamp
RETURN e
```

### All Events Update (Fixed)
```cypher
MATCH (e:Goal)
WHERE e.goal_type = 'event'
AND e.parent_id = $parent_id
AND e.parent_type = 'routine'
AND (e.is_deleted IS NULL OR e.is_deleted = false)
SET e.scheduled_timestamp = (e.scheduled_timestamp / $day_in_ms) * $day_in_ms + $new_time_of_day
RETURN collect(e) as events
```

### Future Events Update (Fixed)
```cypher
MATCH (e:Goal)
WHERE e.goal_type = 'event'
AND e.parent_id = $parent_id
AND e.parent_type = 'routine'
AND e.scheduled_timestamp >= $current_timestamp
AND (e.is_deleted IS NULL OR e.is_deleted = false)
SET e.scheduled_timestamp = (e.scheduled_timestamp / $day_in_ms) * $day_in_ms + $new_time_of_day
RETURN collect(e) as events
```

### Algorithm Explanation:
- `new_time_of_day = new_timestamp % day_in_ms` - Extract milliseconds since midnight
- `(old_timestamp / day_in_ms) * day_in_ms` - Get start of the day for the old event
- `start_of_day + new_time_of_day` - Combine to get the new timestamp with correct time-of-day

## User Experience

1. User drags a routine event to a new time slot
2. System detects it's a routine event and pauses the drag operation
3. Dialog appears asking which events to update
4. User selects their preference and clicks "Update"
5. System applies the time-of-day to the selected scope of events (maintaining date synchronization)
6. Calendar refreshes to show the updated events

## Error Handling

- If the API call fails, the drag operation is reverted
- Error messages are displayed to the user
- Dialog can be cancelled to revert the change

This feature provides fine-grained control over routine event scheduling while maintaining proper time synchronization across all events. 