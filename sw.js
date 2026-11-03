/* Massi Fars · Service Worker  (V1.0.4)
   ئەم فایلە لەگەڵ سکریپتی mf-sw-register ی index.html ڕێک دەکەوێت:
   پەیامەکان: STATUS · CHECK · ACTIVATE
   - وەشانی ئێستا (ptr) لە cache ـی mfp-<id> ڕادەگیرێت
   - وەشانی نوێ دادەبەزێت و وەک pending دەوەستێت هەتا بەکارهێنەر «نوێکردنەوە» بکات
   هەر وەشانێکی نوێ: mf-build لە index.html بگۆڕە (و changelog.json). */
const VERSION = 'V1.0.2';
const SCOPE = self.registration.scope;
const META = 'mf-meta';
const META_KEY = SCOPE + '__mf_meta';
const PAGE = SCOPE + 'index.html';

/* ───────── meta: ptr = وەشانی ئێستا، pending = وەشانی دابەزیوی چاوەڕێکراو ───────── */
async function getMeta() {
  try {
    const c = await caches.open(META);
    const r = await c.match(META_KEY);
    if (r) { const j = await r.json(); return { ptr: j.ptr || null, pending: j.pending || null }; }
  } catch (e) {}
  return { ptr: null, pending: null };
}
async function setMeta(m) {
  const c = await caches.open(META);
  await c.put(META_KEY, new Response(JSON.stringify(m), { headers: { 'Content-Type': 'application/json' } }));
}
function buildOf(txt) {
  const m = /name="mf-build"\s+content="([^"]+)"/.exec(txt || '');
  return m ? m[1] : '';
}

/* تەنها سەرەتای لاپەڕە دەخوێنێتەوە بۆ زانینی mf-build (نەک ٣ مێگابایتەکە) */
async function peekBuild() {
  const ctl = new AbortController();
  const t = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 8000);
  try {
    const r = await fetch(PAGE + '?mfv=' + Date.now(), { cache: 'no-store', signal: ctl.signal, headers: { Range: 'bytes=0-8191' } });
    if (!r || !(r.ok || r.status === 206)) return '';
    let txt = '';
    if (r.body && r.body.getReader) {
      const rd = r.body.getReader(), dec = new TextDecoder();
      let n = 0;
      for (;;) {
        const x = await rd.read();
        if (x.done) break;
        txt += dec.decode(x.value, { stream: true }); n += x.value.length;
        if (buildOf(txt) || n > 12000) break;
      }
      try { ctl.abort(); } catch (e) {}
    } else { txt = (await r.text()).slice(0, 12000); }
    return buildOf(txt);
  } catch (e) { return ''; } finally { clearTimeout(t); }
}

async function downloadPage() {
  const r = await fetch(new Request(PAGE + '?mfv=' + Date.now(), { cache: 'reload' }));
  if (!r || !r.ok) throw new Error('page fetch failed');
  const txt = await r.clone().text();
  const id = String(Date.now());
  const c = await caches.open('mfp-' + id);
  await c.put(SCOPE, r);
  return { id: id, label: buildOf(txt) };
}

/* ───────── install / activate ───────── */
self.addEventListener('install', function (e) {
  /* وەشانی لاپەڕە لە meta ـدایە، نەک لە کۆدی SW، بۆیە skipWaiting ئارامە */
  self.skipWaiting();
  e.waitUntil((async function () {
    const m = await getMeta();
    if (m.ptr) return;                       /* پێشتر وەشانێک هەیە: دەستی لێ نادەین */
    const p = await downloadPage();          /* یەکەم جار / گواستنەوە لە SW ی کۆن: نوێترین وەشان دابنێ */
    await setMeta({ ptr: p, pending: null });
  })());
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    const m = await getMeta();
    const keep = {};
    if (m.ptr) keep['mfp-' + m.ptr.id] = 1;
    if (m.pending) keep['mfp-' + m.pending.id] = 1;
    const ks = await caches.keys();
    await Promise.all(ks.filter(function (k) {
      if (k === META) return false;
      if (k.indexOf('mfp-') === 0) return !keep[k];
      return k.indexOf('mf-') === 0;         /* cache ـی کۆنی mf-V1.0.1 و هاوشێوەکانی */
    }).map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

/* ───────── پەیامەکانی لاپەڕە ───────── */
async function status() { const m = await getMeta(); return { ptr: m.ptr, pending: m.pending }; }

async function check() {
  const m = await getMeta();
  const srv = await peekBuild();
  if (!srv) return status();                              /* ئینتەرنێت نییە یان خوێندنەوە نەکرا */
  if (m.ptr && srv === m.ptr.label) {                     /* هەمان وەشانە: pending ی کۆن بسڕەوە */
    if (m.pending) { await caches.delete('mfp-' + m.pending.id); m.pending = null; await setMeta(m); }
    return status();
  }
  if (m.pending && m.pending.label === srv) return status();   /* پێشتر دابەزێنراوە */
  const p = await downloadPage();
  if (m.ptr && p.label === m.ptr.label) { await caches.delete('mfp-' + p.id); return status(); }
  if (m.pending) await caches.delete('mfp-' + m.pending.id);
  m.pending = p;
  if (!m.ptr) { m.ptr = p; m.pending = null; }
  await setMeta(m);
  return status();
}

async function activate(id) {
  const m = await getMeta();
  if (!m.pending || (id && m.pending.id !== id)) return { ok: false };
  const old = m.ptr;
  m.ptr = m.pending; m.pending = null;
  await setMeta(m);
  if (old && old.id !== m.ptr.id) await caches.delete('mfp-' + old.id);
  return { ok: true, label: m.ptr.label };
}

self.addEventListener('message', function (e) {
  const d = e.data || {};
  if (d.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  const port = e.ports && e.ports[0];
  function reply(v) { try { if (port) port.postMessage(v); } catch (x) {} }
  var job;
  if (d.type === 'STATUS') job = status();
  else if (d.type === 'CHECK') job = check();
  else if (d.type === 'ACTIVATE') job = activate(d.id);
  else return;
  e.waitUntil(job.then(reply, function () { reply(null); }));
});

/* ───────── کردنەوەی لاپەڕە: لە وەشانی ئێستا (ptr)، ئەگەر نەبوو لە ئینتەرنێت ───────── */
self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.mode !== 'navigate') return;
  const base = new URL(SCOPE).pathname, p = new URL(req.url).pathname;
  if (p !== base && p !== base + 'index.html') return;
  e.respondWith((async function () {
    try {
      const m = await getMeta();
      if (m.ptr) {
        const c = await caches.open('mfp-' + m.ptr.id);
        const hit = await c.match(SCOPE);
        if (hit) return hit;
      }
    } catch (x) {}
    return fetch(req);
  })());
});
