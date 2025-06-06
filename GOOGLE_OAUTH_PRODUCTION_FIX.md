# Google OAuth Production Fix

## Problem
Google OAuth was not working in production due to incorrect redirect URL configuration. The issue was caused by the difference in routing between development and production environments:

- **Development**: Frontend calls backend directly at `http://localhost:5059` (no prefix)
- **Production**: Frontend calls backend at `https://goals.atlantis.trading/api` (with `/api` prefix due to nginx routing)

## Root Cause
The `GOOGLE_REDIRECT_URL` environment variable was incorrectly configured to point to a backend API route instead of the frontend callback route.

## Solution
The Google OAuth redirect URL must always point to the **frontend** callback route, not the backend API route:

- **Development**: `http://localhost:3030/auth/callback`
- **Production**: `https://goals.atlantis.trading/auth/callback` (no `/api` prefix)

## OAuth Flow Explanation
1. User clicks "Sign in with Google" on frontend
2. Frontend calls backend API: `GET /api/auth/google` (in production)
3. Backend returns Google OAuth URL with redirect pointing to frontend: `https://goals.atlantis.trading/auth/callback`
4. User is redirected to Google for authentication
5. Google redirects back to frontend: `https://goals.atlantis.trading/auth/callback?code=...&state=...`
6. Frontend extracts code/state and calls backend API: `GET /api/auth/callback?code=...&state=...`
7. Backend exchanges code for token and returns JWT to frontend

## Required Environment Variable Update
Update the production environment variable:

```bash
GOOGLE_REDIRECT_URL=https://goals.atlantis.trading/auth/callback
```

**Important**: This URL should NOT include the `/api` prefix, as it's a frontend route, not a backend API route.

## Google Cloud Console Configuration
In the Google Cloud Console, ensure the authorized redirect URIs include:
- Development: `http://localhost:3030/auth/callback`
- Production: `https://goals.atlantis.trading/auth/callback`

## Files Modified
- `backend/src/server/auth.rs`: Added clarifying comments about redirect URL configuration
- `GOOGLE_OAUTH_SETUP.md`: Updated documentation to clarify correct redirect URL format
- `GOOGLE_OAUTH_PRODUCTION_FIX.md`: This document explaining the fix

## Testing
After updating the environment variable and redeploying:
1. Navigate to the production signin page
2. Click "Sign in with Google"
3. Complete Google OAuth flow
4. Verify successful authentication and redirect to the application 