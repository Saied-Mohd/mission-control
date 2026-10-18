// Mission Control service worker.
// - Precaches the app shell (bump VERSION on every deploy).
// - Network-first for navigations/HTML, cache-first for static assets.
// - NEVER caches /api/ (local server) or api.github.com (it only handles same-origin GETs).
// - Shows push notifications and routes clicks back into the app.

const VERSION = 'mc-v0.1.0';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './deck-frame.html',
  './css/app.css',
  './js/app.js',
  './js/adapters.js',
  './js/crypto.js',
  './js/model.js',
  './js/palette.js',
  './js/push.js',
  './js/session.js',
  './js/store.js',
  './js/ui.js',
  './js/deck-frame.js',
  './js/views/activity.js',
  './js/views/approvals.js',
  './js/views/auth.js',
  './js/views/brain.js',
  './js/views/common.js',
  './js/views/dashboard.js',
  './js/views/deck.js',
  './js/views/inbox.js',
  './js/views/project.js',
  './js/views/radar.js',
  './js/views/settings.js',
  './js/views/vault.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/badge-96.png',
];

const scopeUrl = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      // One missing optional file (e.g. brain.js not shipped yet) must not break install.
      await Promise.allSettled(SHELL.map((p) => cache.add(new Request(scopeUrl(p), { cache: 'reload' }))));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('mc-shell-') && k !== VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'skipWaiting') self.skipWaiting();
});

function bypass(url) {
  if (url.origin !== self.location.origin) return true; // api.github.com and anything else: network only, untouched
  const scopePath = new URL(self.registration.scope).pathname;
  const rel = url.pathname.startsWith(scopePath) ? url.pathname.slice(scopePath.length) : url.pathname;
  if (rel.startsWith('api/') || url.pathname.includes('/api/')) return true; // local server API: never cache
  if (rel.startsWith('deck/')) return true; // live deck from mc serve
  return false;
}

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req.mode === 'navigate' ? scopeUrl('./') : req, res.clone());
    return res;
  } catch (e) {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' && ((await cache.match(scopeUrl('./'))) || (await cache.match(scopeUrl('./index.html')))));
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (bypass(url)) return;
  const isHtml = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  event.respondWith(isHtml ? networkFirst(req) : cacheFirst(req));
});

// ---------------- push ----------------

async function updateBadge(explicit) {
  if (!self.navigator?.setAppBadge) return;
  try {
    const n = typeof explicit === 'number' ? explicit : (await self.registration.getNotifications()).length;
    if (n > 0) await self.navigator.setAppBadge(n);
    else await self.navigator.clearAppBadge();
  } catch {}
}

async function broadcast(msg) {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of all) c.postMessage(msg);
}

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data ? event.data.text() : '' };
  }
  const title = String(d.title || 'Mission Control').slice(0, 120);
  const opts = {
    body: String(d.body || '').slice(0, 400),
    icon: scopeUrl('./icons/icon-192.png'),
    badge: scopeUrl('./icons/badge-96.png'),
    data: { url: d.url || '#/', kind: d.kind || null },
    requireInteraction: d.kind === 'request',
    timestamp: Date.now(),
  };
  if (d.tag) {
    opts.tag = String(d.tag);
    opts.renotify = true;
  }
  if (d.urgency === 'high' || d.kind === 'request') opts.vibrate = [80, 40, 80];
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, opts);
      await updateBadge(typeof d.badge === 'number' ? d.badge : undefined);
      await broadcast({ type: 'push', kind: d.kind || null });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(
    (async () => {
      await updateBadge();
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const scope = self.registration.scope;
      const client = all.find((c) => c.url.startsWith(scope) && 'focus' in c);
      if (client) {
        try {
          await client.focus();
        } catch {}
        client.postMessage({ type: 'navigate', url: target });
        return;
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })(),
  );
});

self.addEventListener('notificationclose', (event) => {
  event.waitUntil(updateBadge());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // The new subscription needs the app (unlocked) to save it to DOC.pushSubs; tell open windows.
  event.waitUntil(broadcast({ type: 'pushsubscriptionchange' }));
});
