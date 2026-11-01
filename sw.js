// Fonctionne hors ligne : l'appli et le module Firebase sont mis en cache.
// Les échanges avec la base Firestore ne passent jamais par le cache.
const VERSION = 'dressage-v1';
const COQUILLE = ['./', 'index.html', 'app.js', 'exercices.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Fichiers de l'appli : réseau d'abord (pour recevoir les mises à jour), cache en secours.
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(r => { const copie = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copie)); return r; })
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
    );
    return;
  }

  // Module Firebase (versionné, immuable) : cache d'abord.
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(res => {
        const copie = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copie)); return res;
      }))
    );
  }
});
