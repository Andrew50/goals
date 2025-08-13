// Service Worker for Goals PWA
// Handles push notifications and offline caching

const CACHE_NAME = 'goals-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/static/css/main.css',
  '/static/js/main.js',
  '/manifest.json',
  '/logo192.png',
  '/logo512.png'
];

// Install event - cache essential files
globalThis.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[ServiceWorker] Caching app shell');
        // Don't fail install if some resources can't be cached
        return cache.addAll(urlsToCache).catch(err => {
          console.warn('[ServiceWorker] Failed to cache some resources:', err);
        });
      })
  );
  // Force the waiting service worker to become active
  globalThis.skipWaiting();
});

// Activate event - clean up old caches
globalThis.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      const oldCacheNames = cacheNames.filter(name => name !== CACHE_NAME);
      return Promise.all(
        oldCacheNames.map(cacheName => {
          console.log('[ServiceWorker] Removing old cache:', cacheName);
          return caches.delete(cacheName);
        })
      );
    })
  );
  // Claim all clients immediately
  globalThis.clients.claim();
});

// Fetch event - serve from cache when possible
globalThis.addEventListener('fetch', event => {
  // Skip non-GET requests and API calls
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version or fetch from network
        return response || fetch(event.request).catch(() => {
          // If both cache and network fail, return a fallback for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});

// Push event - show notification
globalThis.addEventListener('push', event => {
  console.log('[ServiceWorker] Push received:', event);

  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    console.error('[ServiceWorker] Error parsing push data:', e);
  }

  const title = data.title || 'Goals Notification';
  const options = {
    body: data.body || 'You have a new notification',
    icon: data.icon || '/logo192.png',
    badge: data.badge || '/logo192.png',
    vibrate: data.vibrate || [100, 50, 100],
    data: data.data || {},
    actions: data.actions || [],
    tag: data.tag || 'default',
    requireInteraction: data.requireInteraction || false,
    renotify: data.renotify || false,
    silent: data.silent || false,
    timestamp: data.timestamp || Date.now()
  };

  event.waitUntil(
    globalThis.registration.showNotification(title, options)
      .catch(err => {
        console.error('[ServiceWorker] Error showing notification:', err);
      })
  );
});

// Notification click event - handle notification interactions
globalThis.addEventListener('notificationclick', event => {
  console.log('[ServiceWorker] Notification clicked:', event);

  event.notification.close();

  const data = event.notification.data || {};
  const url = data.url || '/';

  // Handle action buttons
  if (event.action) {
    console.log('[ServiceWorker] Action clicked:', event.action);
    // You can handle different actions here
    // For example: mark task complete, snooze reminder, etc.
  }

  event.waitUntil(
    globalThis.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(clientList => {
      // Check if there's already a window/tab open
      for (const client of clientList) {
        if (client.url.includes(globalThis.location.origin) && 'focus' in client) {
          // Navigate to the URL if provided
          if (url !== '/' && client.url !== new URL(url, globalThis.location.origin).href) {
            client.navigate(url);
          }
          return client.focus();
        }
      }
      // If no window is open, open a new one
      if (globalThis.clients.openWindow) {
        return globalThis.clients.openWindow(url);
      }
    })
  );
});

// Background sync event (for future use)
globalThis.addEventListener('sync', event => {
  console.log('[ServiceWorker] Background sync:', event.tag);
  if (event.tag === 'sync-goals') {
    // Implement background sync logic here
    // For example: sync offline changes with server
  }
});

// Periodic background sync (for future use)
globalThis.addEventListener('periodicsync', event => {
  console.log('[ServiceWorker] Periodic background sync:', event.tag);
  if (event.tag === 'update-routines') {
    // Implement periodic sync logic here
    // For example: update routine events periodically
  }
});
