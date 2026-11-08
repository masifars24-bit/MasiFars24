/* Massi Fars · سیستەمی ئامێر: کامێرا، مایکرۆفۆن، شوێن، لەرزین، Push (Supabase)
   ئەم کۆدە لە index.html دا وەک سکریپتی mf-device-js دانراوە. هیچ ستایلێکی ئەپەکە ناگۆڕێت
   و هیچ شتێک نیشان نادات تا خۆت بانگی بکەیت. کلیلەکانی localStorage بە mfd_ دەست پێدەکەن، بۆیە
   لەگەڵ سێرڤەر ناگونجێنرێن (هەر ئامێرێک ڕێکخستنی تایبەتی خۆی هەیە). */
(function () {
  'use strict';
  if (window.MFDevice || window.__MF_VIEWER) return;

  var CFG = {
    url: 'https://wtzffmorfclxivopvsit.supabase.co',
    key: 'sb_publishable_YDz--eVlnrTgZJ6hKJwLig_bzY1-Fjg',
    vapidPublicKey: '',            /* <-- کلیلی گشتی VAPID لێرە دابنێ (لە README ڕوون کراوەتەوە) */
    pushFunction: 'send-push',
    bucket: 'mf-media',
    photoMaxSide: 1600, photoQuality: 0.82,
    audioMaxMs: 120000,
    locMinMs: 15000, locMinMeters: 15
  };
  try { if (window.MFD_CONFIG) for (var k in window.MFD_CONFIG) CFG[k] = window.MFD_CONFIG[k]; } catch (e) {}

  var LS = window.localStorage, D = document;
  var T = {
    noauth: 'سەرەتا لە پانێڵی «گونجاندن لەگەڵ سێرڤەر» بچۆ ژوورەوە، پاشان دووبارە هەوڵبدەرەوە.',
    denied: 'ڕێگەپێدان ڕەتکراوەتەوە. لە ڕێکخستنەکانی وێبگەڕ یان ئامێرەکەت چالاکی بکە.',
    nodev: 'ئامێری پێویست نەدۆزرایەوە.',
    busy: 'ئامێرەکە لەلایەن ئەپێکی تر بەکاردێت.',
    insecure: 'ئەم تایبەتمەندییە تەنها لە لینکی HTTPS کار دەکات.',
    unsup: 'ئەم وێبگەڕە پشتگیری ئەم تایبەتمەندییە ناکات.',
    ios: 'لە iPhone دەبێت سەرەتا ئەپەکە بە «Add to Home Screen» دابمەزرێنیت، پاشان ئاگادارکردنەوە چالاک بکەیت.',
    novapid: 'کلیلی VAPID دانەنراوە. بڕوانە README.',
    fail: 'کارەکە سەرکەوتوو نەبوو: '
  };

  /* ---------- یاریدەدەرەکان ---------- */
  function jget(k, d) { try { var v = LS.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lset(k, v) { try { LS.setItem(k, v); } catch (e) {} }
  function dlg(msg, title, type) {
    try { if (window.mfDialog) return window.mfDialog.alert(msg, { title: title || 'ئاگادارکردنەوە', type: type || 'info' }); } catch (e) {}
    try { alert(msg); } catch (e) {} return Promise.resolve();
  }
  function deviceId() {
    var m = jget('mf_sync_meta', null);
    if (m && m.device) return m.device;
    var id = LS.getItem('mfd_device');
    if (!id) { id = 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); lset('mfd_device', id); }
    return id;
  }
  function token() {
    if (window.__mfSync && window.__mfSync.token) return window.__mfSync.token();
    return Promise.reject(new Error('NOAUTH'));
  }
  function who() {
    return token().then(function (t) {
      var p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return { id: JSON.parse(atob(p)).sub, tok: t };
    });
  }
  function rest(path, opt) {
    return token().then(function (tok) {
      opt = opt || {};
      opt.headers = Object.assign({ apikey: CFG.key, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, opt.headers || {});
      return fetch(CFG.url + path, opt).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 160)); });
        return r.status === 204 ? null : r.json().catch(function () { return null; });
      });
    });
  }
  function fail(e, quiet) {
    var m = String((e && e.message) || e);
    if (m === 'NOAUTH') m = T.noauth; else m = T.fail + m.slice(0, 160);
    if (!quiet) dlg(m, 'هەڵە', 'err');
    return null;
  }
  function mediaErr(e, quiet) {
    var n = e && e.name, m = T.fail + String((e && e.message) || e).slice(0, 120);
    if (!window.isSecureContext) m = T.insecure;
    else if (n === 'NotAllowedError' || n === 'SecurityError') m = T.denied;
    else if (n === 'NotFoundError' || n === 'OverconstrainedError') m = T.nodev;
    else if (n === 'NotReadableError' || n === 'AbortError') m = T.busy;
    if (!quiet) dlg(m, 'هەڵە', 'err');
    return null;
  }
  function sup() {
    var md = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return {
      secure: !!window.isSecureContext, ios: ios,
      standalone: (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true,
      camera: md, mic: md && !!window.MediaRecorder, location: 'geolocation' in navigator,
      vibrate: 'vibrate' in navigator,
      push: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    };
  }
  function perm(name) {
    if (name === 'notifications' && window.Notification) return Promise.resolve(Notification.permission === 'default' ? 'prompt' : Notification.permission);
    try { return navigator.permissions.query({ name: name }).then(function (r) { return r.state; }, function () { return 'unknown'; }); }
    catch (e) { return Promise.resolve('unknown'); }
  }

  /* ---------- ستایلی ناوخۆیی (تەنها کاتێک پێویست بێت دەخرێتە ناو پەڕە) ---------- */
  function css() {
    if (D.getElementById('mfd-css')) return;
    var s = D.createElement('style'); s.id = 'mfd-css';
    s.textContent =
      '.mfd-ov{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;direction:rtl;font-family:var(--main-font,inherit);color:#fff;background:#000}' +
      '.mfd-ov video{flex:1;min-height:0;width:100%;object-fit:cover;background:#000}' +
      '.mfd-bar{display:flex;align-items:center;justify-content:space-around;gap:12px;padding:16px 16px calc(16px + env(safe-area-inset-bottom,0px));background:rgba(0,0,0,.55)}' +
      '.mfd-btn{width:52px;height:52px;border-radius:50%;border:0;background:rgba(255,255,255,.18);color:#fff;font:800 12px var(--main-font,inherit);cursor:pointer}' +
      '.mfd-btn.on{background:var(--c-1,#4f46e5)}' +
      '.mfd-shoot{width:72px;height:72px;background:#fff;border:5px solid rgba(255,255,255,.4);background-clip:padding-box}' +
      '.mfd-rec{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;flex:1;padding:24px;background:linear-gradient(160deg,#0f172a,#312e81)}' +
      '.mfd-time{font:900 44px var(--main-font,inherit);direction:ltr;letter-spacing:2px}' +
      '.mfd-lvl{width:min(280px,80vw);height:10px;border-radius:10px;background:rgba(255,255,255,.2);overflow:hidden;direction:ltr}' +
      '.mfd-lvl i{display:block;height:100%;width:0;background:var(--c-1,#38bdf8);transition:width .1s}' +
      '.mfd-sh{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;background:rgba(0,0,0,.45);direction:rtl;font-family:var(--main-font,inherit)}' +
      '.mfd-card{width:100%;max-height:85vh;overflow:auto;border-radius:22px 22px 0 0;background:var(--bg-color,#fff);color:var(--text-main,#09090b);padding:16px 14px calc(16px + env(safe-area-inset-bottom,0px))}' +
      '.mfd-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-weight:900;font-size:16px}' +
      '.mfd-x{border:0;background:var(--surface,#f4f4f5);color:var(--text-main,#09090b);width:32px;height:32px;border-radius:10px;font-size:16px;cursor:pointer}' +
      '.mfd-row{display:flex;align-items:center;gap:10px;padding:11px 12px;margin-bottom:8px;border:1.5px solid var(--border,#e4e4e7);border-radius:14px;background:var(--surface,#fafafa)}' +
      '.mfd-row b{flex:1;font-size:14px;font-weight:800}' +
      '.mfd-row small{display:block;font-size:11.5px;font-weight:700;color:var(--text-sub,#71717a)}' +
      '.mfd-act{border:0;border-radius:11px;padding:8px 12px;background:var(--c-1,#4f46e5);color:#fff;font:800 12.5px var(--main-font,inherit);cursor:pointer}' +
      '.mfd-act[disabled]{opacity:.5}' +
      '.mfd-act.alt{background:var(--border,#e4e4e7);color:var(--text-main,#09090b)}';
    D.head.appendChild(s);
  }
  function el(tag, cls, txt, on) {
    var n = D.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt;
    if (on) n.addEventListener('click', on); return n;
  }

  /* ---------- لەرزین ---------- */
  var PAT = { tap: 8, select: 6, success: [30, 40, 30], warn: [60, 60, 60], error: [120, 60, 120, 60, 200], ring: [300, 150, 300, 150, 300], urgent: [200, 100, 200, 100, 200] };
  var vibrate = {
    supported: function () { return 'vibrate' in navigator; },
    enabled: function () { return LS.getItem('mfd_vibrate') !== '0'; },
    setEnabled: function (on) { lset('mfd_vibrate', on ? '1' : '0'); if (on) vibrate.play('tap'); },
    play: function (p) {
      if (!vibrate.enabled() || !vibrate.supported()) return false;
      try { return navigator.vibrate(typeof p === 'string' ? (PAT[p] || PAT.tap) : p); } catch (e) { return false; }
    },
    stop: function () { try { navigator.vibrate(0); } catch (e) {} }
  };

  /* ---------- وێنە: کامێرا ---------- */
  function toJpeg(src, w, h) {
    var m = CFG.photoMaxSide, sc = Math.min(1, m / Math.max(w, h)), c = D.createElement('canvas');
    c.width = Math.round(w * sc); c.height = Math.round(h * sc);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return new Promise(function (res) {
      c.toBlob(function (b) { res(b ? { blob: b, width: c.width, height: c.height, mime: 'image/jpeg', url: URL.createObjectURL(b) } : null); }, 'image/jpeg', CFG.photoQuality);
    });
  }
  function pickFile(o) {
    return new Promise(function (res) {
      var i = D.createElement('input'); i.type = 'file'; i.accept = 'image/*';
      i.setAttribute('capture', (o && o.facing === 'user') ? 'user' : 'environment');
      i.onchange = function () {
        var f = i.files && i.files[0]; if (!f) return res(null);
        createImageBitmap(f, { imageOrientation: 'from-image' }).then(function (bm) { return toJpeg(bm, bm.width, bm.height); }).then(res, function () { res(null); });
      };
      i.addEventListener('cancel', function () { res(null); });
      i.click();
    });
  }
  function capture(o) {
    o = o || {};
    if (!sup().camera) return pickFile(o);
    css();
    var facing = o.facing || 'environment', stream = null, track = null, torchOn = false;
    var ov = el('div', 'mfd-ov'), v = D.createElement('video');
    v.setAttribute('playsinline', ''); v.muted = true;
    var bar = el('div', 'mfd-bar');
    var bClose = el('button', 'mfd-btn', 'داخستن'), bShoot = el('button', 'mfd-btn mfd-shoot'), bFlip = el('button', 'mfd-btn', 'گۆڕین'), bTorch = el('button', 'mfd-btn', 'فلاش');
    bTorch.style.display = 'none';
    bar.append(bClose, bShoot, bFlip, bTorch); ov.append(v, bar); D.body.appendChild(ov);
    function stop() { if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; } }
    function start() {
      stop();
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(function (s) {
        stream = s; track = s.getVideoTracks()[0]; v.srcObject = s; torchOn = false; bTorch.classList.remove('on');
        var cap = track.getCapabilities ? track.getCapabilities() : {};
        bTorch.style.display = cap.torch ? '' : 'none';
        return v.play().catch(function () {});
      });
    }
    return new Promise(function (res) {
      function done(r) { stop(); ov.remove(); res(r); }
      bClose.onclick = function () { done(null); };
      bFlip.onclick = function () { facing = facing === 'user' ? 'environment' : 'user'; start().catch(function (e) { mediaErr(e); done(null); }); };
      bTorch.onclick = function () {
        torchOn = !torchOn; bTorch.classList.toggle('on', torchOn);
        try { track.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch (e) {}
      };
      bShoot.onclick = function () {
        if (!v.videoWidth) return;
        vibrate.play('tap');
        toJpeg(v, v.videoWidth, v.videoHeight).then(done);
      };
      start().catch(function (e) { mediaErr(e); done(null); });
    });
  }

  /* ---------- Supabase Storage + media_items ---------- */
  function ext(m) { return /png/.test(m) ? 'png' : /webp/.test(m) ? 'webp' : /jpe?g/.test(m) ? 'jpg' : /mp4|aac|m4a/.test(m) ? 'm4a' : /ogg/.test(m) ? 'ogg' : /mpeg/.test(m) ? 'mp3' : 'webm'; }
  var media = {
    upload: function (blob, o) {
      o = o || {};
      return who().then(function (u) {
        var mime = String(blob.type || 'application/octet-stream').split(';')[0];
        var path = u.id + '/' + (o.kind || 'file') + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.' + ext(mime);
        return fetch(CFG.url + '/storage/v1/object/' + CFG.bucket + '/' + path, {
          method: 'POST', body: blob,
          headers: { apikey: CFG.key, Authorization: 'Bearer ' + u.tok, 'Content-Type': mime, 'x-upsert': 'false', 'cache-control': 'max-age=31536000' }
        }).then(function (r) {
          if (!r.ok) return r.text().then(function (t) { throw new Error('upload ' + r.status + ' ' + t.slice(0, 120)); });
          return rest('/rest/v1/media_items', {
            method: 'POST', headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ device_id: deviceId(), kind: o.kind || 'file', path: path, mime: mime, size_bytes: blob.size, duration_ms: o.durationMs || null, ref_type: o.refType || null, ref_id: o.refId != null ? String(o.refId) : null, note: o.note || null })
          });
        }).then(function (rows) { return (rows && rows[0]) || { path: path }; });
      }).catch(fail);
    },
    signedUrl: function (path, secs) {
      return rest('/storage/v1/object/sign/' + CFG.bucket + '/' + path, { method: 'POST', body: JSON.stringify({ expiresIn: secs || 3600 }) })
        .then(function (j) { return CFG.url + '/storage/v1' + j.signedURL; }).catch(function (e) { return fail(e, true); });
    },
    list: function (f) {
      f = f || {};
      var q = '?select=*&order=created_at.desc&limit=' + (f.limit || 50);
      if (f.kind) q += '&kind=eq.' + encodeURIComponent(f.kind);
      if (f.refType) q += '&ref_type=eq.' + encodeURIComponent(f.refType);
      if (f.refId != null) q += '&ref_id=eq.' + encodeURIComponent(String(f.refId));
      return rest('/rest/v1/media_items' + q).catch(function (e) { return fail(e, true) || []; });
    },
    remove: function (item) {
      return rest('/storage/v1/object/' + CFG.bucket + '/' + item.path, { method: 'DELETE' })
        .then(function () { return rest('/rest/v1/media_items?id=eq.' + encodeURIComponent(item.id), { method: 'DELETE' }); })
        .then(function () { return true; }, function (e) { return fail(e) || false; });
    }
  };
  var camera = {
    supported: function () { return sup().camera; },
    capture: capture,
    captureAndUpload: function (o) {
      return capture(o).then(function (p) {
        if (!p) return null;
        return media.upload(p.blob, Object.assign({ kind: 'photo' }, o || {})).then(function (row) { return row ? Object.assign({ local: p }, row) : null; });
      });
    }
  };

  /* ---------- مایکرۆفۆن ---------- */
  function pickMime() {
    var c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < c.length; i++) { try { if (MediaRecorder.isTypeSupported(c[i])) return c[i]; } catch (e) {} }
    return '';
  }
  function micStart(o) {
    o = o || {};
    if (!sup().mic) { dlg(T.unsup, 'هەڵە', 'err'); return Promise.resolve(null); }
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      var mime = pickMime(), rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      var chunks = [], t0 = Date.now(), cancelled = false, ac = null, timer = null, auto = null;
      try {
        var AC = window.AudioContext || window.webkitAudioContext; ac = new AC();
        var an = ac.createAnalyser(); an.fftSize = 256; ac.createMediaStreamSource(stream).connect(an);
        var buf = new Uint8Array(an.fftSize);
        timer = setInterval(function () {
          an.getByteTimeDomainData(buf); var m = 0;
          for (var i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i] - 128));
          if (o.onLevel) o.onLevel(Math.min(1, m / 90), Date.now() - t0);
        }, 100);
      } catch (e) {}
      var done = new Promise(function (res) {
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          clearInterval(timer); clearTimeout(auto); stream.getTracks().forEach(function (t) { t.stop(); });
          try { ac && ac.close(); } catch (e) {}
          var type = rec.mimeType || mime || 'audio/webm';
          res(cancelled || !chunks.length ? null : { blob: new Blob(chunks, { type: type }), durationMs: Date.now() - t0, mime: type });
        };
      });
      rec.start(1000);
      auto = setTimeout(function () { if (rec.state !== 'inactive') rec.stop(); }, o.maxMs || CFG.audioMaxMs);
      return {
        done: done,
        stop: function () { if (rec.state !== 'inactive') rec.stop(); return done; },
        cancel: function () { cancelled = true; if (rec.state !== 'inactive') rec.stop(); return done; }
      };
    }).catch(function (e) { return mediaErr(e); });
  }
  function fmtT(ms) { var s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
  function recordUI(o) {
    css();
    var ov = el('div', 'mfd-ov'), box = el('div', 'mfd-rec'), tm = el('div', 'mfd-time', '00:00'), lv = el('div', 'mfd-lvl'), li = D.createElement('i');
    lv.appendChild(li); box.append(tm, lv);
    var bar = el('div', 'mfd-bar'), bCancel = el('button', 'mfd-btn', 'پاشگەز'), bStop = el('button', 'mfd-btn mfd-shoot', 'تەواو');
    bStop.style.color = '#09090b'; bar.append(bCancel, bStop); ov.append(box, bar); D.body.appendChild(ov);
    return micStart(Object.assign({}, o, { onLevel: function (l, ms) { li.style.width = Math.round(l * 100) + '%'; tm.textContent = fmtT(ms); } })).then(function (c) {
      if (!c) { ov.remove(); return null; }
      vibrate.play('tap');
      bCancel.onclick = function () { c.cancel(); };
      bStop.onclick = function () { c.stop(); };
      return c.done.then(function (r) { ov.remove(); if (r) vibrate.play('success'); return r; });
    });
  }
  var mic = {
    supported: function () { return sup().mic; },
    start: micStart, recordUI: recordUI,
    recordAndUpload: function (o) {
      return recordUI(o).then(function (r) {
        if (!r) return null;
        return media.upload(r.blob, Object.assign({ kind: 'audio', durationMs: r.durationMs }, o || {})).then(function (row) { return row ? Object.assign({ local: r }, row) : null; });
      });
    }
  };

  /* ---------- شوێن ---------- */
  function norm(p) { var c = p.coords; return { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, speed: c.speed, heading: c.heading, ts: p.timestamp }; }
  function geoErr(e, quiet) {
    var m = !window.isSecureContext ? T.insecure : e && e.code === 1 ? T.denied : e && e.code === 2 ? 'شوێن بەردەست نییە. GPS ی ئامێرەکەت بپشکنە.' : 'کاتی دۆزینەوەی شوێن تەواو بوو. دووبارە هەوڵبدەرەوە.';
    if (!quiet) dlg(m, 'شوێن', 'err');
    return null;
  }
  function dist(a, b) {
    var R = 6371000, t = Math.PI / 180, dLa = (b.lat - a.lat) * t, dLo = (b.lng - a.lng) * t;
    var x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function row(p, o) { return { device_id: deviceId(), label: o.label || null, lat: p.lat, lng: p.lng, accuracy: p.accuracy, speed: p.speed, heading: p.heading, meta: o.meta || {}, recorded_at: new Date(p.ts || Date.now()).toISOString() }; }
  var locQ = jget('mfd_locq', []);
  function saveQ() { lset('mfd_locq', JSON.stringify(locQ.slice(-100))); }
  function flushQ() {
    if (!locQ.length || !navigator.onLine) return Promise.resolve();
    var batch = locQ.slice();
    return rest('/rest/v1/device_locations', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(batch) })
      .then(function () { locQ = locQ.slice(batch.length); saveQ(); }, function () {});
  }
  function sendLoc(p, o) { locQ.push(row(p, o)); saveQ(); return flushQ(); }
  window.addEventListener('online', function () { flushQ(); });
  var location_ = {
    supported: function () { return sup().location; },
    getOnce: function (o) {
      return new Promise(function (res) {
        if (!navigator.geolocation) { dlg(T.unsup, 'شوێن', 'err'); return res(null); }
        navigator.geolocation.getCurrentPosition(function (p) { res(norm(p)); }, function (e) { res(geoErr(e, o && o.quiet)); },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
      });
    },
    watch: function (cb, errCb) {
      if (!navigator.geolocation) return function () {};
      var id = navigator.geolocation.watchPosition(function (p) { cb(norm(p)); }, function (e) { geoErr(e, true); if (errCb) errCb(e); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
      return function () { navigator.geolocation.clearWatch(id); };
    },
    share: function (o) {
      o = o || {};
      return location_.getOnce().then(function (p) { return p ? sendLoc(p, o).then(function () { return p; }) : null; });
    },
    /* شوێن بەردەوام دەنێرێت تا ئەپەکە کراوەیە (وێب ناتوانێت لە پاشبنەما GPS بخوێنێتەوە) */
    track: function (o) {
      o = o || {}; var last = null, lastT = 0, lock = null, stopW;
      function wl() { try { if (navigator.wakeLock && !D.hidden) navigator.wakeLock.request('screen').then(function (l) { lock = l; }, function () {}); } catch (e) {} }
      function vis() { if (!D.hidden) wl(); }
      D.addEventListener('visibilitychange', vis); wl();
      stopW = location_.watch(function (p) {
        var now = Date.now();
        if (last && now - lastT < CFG.locMinMs && dist(last, p) < CFG.locMinMeters) return;
        last = p; lastT = now; sendLoc(p, o); if (o.onPoint) o.onPoint(p);
      });
      return { stop: function () { stopW(); D.removeEventListener('visibilitychange', vis); try { lock && lock.release(); } catch (e) {} } };
    },
    distance: dist,
    mapsLink: function (p) { return 'https://www.google.com/maps?q=' + p.lat + ',' + p.lng; },
    latest: function () { return rest('/rest/v1/latest_device_locations?select=*').catch(function (e) { return fail(e, true) || []; }); }
  };

  /* ---------- Push ---------- */
  function b64u8(s) {
    var b = (s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'), r = atob(b), u = new Uint8Array(r.length);
    for (var i = 0; i < r.length; i++) u[i] = r.charCodeAt(i); return u;
  }
  function sameKey(sub) {
    try {
      var a = new Uint8Array(sub.options.applicationServerKey), b = b64u8(CFG.vapidPublicKey);
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true;
    } catch (e) { return true; }
  }
  function saveSub(sub) {
    var j = sub.toJSON();
    return rest('/rest/v1/rpc/register_push_subscription', {
      method: 'POST',
      body: JSON.stringify({ p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_device_id: deviceId(), p_platform: sup().ios ? 'ios' : /android/i.test(navigator.userAgent) ? 'android' : 'desktop', p_ua: navigator.userAgent.slice(0, 200) })
    });
  }
  function getSub() { return navigator.serviceWorker.ready.then(function (r) { return r.pushManager.getSubscription(); }); }
  var push = {
    supported: function () { var s = sup(); return s.push && (!s.ios || s.standalone); },
    status: function () {
      var s = sup();
      if (!s.push) return Promise.resolve({ supported: false, needsInstall: s.ios && !s.standalone, permission: 'unsupported', subscribed: false });
      return getSub().then(function (sub) { return { supported: true, needsInstall: false, permission: Notification.permission, subscribed: !!sub && LS.getItem('mfd_push') === '1' }; });
    },
    enable: function () {
      var s = sup();
      if (!window.isSecureContext) { dlg(T.insecure, 'ئاگادارکردنەوە', 'err'); return Promise.resolve({ ok: false, reason: 'insecure' }); }
      if (s.ios && !s.standalone) { dlg(T.ios, 'ئاگادارکردنەوە'); return Promise.resolve({ ok: false, reason: 'ios-install' }); }
      if (!s.push) { dlg(T.unsup, 'ئاگادارکردنەوە', 'err'); return Promise.resolve({ ok: false, reason: 'unsupported' }); }
      if (!CFG.vapidPublicKey) { dlg(T.novapid, 'ئاگادارکردنەوە', 'err'); return Promise.resolve({ ok: false, reason: 'novapid' }); }
      return who().then(function () { return Notification.requestPermission(); }).then(function (p) {
        if (p !== 'granted') { if (p === 'denied') dlg(T.denied, 'ئاگادارکردنەوە', 'err'); return { ok: false, reason: p }; }
        return navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.getSubscription().then(function (sub) {
            if (sub && !sameKey(sub)) return sub.unsubscribe().then(function () { return null; });
            return sub;
          }).then(function (sub) {
            return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u8(CFG.vapidPublicKey) });
          });
        }).then(saveSub).then(function () { lset('mfd_push', '1'); lset('mfd_push_ts', String(Date.now())); return { ok: true }; });
      }).catch(function (e) { fail(e); return { ok: false, reason: 'error' }; });
    },
    disable: function () {
      return getSub().then(function (sub) {
        if (!sub) return null;
        var ep = sub.endpoint;
        return sub.unsubscribe().then(function () { return rest('/rest/v1/rpc/unregister_push_subscription', { method: 'POST', body: JSON.stringify({ p_endpoint: ep }) }); });
      }).then(function () { LS.removeItem('mfd_push'); return true; }, function (e) { fail(e); return false; });
    },
    /* ناردنی ئاگادارکردنەوە بۆ هەموو ئامێرەکانی هەمان هەژمار: {title, body, url, tag, urgent, excludeSelf, onlyThisDevice} */
    send: function (m) {
      m = m || {};
      return token().then(function (tok) {
        return fetch(CFG.url + '/functions/v1/' + CFG.pushFunction, {
          method: 'POST', headers: { apikey: CFG.key, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.tag, urgent: !!m.urgent, exclude_device: m.excludeSelf ? deviceId() : undefined, only_device: m.onlyThisDevice ? deviceId() : undefined })
        });
      }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); }).catch(function (e) { return fail(e); });
    },
    test: function () { return push.send({ title: 'Massi Fars', body: 'ئاگادارکردنەوەی تاقیکردنەوە کار دەکات', onlyThisDevice: true, tag: 'mfd-test' }); },
    /* هەموو ڕۆژێک یەک جار بەشداربوونەکە نوێ دەکاتەوە (ئەگەر وێبگەڕ endpoint ی گۆڕیبێت) */
    sync: function () {
      if (LS.getItem('mfd_push') !== '1' || !sup().push || !window.Notification || Notification.permission !== 'granted' || !CFG.vapidPublicKey) return Promise.resolve();
      if (Date.now() - (parseInt(LS.getItem('mfd_push_ts'), 10) || 0) < 86400000) return Promise.resolve();
      return getSub().then(function (sub) { return sub ? saveSub(sub) : push.enable(); }).then(function () { lset('mfd_push_ts', String(Date.now())); }).catch(function () {});
    }
  };
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (e) {
      var d = e.data || {};
      if (d.type === 'MF_PUSH_OPEN') {
        try { window.dispatchEvent(new CustomEvent('mfd:pushopen', { detail: d })); } catch (x) {}
        try { var h = new URL(d.url, location.href).hash; if (h && h.length > 1) location.hash = h; } catch (x) {}
      } else if (d.type === 'MF_PUSH_RESUB') { LS.removeItem('mfd_push_ts'); push.sync(); }
    });
  }

  /* ---------- پانێڵی مۆڵەتەکان (ئارەزوومەندانە) ---------- */
  function openPanel() {
    css();
    var sh = el('div', 'mfd-sh'), card = el('div', 'mfd-card'), h = el('div', 'mfd-h');
    h.append(el('span', '', 'ڕێگەپێدانی ئامێر'), el('button', 'mfd-x', '✕', function () { sh.remove(); }));
    card.appendChild(h); sh.appendChild(card);
    sh.addEventListener('click', function (e) { if (e.target === sh) sh.remove(); });
    D.body.appendChild(sh);
    var S = { granted: 'چالاکە', denied: 'ڕێگەپێنەدراوە', prompt: 'هێشتا داوا نەکراوە', unknown: 'نەزانراو', unsupported: 'پشتگیری ناکرێت' };
    var items = [
      { n: 'کامێرا', ok: sup().camera, q: function () { return perm('camera'); }, go: function () { return navigator.mediaDevices.getUserMedia({ video: true }).then(function (s) { s.getTracks().forEach(function (t) { t.stop(); }); }, mediaErr); } },
      { n: 'مایکرۆفۆن', ok: sup().mic, q: function () { return perm('microphone'); }, go: function () { return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) { s.getTracks().forEach(function (t) { t.stop(); }); }, mediaErr); } },
      { n: 'شوێن', ok: sup().location, q: function () { return perm('geolocation'); }, go: function () { return location_.getOnce(); } },
      { n: 'ئاگادارکردنەوە', ok: sup().push, q: function () { return perm('notifications'); }, go: function () { return push.enable(); }, extra: function () { return push.status().then(function (s) { return s.subscribed ? 'بەشداربووی' : (s.needsInstall ? 'پێویستە ئەپەکە دابمەزرێنیت' : ''); }); } },
      { n: 'لەرزین', ok: sup().vibrate, q: function () { return Promise.resolve(vibrate.enabled() ? 'granted' : 'denied'); }, go: function () { vibrate.setEnabled(!vibrate.enabled()); return Promise.resolve(); }, label: function () { return vibrate.enabled() ? 'کوژاندنەوە' : 'چالاککردن'; } }
    ];
    items.forEach(function (it) {
      var r = el('div', 'mfd-row'), t = el('b', ''), st = el('small', ''), b = el('button', 'mfd-act', it.label ? it.label() : 'چالاککردن');
      t.textContent = it.n; t.appendChild(st); r.append(t, b); card.appendChild(r);
      function paint() {
        if (!it.ok) { st.textContent = S.unsupported; b.disabled = true; return; }
        it.q().then(function (s) {
          st.textContent = S[s] || S.unknown;
          if (it.extra) it.extra().then(function (x) { if (x) st.textContent += ' · ' + x; });
          if (it.label) b.textContent = it.label();
          b.classList.toggle('alt', s === 'granted' && !it.label);
        });
      }
      b.onclick = function () { b.disabled = true; Promise.resolve(it.go()).then(function () { b.disabled = false; paint(); }, function () { b.disabled = false; paint(); }); };
      paint();
    });
    return sh;
  }

  window.MFDevice = {
    version: '1.0', config: CFG, support: sup, permission: perm, deviceId: deviceId,
    camera: camera, mic: mic, location: location_, vibrate: vibrate, push: push, media: media,
    openPanel: openPanel
  };

  /* لە کاتی کردنەوەی ئەپەکە، بەشداربوونی Push پشکنین */
  setTimeout(function () { try { push.sync(); flushQ(); } catch (e) {} }, 6000);
})();
