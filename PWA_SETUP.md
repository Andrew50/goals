# PWA and Push Notifications Setup Guide

## Overview

This app is now a Progressive Web App (PWA) with push notification support. This guide explains how to set up and use these features.

## Features

- **Installable PWA**: Can be installed to home screen on mobile devices and desktop
- **Offline Support**: Basic offline functionality with service worker caching
- **Push Notifications**: Receive notifications for events, tasks, and reminders
- **iOS Support**: Full support for iOS 16.4+ when installed to home screen

## Setup Instructions

### 1. Generate VAPID Keys

First, generate the VAPID keys needed for push notifications:

```bash
./generate-vapid-keys.sh
```

This will output three environment variables that you need to add to your `.env` file:
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

### 2. Configure Environment Variables

Add the VAPID keys to your `.env` file:

```env
# Push Notifications (VAPID)
VAPID_PUBLIC_KEY=your_generated_public_key
VAPID_PRIVATE_KEY=your_generated_private_key
VAPID_SUBJECT=mailto:admin@yourdomain.com
```

### 3. Restart Docker Containers

After adding the environment variables, restart your containers:

```bash
docker-compose -f docker-compose.dev.yaml down
docker-compose -f docker-compose.dev.yaml up -d
```

For production:
```bash
docker-compose -f docker-compose.prod.yaml down
docker-compose -f docker-compose.prod.yaml up -d
```

## Installing the PWA

### iOS (iPhone/iPad)

1. Open the app in Safari (Chrome won't work on iOS)
2. Tap the Share button (square with arrow)
3. Scroll down and tap "Add to Home Screen"
4. Give it a name and tap "Add"
5. Open the app from your home screen
6. Go to Account Settings and enable notifications

**Important**: On iOS, push notifications ONLY work when the app is installed to the home screen and opened from there.

### Android

1. Open the app in Chrome
2. You should see an "Install" prompt in the address bar or a banner
3. Alternatively, tap the menu (three dots) and select "Install app"
4. Open the app from your home screen or app drawer
5. Go to Account Settings and enable notifications

### Desktop (Chrome/Edge)

1. Open the app in Chrome or Edge
2. Look for the install icon in the address bar (usually a + or computer icon)
3. Click it and follow the prompts
4. The app will open in its own window
5. Go to Account Settings and enable notifications

## Using Push Notifications

### Enabling Notifications

1. Navigate to Account Settings (user menu → Account Settings)
2. Scroll to the "Push Notifications" section
3. Click "Enable Notifications"
4. Allow notifications when prompted by your browser
5. Test it works with the "Send Test" button

### Notification Types

The app can send notifications for:
- **High Priority Events**: Automatic alerts 15 minutes before high priority events start
- **Event Reminders**: Configurable reminders before any event (15 min, 1 hour, 1 day)
- **Task Deadlines**: When tasks are approaching their due date
- **Routine Reminders**: For recurring routine events
- **Custom Notifications**: Any other app-specific alerts

#### High Priority Event Notifications

Events marked as "high" priority will automatically trigger push notifications 15 minutes before they start. These notifications:
- Are sent automatically without requiring manual configuration
- Have a distinctive "⚡ High Priority Event" title
- Require user interaction (won't auto-dismiss)
- Include action buttons to view the event or snooze the reminder
- Are checked every minute by the backend scheduler

To enable high priority notifications:
1. Mark an event as "High" priority when creating or editing it
2. Ensure push notifications are enabled in Account Settings
3. The system will automatically send a notification 15 minutes before the event starts

### Troubleshooting

#### Notifications not working on iOS?
- Ensure the app is installed to home screen
- Must be using iOS 16.4 or later
- Open the app FROM the home screen icon (not Safari)
- Check Settings → Notifications → [App Name] is enabled

#### Notifications not working on Android/Desktop?
- Check browser notification permissions
- Ensure the service worker is registered (check browser DevTools)
- Try unsubscribing and re-subscribing

#### Test notification not received?
- Check browser console for errors
- Verify VAPID keys are correctly configured
- Ensure backend has network access to push services
- Check Neo4j has the subscription stored

## Technical Details

### Service Worker

The service worker (`/service-worker.js`) handles:
- Push event reception
- Notification display
- Offline caching
- Background sync (future feature)

### Push Subscription Flow

1. User clicks "Enable Notifications"
2. Browser requests permission
3. If granted, subscribes to push service with VAPID public key
4. Subscription sent to backend
5. Backend stores in Neo4j as `WebPushSubscription` node

### Backend Architecture

- Push module: `/backend/src/tools/push.rs`
- Routes: `/api/push/subscribe`, `/api/push/unsubscribe`, `/api/push/test`
- Storage: Neo4j graph with `User -[:HAS_SUBSCRIPTION]-> WebPushSubscription`

### Security Considerations

- VAPID private key should never be exposed to frontend
- Push subscriptions are user-specific and authenticated
- Invalid subscriptions are automatically cleaned up
- HTTPS required for service workers and push

## Development Tips

### Testing Push Notifications Locally

1. Ensure VAPID keys are set in `.env`
2. Use ngrok or similar to get HTTPS for local testing
3. Install the PWA from the HTTPS URL
4. Test with the "Send Test" button in Account Settings

### Debugging

Check the browser console for:
- Service worker registration status
- Push subscription errors
- Notification permission state

Check the backend logs for:
- VAPID configuration issues
- Push sending failures
- Subscription storage errors

### Browser Compatibility

- **Chrome**: Full support (Desktop & Android)
- **Safari**: iOS 16.4+ (home screen only)
- **Firefox**: Full support (Desktop & Android)
- **Edge**: Full support (Desktop)

## Future Enhancements

Potential improvements to implement:
- Background sync for offline changes
- Periodic background sync for routine updates
- Rich notifications with images
- Notification actions (complete task, snooze, etc.)
- Notification scheduling preferences
- Do Not Disturb hours
- Notification categories/filtering
