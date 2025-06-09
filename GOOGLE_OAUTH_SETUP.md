# Google OAuth Setup Guide

This guide will help you set up Google OAuth for your Goals application.

## ⚠️ SECURITY NOTICE

**IMPORTANT**: Never commit your actual OAuth credentials to version control. Use environment variables instead.

### Required Configuration:
- **Client ID**: `YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com` (from Google Console)
- **Client Secret**: `YOUR_GOOGLE_CLIENT_SECRET` (from Google Console)
- **Redirect URIs**: 
  - Development: `http://localhost:3030/auth/callback`
  - Production: `https://goal.atlantis.trading/auth/callback`
- **JWT Secret**: Secure random string generated
- **Environment variables**: Must be configured in your `.env` file

## Setup Instructions

1. **Create Google OAuth App** in [Google Cloud Console](https://console.cloud.google.com/)
2. **Get your OAuth credentials** (Client ID and Client Secret)
3. **Configure environment variables** in your `.env` file (see below)
4. **Start your application** (backend and frontend)
5. **Navigate to**: `http://localhost:3030/signin`
6. **Click "Sign in with Google"** 
7. **Enjoy seamless authentication!**

## Environment Variables Configuration

Create a `.env` file in your project root with the following variables:

```bash
# Google OAuth Configuration (DO NOT commit these values!)
GOOGLE_CLIENT_ID=your_actual_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_actual_client_secret_here
GOOGLE_REDIRECT_URL=http://localhost:3030/auth/callback

# JWT Configuration
JWT_SECRET=GenerateASecureRandomStringHere
JWT_EXPIRATION=86400

# Host and Database Configuration
HOST_URL=localhost
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=neo4j
```

## Production Deployment

For production:
1. **Set environment variables** in your hosting platform
2. **Update GOOGLE_REDIRECT_URL** to: `https://goal.atlantis.trading/auth/callback`
3. **Generate secure JWT_SECRET** for production
4. **Never expose credentials** in source code

## Features Available

✅ **Traditional Login**: Username/password authentication  
✅ **Google OAuth**: One-click Google sign-in  
✅ **Account Linking**: Existing users can link Google accounts  
✅ **Secure Tokens**: JWT-based authentication  
✅ **User Management**: Automatic user creation for new Google users  

## Troubleshooting

### If Google Sign-In Doesn't Work:

1. **Check Environment Variables**: Ensure `.env` file has correct values
2. **Restart Services**: Restart both backend and frontend after env changes
3. **Check Console**: Look for any OAuth errors in browser console
4. **Verify Redirect**: Ensure the callback URL matches exactly

### Error Messages:

- **"OAuth client not found"**: Backend isn't reading the `GOOGLE_CLIENT_ID` properly
- **"redirect_uri_mismatch"**: The callback URL doesn't match Google Console settings
- **"Token exchange failed"**: Issue with `GOOGLE_CLIENT_SECRET`

## Technical Implementation

The implementation includes:

### Backend (`/backend/src/server/auth.rs`):
- OAuth2 client setup and authorization URL generation
- Token exchange with Google's OAuth API
- User creation/linking with Google accounts
- JWT token generation for authenticated users

### Frontend:
- Google Sign-In button in signin page
- OAuth callback handler component
- AuthContext integration for seamless authentication
- Automatic redirection after successful login

### Database:
- Extended User model with Google-specific fields:
  - `google_id`: Google's unique user identifier
  - `google_email`: User's Google email address
  - `display_name`: User's display name from Google
  - `created_via`: Authentication method tracking

## Security Best Practices

✅ **Environment Variables**: All secrets stored in `.env` file  
✅ **CSRF Protection**: State parameter validation prevents CSRF attacks  
✅ **Secure Secrets**: JWT secret is properly randomized  
✅ **Token Validation**: Proper OAuth token exchange and validation  
✅ **Account Linking**: Safe linking of existing accounts via email matching  
✅ **No Committed Secrets**: Credentials never stored in version control  

Your Google OAuth implementation follows security best practices! 
