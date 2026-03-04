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

  // Helper to fix Safari issue with redirected responses in SW
  const cleanResponse = (response) => {
    if (!response) return response;
    if (response.redirected) {
      return new Response(response.body, {
        status: response.status === 0 ? 200 : response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    }
    return response;
  };

  // Top-level navigations: try network, fallback to cached index
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        return cleanResponse(response);
      } catch (_) {
        const fallback = await caches.match('/index.html');
        return fallback ? cleanResponse(fallback) : new Response('', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Non-navigation GETs: pass-through to network; if it fails, try cache or 503
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      return cleanResponse(response);
    } catch (_) {
      const cached = await caches.match(request);
      return cached ? cleanResponse(cached) : new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
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
