/* Massi Fars · Service Worker (پەیوەندی لەگەڵ سیستەمی ئەپدێتی ناو index.html)
   index.html لەم SW دەپرسێت:  STATUS  /  CHECK  /  ACTIVATE  (بە MessageChannel).
   - لاپەڕەی ئێستا لە cache دەکرێتەوە (ptr). وەشانی نوێ دادەبەزێت و وەک "pending" چاوەڕێ دەکات.
   - تەنها کاتێک ACTIVATE بێت (بەکارهێنەر «نوێکردنەوە ئێستا» بکات) ptr دەگۆڕدرێت و وەشانی نوێ دەکرێتەوە.
   هەر وەشانێکی نوێ: تەنها mf-build لە index.html بگۆڕە (VERSION ی خوارەوەش بگۆڕە بۆ ئەوەی براوزەر SW نوێ بکاتەوە). */
const VERSION = 'V1.0.7';
const PAGES = 'mf-pages', META = 'mf-meta';
const SCOPE = self.registration.scope;
const PTR = SCOPE + '__mf/ptr', PEND = SCOPE + '__mf/pending';
const pageKey = function (id) { return SCOPE + '__mf/page/' + id; };

async function getJ(key) {
  const c = await caches.open(META), r = await c.match(key);
  if (!r) return null;
  try { return await r.json(); } catch (e) { return null; }
}
async function setJ(key, v) {
  const c = await caches.open(META);
  if (v == null) { await c.delete(key); return; }
  await c.put(key, new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } }));
}
function hex(buf) { return Array.from(new Uint8Array(buf)).map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }

/* دابەزاندنی index.html ی نوێ و پاشەکەوتکردنی بە ناسنامەی ناوەڕۆکەکەی */
async function fetchPage() {
  const r = await fetch(new Request(SCOPE + 'index.html', { cache: 'reload' }));
  if (!r || !r.ok) throw new Error('page fetch failed');
  const buf = await r.arrayBuffer();
  const id = hex(await crypto.subtle.digest('SHA-256', buf)).slice(0, 20);
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 8192)));
  const m = /name=["']mf-build["']\s+content=["']([^"']*)["']/.exec(head);
  const pc = await caches.open(PAGES);
  await pc.put(pageKey(id), new Response(buf, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  return { id: id, label: m ? m[1] : '' };
}
async function prune() {
  const ptr = await getJ(PTR), pend = await getJ(PEND), keep = {};
  if (ptr) keep[pageKey(ptr.id)] = 1;
  if (pend) keep[pageKey(pend.id)] = 1;
  const pc = await caches.open(PAGES), ks = await pc.keys();
  await Promise.all(ks.filter(function (k) { return !keep[k.url]; }).map(function (k) { return pc.delete(k); }));
}
async function status() { return { ptr: await getJ(PTR), pending: await getJ(PEND) }; }

async function check() {
  try {
    const p = await fetchPage(), ptr = await getJ(PTR);
    if (!ptr) { await setJ(PTR, { id: p.id, label: p.label, at: Date.now() }); await setJ(PEND, null); }
    else if (ptr.id === p.id) await setJ(PEND, null);
    else await setJ(PEND, { id: p.id, label: p.label, at: Date.now() });
    await prune();
  } catch (e) { /* ئۆفلاین: هەمان دۆخی پێشوو دەگەڕێنرێتەوە */ }
  return status();
}
async function activate(id, label) {
  const pend = await getJ(PEND);
  if (!pend || (id && pend.id !== id)) return { ok: false };
  const pc = await caches.open(PAGES);
  if (!(await pc.match(pageKey(pend.id)))) return { ok: false };
  await setJ(PTR, { id: pend.id, label: pend.label || label || '', at: Date.now() });
  await setJ(PEND, null);
  await prune();
  return { ok: true };
}

self.addEventListener('install', function (e) {
  self.skipWaiting();                       /* خودی SW بە خێرایی دەگۆڕێت؛ وەشانی ئەپەکە تەنها بە ACTIVATE دەگۆڕێت */
  e.waitUntil(check());
});
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k !== PAGES && k !== META; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});
self.addEventListener('message', function (e) {
  const d = e.data || {}, port = e.ports && e.ports[0];
  if (d.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (!port) return;
  const run = d.type === 'CHECK' ? check() : d.type === 'STATUS' ? status() : d.type === 'ACTIVATE' ? activate(d.id, d.label) : null;
  if (!run) return;
  e.waitUntil(run.then(function (r) { port.postMessage(r); }, function () { port.postMessage(null); }));
});

/* کردنەوەی لاپەڕەکە: وەشانی ئێستا (ptr) لە cache، ئەگەر نەبوو لە ئینتەرنێت */
self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.mode !== 'navigate') return;
  e.respondWith((async function () {
    const ptr = await getJ(PTR), pc = await caches.open(PAGES);
    if (ptr) { const hit = await pc.match(pageKey(ptr.id)); if (hit) return hit; }
    try { return await fetch(req); }
    catch (err) {
      const ks = await pc.keys();
      if (ks.length) { const any = await pc.match(ks[0]); if (any) return any; }
      throw err;
    }
  })());
});
