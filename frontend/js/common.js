/* Shared helpers for every page. */
(function () {
  'use strict';

  async function api(path, opts) {
    opts = opts || {};
    const o = { method: opts.method || 'GET', headers: { 'X-Requested-With': 'rsvp' }, credentials: 'same-origin' };
    if (opts.raw) { o.headers['Content-Type'] = opts.raw.type; o.body = opts.raw; }
    else if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
    let r;
    try { r = await fetch('/api' + path, o); }
    catch (e) { const err = new Error('No connection. Check your internet and try again.'); err.status = 0; throw err; }
    let data = null;
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) { const err = new Error((data && data.error) || 'Something went wrong.'); err.status = r.status; throw err; }
    return data;
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');

  /* ---------- dates ---------- */
  function parseDate(d) { if (!d) return null; const dt = new Date(d + 'T00:00:00'); return isNaN(dt) ? null : dt; }
  function fmtDate(d, short) {
    const dt = parseDate(d); if (!dt) return d || '';
    return dt.toLocaleDateString('en-IN', short ? { day: 'numeric', month: 'short' } : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  function fmtTime(t) {
    if (!t) return '';
    const p = t.split(':'), h = +p[0], m = +p[1] || 0;
    return ((h + 11) % 12 + 1) + ':' + String(m).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
  }
  /* "Wednesday, 10 February 2027 at 4:00 PM" */
  const when = (f) => { const d = fmtDate(f.date), t = fmtTime(f.time); return d && t ? d + ' at ' + t : d || t; };
  /* day number, short month, weekday for the big date marker */
  function dayParts(d) {
    const dt = parseDate(d); if (!dt) return null;
    return { d: dt.getDate(), m: dt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }), w: dt.toLocaleDateString('en-IN', { weekday: 'long' }) };
  }
  function daysUntil(d) {
    const dt = parseDate(d); if (!dt) return null;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.round((dt - now) / 86400000);
  }

  let tt;
  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
    el.innerHTML = '<span>' + esc(msg) + '</span>';
    clearTimeout(tt); tt = setTimeout(() => { el.innerHTML = ''; }, 3200);
  }

  /* ---------- motion ---------- */
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const shown = {};
  /* Count numbers up from what the viewer last saw. Elements carry data-count and data-key. */
  function runCounts(root) {
    root.querySelectorAll('[data-count]').forEach((el) => {
      const to = +el.dataset.count, key = el.dataset.key, from = shown[key] == null ? 0 : shown[key];
      const fmt = (v) => el.dataset.fmt === 'inr' ? inr(v) : String(Math.round(v));
      shown[key] = to;
      if (reduce || from === to) { el.textContent = fmt(to); return; }
      const t0 = performance.now(), dur = 1000;
      (function step(t) {
        const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(from + (to - from) * e);
        if (p < 1) requestAnimationFrame(step);
      })(t0);
    });
  }
  /* Bars and stacks grow to data-w once painted. */
  function growBars(root) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.querySelectorAll('[data-w]').forEach((i) => { i.style.width = i.dataset.w + '%'; });
    }));
  }
  /* Quiet scroll reveals. Anything marked data-reveal fades in once as it nears the screen.
     With reduced motion, or no IntersectionObserver, nothing is hidden in the first place (see theme.js and app.css). */
  let io = null;
  function reveal(root) {
    const els = (root || document).querySelectorAll('[data-reveal]:not(.in)');
    if (!document.documentElement.classList.contains('rv') || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    if (!io) io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -7% 0px', threshold: 0.08 });
    els.forEach((e) => io.observe(e));
  }
  window.addEventListener('beforeprint', () => document.querySelectorAll('[data-reveal]').forEach((e) => e.classList.add('in')));

  /* ---------- theme ---------- */
  const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';
  function toggleTheme() {
    const root = document.documentElement, next = isDark() ? 'light' : 'dark';
    root.classList.add('theming');
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('rsvp-theme', next); } catch (e) {}
    setTimeout(() => root.classList.remove('theming'), 650);
    return next;
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (x) {}
      ta.remove(); return ok;
    }
  }

  /* ---------- artwork ----------
     Every invitation gets its own illustrated niche until the hosts add a real photo. Same seed, same picture. */
  const PALETTES = [
    { a: '#fde8b4', b: '#f6b3c6', p1: '#c23b66', p2: '#e2a21b', ink: '#7a2547' },   // marigold into rose
    { a: '#cdeef0', b: '#cbc4f5', p1: '#1d7881', p2: '#e2a21b', ink: '#1d4f67' },   // peacock into indigo
    { a: '#dcefd5', b: '#fddf9c', p1: '#46794f', p2: '#c23b66', ink: '#2f5a37' },   // mehendi into marigold
    { a: '#dcd8fb', b: '#fbd0dc', p1: '#4b3fa6', p2: '#e2a21b', ink: '#3d3394' }    // indigo into rose
  ];
  function hash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let s = seed || 1; return () => { s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909); s ^= s >>> 16; return (s >>> 0) / 4294967296; }; }
  let artN = 0;
  function art(seed) {
    const h = hash(seed), P = PALETTES[h % PALETTES.length], rnd = rng(h), n = ++artN;
    const arch = (x, y, w, hgt) => 'M' + x + ',' + (y + hgt) + 'V' + (y + w / 2) + 'A' + (w / 2) + ',' + (w / 2) + ' 0 0 1 ' + (x + w) + ',' + (y + w / 2) + 'V' + (y + hgt) + 'Z';
    let petals = '', ring = '', stars = '', scallops = '';
    const petalCount = 8 + (h % 3) * 2;
    for (let i = 0; i < petalCount; i++) {
      const ang = (360 / petalCount) * i;
      petals += '<ellipse cx="0" cy="-27" rx="8.5" ry="25" transform="rotate(' + ang + ')" fill="' + (i % 2 ? P.p2 : P.p1) + '" fill-opacity=".92"/>';
    }
    for (let i = 0; i < 24; i++) { const a = (Math.PI * 2 / 24) * i; ring += '<circle cx="' + (Math.cos(a) * 66).toFixed(1) + '" cy="' + (Math.sin(a) * 66).toFixed(1) + '" r="2.2" fill="' + P.ink + '" fill-opacity=".45"/>'; }
    for (let i = 0; i < 16; i++) { stars += '<circle cx="' + (14 + rnd() * 272).toFixed(0) + '" cy="' + (14 + rnd() * 120).toFixed(0) + '" r="' + (0.8 + rnd() * 1.4).toFixed(1) + '" fill="#fff" fill-opacity="' + (0.5 + rnd() * 0.4).toFixed(2) + '"/>'; }
    for (let i = 0; i < 7; i++) { scallops += '<path d="' + arch(8 + i * 42, 346, 38, 80) + '" fill="' + P.ink + '" fill-opacity="' + (i % 2 ? '.16' : '.1') + '"/>'; }
    return '<svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Decorative illustration of an arched doorway with a flower" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><linearGradient id="ga' + n + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + P.a + '"/><stop offset="1" stop-color="' + P.b + '"/></linearGradient>' +
      '<radialGradient id="gb' + n + '" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>' +
      '<rect width="300" height="400" fill="url(#ga' + n + ')"/>' + stars +
      '<circle cx="150" cy="178" r="118" fill="url(#gb' + n + ')"/>' +
      '<path d="' + arch(30, 40, 240, 380) + '" fill="#fff" fill-opacity=".34"/>' +
      '<path d="' + arch(60, 84, 180, 340) + '" fill="#fff" fill-opacity=".42"/>' +
      '<path d="' + arch(90, 128, 120, 300) + '" fill="#fff" fill-opacity=".62"/>' +
      '<path d="' + arch(60, 84, 180, 340) + '" fill="none" stroke="' + P.ink + '" stroke-opacity=".28" stroke-width="1.2"/>' +
      '<path d="' + arch(30, 40, 240, 380) + '" fill="none" stroke="' + P.ink + '" stroke-opacity=".2" stroke-width="1"/>' +
      '<g transform="translate(150 190)">' + ring + petals + '<circle r="11" fill="#fff"/><circle r="6.5" fill="' + P.p2 + '"/></g>' +
      scallops + '<rect x="0" y="392" width="300" height="8" fill="' + P.ink + '" fill-opacity=".18"/></svg>';
  }
  /* Arch frame holding either the uploaded photo or the artwork. */
  function archHTML(inv, opts) {
    opts = opts || {};
    const cls = 'arch' + (opts.cls ? ' ' + opts.cls : '');
    const inner = inv.cover && opts.photoUrl
      ? '<img src="' + esc(opts.photoUrl + '?v=' + inv.cover) + '" alt="' + esc(opts.alt || '') + '" decoding="async"' + (opts.eager ? '' : ' loading="lazy"') + '>'
      : art(opts.seed != null ? opts.seed : (inv.id || inv.title));
    return '<figure class="' + cls + '">' + inner + '</figure>';
  }
  /* The little arch used as the logo. */
  const MARK_SRC = '<svg class="mark" viewBox="0 0 26 30" aria-hidden="true"><defs><linearGradient id="mk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e2a21b"/><stop offset="1" stop-color="#c23b66"/></linearGradient></defs><path d="M2 29V13A11 11 0 0 1 24 13V29Z" fill="url(#mk)"/><path d="M7 29V14.5a6 6 0 0 1 12 0V29Z" fill="#fff" fill-opacity=".92"/><circle cx="13" cy="15" r="2.4" fill="#e2a21b"/></svg>';
  /* Each copy gets its own gradient id, so a mark inside a hidden element cannot break the visible one. */
  let markN = 0;
  const mark = () => MARK_SRC.replace(/\bmk\b/g, 'mk' + (++markN));

  /* ---------- photo → JPEG ----------
     Shrinks whatever the person picks to a JPEG of at most 1600 pixels, small enough to send quickly. */
  async function photoToJpeg(file) {
    if (!file || !/^image\//.test(file.type || '')) throw new Error('Choose a photo (JPEG or PNG).');
    let bmp = null;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {}
    if (!bmp) {
      bmp = await new Promise((ok, no) => {
        const url = URL.createObjectURL(file), im = new Image();
        im.onload = () => { URL.revokeObjectURL(url); ok(im); }; im.onerror = () => { URL.revokeObjectURL(url); no(new Error('That picture could not be opened. Try a JPEG or PNG.')); };
        im.src = url;
      });
    }
    const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight;
    if (w0 < 200 || h0 < 200) throw new Error('That photo is too small. Use one at least 200 pixels wide.');
    const k = Math.min(1, 1600 / Math.max(w0, h0)), w = Math.round(w0 * k), h = Math.round(h0 * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h);
    let q = 0.86, blob = null;
    do {
      blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q)); q -= 0.08;
    } while (blob && blob.size > 800 * 1024 && q > 0.4);
    if (!blob) throw new Error('That picture could not be prepared. Try another.');
    if (blob.size > 880 * 1024) throw new Error('That photo is too detailed to send. Try a smaller one.');
    return blob;
  }

  window.RSVP = { api, esc, inr, fmtDate, fmtTime, when, dayParts, daysUntil, toast, runCounts, growBars, reveal, isDark, toggleTheme, copy, reduce, art, archHTML, mark, photoToJpeg };
})();
