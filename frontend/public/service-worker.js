/* eslint-env serviceworker */
/* eslint-disable no-restricted-globals */
// Service Worker for Goals PWA
// Handles push notifications and offline caching

const CACHE_NAME = 'goals-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo192.png',
  '/logo512.png',
  '/favicon.png'
];

// Install event - cache essential files
self.addEventListener('install', event => {
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
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
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
  self.clients.claim();
});

// Fetch event - handle navigations with offline fallback; pass-through others safely
self.addEventListener('fetch', event => {
  const { request } = event;
  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Top-level navigations: try network, fallback to cached index
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (_) {
        const fallback = await caches.match('/index.html');
        return fallback || new Response('', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Non-navigation GETs: pass-through to network; if it fails, try cache or 503
  event.respondWith((async () => {
    try {
      return await fetch(request);
    } catch (_) {
      const cached = await caches.match(request);
      return cached || new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});

// Push event - show notification
self.addEventListener('push', event => {
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
    self.registration.showNotification(title, options)
      .catch(err => {
        console.error('[ServiceWorker] Error showing notification:', err);
      })
  );
});

// Notification click event - handle notification interactions
self.addEventListener('notificationclick', event => {
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
    self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(clientList => {
      // Check if there's already a window/tab open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          // Navigate to the URL if provided
          if (url !== '/' && client.url !== new URL(url, self.location.origin).href) {
            client.navigate(url);
          }
          return client.focus();
        }
      }
      // If no window is open, open a new one
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});

// Background sync event (for future use)
self.addEventListener('sync', event => {
  console.log('[ServiceWorker] Background sync:', event.tag);
  if (event.tag === 'sync-goals') {
    // Implement background sync logic here
    // For example: sync offline changes with server
  }
});

// Periodic background sync (for future use)
self.addEventListener('periodicsync', event => {
  console.log('[ServiceWorker] Periodic background sync:', event.tag);
  if (event.tag === 'update-routines') {
    // Implement periodic sync logic here
    // For example: update routine events periodically
  }
});
