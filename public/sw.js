const CACHE_VERSION = 'v1';
const STATIC_CACHE = `1p-static-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/dashboard.html',
  '/login.html',
  '/signup.html',
  '/courses.html',
  '/community.html',
  '/resources.html',
  '/profile.html',
  '/events.html',
  '/invite.html',
  '/affiliate.html',
  '/goal-planning.html',
  '/styles.css',
  '/assets/academy-logo.png',
  '/assets/academy-logo.svg',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/js/firebase.js',
  '/js/auth.js',
  '/js/app.js',
  '/js/hub.js',
  '/js/topbar.js',
  '/js/community.js',
  '/js/community-page.js',
  '/js/courses-page.js',
  '/js/courses-data.js',
  '/js/courses-registry.js',
  '/js/enrollments.js',
  '/js/roles.js',
  '/js/store.js',
  '/js/modules.js',
  '/js/referral.js',
  '/js/profile-page.js',
  '/js/events-page.js',
  '/js/capacitor-bridge.js',
  '/js/register-sw.js'
];

// Never cache — always go to network
const NETWORK_ONLY_ORIGINS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'us-central1-the-1p-leadership.cloudfunctions.net',
  'stripe.com',
  'js.stripe.com',
  'googletagmanager.com',
  'google-analytics.com'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (NETWORK_ONLY_ORIGINS.some((o) => url.hostname.includes(o))) return;

  // Firebase CDN SDK — versioned and immutable, safe to cache forever
  if (url.hostname === 'www.gstatic.com') {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Google Fonts — cache after first fetch
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Local app assets — cache-first with offline fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(event.request, clone));
        }
        return res;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('/dashboard.html');
        }
      });
    })
  );
});

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const fetchPromise = fetch(request).then((res) => {
    if (res.ok) {
      const clone = res.clone();
      caches.open(STATIC_CACHE).then((c) => c.put(request, clone));
    }
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}
