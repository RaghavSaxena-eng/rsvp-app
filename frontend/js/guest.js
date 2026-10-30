(function () {
  'use strict';
  const R = window.RSVP;
  const { api, esc, when, dayParts, daysUntil, archHTML, reveal } = R;
  const root = document.getElementById('g');
  const token = location.pathname.split('/').pop();
  const TONES = ['indigo', 'teal', 'rose', 'gold'];
  const LABEL = { yes: 'Coming', maybe: 'Maybe', no: "Can't come" };
  let data = null, draft = {}, note = '', sent = false;

  const themeBtn = '<button class="ib" id="theme" type="button" aria-label="Switch light and dark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>';
  const down = '<svg class="cue" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>';

  function shell(inner) {
    root.innerHTML = '<div class="g-bar"><span class="brand">' + R.mark() + 'RSVP Desk</span>' + themeBtn + '</div>' + inner;
    document.getElementById('theme').addEventListener('click', () => R.toggleTheme());
  }

  function countdown() {
    const dated = data.functions.filter((f) => f.date).map((f) => daysUntil(f.date)).filter((n) => n !== null && n >= 0);
    if (!dated.length) return '';
    const n = Math.min.apply(null, dated);
    return '<div class="countdown">' + (n === 0 ? '<b>Today</b><span>is the day</span>' : '<b class="num">' + n + '</b><span>' + (n === 1 ? 'day' : 'days') + ' to go</span>') + '</div>';
  }

  function hero() {
    const i = data.invitation;
    document.title = i.title + ', you are invited';
    return '<section class="g-hero">' +
      archHTML(i, { photoUrl: '/api/guest/' + encodeURIComponent(token) + '/cover', seed: i.title, cls: 'hero-arch', alt: 'Photo for ' + i.title, eager: true }) +
      '<p class="kick">You are invited</p>' +
      '<h1>' + esc(i.title) + '</h1>' +
      (i.hostLine ? '<p class="host">' + esc(i.hostLine) + '</p>' : '') +
      (i.note ? '<p class="note">' + esc(i.note) + '</p>' : '') +
      countdown() + '</section>';
  }

  function dear(open) {
    const n = data.guest.seats;
    return '<section class="g-for" data-reveal><span class="to">Dear ' + esc(data.guest.name) + '</span>' +
      '<p>' + (n === 1 ? 'One seat is kept for you.' : 'Up to ' + n + ' seats are kept for you.') + (open ? ' Tell us which functions you will join.' : '') + '</p>' + (open ? down : '') + '</section>';
  }

  function recap() {
    return '<div class="recap">' + data.functions.map((f) => {
      const r = draft[f.id] || {};
      return '<div><strong>' + esc(f.name) + '</strong>' + (r.status ? '<span class="pill fill s-' + esc(r.status) + '"><i class="dot"></i>' + esc(LABEL[r.status]) + (r.status !== 'no' && r.count ? ', ' + r.count : '') + '</span>' : '<span class="pill dashed">No reply</span>') + '</div>';
    }).join('') + '</div>';
  }

  function evHTML(f, i, shown) {
    const r = draft[f.id] || {};
    const on = (s) => (r.status === s ? 'true' : 'false');
    const dp = dayParts(f.date);
    const date = dp ? '<div class="when"><span class="d num">' + dp.d + '</span><span class="m">' + esc(dp.m) + '</span><span class="w">' + esc(dp.w) + '</span></div>' : '<div class="when"></div>';
    const step = (r.status === 'yes' || r.status === 'maybe') && data.guest.seats > 1
      ? '<div class="stepline"><span>Guests, including you</span><div class="stepper"><button type="button" data-d="-1" aria-label="Fewer guests">−</button><output aria-live="polite">' + (r.count || 1) + '</output><button type="button" data-d="1" aria-label="More guests">+</button></div></div>'
      : '';
    const time = R.fmtTime(f.time);
    const meta = [time, f.venue].filter(Boolean);
    return '<article class="ev t-' + TONES[i % TONES.length] + (shown ? ' in' : '') + '" data-fn="' + f.id + '" data-reveal role="group" aria-labelledby="fh' + f.id + '">' + date +
      '<div class="ev-body"><div><h3 id="fh' + f.id + '">' + esc(f.name) + '</h3>' + (meta.length ? '<p class="meta">' + esc(meta.join(', ')) + '</p>' : '') + '</div>' +
      '<div class="seg">' +
      '<button type="button" class="s-yes" data-s="yes" aria-pressed="' + on('yes') + '">Coming</button>' +
      '<button type="button" class="s-maybe" data-s="maybe" aria-pressed="' + on('maybe') + '">Maybe</button>' +
      '<button type="button" class="s-no" data-s="no" aria-pressed="' + on('no') + '">Can\'t come</button>' +
      '</div>' + step + '</div></article>';
  }

  function answered() { return data.functions.filter((f) => draft[f.id] && draft[f.id].status).length; }
  function updateBar() {
    const st = document.getElementById('sbst'); if (!st) return;
    const n = answered(), t = data.functions.length;
    st.innerHTML = n === t ? '<b>All answered.</b> Ready to send.' : '<b class="num">' + n + '</b> of ' + t + ' answered';
  }

  function render() {
    window.scrollTo(0, 0);
    if (sent) {
      shell(hero() + '<section class="g-state"><h2>Thank you, ' + esc(data.guest.name.split(' ')[0]) + '.</h2>' +
        '<p>Your reply is saved. You can change it until the hosts close replies.</p>' + recap() +
        '<div><button class="btn ghost" id="change" type="button">Change my reply</button></div></section>');
      document.getElementById('change').addEventListener('click', () => { sent = false; render(); });
      return;
    }
    if (data.invitation.closed) {
      shell(hero() + '<section class="g-state"><h2>Replies are closed.</h2><p>The hosts are no longer taking replies online. Please contact them directly.</p>' +
        (data.guest.replied ? '<p>Your last reply:</p>' + recap() : '') + '</section>');
      return;
    }
    if (!data.functions.length) {
      shell(hero() + '<section class="g-state"><h2>Details are on the way.</h2><p>The hosts have not added the functions yet. Please check back soon.</p></section>');
      return;
    }
    shell(hero() + dear(true) +
      '<form id="form" novalidate style="display:flex;flex-direction:column;gap:70px">' +
      '<div class="events" id="fns">' + data.functions.map((f, i) => evHTML(f, i, false)).join('') + '</div>' +
      '<label class="field g-note" data-reveal><span>A note for the hosts (optional)</span><textarea id="note" maxlength="300" placeholder="Food preferences, travel plans, anything else"></textarea></label>' +
      '<p class="foot">This link is personal to you. Please do not share it.</p></form>' +
      '<div class="sendbar" id="sendbar"><div><span class="st" id="sbst"></span><button class="btn" id="send" type="submit" form="form">Send reply</button></div></div>' +
      '<p class="err" id="err" role="alert" style="text-align:center;margin-top:-50px"></p>');
    document.getElementById('note').value = note;
    document.getElementById('note').addEventListener('input', (e) => { note = e.target.value; });
    document.getElementById('fns').addEventListener('click', onClick);
    document.getElementById('form').addEventListener('submit', onSubmit);
    updateBar();
    reveal(root);
    const bar = document.getElementById('sendbar');
    const fns = document.getElementById('fns');
    const sync = () => { if (!bar.isConnected) { window.removeEventListener('scroll', sync); return; } bar.classList.toggle('on', fns.getBoundingClientRect().top < window.innerHeight * 0.7); };
    window.addEventListener('scroll', sync, { passive: true }); sync();
  }

  function onClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    const el = b.closest('.ev'); if (!el) return;
    const id = +el.dataset.fn, idx = data.functions.findIndex((f) => f.id === id);
    const r = draft[id] || (draft[id] = { status: '', count: 0 });
    if (b.dataset.s) { r.status = b.dataset.s; r.count = r.status === 'no' ? 0 : Math.max(1, r.count || 1); }
    else if (b.dataset.d) { r.count = Math.min(data.guest.seats, Math.max(1, (r.count || 1) + (+b.dataset.d))); }
    document.getElementById('err').textContent = '';
    const tmp = document.createElement('div'); tmp.innerHTML = evHTML(data.functions[idx], idx, true);
    el.replaceWith(tmp.firstChild);
    updateBar();
    const keep = b.dataset.s ? '[data-s="' + b.dataset.s + '"]' : '[data-d="' + b.dataset.d + '"]';
    const nb = document.querySelector('[data-fn="' + id + '"] ' + keep); if (nb) nb.focus({ preventScroll: true });
  }

  async function onSubmit(e) {
    e.preventDefault();
    const err = document.getElementById('err'), btn = document.getElementById('send');
    const missing = data.functions.filter((f) => !(draft[f.id] && draft[f.id].status));
    if (missing.length) {
      err.textContent = 'Please answer for ' + missing.map((m) => m.name).join(', ') + '.';
      const el = document.querySelector('[data-fn="' + missing[0].id + '"]'); if (el) el.scrollIntoView({ behavior: R.reduce ? 'auto' : 'smooth', block: 'center' });
      return;
    }
    btn.disabled = true;
    try {
      await api('/guest/' + encodeURIComponent(token), { method: 'POST', body: {
        responses: data.functions.map((f) => ({ functionId: f.id, status: draft[f.id].status, count: draft[f.id].count })),
        note
      } });
      sent = true; data.guest.replied = true; render();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  }

  (async function init() {
    try {
      data = await api('/guest/' + encodeURIComponent(token));
    } catch (ex) {
      shell('<section class="g-state"><h2>This link did not work.</h2><p>' + esc(ex.message) + '</p></section>');
      return;
    }
    draft = JSON.parse(JSON.stringify(data.responses || {}));
    note = data.guest.note || '';
    sent = false;
    render();
  })();
})();
