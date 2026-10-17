// Offline cache (deploy.sh stamps V per release, so cards.json + art.bin + prints.bin + meta.json always come from one release):
// app shell + scanner engine + card DB (cache-first), Scryfall images (stale-while-revalidate, capped).
const V = 'cb-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'js/app.js', 'js/binder.js', 'js/carddb.js', 'js/csv.js', 'js/db.js', 'js/identify.js', 'js/loadcv.js', 'js/match.js', 'js/scry.js', 'js/vision.js', 'js/artindex.js', 'data/art.bin', 'js/printindex.js', 'js/record.js', 'js/liveworker.js', 'data/prints.bin', 'data/meta.json', 'js/meta.js', 'js/deckcheck.js', 'js/filters.js', 'js/picker.js', 'js/decks.js', 'js/ui.js',
  'vendor/opencv.js', 'vendor/tess/tesseract.min.js', 'vendor/tess/worker.min.js', 'vendor/tess/tesseract-core-simd-lstm.wasm.js', 'vendor/tess/tesseract-core-lstm.wasm.js', 'vendor/lang/eng.traineddata.gz', 'data/cards.json', 'icons/icon-192.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== 'cb-img').map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin === location.origin) {
    // network-first for the shell html/js so updates land quickly; cache fallback offline
    const big = /\/(vendor|data)\//.test(u.pathname);
    e.respondWith(big ? caches.open(V).then(c => c.match(e.request)).then(r => r || fetch(e.request).then(res => { const c = res.clone(); caches.open(V).then(x => x.put(e.request, c)); return res; }))
      : fetch(e.request).then(res => { const c = res.clone(); caches.open(V).then(x => x.put(e.request, c)); return res; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else if (u.hostname === 'cards.scryfall.io') {
    e.respondWith(caches.open('cb-img').then(async c => { const hit = await c.match(e.request); if (hit) return hit; const res = await fetch(e.request); if (res.ok || res.type === 'opaque') c.put(e.request, res.clone()); return res; }));
  }
});
