/* Massi Fars · Service Worker — سیستەمی نوێکردنەوەی ڕاستەقینە
   index.html لەم SW دەپرسێت:  STATUS / CHECK / ACTIVATE / RESET  (بە MessageChannel)
   و SW ڕاپۆرتی ڕاستەقینەی دابەزاندن (MF_PROGRESS) بۆ لاپەڕە دەنێرێت.

   چۆنیەتی کارکردن:
   1. پشکنین (CHECK) تەنها چەند کیلۆبایتی سەرەتای index.html دەخوێنێتەوە بۆ ئەوەی mf-build بزانێت (نەک ٣.٣ مێگابایت).
   2. تەنها ئەگەر وەشانەکە جیاواز بوو، فایلی تەواو دادەبەزێنرێت، پشکنین دەکرێت (قەبارە، کۆتایی </html>، mf-build) و وەک «pending» دەمێنێتەوە.
   3. هەموو کارەکان بە ڕیز (exclusive) ڕادەکرێن، بۆیە دوو پشکنین هیچ کات یەکتر تێک نادەن.
   4. تەنها ACTIVATE (کاتێک بەکارهێنەر «نوێکردنەوە ئێستا» دەکات) وەشانی ئەپەکە دەگۆڕێت.
   5. ڕزگارکردن: ئەگەر ئەپەکە گیرا، ?mf_reset=1 لە کۆتایی ناونیشان زیاد بکە.

   هەر وەشانێکی نوێ: mf-build لە index.html + changelog.json + VERSION ی خوارەوە (بۆ ئەوەی براوزەر SW نوێ بکاتەوە). */
const VERSION = 'V1.0.41';
const PAGES = 'mf-pages', META = 'mf-meta';
const SCOPE = self.registration.scope;
const PTR = SCOPE + '__mf/ptr', PEND = SCOPE + '__mf/pending';
const pageKey = function (id) { return SCOPE + '__mf/page/' + id; };
const MIN_BYTES = 100000;
const SBU = 'https://wtzffmorfclxivopvsit.supabase.co', SBK = 'sb_publishable_YDz--eVlnrTgZJ6hKJwLig_bzY1-Fjg';
const LABEL_RE = /name=["']mf-build["']\s+content=["']([^"']*)["']/;

let queue = Promise.resolve();   /* هەموو گۆڕانکارییەکان بە ڕیز */
let checkP = null;               /* هەر کاتێک تەنها یەک پشکنین */
let working = null, lastError = '';

function exclusive(fn) {
  const run = queue.then(fn, fn);
  queue = run.then(function () {}, function () {});
  return run;
}
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
function labelOf(text) { const m = LABEL_RE.exec(text); return m ? m[1] : ''; }
async function tell(msg) {
  try {
    const cs = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    cs.forEach(function (c) { c.postMessage(msg); });
  } catch (e) {}
}
function readT(rd, ms) {
  return new Promise(function (res, rej) {
    const t = setTimeout(function () { rej(new Error('stalled')); }, ms);
    rd.read().then(function (x) { clearTimeout(t); res(x); }, function (e) { clearTimeout(t); rej(e); });
  });
}

/* خوێندنەوەی تەنها سەرەتای index.html بۆ زانینی mf-build (چەند کیلۆبایت) */
async function probe() {
  const ctl = new AbortController(), timer = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 15000);
  try {
    const r = await fetch(SCOPE + 'index.html?mfv=' + Date.now(), { cache: 'no-store', signal: ctl.signal });
    if (!r.ok || !r.body) throw new Error('probe ' + r.status);
    const rd = r.body.getReader(), dec = new TextDecoder();
    let txt = '', n = 0;
    for (;;) {
      const x = await rd.read();
      if (x.done) break;
      txt += dec.decode(x.value, { stream: true }); n += x.value.length;
      if (LABEL_RE.test(txt) || n > 16384) break;
    }
    try { rd.cancel(); } catch (e) {}
    try { ctl.abort(); } catch (e) {}
    return labelOf(txt);
  } finally { clearTimeout(timer); }
}

/* دابەزاندنی تەواوی فایل، لەگەڵ ڕاپۆرتی ڕاستەقینە */
function relFetch(src) {
  return fetch(SBU + '/rest/v1/rpc/get_release', { method: 'POST', headers: { apikey: SBK, Authorization: 'Bearer ' + SBK, 'Content-Type': 'application/json', Accept: 'text/plain' }, body: JSON.stringify({ p_rid: src.rid }), cache: 'no-store' });
}
async function download(expected, src) {
  const r = src ? await relFetch(src) : await fetch(SCOPE + 'index.html?mfv=' + Date.now(), { cache: 'reload' });
  if (!r.ok || !r.body) throw new Error('http ' + r.status);
  const enc = r.headers.get('content-encoding'), cl = +r.headers.get('content-length') || 0;
  const est = (!enc && cl) ? cl : (expected || 0);
  const rd = r.body.getReader(), parts = [];
  let got = 0, last = -2;
  try {
    for (;;) {
      const x = await readT(rd, 30000);
      if (x.done) break;
      parts.push(x.value); got += x.value.length;
      const pct = est ? Math.min(97, Math.floor(got / est * 100)) : -1;
      working = { stage: 'download', got: got, total: est };
      if (pct !== last) { last = pct; tell({ type: 'MF_PROGRESS', stage: 'download', pct: pct, got: got, total: est }); }
    }
  } catch (e) { try { rd.cancel(); } catch (x) {} throw e; }
  if (!src && !enc && cl && got !== cl) throw new Error('incomplete');
  let buf = new Uint8Array(got); let o = 0;
  parts.forEach(function (p) { buf.set(p, o); o += p.length; });
  if (src) {                                                            /* وەڵامی RPC: دەقی سادە یان JSON string */
    let t = new TextDecoder().decode(buf);
    if (t.charAt(0) === '"') t = JSON.parse(t);
    if (!t || t === 'null') throw new Error('release missing');
    buf = new TextEncoder().encode(t);
  }
  return buf;
}

/* پشکنینی ئەوەی دابەزێنراوە: تەواو، کۆتایی </html>، mf-build ی ڕاست */
function verify(buf, label) {
  if (buf.length < MIN_BYTES) throw new Error('too small');
  const head = new TextDecoder().decode(buf.subarray(0, 16384));
  const tail = new TextDecoder().decode(buf.subarray(Math.max(0, buf.length - 512)));
  if (tail.toLowerCase().indexOf('</html>') < 0) throw new Error('truncated');
  const l = labelOf(head);
  if (!l) throw new Error('no mf-build');
  if (label && l !== label) throw new Error('label mismatch ' + l + ' vs ' + label);
  return l;
}

async function prune() {
  const ptr = await getJ(PTR), pend = await getJ(PEND), keep = {};
  if (ptr) keep[pageKey(ptr.id)] = 1;
  if (pend) keep[pageKey(pend.id)] = 1;
  const pc = await caches.open(PAGES), ks = await pc.keys();
  await Promise.all(ks.filter(function (k) { return !keep[k.url]; }).map(function (k) { return pc.delete(k); }));
}
async function status() {
  return { ptr: await getJ(PTR), pending: await getJ(PEND), ver: VERSION, busy: working ? working.stage : '', err: lastError };
}

async function doCheck(src) {
  working = { stage: 'probe' }; lastError = '';
  try {
    const ptr = await getJ(PTR), pend = await getJ(PEND), pc = await caches.open(PAGES);
    const ptrOk = !!(ptr && await pc.match(pageKey(ptr.id)));
    const pendOk = !!(pend && await pc.match(pageKey(pend.id)));
    if (pend && !pendOk) await setJ(PEND, null);                       /* فایلی pending ی لەناوچوو */
    const live = src ? src.ver : await probe();
    if (!live) throw new Error('mf-build not found on server');
    if (ptr && ptrOk && !newer(live, ptr.label)) { await setJ(PEND, null); await prune(); return; }   /* وەشانی سێرڤەر نوێتر نییە: هیچ ناگۆڕدرێت */
    if (ptr && ptrOk && ptr.label === live) { await setJ(PEND, null); await prune(); return; }   /* هەمان وەشان */
    if (pend && pendOk && pend.label === live) return;                 /* پێشتر ئامادە کراوە */
    if (pend && pendOk && !newer(live, pend.label) && pend.label !== live) { /* pending ی نوێتر هەیە */ return; }
    const buf = await download((src && src.size) || (ptr && ptr.size) || (pend && pend.size) || 0, src);
    working = { stage: 'verify' };
    tell({ type: 'MF_PROGRESS', stage: 'verify', pct: 98 });
    const l = verify(buf, live);
    const id = hex(await crypto.subtle.digest('SHA-256', buf)).slice(0, 20);
    if (ptr && ptrOk && ptr.id === id) { await setJ(PEND, null); await prune(); return; }
    await pc.put(pageKey(id), new Response(buf, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    const rec = { id: id, label: l, at: Date.now(), size: buf.length };
    if (!ptr || !ptrOk) { await setJ(PTR, rec); await setJ(PEND, null); }   /* یەکەم جار، یان cache ی کۆن نەما */
    else await setJ(PEND, rec);
    await prune();
    tell({ type: 'MF_PROGRESS', stage: 'ready', pct: 100 });
  } catch (e) {
    lastError = String((e && e.message) || e);                          /* ئۆفلاین یان کێشە: هیچ شتێک ناگۆڕێت */
  } finally { working = null; }
}
let checkKey = '';
function check(src) {
  const key = src ? src.rid : '';
  if (!checkP || checkKey !== key) { checkKey = key; const p = exclusive(function () { return doCheck(src); }).then(function () { if (checkP === p) checkP = null; }, function () { if (checkP === p) checkP = null; }); checkP = p; }
  return checkP;
}

async function doActivate(id, label) {
  const pend = await getJ(PEND);
  if (!pend || (id && pend.id !== id)) return { ok: false, why: 'nopending' };
  const pc = await caches.open(PAGES), hit = await pc.match(pageKey(pend.id));
  if (!hit) { await setJ(PEND, null); return { ok: false, why: 'missing' }; }
  const buf = new Uint8Array(await hit.arrayBuffer());                  /* دووبارە پشکنینی ئەوەی لە cache هەیە */
  try { verify(buf, pend.label); }
  catch (e) { await setJ(PEND, null); await pc.delete(pageKey(pend.id)); return { ok: false, why: 'corrupt' }; }
  const lb = pend.label || label || '';
  await setJ(PTR, { id: pend.id, label: lb, at: Date.now(), size: pend.size || buf.length });
  await setJ(PEND, null);
  await prune();
  return { ok: true, label: lb };
}
async function hardReset() {
  await caches.delete(PAGES); await caches.delete(META);
  try { await self.registration.unregister(); } catch (e) {}
  return { ok: true };
}

self.addEventListener('install', function () { self.skipWaiting(); });
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
  let run = null;
  if (d.type === 'CHECK') run = check(d.src && d.src.rid && d.src.ver ? d.src : null).then(status);
  else if (d.type === 'STATUS') run = status();
  else if (d.type === 'ACTIVATE') run = exclusive(function () { return doActivate(d.id, d.label); });
  else if (d.type === 'RESET') run = hardReset();
  if (!run) return;
  e.waitUntil(run.then(function (r) { port.postMessage(r); }, function () { port.postMessage(null); }));
});

/* ئەپدێتی خۆکار لە کاتی کردنەوەی ئەپەکە: ئەگەر وەشانی نوێ پێشتر دابەزێنرابێت و ئادمین ناردبێتی، هەر ئێستا دەمەزرێت و بەکارهێنەر ڕاستەوخۆ وەشانی نوێ دەبینێت (بێ نیشاندانی ئەپی کۆن) */
function vnum(v) { return String(v || '').replace(/[^0-9.]/g, '').split('.').map(function (x) { return parseInt(x, 10) || 0; }); }
function newer(a, b) { if (!b) return true; const x = vnum(a), y = vnum(b), n = Math.max(x.length, y.length); for (let k = 0; k < n; k++) { const p = x[k] || 0, q = y[k] || 0; if (p !== q) return p > q; } return false; }
async function probeQuick(ms) {
  return Promise.race([probe().catch(function () { return ''; }), new Promise(function (r) { setTimeout(function () { r(''); }, ms); })]);
}
async function instantPromote() {
  const ptr = await getJ(PTR); if (!ptr) return;
  let pend = await getJ(PEND);
  if (!(pend && newer(pend.label, ptr.label))) {
    const live = await probeQuick(1500);                                 /* لەسەر GitHub وەشانی نوێتر هەیە؟ */
    if (!live || !newer(live, ptr.label)) return;
    await Promise.race([check(null), new Promise(function (r) { setTimeout(r, 12000); })]);
    pend = await getJ(PEND);
  }
  if (!pend || !newer(pend.label, ptr.label)) return;
  await exclusive(function () { return doActivate(pend.id, pend.label); });
}

/* کردنەوەی لاپەڕەکە: وەشانی ئێستا (ptr) لە cache، ئەگەر نەبوو لە ئینتەرنێت */
self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.mode !== 'navigate') return;
  let url; try { url = new URL(req.url); } catch (x) { return; }
  /* V1.0.35: تەنها پەڕەی سەرەکی ئەپ (/ یان index.html) لێرە دەگیرێت. پەڕەکانی تر وەک order.html (پەڕەی گشتی) ڕاستەوخۆ لە ئینتەرنێتەوە دەکرێنەوە */
  if (!/(^|\/)(index\.html)?$/.test(url.pathname)) return;
  if (url.searchParams.has('mf_reset')) {                               /* ڕزگارکردن: cache و SW دەسڕێتەوە و لە ئینتەرنێت دەکرێتەوە */
    e.respondWith(hardReset().then(function () { return fetch(url.origin + url.pathname, { cache: 'reload' }); }, function () { return fetch(req); }));
    return;
  }
  e.respondWith((async function () {
    try { await instantPromote(); } catch (x) {}
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

/* ===== V1.0.26/27 · Push / ئاگادارکردنەوە (Supabase send-push) ===== */
self.addEventListener('push', function (e) {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  const urgent = !!d.urgent;
  e.waitUntil(self.registration.showNotification(d.title || 'Massi Fars', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag,
    icon: 'icon-192.png', badge: 'icon-192.png', dir: 'rtl', lang: 'ku',
    vibrate: urgent ? [200, 100, 200, 100, 200] : [120, 60, 120],
    requireInteraction: urgent, data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  let url = SCOPE;
  try { url = new URL((e.notification.data && e.notification.data.url) || './', SCOPE).href; } catch (x) {}
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    for (const c of cs) { if ('focus' in c) { c.postMessage({ type: 'MF_PUSH_OPEN', url: url }); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
self.addEventListener('pushsubscriptionchange', function (e) {
  e.waitUntil(tell({ type: 'MF_PUSH_RESUB' }));
});
