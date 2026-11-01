/* Massi Fars · Service Worker
   هەر وەشانێکی نوێ: تەنها VERSION بگۆڕە (و mf-build لە index.html).
   وەشانی نوێ دادەبەزێت و چاوەڕێ دەکات؛ تەنها کاتێک بەکارهێنەر «نوێ بکەرەوە» دەکات چالاک دەبێت. */
const VERSION = 'V1.0.1';
const CACHE = 'mf-' + VERSION;
const SCOPE = self.registration.scope;

self.addEventListener('install', function (e) {
  /* نابێت skipWaiting بکەین: وەشانی نوێ چاوەڕێ دەکات هەتا بەکارهێنەر ڕازی بێت */
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return fetch(new Request(SCOPE + 'index.html', { cache: 'reload' })).then(function (r) {
        if (!r || !r.ok) throw new Error('page fetch failed');
        return c.put(SCOPE, r);
      });
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k.indexOf('mf-') === 0 && k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* تەنها کردنەوەی لاپەڕەکە: لە cache (وەشانی ئێستا)، ئەگەر نەبوو لە ئینتەرنێت */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.mode !== 'navigate') return;
  e.respondWith(
    caches.open(CACHE).then(function (c) { return c.match(SCOPE); })
      .then(function (hit) { return hit || fetch(req); })
  );
});
