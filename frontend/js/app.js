(function () {
  'use strict';
  const R = window.RSVP;
  const { api, esc, inr, fmtDate, when, toast, runCounts, growBars, copy, reveal, dayParts, archHTML } = R;
  const $ = (s, r) => (r || document).querySelector(s);
  const TONES = ['indigo', 'teal', 'rose', 'gold'];
  const LABEL = { yes: 'Coming', maybe: 'Maybe', no: "Can't come" };
  const AV = ['indigo', 'teal', 'rose', 'gold'];

  const ICON = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3.2 2.7-5 6-5s6 1.8 6 5"/><path d="M16 5.2a3.2 3.2 0 010 5.6M18 14.4c2 .6 3 2.2 3 4.6"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h10a3 3 0 013 3v13H8a3 3 0 01-3-3z"/><path d="M5 17a3 3 0 013-3h10"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1.3-4.2A8 8 0 1112 20a8 8 0 01-3.8-.9z"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
  };

  const S = { me: null, inv: null, invId: null, filter: 'all', q: '', navToken: 0 };

  /* ---------- tiny utilities ---------- */
  const initial = (n) => (String(n || '?').trim().charAt(0) || '?').toUpperCase();
  const toneFor = (id) => AV[Math.abs(+id || 0) % AV.length];
  const link = (token) => location.origin + '/r/' + token;
  const coverUrl = (id) => '/api/invitations/' + id + '/cover';
  const arch = (i, cls) => archHTML(i, { photoUrl: coverUrl(i.id), seed: i.id, cls: cls || '', alt: 'Cover photo for ' + i.title });
  const pill = (tone, text, dot) => '<span class="pill fill t-' + tone + '">' + (dot ? '<i class="dot"></i>' : '') + esc(text) + '</span>';
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  function waNumber(p) {
    let d = String(p || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!d) return '';
    if (d.length === 10) d = '91' + d;
    return d;
  }
  function genPassword() {
    const a = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const b = new Uint32Array(14); crypto.getRandomValues(b);
    return Array.from(b, (x) => a[x % a.length]).join('');
  }
  function guestStatus(g, fns) {
    const rel = fns.filter((f) => !g.fnIds || g.fnIds.includes(f.id));
    const rs = rel.map((f) => g.responses[f.id]).filter(Boolean);
    return { rel, any: rs.length > 0, has: (s) => rs.some((r) => r.status === s) };
  }

  /* ---------- dialog ---------- */
  const dlg = $('#dlg');
  function openDlg(html, mount, locked) {
    dlg.innerHTML = '<div class="dlg-body">' + html + '</div>';
    dlg.dataset.locked = locked ? '1' : '';
    if (!dlg.open) dlg.showModal();
    if (mount) mount(dlg);
    const f = dlg.querySelector('[autofocus]') || dlg.querySelector('input:not([type=checkbox]),textarea,select');
    if (f) f.focus();
  }
  const closeDlg = () => { dlg.dataset.locked = ''; if (dlg.open) dlg.close(); };
  dlg.addEventListener('mousedown', (e) => { dlg._down = e.target === dlg; });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && dlg._down && !dlg.dataset.locked) closeDlg(); });
  dlg.addEventListener('cancel', (e) => { if (dlg.dataset.locked) e.preventDefault(); });

  /* A form dialog: shows errors inline, disables the button while saving. */
  function formDialog(o) {
    openDlg('<h2>' + esc(o.title) + '</h2>' + (o.intro ? '<p class="mute">' + o.intro + '</p>' : '') +
      '<form id="dform" novalidate>' + o.body +
      '<p class="err" id="derr" role="alert"></p>' +
      '<div class="dlg-actions"><button class="btn" type="submit" id="dgo">' + esc(o.submit || 'Save') + '</button>' +
      (o.noCancel ? '' : '<button class="btn ghost" type="button" id="dcancel">Cancel</button>') +
      '<span class="sp"></span>' + (o.extra || '') + '</div></form>',
      (d) => {
        const form = $('#dform', d), err = $('#derr', d), go = $('#dgo', d);
        const cancel = $('#dcancel', d); if (cancel) cancel.addEventListener('click', closeDlg);
        form.addEventListener('submit', async (e) => {
          e.preventDefault(); err.textContent = ''; go.disabled = true;
          try { await o.onSubmit(form, d); } catch (ex) { err.textContent = ex.message || 'Something went wrong.'; go.disabled = false; }
        });
        if (o.mount) o.mount(d, form);
      }, o.locked);
  }

  /* ---------- shell ---------- */
  function navItems() {
    const items = [{ k: 'home', href: '#/', label: 'Invitations', icon: ICON.home }];
    if (S.me.role === 'admin') items.push({ k: 'accounts', href: '#/accounts', label: 'Accounts', icon: ICON.users });
    items.push({ k: 'guide', href: '#/guide', label: 'How it works', icon: ICON.book });
    return items;
  }
  function menuHTML() {
    const role = S.me.role === 'admin' ? 'Owner' : 'Host';
    return '<div class="menu" role="menu" hidden>' +
      '<div class="menu-head"><strong>' + esc(S.me.name) + '</strong><span>' + esc(S.me.email) + '</span></div>' +
      '<button class="mi" data-do="theme" role="menuitem"><span>Dark mode</span><span class="switch" role="switch" aria-checked="' + R.isDark() + '"></span></button>' +
      '<button class="mi" data-do="profile" role="menuitem">Your details</button>' +
      '<button class="mi" data-do="password" role="menuitem">Change password</button>' +
      '<button class="mi out" data-do="signout" role="menuitem">Sign out</button>' +
      '<button class="mi" data-do="signout-all" role="menuitem"><span>Sign out of all devices</span></button>' +
      '</div>';
  }
  function acctHTML() {
    const role = S.me.role === 'admin' ? 'Owner' : 'Host';
    return '<div class="acct"><button class="chip" data-menu aria-haspopup="menu" aria-expanded="false"><span class="avatar t-' + toneFor(S.me.id) + '">' + esc(initial(S.me.name)) + '</span>' +
      '<span class="who"><strong>' + esc(S.me.name) + '</strong><span>' + role + '</span></span></button>' + menuHTML() + '</div>';
  }
  function renderShell() {
    const nav = navItems();
    $('#root').innerHTML =
      '<div class="shell">' +
      '<aside class="side"><a class="brand" href="#/">' + R.mark() + 'RSVP Desk</a>' +
      '<nav class="nav" aria-label="Main">' + nav.map((n) => '<a href="' + n.href + '" data-nav="' + n.k + '">' + n.icon + '<span>' + n.label + '</span></a>').join('') + '</nav>' +
      '<div class="grow"></div>' + acctHTML() + '</aside>' +
      '<div style="min-width:0"><header class="topm"><a class="brand" href="#/">' + R.mark() + 'RSVP Desk</a>' + acctHTML().replace('class="chip"', 'class="chip" aria-label="Account menu"') + '</header>' +
      '<main class="main" id="main" tabindex="-1"></main></div>' +
      '<nav class="tabbar" aria-label="Main">' + nav.map((n) => '<a href="' + n.href + '" data-nav="' + n.k + '">' + n.icon + '<span>' + n.label.replace('How it works', 'Guide') + '</span></a>').join('') + '</nav>' +
      '</div>';
  }
  function setNav(k) {
    document.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.dataset.nav === k) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  function closeMenus() {
    document.querySelectorAll('.menu').forEach((m) => { m.hidden = true; });
    document.querySelectorAll('[data-menu]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }
  function page(html, cls) {
    const m = $('#main');
    m.innerHTML = '<div class="page ' + (cls || '') + '">' + html + '</div>';
    return m;
  }

  /* ---------- routing ---------- */
  function route() {
    closeMenus();
    const p = location.hash.replace(/^#\/?/, '').split('/');
    window.scrollTo(0, 0);
    if (p[0] === 'i' && /^\d+$/.test(p[1] || '')) { setNav('home'); return showInvitation(+p[1], p[2] || 'summary'); }
    if (p[0] === 'accounts' && S.me.role === 'admin') { setNav('accounts'); return showAccounts(); }
    if (p[0] === 'guide') { setNav('guide'); return showGuide(); }
    setNav('home'); return showHome();
  }
  function failed(ex) {
    if (ex && ex.status === 401) { location.replace('/'); return; }
    page('<div class="empty"><h3>Could not load this page.</h3><p>' + esc(ex && ex.message) + '</p><button class="btn" id="retry">Try again</button></div>');
    const b = $('#retry'); if (b) b.addEventListener('click', route);
  }

  /* ---------- home: invitations ---------- */
  async function showHome() {
    const my = ++S.navToken;
    let list;
    try { list = (await api('/invitations')).invitations; } catch (ex) { return failed(ex); }
    if (my !== S.navToken) return;
    const h = new Date().getHours(), greet = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const guests = list.reduce((a, i) => a + i.guests, 0), replied = list.reduce((a, i) => a + i.replied, 0), cost = list.reduce((a, i) => a + i.cost, 0);
    const first = esc(S.me.name.split(' ')[0]);
    let html = '<section class="hello rise"><h1>' + greet + ', ' + first + '.</h1><p>' +
      (list.length ? 'Here is where your invitations stand.' : 'Create your first invitation to start collecting replies.') + '</p></section>';
    if (list.length) {
      html += '<section class="ledger rise" style="--i:1">' +
        '<div class="lg"><span class="l">Invitations</span><span class="v num" data-key="h-i" data-count="' + list.length + '">' + list.length + '</span><span class="s">being planned</span></div>' +
        '<div class="lg"><span class="l">Guests replied</span><span class="v num"><span data-key="h-r" data-count="' + replied + '">' + replied + '</span> <small>of ' + guests + '</small></span><span class="s">across all invitations</span></div>' +
        '<div class="lg"><span class="l">Catering confirmed</span><span class="v num" data-key="h-c" data-fmt="inr" data-count="' + cost + '">' + inr(cost) + '</span><span class="s">from guests who said yes</span></div></section>';
    }
    html += '<section class="rise" style="--i:2"><div class="sec-head"><h2>Your invitations</h2><button class="btn" id="newInv">' + ICON.plus + 'New invitation</button></div>';
    if (!list.length) {
      html += '<div class="empty"><h3>Nothing here yet</h3><p>An invitation holds your functions, such as Mehendi or Reception, and a personal link for every guest.</p><button class="btn" id="newInv2">' + ICON.plus + 'Create your first invitation</button></div>';
    } else {
      html += '<div class="invs">' + list.map((i) => {
        const pct = i.guests ? Math.round(i.replied / i.guests * 100) : 0;
        const sub = i.hostLine || plural(i.functions, 'function');
        const first = i.firstDate ? fmtDate(i.firstDate) : '';
        return '<a class="inv" href="#/i/' + i.id + '" data-reveal>' + arch(i) +
          '<div class="inv-main"><h3>' + esc(i.title) + '</h3><p class="sub">' + esc(sub) + '</p>' +
          (first || i.closed ? '<p class="wh">' + esc(first) + (first && i.closed ? ', ' : '') + (i.closed ? 'replies closed' : '') + '</p>' : '') + '</div>' +
          '<div class="inv-nums"><span class="amt">' + inr(i.cost) + '</span><span class="cap">' + i.replied + ' of ' + plural(i.guests, 'guest') + ' replied</span></div>' +
          '<div class="bar t-green"><i data-w="' + pct + '"></i></div></a>';
      }).join('') + '</div>';
    }
    html += '</section>';
    const m = page(html);
    runCounts(m); growBars(m); reveal(m);
    const nb = $('#newInv') || $('#newInv2'); if (nb) nb.addEventListener('click', newInvitation);
    const nb2 = $('#newInv2'); if (nb2) nb2.addEventListener('click', newInvitation);
  }

  function newInvitation() {
    formDialog({
      title: 'New invitation', submit: 'Create invitation',
      body: '<label class="field"><span>Title</span><input id="f-title" type="text" maxlength="80" placeholder="Meera &amp; Arjun" autofocus></label>' +
        '<label class="field"><span>Hosted by (optional)</span><input id="f-host" type="text" maxlength="120" placeholder="Together with their families"></label>' +
        '<label class="field"><span>Message for guests (optional)</span><textarea id="f-note" maxlength="400" placeholder="Please reply by 20 January."></textarea></label>',
      async onSubmit() {
        const r = await api('/invitations', { method: 'POST', body: { title: $('#f-title').value, hostLine: $('#f-host').value, note: $('#f-note').value } });
        closeDlg(); toast('Invitation created. Add your functions next.');
        location.hash = '#/i/' + r.id + '/functions';
      }
    });
  }

  /* ---------- invitation ---------- */
  async function loadInv(id) { S.inv = await api('/invitations/' + id); S.invId = id; }

  async function showInvitation(id, tab) {
    const my = ++S.navToken;
    try { await loadInv(id); } catch (ex) {
      if (ex.status === 404) { page('<div class="empty"><h3>Invitation not found</h3><p>It may have been deleted.</p><a class="btn" href="#/">Back to invitations</a></div>'); return; }
      return failed(ex);
    }
    if (my !== S.navToken) return;
    if (!['summary', 'guests', 'functions', 'details'].includes(tab)) tab = 'summary';
    S.tab = tab; S.filter = 'all'; S.q = '';
    renderInv(true);
  }
  async function reloadInv() { await loadInv(S.invId); renderInv(false); }

  function renderInv(animate) {
    const d = S.inv, i = d.invitation, tab = S.tab, base = '#/i/' + i.id + '/';
    const tabs = [['summary', 'Summary', ''], ['guests', 'Guests', d.guests.length], ['functions', 'Functions', d.functions.length], ['details', 'Details', '']];
    const rc = animate ? ' rise' : '';
    const html = '<div class="' + rc + '"><a class="back" href="#/">' + ICON.back + 'All invitations</a>' +
      '<div class="inv-head"><div><h1>' + esc(i.title) + '</h1>' + (i.hostLine ? '<p class="sub">' + esc(i.hostLine) + '</p>' : '') +
      '<div class="row">' + '<button class="btn" id="addGuests">' + ICON.plus + 'Add guests</button>' + (i.closed ? pill('neutral', 'Replies closed') : '') + '</div></div>' +
      arch(i) + '</div></div>' +
      '<nav class="tabs" aria-label="Invitation sections">' + tabs.map((t) => '<a href="' + base + t[0] + '"' + (t[0] === tab ? ' aria-current="page"' : '') + '>' + t[1] + (t[2] !== '' ? '<span class="n">' + t[2] + '</span>' : '') + '</a>').join('') + '</nav>' +
      '<div id="tabbody"></div>';
    const m = page(html);
    $('#addGuests').addEventListener('click', addGuests);
    ({ summary: tabSummary, guests: tabGuests, functions: tabFunctions, details: tabDetails })[tab]();
    runCounts(m); growBars(m); reveal(m);
  }

  /* summary */
  function tabSummary() {
    const d = S.inv, body = $('#tabbody');
    const total = d.guests.length, replied = d.guests.filter((g) => g.respondedAt).length;
    if (!d.functions.length) {
      body.innerHTML = '<div class="empty"><h3>Add your first function</h3><p>Functions are the events inside this invitation, for example Mehendi, Sangeet and Reception. Each has its own date, venue and price per plate.</p><a class="btn" href="#/i/' + S.inv.invitation.id + '/functions">' + ICON.plus + 'Add a function</a></div>';
      return;
    }
    let html = '<div style="display:flex;flex-direction:column;gap:40px">';
    html += '<section class="progress"><div class="top"><span><b class="num">' + replied + '</b> of ' + plural(total, 'guest') + ' have replied</span><span class="mute">' + (total - replied) + ' waiting</span></div>' +
      '<div class="bar t-green"><i data-w="' + (total ? Math.round(replied / total * 100) : 0) + '"></i></div></section>';
    if (!total) {
      html += '<div class="empty" style="padding:8px 0"><h3>No guests yet</h3><p>Add guests to give each of them a personal link to reply with.</p></div>';
    }
    html += '<section>' + d.functions.map((f, n) => {
      const resp = f.fy + f.fm + f.fn, w = (x) => (resp ? (x / resp * 100).toFixed(2) : 0);
      const plan = f.maybe ? 'Plan for ' + f.yes + ' to ' + (f.yes + f.maybe) + ' plates' : (f.yes ? 'No maybes pending' : 'Waiting for replies');
      const dp = dayParts(f.date);
      const when1 = dp ? '<div class="fs-when"><span class="d num">' + dp.d + '</span><span class="m">' + esc(dp.m) + '</span><span class="w">' + esc(dp.w) + '</span></div>'
        : '<div class="fs-when"><span class="m">Date not set</span></div>';
      return '<article class="fsec t-' + TONES[n % TONES.length] + '" data-reveal>' + when1 +
        '<div class="fs-body"><h3>' + esc(f.name) + '</h3><p class="meta">' + esc([R.fmtTime(f.time), f.venue].filter(Boolean).join(', ')) + '</p></div>' +
        '<div class="fs-nums"><div class="big"><b class="num" data-key="p' + f.id + '" data-count="' + f.yes + '">' + f.yes + '</b><span>plates confirmed</span></div>' +
        '<p class="plan">' + plan + '</p>' +
        '<div class="stack" role="img" aria-label="' + f.fy + ' coming, ' + f.fm + ' maybe, ' + f.fn + ' can\'t come"><i class="y" data-w="' + w(f.fy) + '"></i><i class="m" data-w="' + w(f.fm) + '"></i><i class="n" data-w="' + w(f.fn) + '"></i></div>' +
        '<div class="legend"><span><i class="dot y"></i>' + f.fy + ' coming</span><span><i class="dot m"></i>' + f.fm + ' maybe</span><span><i class="dot n"></i>' + f.fn + ' can\'t come</span><span><i class="dot p"></i>' + f.pending + ' waiting</span></div>' +
        '<dl class="money"><div><dt>Price per plate</dt><dd>' + inr(f.price) + '</dd></div>' +
        '<div><dt>Catering, confirmed</dt><dd data-key="c' + f.id + '" data-fmt="inr" data-count="' + (f.yes * f.price) + '">' + inr(f.yes * f.price) + '</dd></div>' +
        '<div><dt>If every maybe comes</dt><dd>' + inr((f.yes + f.maybe) * f.price) + '</dd></div></dl></div></article>';
    }).join('') + '</section></div>';
    body.innerHTML = html;
  }

  /* guests */
  function tabGuests() {
    const d = S.inv, body = $('#tabbody');
    if (!d.guests.length) {
      body.innerHTML = '<div class="empty"><h3>Add your guest list</h3><p>Paste names, one per line. Every guest gets a personal link, so replies never get mixed up and nobody answers twice.</p><button class="btn" id="g-add">' + ICON.plus + 'Add guests</button></div>';
      $('#g-add').addEventListener('click', addGuests);
      return;
    }
    const filters = [['all', 'Everyone'], ['pending', 'Not replied'], ['yes', 'Coming'], ['maybe', 'Maybe'], ['no', "Can't come"]];
    body.innerHTML = '<div style="display:flex;flex-direction:column;gap:20px">' +
      '<div class="toolbar"><input class="search" id="gq" type="search" placeholder="Search guests" aria-label="Search guests" value="' + esc(S.q) + '">' +
      '<button class="btn soft sm" id="copyAll">' + ICON.link + 'Copy all links</button>' +
      '<a class="btn soft sm" href="/api/invitations/' + d.invitation.id + '/export.csv">' + ICON.down + 'Export CSV</a></div>' +
      '<div class="filters" id="gf">' + filters.map((f) => '<button class="fchip" data-f="' + f[0] + '" aria-pressed="' + (S.filter === f[0]) + '">' + f[1] + '</button>').join('') + '</div>' +
      '<div class="glist" id="glist"></div></div>';
    $('#gq').addEventListener('input', (e) => { S.q = e.target.value; paintGuests(); });
    $('#gf').addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]'); if (!b) return;
      S.filter = b.dataset.f;
      document.querySelectorAll('#gf .fchip').forEach((x) => x.setAttribute('aria-pressed', x === b));
      paintGuests();
    });
    $('#copyAll').addEventListener('click', async () => {
      const text = d.guests.map((g) => g.name + ': ' + link(g.token)).join('\n');
      toast((await copy(text)) ? 'Copied ' + plural(d.guests.length, 'link') + '.' : 'Could not copy. Use Export CSV instead.');
    });
    $('#glist').addEventListener('click', onGuestClick);
    paintGuests();
  }
  function paintGuests() {
    const d = S.inv, q = S.q.trim().toLowerCase(), box = $('#glist'); if (!box) return;
    const rows = d.guests.filter((g) => {
      if (q && !g.name.toLowerCase().includes(q)) return false;
      if (S.filter === 'all') return true;
      const st = guestStatus(g, d.functions);
      return S.filter === 'pending' ? !st.any : st.has(S.filter);
    });
    if (!rows.length) { box.innerHTML = '<div class="empty" style="padding:28px 0"><p>No guests match this filter.</p></div>'; return; }
    box.innerHTML = rows.map((g) => {
      const st = guestStatus(g, d.functions);
      const chips = !st.any ? '<span class="pill dashed">Not replied</span>' :
        st.rel.map((f) => {
          const r = g.responses[f.id]; if (!r) return '<span class="pill dashed">' + esc(f.name) + ': no reply</span>';
          return '<span class="pill fill s-' + r.status + '"><i class="dot"></i>' + esc(f.name) + (r.status === 'no' ? ', no' : ', ' + r.count) + '</span>';
        }).join('');
      const sub = [g.phone, 'Up to ' + g.seats + ' seat' + (g.seats === 1 ? '' : 's')].filter(Boolean).join(', ');
      return '<div class="guest" data-id="' + g.id + '"><div class="g-name"><strong>' + esc(g.name) + '</strong><span>' + esc(sub) + '</span></div>' +
        '<div class="g-st">' + chips + '</div>' +
        '<div class="g-act"><button class="btn soft sm" data-a="copy">' + ICON.link + 'Copy link</button><button class="btn soft sm" data-a="wa">' + ICON.chat + 'WhatsApp</button><button class="btn ghost sm" data-a="edit">Edit</button></div></div>';
    }).join('');
  }
  function onGuestClick(e) {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const id = +b.closest('.guest').dataset.id, g = S.inv.guests.find((x) => x.id === id); if (!g) return;
    if (b.dataset.a === 'copy') copy(link(g.token)).then((ok) => toast(ok ? 'Link for ' + g.name + ' copied.' : 'Could not copy the link.'));
    if (b.dataset.a === 'wa') sendWhatsApp(g);
    if (b.dataset.a === 'edit') editGuest(g);
  }
  function sendWhatsApp(g) {
    const i = S.inv.invitation;
    const msg = 'Hi ' + g.name + ', you are invited to ' + i.title + '. Please tell us which functions you can attend: ' + link(g.token);
    const n = waNumber(g.phone);
    window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
  }

  function parseGuests(text, seats) {
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 500).map((line) => {
      const parts = line.split(/[,\t;|]/).map((x) => x.trim()).filter((x) => x !== '');
      const g = { name: parts[0] || '', phone: '', seats };
      parts.slice(1).forEach((p) => {
        const digits = p.replace(/\D/g, '');
        if (digits.length >= 7) g.phone = p; else if (/^\d{1,2}$/.test(p)) g.seats = Math.min(20, Math.max(1, +p));
      });
      return g;
    }).filter((g) => g.name);
  }
  function addGuests() {
    formDialog({
      title: 'Add guests', submit: 'Add guests',
      intro: 'One guest or family per line. Phone number and seats are optional, for example <b>Sharma family, 98290 12345, 5</b>.',
      body: '<label class="field"><span>Guest list</span><textarea id="g-list" placeholder="Sharma family, 9829012345, 5&#10;Kavita Menon&#10;Dev &amp; Anika, 2" autofocus></textarea></label>' +
        '<div class="dlg-row"><label class="field"><span>Default seats per guest</span><select id="g-seats">' + [1, 2, 3, 4, 5, 6, 8, 10].map((n) => '<option value="' + n + '"' + (n === 2 ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
        '<div class="field"><span>Preview</span><p id="g-prev" class="mute" style="padding:.7rem 0">0 guests</p></div></div>',
      mount() {
        const upd = () => { const n = parseGuests($('#g-list').value, +$('#g-seats').value).length; $('#g-prev').textContent = plural(n, 'guest') + ' will be added'; };
        $('#g-list').addEventListener('input', upd); $('#g-seats').addEventListener('change', upd);
      },
      async onSubmit() {
        const list = parseGuests($('#g-list').value, +$('#g-seats').value);
        if (!list.length) throw new Error('Add at least one name.');
        const r = await api('/invitations/' + S.invId + '/guests', { method: 'POST', body: { guests: list } });
        closeDlg(); toast(plural(r.added, 'guest') + ' added. Their links are ready.');
        if (S.tab !== 'guests') location.hash = '#/i/' + S.invId + '/guests'; else await reloadInv();
      }
    });
  }
  function editGuest(g) {
    const fns = S.inv.functions;
    const checks = fns.length > 1 ? '<div class="field"><span>Invited to</span><div class="checks">' + fns.map((f) => '<label><input type="checkbox" value="' + f.id + '"' + (!g.fnIds || g.fnIds.includes(f.id) ? ' checked' : '') + '>' + esc(f.name) + '</label>').join('') + '</div></div>' : '';
    formDialog({
      title: 'Edit guest', submit: 'Save',
      body: '<label class="field"><span>Name</span><input id="e-name" type="text" maxlength="80" value="' + esc(g.name) + '"></label>' +
        '<div class="dlg-row"><label class="field"><span>Phone (for WhatsApp)</span><input id="e-phone" type="text" inputmode="tel" maxlength="20" value="' + esc(g.phone) + '"></label>' +
        '<label class="field"><span>Seats</span><input id="e-seats" type="number" min="1" max="20" value="' + g.seats + '"></label></div>' + checks +
        '<div class="field"><span>Personal link</span><div class="linkbox"><code>' + esc(link(g.token)) + '</code><button class="btn soft sm" type="button" id="e-copy">Copy</button></div></div>' +
        (g.note ? '<div class="field"><span>Note from guest</span><p>' + esc(g.note) + '</p></div>' : ''),
      extra: '<button class="linkbtn" type="button" id="e-new">New link</button><button class="linkbtn" type="button" id="e-del">Delete</button>',
      mount(d) {
        $('#e-copy', d).addEventListener('click', async () => toast((await copy(link(g.token))) ? 'Link copied.' : 'Could not copy.'));
        const two = (btn, label, fn) => btn.addEventListener('click', async () => {
          if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = label; setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; } }, 3500); return; }
          try { await fn(); } catch (ex) { $('#derr', d).textContent = ex.message; }
        });
        const nl = $('#e-new', d), dl = $('#e-del', d); nl.dataset.orig = 'New link'; dl.dataset.orig = 'Delete';
        two(nl, 'Old link stops working. Confirm?', async () => { await api('/guests/' + g.id, { method: 'PATCH', body: { newLink: true } }); closeDlg(); toast('New link created. Send it to ' + g.name + '.'); await reloadInv(); });
        two(dl, 'Delete ' + g.name + '?', async () => { await api('/guests/' + g.id, { method: 'DELETE' }); closeDlg(); toast('Guest deleted.'); await reloadInv(); });
      },
      async onSubmit(form, d) {
        const body = { name: $('#e-name', d).value, phone: $('#e-phone', d).value, seats: +$('#e-seats', d).value };
        const boxes = d.querySelectorAll('.checks input');
        if (boxes.length) {
          const ids = Array.from(boxes).filter((b) => b.checked).map((b) => +b.value);
          if (!ids.length) throw new Error('Invite the guest to at least one function.');
          body.fnIds = ids;
        }
        await api('/guests/' + g.id, { method: 'PATCH', body });
        closeDlg(); toast('Guest saved.'); await reloadInv();
      }
    });
  }

  /* functions */
  function tabFunctions() {
    const d = S.inv, body = $('#tabbody');
    let html = '<div style="display:flex;flex-direction:column;gap:20px"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center"><p class="mute" style="max-width:52ch">Each function has its own date, venue and plate price. Guests answer for every function they are invited to.</p><button class="btn" id="addFn">' + ICON.plus + 'Add function</button></div>';
    if (!d.functions.length) html += '<div class="empty" style="padding:24px 0"><h3>No functions yet</h3><p>Add Mehendi, Sangeet, Wedding, Reception, or anything else your guests need to answer for.</p></div>';
    else html += '<div>' + d.functions.map((f, n) =>
      '<div class="frow t-' + TONES[n % TONES.length] + '"><i class="dot"></i><div><strong>' + esc(f.name) + '</strong><p class="meta">' + esc([when(f) || 'Date not set', f.venue].filter(Boolean).join(', ')) + '</p></div>' +
      '<span class="price">' + inr(f.price) + ' <span class="mute" style="font-weight:400">per plate</span></span>' +
      '<span class="acts"><button class="btn ghost sm" data-fe="' + f.id + '">Edit</button></span></div>').join('') + '</div>';
    body.innerHTML = html + '</div>';
    $('#addFn').addEventListener('click', () => fnDialog(null));
    body.querySelectorAll('[data-fe]').forEach((b) => b.addEventListener('click', () => fnDialog(d.functions.find((f) => f.id === +b.dataset.fe))));
  }
  function fnDialog(f) {
    formDialog({
      title: f ? 'Edit function' : 'Add function', submit: f ? 'Save changes' : 'Add function',
      body: '<label class="field"><span>Name</span><input id="n-name" type="text" maxlength="60" placeholder="Sangeet" value="' + esc(f ? f.name : '') + '" autofocus></label>' +
        '<div class="dlg-row"><label class="field"><span>Date</span><input id="n-date" type="date" value="' + esc(f ? f.date : '') + '"></label><label class="field"><span>Time</span><input id="n-time" type="time" value="' + esc(f ? f.time : '') + '"></label></div>' +
        '<label class="field"><span>Venue</span><input id="n-venue" type="text" maxlength="100" placeholder="Grand Ballroom" value="' + esc(f ? f.venue : '') + '"></label>' +
        '<label class="field"><span>Price per plate (₹)</span><input id="n-price" type="number" min="0" step="50" inputmode="numeric" placeholder="3500" value="' + (f ? f.price : '') + '"></label>',
      extra: f ? '<button class="linkbtn" type="button" id="n-del">Delete</button>' : '',
      mount(d) {
        const del = $('#n-del', d); if (!del) return;
        del.addEventListener('click', async () => {
          if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Replies for it are removed too. Confirm?'; return; }
          try { await api('/functions/' + f.id, { method: 'DELETE' }); closeDlg(); toast('Function deleted.'); await reloadInv(); } catch (ex) { $('#derr', d).textContent = ex.message; }
        });
      },
      async onSubmit() {
        const body = { name: $('#n-name').value, date: $('#n-date').value, time: $('#n-time').value, venue: $('#n-venue').value, price: $('#n-price').value === '' ? 0 : +$('#n-price').value };
        if (f) await api('/functions/' + f.id, { method: 'PATCH', body });
        else await api('/invitations/' + S.invId + '/functions', { method: 'POST', body });
        closeDlg(); toast('Function saved.'); await reloadInv();
      }
    });
  }

  /* details */
  function tabDetails() {
    const i = S.inv.invitation, body = $('#tabbody');
    body.innerHTML = '<div style="display:flex;flex-direction:column;gap:44px"><section class="cover-ed">' + arch(i) +
      '<div><h3>Cover photo</h3><p>Guests see this at the top of their invitation. Without one, a painted arch is shown.</p>' +
      '<div class="row"><button class="btn soft sm" type="button" id="c-pick">' + (i.cover ? 'Change photo' : 'Add a photo') + '</button>' + (i.cover ? '<button class="btn ghost sm" type="button" id="c-del">Remove</button>' : '') +
      '<input type="file" id="c-file" accept="image/jpeg,image/png,image/webp" hidden></div><p class="err" id="c-err" role="alert"></p></div></section>' +
      '<form class="panel" id="detForm" novalidate>' +
      '<label class="field"><span>Title</span><input id="d-title" type="text" maxlength="80" value="' + esc(i.title) + '"></label>' +
      '<label class="field"><span>Hosted by</span><input id="d-host" type="text" maxlength="120" value="' + esc(i.hostLine) + '"></label>' +
      '<label class="field"><span>Message for guests</span><textarea id="d-note" maxlength="400">' + esc(i.note) + '</textarea></label>' +
      '<div class="setrow"><div><strong>Accept replies</strong><p>Turn off to lock every guest link once your headcount is final.</p></div><button type="button" class="switch" id="d-open" role="switch" aria-checked="' + (!i.closed) + '" aria-label="Accept replies"></button></div>' +
      '<p class="err" id="d-err" role="alert"></p><div><button class="btn" type="submit" id="d-save">Save changes</button></div>' +
      '<div class="danger-zone"><button class="btn danger sm" type="button" id="d-del">Delete this invitation</button></div></form></div>';
    const cerr = $('#c-err'), file = $('#c-file');
    $('#c-pick').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0]; if (!f) return; cerr.textContent = '';
      $('#c-pick').disabled = true; $('#c-pick').textContent = 'Uploading…';
      try { const blob = await R.photoToJpeg(f); await api('/invitations/' + i.id + '/cover', { method: 'PUT', raw: blob }); toast('Cover photo saved.'); await reloadInv(); }
      catch (ex) { cerr.textContent = ex.message; $('#c-pick').disabled = false; $('#c-pick').textContent = i.cover ? 'Change photo' : 'Add a photo'; }
      file.value = '';
    });
    const cd = $('#c-del'); if (cd) cd.addEventListener('click', async () => { try { await api('/invitations/' + i.id + '/cover', { method: 'DELETE' }); toast('Photo removed.'); await reloadInv(); } catch (ex) { cerr.textContent = ex.message; } });
    let open = !i.closed;
    $('#d-open').addEventListener('click', (e) => { open = !open; e.currentTarget.setAttribute('aria-checked', open); });
    $('#detForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const err = $('#d-err'), btn = $('#d-save'); err.textContent = ''; btn.disabled = true;
      try { await api('/invitations/' + i.id, { method: 'PATCH', body: { title: $('#d-title').value, hostLine: $('#d-host').value, note: $('#d-note').value, closed: !open } }); toast('Saved.'); await reloadInv(); }
      catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    });
    $('#d-del').addEventListener('click', () => {
      openDlg('<h2>Delete this invitation?</h2><p class="mute">All functions, guests and replies for <b>' + esc(i.title) + '</b> are removed for good. Guest links stop working.</p>' +
        '<p class="err" id="derr" role="alert"></p><div class="dlg-actions"><button class="btn danger" id="yes">Delete it</button><button class="btn ghost" id="no">Keep it</button></div>',
        (d) => {
          $('#no', d).addEventListener('click', closeDlg);
          $('#yes', d).addEventListener('click', async () => {
            try { await api('/invitations/' + i.id, { method: 'DELETE' }); closeDlg(); toast('Invitation deleted.'); location.hash = '#/'; } catch (ex) { $('#derr', d).textContent = ex.message; }
          });
        });
    });
  }

  /* ---------- accounts (owner) ---------- */
  async function showAccounts() {
    const my = ++S.navToken;
    let users;
    try { users = (await api('/admin/users')).users; } catch (ex) { return failed(ex); }
    if (my !== S.navToken) return;
    const ago = (s) => { if (!s) return 'Never signed in'; const d = new Date(s.replace(' ', 'T') + 'Z'); return 'Last seen ' + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
    const html = '<section class="hello rise"><h1>Accounts</h1><p>Create a separate account for each banquet hall, planner or client. They only ever see their own invitations.</p></section>' +
      '<section class="rise" style="--i:1"><div class="sec-head"><h2>People</h2><button class="btn" id="addUser">' + ICON.plus + 'Add account</button></div>' +
      '<div class="urows">' + users.map((u) => {
        const me = u.id === S.me.id;
        return '<div class="urow"><span class="avatar t-' + toneFor(u.id) + '">' + esc(initial(u.name)) + '</span>' +
          '<div class="nm"><strong>' + esc(u.name) + (me ? ' <span class="mute" style="font-weight:400">(you)</span>' : '') + '</strong><p class="em">' + esc(u.email) + '</p></div>' +
          '<div class="info">' + pill(u.role === 'admin' ? 'indigo' : 'neutral', u.role === 'admin' ? 'Owner' : 'Host') +
          (u.active ? '' : pill('rose', 'Disabled')) + (u.mustChange ? pill('gold', 'Must change password') : '') +
          '<span class="hint">' + plural(u.invitations, 'invitation') + ', ' + ago(u.lastLogin).toLowerCase() + '</span></div>' +
          '<div class="acts">' + (me ? '' : '<button class="btn ghost sm" data-u="reset" data-id="' + u.id + '">Reset password</button>' +
            '<button class="btn ghost sm" data-u="toggle" data-id="' + u.id + '">' + (u.active ? 'Disable' : 'Enable') + '</button>' +
            '<button class="btn ghost sm" data-u="del" data-id="' + u.id + '">Delete</button>') + '</div></div>';
      }).join('') + '</div></section>';
    page(html);
    $('#addUser').addEventListener('click', addAccount);
    $('.urows').addEventListener('click', (e) => {
      const b = e.target.closest('[data-u]'); if (!b) return;
      const u = users.find((x) => x.id === +b.dataset.id); if (!u) return;
      if (b.dataset.u === 'reset') resetPassword(u);
      if (b.dataset.u === 'toggle') confirmDo(u.active ? 'Disable ' + u.name + '?' : 'Enable ' + u.name + '?', u.active ? 'They are signed out right away and cannot sign in until you enable them again.' : 'They can sign in again.', u.active ? 'Disable' : 'Enable', async () => { await api('/admin/users/' + u.id, { method: 'PATCH', body: { active: !u.active } }); toast(u.active ? 'Account disabled.' : 'Account enabled.'); showAccounts(); });
      if (b.dataset.u === 'del') confirmDo('Delete ' + u.name + '?', 'Their account and every invitation, guest and reply in it are removed for good.', 'Delete account', async () => { await api('/admin/users/' + u.id, { method: 'DELETE' }); toast('Account deleted.'); showAccounts(); }, true);
    });
  }
  function confirmDo(title, text, label, fn, danger) {
    openDlg('<h2>' + esc(title) + '</h2><p class="mute">' + esc(text) + '</p><p class="err" id="derr" role="alert"></p>' +
      '<div class="dlg-actions"><button class="btn ' + (danger ? 'danger' : '') + '" id="yes">' + esc(label) + '</button><button class="btn ghost" id="no">Cancel</button></div>',
      (d) => {
        $('#no', d).addEventListener('click', closeDlg);
        $('#yes', d).addEventListener('click', async () => { try { await fn(); closeDlg(); } catch (ex) { $('#derr', d).textContent = ex.message; } });
      });
  }
  function pwField(id, label) {
    return '<div class="field"><span>' + label + '</span><div class="linkbox"><input id="' + id + '" type="text" autocomplete="off" spellcheck="false" style="background:transparent;padding:.4rem 0" value="' + esc(genPassword()) + '"><button class="btn soft sm" type="button" data-gen="' + id + '">New</button><button class="btn soft sm" type="button" data-cp="' + id + '">Copy</button></div></div>';
  }
  function wirePw(d) {
    d.querySelectorAll('[data-gen]').forEach((b) => b.addEventListener('click', () => { $('#' + b.dataset.gen, d).value = genPassword(); }));
    d.querySelectorAll('[data-cp]').forEach((b) => b.addEventListener('click', async () => toast((await copy($('#' + b.dataset.cp, d).value)) ? 'Password copied.' : 'Could not copy.')));
  }
  function addAccount() {
    formDialog({
      title: 'Add account', submit: 'Create account',
      intro: 'Share the email and temporary password with your client. They choose their own password when they first sign in.',
      body: '<label class="field"><span>Name or business</span><input id="a-name" type="text" maxlength="80" placeholder="Royal Palace Banquet" autofocus></label>' +
        '<label class="field"><span>Email</span><input id="a-email" type="email" maxlength="254" autocomplete="off" placeholder="manager@royalpalace.in"></label>' + pwField('a-pw', 'Temporary password'),
      mount: wirePw,
      async onSubmit() {
        const email = $('#a-email').value, pw = $('#a-pw').value, name = $('#a-name').value;
        await api('/admin/users', { method: 'POST', body: { name, email, password: pw } });
        openDlg('<h2>Account created</h2><p class="mute">Send these details to ' + esc(name) + '. The password is shown only now.</p>' +
          '<div class="field"><span>Sign in at</span><div class="linkbox"><code>' + esc(location.origin) + '</code></div></div>' +
          '<div class="field"><span>Email</span><div class="linkbox"><code>' + esc(email) + '</code></div></div>' +
          '<div class="field"><span>Temporary password</span><div class="linkbox"><code>' + esc(pw) + '</code><button class="btn soft sm" id="cp">Copy</button></div></div>' +
          '<div class="dlg-actions"><button class="btn" id="done">Done</button></div>',
          (d) => {
            $('#cp', d).addEventListener('click', async () => toast((await copy(pw)) ? 'Password copied.' : 'Could not copy.'));
            $('#done', d).addEventListener('click', () => { closeDlg(); showAccounts(); });
          });
      }
    });
  }
  function resetPassword(u) {
    formDialog({
      title: 'Reset password', submit: 'Set temporary password',
      intro: esc(u.name) + ' is signed out everywhere and must choose a new password at the next sign-in.',
      body: pwField('r-pw', 'Temporary password'), mount: wirePw,
      async onSubmit() {
        const pw = $('#r-pw').value;
        await api('/admin/users/' + u.id, { method: 'PATCH', body: { password: pw } });
        await copy(pw); closeDlg(); toast('Password set and copied. Send it to ' + u.name + '.'); showAccounts();
      }
    });
  }

  /* ---------- your own account ---------- */
  function changePassword(forced) {
    formDialog({
      title: forced ? 'Choose your own password' : 'Change password', submit: 'Update password', locked: forced, noCancel: forced,
      intro: forced ? 'You signed in with a temporary password. Choose one only you know.' : 'You will stay signed in here and be signed out on other devices.',
      body: '<label class="field"><span>' + (forced ? 'Temporary password' : 'Current password') + '</span><input id="p-cur" type="password" autocomplete="current-password" maxlength="100" autofocus></label>' +
        '<label class="field"><span>New password</span><input id="p-new" type="password" autocomplete="new-password" maxlength="100"></label>' +
        '<p class="hint">At least 10 characters. A short sentence is easy to remember and hard to guess.</p>',
      async onSubmit() {
        await api('/me/password', { method: 'POST', body: { current: $('#p-cur').value, next: $('#p-new').value } });
        S.me.mustChange = false; closeDlg(); toast('Password updated.');
      }
    });
  }
  function profile() {
    formDialog({
      title: 'Your details', submit: 'Save',
      body: '<label class="field"><span>Name</span><input id="m-name" type="text" maxlength="80" value="' + esc(S.me.name) + '" autofocus></label>' +
        '<div class="field"><span>Email</span><p class="mute">' + esc(S.me.email) + '</p></div>',
      async onSubmit() {
        const r = await api('/me', { method: 'PATCH', body: { name: $('#m-name').value } });
        S.me = r.user; closeDlg(); renderShell(); setNav(location.hash.startsWith('#/accounts') ? 'accounts' : location.hash.startsWith('#/guide') ? 'guide' : 'home'); route(); toast('Saved.');
      }
    });
  }
  async function signOut(all) {
    try { await api('/auth/logout', { method: 'POST', body: { all: !!all } }); } catch (e) {}
    location.replace('/');
  }

  /* ---------- guide ---------- */
  function showGuide() {
    const steps = [
      ['t-indigo', '1', 'Create an invitation', 'One invitation per celebration, for example "Meera & Arjun". It holds everything for that family.'],
      ['t-teal', '2', 'Add the functions', 'Mehendi, Sangeet, Wedding, Reception. Give each a date, venue and the price per plate.'],
      ['t-rose', '3', 'Add your guests', 'Paste names, one per line. Add a phone number and seats if you have them. Each guest gets a personal link.'],
      ['t-gold', '4', 'Send the links', 'Tap WhatsApp next to a guest to send their link with a ready message, or copy all links at once.']
    ];
    page('<section class="hello rise"><h1>How it works</h1><p>Four steps from empty page to an exact plate count.</p></section>' +
      '<section class="steps rise" style="--i:1">' + steps.map((s) => '<div class="step ' + s[0] + '" data-reveal style="--d:' + (+s[1] - 1) + '"><figure class="arch"><span>' + s[1] + '</span></figure><h3>' + s[2] + '</h3><p>' + s[3] + '</p></div>').join('') + '</section>' +
      '<section class="prose rise" style="--i:2"><h3>Good to know</h3>' +
      '<p><b>Each link belongs to one guest.</b> It shows their name and only the functions they are invited to. Replies can be changed until you turn off "Accept replies" in Details.</p>' +
      '<p><b>Coming and maybe are counted apart.</b> The Summary shows the plates you can order now and the most you might need.</p>' +
      '<p><b>Lost or leaked link?</b> Open the guest, choose New link, and send the new one. The old link stops working.</p>' +
      '<p><b>Your clients.</b> ' + (S.me.role === 'admin' ? 'Add an account for each client under Accounts. They see only their own invitations.' : 'Your invitations are private to your account.') + '</p></section>');
    reveal($('#main'));
  }

  /* ---------- events ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-menu]');
    if (t) {
      const menu = t.parentElement.querySelector('.menu'), open = menu.hidden;
      closeMenus(); menu.hidden = !open; t.setAttribute('aria-expanded', open);
      return;
    }
    const a = e.target.closest('[data-do]');
    if (a) {
      const act = a.dataset.do;
      if (act === 'theme') { const dark = R.toggleTheme() === 'dark'; document.querySelectorAll('.menu .switch').forEach((s) => s.setAttribute('aria-checked', dark)); return; }
      closeMenus();
      if (act === 'password') changePassword(false);
      if (act === 'profile') profile();
      if (act === 'signout') signOut(false);
      if (act === 'signout-all') signOut(true);
      return;
    }
    if (!e.target.closest('.menu')) closeMenus();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

  /* ---------- boot ---------- */
  (async function boot() {
    try { S.me = (await api('/me')).user; } catch (ex) { location.replace('/'); return; }
    renderShell();
    window.addEventListener('hashchange', route);
    route();
    if (S.me.mustChange) changePassword(true);
  })();
})();
