// Keeps a copy of the app's files so it opens and works offline.
// Bump VERSION whenever the app's files change, so phones fetch the new ones.

const VERSION = 'v1.0.0';
const CACHE = `learning-tester-${VERSION}`;
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/ui.js',
  'js/util.js',
  'js/store.js',
  'js/model.js',
  'js/sync.js',
  'js/scheduler.js',
  'js/importer.js',
  'js/rules.js',
  'js/match.js',
  'js/texts.js',
  'js/views/home.js',
  'js/views/review.js',
  'js/views/cards.js',
  'js/views/import.js',
  'js/views/settings.js',
  'vendor/ts-fsrs.mjs',
  'coach/INSTRUCTIONS.md',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

const isLocal = ['localhost', '127.0.0.1'].includes(self.location.hostname);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('learning-tester-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  // Only the app's own files; GitHub API calls go straight to the network.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/tests/')) return;

  if (isLocal) {
    // While developing on the Mac: always fetch fresh, fall back to the copy offline.
    event.respondWith(fetch(req).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit ?? fetch(req)),
  );
});
