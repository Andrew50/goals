# Google Calendar Integration - Per-User OAuth Implementation

## Overview

This implementation uses per-user OAuth 2.0 tokens with offline access to sync Google Calendar events. Each user authenticates with their own Google account and grants calendar permissions, enabling bidirectional sync between the Goals app and their Google Calendar.

## Key Features

- **Per-user authentication**: Each user links their own Google account
- **Offline access**: Refresh tokens allow background sync without user interaction
- **Incremental sync**: Uses sync tokens to fetch only changes, reducing API calls
- **Calendar selection**: Users can choose which calendar to sync with
- **Bidirectional sync**: Import from and export to Google Calendar
- **Automatic token refresh**: Tokens are refreshed transparently when expired

## Architecture

### Backend Components

1. **OAuth Flow** (`backend/src/server/auth.rs`)
   - Requests calendar scopes during Google sign-in
   - Stores access and refresh tokens in Neo4j
   - Updates tokens on each sign-in

2. **Token Manager** (`backend/src/server/token_manager.rs`)
   - Validates token expiry with 5-minute buffer
   - Refreshes expired tokens automatically
   - Provides token revocation for unlinking

3. **Calendar Client** (`backend/src/tools/gcal_client.rs`)
   - REST API client using per-user tokens
   - Incremental sync with sync tokens
   - Handles all-day vs timed events
   - Error recovery and retry logic

4. **HTTP Handlers** (`backend/src/server/http_handler.rs`)
   - `GET /gcal/calendars` - List user's calendars
   - `POST /gcal/sync-from` - Import from Google Calendar
   - `POST /gcal/sync-to` - Export to Google Calendar
   - `POST /gcal/sync-bidirectional` - Two-way sync
   - `DELETE /gcal/event/:id` - Delete synced event

### Frontend Components

1. **Calendar Page** (`frontend/src/pages/calendar/Calendar.tsx`)
   - Sync dialog with calendar selector
   - Direction selection (from/to/bidirectional)
   - Progress and error reporting

2. **API Client** (`frontend/src/shared/utils/api.ts`)
   - Calendar list and sync endpoints
   - Type definitions for sync results

### Database Schema

User node properties for OAuth:
- `google_access_token` - Current access token
- `google_refresh_token` - Refresh token for offline access
- `google_token_expiry` - Token expiration timestamp (ms)
- `google_email` - User's Google email

Goal node properties for sync:
- `gcal_event_id` - Google Calendar event ID
- `gcal_calendar_id` - Calendar ID the event belongs to
- `gcal_sync_enabled` - Whether to sync this event
- `gcal_sync_direction` - Sync direction (from_gcal/to_gcal/bidirectional)
- `gcal_last_sync` - Last sync timestamp
- `is_gcal_imported` - Whether event was imported from Google

SyncState node for incremental sync:
- `user_id` - User ID
- `calendar_id` - Calendar ID
- `sync_token` - Google's sync token
- `last_synced` - Last sync timestamp

## Setup Instructions

### 1. Google Cloud Console Configuration

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable the Google Calendar API
4. Create OAuth 2.0 credentials:
   - Application type: Web application
   - Authorized redirect URIs:
     - Development: `http://localhost:3030/auth/callback`
     - Production: `https://your-domain.com/auth/callback`
5. Download the credentials (Client ID and Secret)

### 2. Environment Variables

Create a `.env` file in the project root:

```bash
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URL=http://localhost:3030/auth/callback  # Frontend route
REACT_APP_GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com

# JWT Configuration
JWT_SECRET=your_secure_random_string
JWT_EXPIRATION=86400

# Database Configuration
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_password
```

### 3. Production Configuration

For production, update the redirect URL:
```bash
GOOGLE_REDIRECT_URL=https://your-domain.com/auth/callback
```

## User Flow

1. **Initial Setup**
   - User clicks "Sign in with Google"
   - Grants calendar permissions
   - Tokens are stored in database

2. **Calendar Sync**
   - User opens Calendar page
   - Clicks "📅 Sync" button
   - Selects calendar from dropdown
   - Chooses sync direction
   - Clicks "Sync Now"

3. **Incremental Updates**
   - First sync fetches events from past 30 days to next 60 days
   - Subsequent syncs use sync token to fetch only changes
   - Automatic conflict resolution (last-write-wins)

## Security Considerations

1. **Token Storage**
   - Tokens stored in Neo4j database
   - Consider encryption at rest for production
   - Never log tokens

2. **Token Refresh**
   - Automatic refresh with 5-minute buffer
   - Refresh tokens never expire unless revoked

3. **Revocation**
   - Tokens revoked at Google when user unlinks account
   - Cleared from database immediately

## API Rate Limits

Google Calendar API limits:
- 1,000,000 queries per day
- 500 queries per 100 seconds per user

Implementation includes:
- Incremental sync to minimize API calls
- Error handling for rate limit responses
- Future: Add exponential backoff for 429 errors

## Troubleshooting

### "No calendars found"
- User hasn't granted calendar permissions
- Re-authenticate with Google

### "Token expired"
- Refresh token is invalid
- User needs to re-authenticate

### Sync conflicts
- Last-write-wins policy
- Check `gcal_last_sync` timestamp

### Missing events
- Check `gcal_sync_enabled` flag
- Verify `gcal_sync_direction` setting
- Check date range (30 days past, 60 days future)

## Future Enhancements

1. **Exponential Backoff**
   - Implement retry logic for rate limits
   - Progressive delay on failures

2. **Batch Operations**
   - Group multiple create/update operations
   - Reduce API calls

3. **Conflict Resolution**
   - User-selectable conflict policies
   - Manual conflict resolution UI

4. **Extended Sync Window**
   - User-configurable date ranges
   - Archive old events

5. **Real-time Updates**
   - Webhook support for instant updates
   - Push notifications for changes

## Migration from Service Account

If migrating from service account implementation:
1. Remove `GCAL_SERVICE_ACCOUNT_PATH` environment variable
2. Remove service account JSON file
3. Users must re-authenticate with Google
4. Existing `gcal_event_id` mappings are preserved
