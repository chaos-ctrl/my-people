// Service worker: caches the app's own files so it opens fast and offline.
// It never touches GitHub API requests, so your people are never cached.
// Bump VERSION when the list of files changes.

const VERSION = 'my-people-v2';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/css/app.css',
  'assets/fonts/bricolage-latin.woff2',
  'assets/fonts/bricolage-latin-ext.woff2',
  'assets/icons/icon.svg',
  'assets/icons/icon-192.png',
  'src/app/theme.js',
  'src/app/main.js',
  'src/app/dom.js',
  'src/app/github.js',
  'src/app/store.js',
  'src/app/vault.js',
  'src/app/views/auth.js',
  'src/app/views/home.js',
  'src/app/views/picker.js',
  'src/app/views/settings.js',
  'src/app/views/sheet.js',
  'src/app/views/charts.js',
  'src/app/views/weekly.js',
  'src/app/views/insights.js',
  'src/app/views/imports.js',
  'src/app/actions.js',
  'src/core/dates.js',
  'src/core/model.js',
  'src/core/person-file.js',
  'src/core/review.js',
  'src/core/settings.js',
  'src/core/text.js',
  'src/core/yaml-edit.js',
  'src/core/followups.js',
  'src/core/gifts.js',
  'src/core/logbook.js',
  'src/core/contact-links.js',
  'src/core/rhythm.js',
  'src/core/trips.js',
  'src/core/insights.js',
  'src/vendor/yaml.js',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Same-origin GETs only: answer from the cache at once and refresh it in the background
// (stale-while-revalidate), so updates to the app arrive on the next visit.
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(caches.open(VERSION).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then(res => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || fresh;
  }));
});
