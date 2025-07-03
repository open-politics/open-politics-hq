// This is the service worker for the Open Politics HQ PWA

// Cache name
const CACHE_NAME = 'open-politics-cache-v1';

// Files to cache
const urlsToCache = [
  '/',
  '/pwa',
  '/manifest.json',
  '/icon.png',
  '/icon-192x192.png',
  '/icon-512x512.png'
];

// Install event
self.addEventListener('install', (event) => {
  console.log('Service Worker installing.');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache opened');
        return cache.addAll(urlsToCache);
      })
  );
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating.');
});

// Fetch event
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

// Push event
self.addEventListener('push', (event) => {
  console.log('Push received:', event.data?.text());
  
  if (event.data) {
    const data = JSON.parse(event.data.text());
    const options = {
      body: data.body,
      icon: '/icon.png',
      badge: '/icon.png',
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: '2',
        url: '/' // URL to open when notification is clicked
      },
      actions: [
        {
          action: 'explore',
          title: 'View Details',
        }
      ]
    };

    event.waitUntil(
      self.registration.showNotification(data.title || 'New Notification', options)
    );
  }
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('Notification click received:', event);

  event.notification.close();

  // This looks to see if the current is already open and focuses if it is
  event.waitUntil(
    clients.matchAll({
      type: "window"
    })
    .then((clientList) => {
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client)
          return client.focus();
      }
      if (clients.openWindow)
        return clients.openWindow('/');
    })
  );
}); 