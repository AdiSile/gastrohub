/* ===========================================================================
   GastroHub – Service Worker pentru PWA
   Versiune: 1.0.0
   Descriere: Cache-are resurse statice, rute API și pagini EJS pentru
              funcționare offline parțială pe platforma GastroHub.
   =========================================================================== */

const CACHE_VERSION = 'gastrohub-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;

// ---------------------------------------------------------------------------
// Resurse pre-cache la instalare
// ---------------------------------------------------------------------------
const PRECACHE_URLS = [
  '/',
  '/customer',
  '/customer/css/style.css',
  '/customer/js/app.js',
  '/manifest.json',
  '/icons/icon-48x48.png',
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png',
  '/icons/shortcut-orders.png',
  '/icons/shortcut-menu.png',
  '/icons/shortcut-reservations.png',
];

// ---------------------------------------------------------------------------
// Instalare – deschide cache-urile și adaugă resursele pre-definite
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  console.log('[SW] Instalare service worker...');

  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS).then(() => {
        console.log('[SW] Resurse pre-cache adăugate cu succes.');
      }).catch((err) => {
        console.warn('[SW] Eroare la pre-cache:', err);
      });
    }).then(() => {
      // Forțează activarea imediată, fără a aștepta
      return self.skipWaiting();
    })
  );
});

// ---------------------------------------------------------------------------
// Activare – curăță cache-urile vechi
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  console.log('[SW] Activare service worker...');

  const validCaches = [STATIC_CACHE, API_CACHE, PAGE_CACHE];

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (!validCaches.includes(cacheName)) {
            console.log('[SW] Ștergere cache vechi:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Preia controlul imediat al paginilor deschise
      return self.clients.claim();
    })
  );
});

// ---------------------------------------------------------------------------
// Interceptare fetch – strategii hibride
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Nu interceptăm request-uri către alte origini
  if (url.origin !== self.location.origin) {
    return;
  }

  // --- Strategia 1: Cache First pentru resurse statice (JS, CSS, imagini, fonts) ---
  if (
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'image' ||
    request.destination === 'font' ||
    url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/i)
  ) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }

  // --- Strategia 2: Network First pentru pagini EJS (navigare) ---
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirst(event.request, PAGE_CACHE));
    return;
  }

  // --- Strategia 3: Network First pentru API calls ---
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(event.request, API_CACHE));
    return;
  }

  // --- Strategia 4: Cache First cu fallback network pentru orice altceva ---
  event.respondWith(cacheFirst(event.request, STATIC_CACHE));
});

// ===========================================================================
// Strategii de cache
// ===========================================================================

/**
 * Cache First – încearcă din cache, dacă nu găsește face request la rețea.
 * Potrivit pentru resurse statice care nu se schimbă des.
 */
async function cacheFirst(request, cacheName) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(cacheName);
      // Nu cache-uim răspunsuri care nu sunt OK
      if (networkResponse.type === 'basic') {
        cache.put(request, networkResponse.clone());
      }
    }
    return networkResponse;
  } catch (error) {
    // Fallback: încearcă orice variantă cache-uire
    const fallback = await caches.match('/offline.html');
    if (fallback) {
      return fallback;
    }
    // Ultim fallback – un răspuns gol
    return new Response('Eroare de rețea - GastroHub offline', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

/**
 * Network First – încearcă rețeaua, dacă eșuează servește din cache.
 * Potrivit pentru pagini și API-uri unde prospețimea contează.
 */
async function networkFirst(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(cacheName);
      if (networkResponse.type === 'basic') {
        cache.put(request, networkResponse.clone());
      }
    }
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    // Dacă e navigare, returnează pagina principală din cache
    if (request.mode === 'navigate') {
      const fallbackPage = await caches.match('/');
      if (fallbackPage) {
        return fallbackPage;
      }
    }
    return new Response('GastroHub offline - Conținutul nu este disponibil momentan.', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

/**
 * Stale While Revalidate – returnează din cache și actualizează în fundal.
 * Potrivit pentru resurse care se schimbă dar nu critic.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse && networkResponse.ok && networkResponse.type === 'basic') {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => cachedResponse);

  return cachedResponse || fetchPromise;
}

// ===========================================================================
// Gestionare mesaje (din pagină)
// ===========================================================================
self.addEventListener('message', (event) => {
  if (!event.data) return;

  const { type, payload } = event.data;

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'CLEAR_CACHE':
      caches.keys().then((keys) => {
        return Promise.all(keys.map((k) => caches.delete(k)));
      }).then(() => {
        console.log('[SW] Toate cache-urile au fost șterse.');
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ status: 'cleared' });
        }
      });
      break;

    case 'CACHE_VERSION':
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ version: CACHE_VERSION });
      }
      break;

    default:
      console.log('[SW] Mesaj necunoscut:', type);
  }
});

// ===========================================================================
// Sincronizare fundal (Background Sync)
// ===========================================================================
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-orders') {
    event.waitUntil(syncOrders());
  }
  if (event.tag === 'sync-reservations') {
    event.waitUntil(syncReservations());
  }
});

/**
 * Sincronizează comenzi neprocesate (exemplu schelet).
 */
async function syncOrders() {
  console.log('[SW] Sincronizare comenzi...');
  // TODO: implementare reală cu IndexedDB
}

/**
 * Sincronizează rezervări neprocesate (exemplu schelet).
 */
async function syncReservations() {
  console.log('[SW] Sincronizare rezervări...');
  // TODO: implementare reală cu IndexedDB
}

// ===========================================================================
// Notificări push (schelet)
// ===========================================================================
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'GastroHub', body: 'Notificare nouă' };
  }

  const options = {
    body: data.body || 'Ai o notificare nouă în GastroHub.',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/',
    },
    actions: [
      { action: 'open', title: 'Deschide' },
      { action: 'close', title: 'Închide' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || 'GastroHub',
      options
    )
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') return;

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Dacă există deja o fereastră deschisă, focus-eaz-o
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(urlToOpen);
          return;
        }
      }
      // Altfel, deschide una nouă
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});