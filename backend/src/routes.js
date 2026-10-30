'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const S = require('./security');

const api = express.Router();

/* ---------- small helpers ---------- */
const clean = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const cleanText = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '';
const isEmail = (e) => e.length <= 254 && /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);
const intIn = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };
const isDate = (d) => d === '' || /^\d{4}-\d{2}-\d{2}$/.test(d);
const isTime = (t) => t === '' || /^\d{2}:\d{2}$/.test(t);
const cleanPhone = (p) => { const s = typeof p === 'string' ? p.replace(/[^\d+]/g, '') : ''; return s.replace(/(?!^)\+/g, '').slice(0, 16); };
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const lim = (opts) => rateLimit(Object.assign({ standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please wait a moment and try again.' } }, opts));

const apiLimiter = lim({ windowMs: 60 * 1000, limit: 300 });
const authLimiter = lim({ windowMs: 15 * 60 * 1000, limit: 30, message: { error: 'Too many attempts. Try again in a few minutes.' } });
const guestLimiter = lim({ windowMs: 60 * 1000, limit: 40 });

api.use(apiLimiter);

/* ---------- auth ---------- */
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, mustChange: !!u.must_change });
const userCount = () => db.prepare('SELECT COUNT(*) c FROM users').get().c;

api.get('/auth/status', (req, res) => {
  const setup = userCount() === 0;
  res.json({ needsSetup: setup, needsSetupKey: setup && !!process.env.SETUP_KEY, allowSignup: process.env.ALLOW_SIGNUP === '1' });
});

/* Optional guard for a fresh deploy: when SETUP_KEY is set, whoever creates the first (owner) account must know it. */
function setupKeyOk(given) {
  const want = process.env.SETUP_KEY;
  if (!want) return true;
  const a = Buffer.from(String(given || '')), b = Buffer.from(want);
  return a.length === b.length && require('crypto').timingSafeEqual(a, b);
}

api.post('/auth/register', authLimiter, wrap(async (req, res) => {
  const name = clean(req.body.name, 80);
  const email = clean(req.body.email, 254).toLowerCase();
  const password = req.body.password;
  if (!name) return bad(res, 'Enter your name.');
  if (!isEmail(email)) return bad(res, 'Enter a valid email address.');
  const pwErr = S.passwordProblem(password); if (pwErr) return bad(res, pwErr);
  if (userCount() === 0 && !setupKeyOk(req.body.setupKey)) return bad(res, 'The setup key is not correct.', 403);
  const hash = await S.hashPassword(password);
  let id;
  try {
    db.transaction(() => {
      const n = userCount();
      if (n > 0 && process.env.ALLOW_SIGNUP !== '1') { const e = new Error('closed'); e.closed = true; throw e; }
      id = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)').run(name, email, hash, n === 0 ? 'admin' : 'host').lastInsertRowid;
    })();
  } catch (e) {
    if (e.closed) return bad(res, 'Sign-up is closed. Ask the owner to create your account.', 403);
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) return bad(res, 'An account with this email already exists.', 409);
    throw e;
  }
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  S.issue(res, user);
  res.status(201).json({ user: publicUser(user) });
}));

api.post('/auth/login', authLimiter, wrap(async (req, res) => {
  const email = clean(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '';
  if (S.isLocked(email)) return bad(res, 'Too many failed attempts. Try again in 15 minutes.', 429);
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const ok = await S.checkPassword(password, user && user.password_hash);
  if (!user || !ok || !user.active) {
    S.noteFail(email);
    return bad(res, 'Email or password is incorrect.', 401);
  }
  S.clearFails(email);
  db.prepare("UPDATE users SET last_login=datetime('now') WHERE id=?").run(user.id);
  S.issue(res, user);
  res.json({ user: publicUser(user) });
}));

api.post('/auth/logout', (req, res) => {
  const u = S.currentUser(req);
  if (u && req.body && req.body.all === true) db.prepare('UPDATE users SET token_version=token_version+1 WHERE id=?').run(u.id);
  S.clear(res);
  res.json({ ok: true });
});

api.get('/me', S.requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

api.patch('/me', S.requireAuth, (req, res) => {
  const name = clean(req.body.name, 80);
  if (!name) return bad(res, 'Enter your name.');
  db.prepare('UPDATE users SET name=? WHERE id=?').run(name, req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
});

api.post('/me/password', S.requireAuth, authLimiter, wrap(async (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const okNow = await S.checkPassword(typeof req.body.current === 'string' ? req.body.current : '', row.password_hash);
  if (!okNow) return bad(res, 'Your current password is not correct.', 403);
  const next = req.body.next;
  const pwErr = S.passwordProblem(next); if (pwErr) return bad(res, pwErr);
  if (next === req.body.current) return bad(res, 'Choose a password you have not used just now.');
  const hash = await S.hashPassword(next);
  db.prepare('UPDATE users SET password_hash=?, must_change=0, token_version=token_version+1 WHERE id=?').run(hash, row.id);
  const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(row.id);
  S.issue(res, fresh);      // other devices are signed out, this one stays in
  res.json({ user: publicUser(fresh) });
}));

/* ---------- accounts (owner only) ---------- */
api.get('/admin/users', S.requireAuth, S.requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT u.id,u.name,u.email,u.role,u.active,u.must_change,u.created_at,u.last_login,
      (SELECT COUNT(*) FROM invitations i WHERE i.user_id=u.id) invitations
    FROM users u ORDER BY u.created_at, u.id`).all();
  res.json({ users: rows.map(r => ({ id: r.id, name: r.name, email: r.email, role: r.role, active: !!r.active, mustChange: !!r.must_change, createdAt: r.created_at, lastLogin: r.last_login, invitations: r.invitations })) });
});

api.post('/admin/users', S.requireAuth, S.requireAdmin, wrap(async (req, res) => {
  const name = clean(req.body.name, 80);
  const email = clean(req.body.email, 254).toLowerCase();
  const role = req.body.role === 'admin' ? 'admin' : 'host';
  if (!name) return bad(res, 'Enter a name for the account.');
  if (!isEmail(email)) return bad(res, 'Enter a valid email address.');
  const pwErr = S.passwordProblem(req.body.password); if (pwErr) return bad(res, pwErr);
  const hash = await S.hashPassword(req.body.password);
  try {
    const r = db.prepare('INSERT INTO users (name,email,password_hash,role,must_change) VALUES (?,?,?,?,1)').run(name, email, hash, role);
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) return bad(res, 'An account with this email already exists.', 409);
    throw e;
  }
}));

api.patch('/admin/users/:id', S.requireAuth, S.requireAdmin, wrap(async (req, res) => {
  const id = intIn(req.params.id, 1, 1e9); if (!id) return bad(res, 'Account not found.', 404);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) return bad(res, 'Account not found.', 404);
  const self = id === req.user.id;
  if (typeof req.body.active === 'boolean') {
    if (self) return bad(res, 'You cannot disable your own account.');
    db.prepare('UPDATE users SET active=?, token_version=token_version+1 WHERE id=?').run(req.body.active ? 1 : 0, id);
  }
  if (req.body.role === 'admin' || req.body.role === 'host') {
    if (self && req.body.role !== u.role) return bad(res, 'You cannot change your own role.');
    db.prepare('UPDATE users SET role=? WHERE id=?').run(req.body.role, id);
  }
  if (req.body.name !== undefined) {
    const n = clean(req.body.name, 80); if (!n) return bad(res, 'Enter a name.');
    db.prepare('UPDATE users SET name=? WHERE id=?').run(n, id);
  }
  if (req.body.password !== undefined) {
    const pwErr = S.passwordProblem(req.body.password); if (pwErr) return bad(res, pwErr);
    const hash = await S.hashPassword(req.body.password);
    db.prepare('UPDATE users SET password_hash=?, must_change=?, token_version=token_version+1 WHERE id=?').run(hash, self ? 0 : 1, id);
    if (self) S.issue(res, db.prepare('SELECT * FROM users WHERE id=?').get(id));
  }
  res.json({ ok: true });
}));

api.delete('/admin/users/:id', S.requireAuth, S.requireAdmin, (req, res) => {
  const id = intIn(req.params.id, 1, 1e9);
  if (!id || !db.prepare('SELECT 1 FROM users WHERE id=?').get(id)) return bad(res, 'Account not found.', 404);
  if (id === req.user.id) return bad(res, 'You cannot delete your own account.');
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.json({ ok: true });
});

/* ---------- invitations ---------- */
const mine = S.requireAuth;

function ownInvitation(req, res, id) {
  const n = intIn(id, 1, 1e12);
  const inv = n && db.prepare('SELECT * FROM invitations WHERE id=? AND user_id=?').get(n, req.user.id);
  if (!inv) { bad(res, 'Invitation not found.', 404); return null; }
  return inv;
}
function ownGuest(req, res, id) {
  const n = intIn(id, 1, 1e12);
  const g = n && db.prepare('SELECT g.* FROM guests g JOIN invitations i ON i.id=g.invitation_id WHERE g.id=? AND i.user_id=?').get(n, req.user.id);
  if (!g) { bad(res, 'Guest not found.', 404); return null; }
  return g;
}
function ownFunction(req, res, id) {
  const n = intIn(id, 1, 1e12);
  const f = n && db.prepare('SELECT f.* FROM functions f JOIN invitations i ON i.id=f.invitation_id WHERE f.id=? AND i.user_id=?').get(n, req.user.id);
  if (!f) { bad(res, 'Function not found.', 404); return null; }
  return f;
}

const invitationOut = (i) => ({ id: i.id, title: i.title, hostLine: i.host_line, note: i.note, closed: !!i.closed, createdAt: i.created_at, cover: i.coverV || 0 });
const coverVersion = (id) => (db.prepare('SELECT version v FROM covers WHERE invitation_id=?').get(id) || {}).v || 0;

api.get('/invitations', mine, (req, res) => {
  const rows = db.prepare(`SELECT i.*,
      (SELECT version FROM covers c WHERE c.invitation_id=i.id) coverV,
      (SELECT MIN(f.date) FROM functions f WHERE f.invitation_id=i.id AND f.date!='') firstDate,
      (SELECT COUNT(*) FROM guests g WHERE g.invitation_id=i.id) guests,
      (SELECT COUNT(*) FROM guests g WHERE g.invitation_id=i.id AND g.responded_at IS NOT NULL) replied,
      (SELECT COUNT(*) FROM functions f WHERE f.invitation_id=i.id) functions,
      COALESCE((SELECT SUM(r.count*f.price) FROM responses r JOIN guests g ON g.id=r.guest_id JOIN functions f ON f.id=r.function_id
                WHERE g.invitation_id=i.id AND r.status='yes'),0) cost,
      COALESCE((SELECT SUM(r.count*f.price) FROM responses r JOIN guests g ON g.id=r.guest_id JOIN functions f ON f.id=r.function_id
                WHERE g.invitation_id=i.id AND r.status IN ('yes','maybe')),0) costMax
    FROM invitations i WHERE i.user_id=? ORDER BY i.created_at DESC, i.id DESC`).all(req.user.id);
  res.json({ invitations: rows.map(r => Object.assign(invitationOut(r), { guests: r.guests, replied: r.replied, functions: r.functions, cost: r.cost, costMax: r.costMax, firstDate: r.firstDate || '' })) });
});

api.post('/invitations', mine, (req, res) => {
  const title = clean(req.body.title, 80);
  if (!title) return bad(res, 'Give the invitation a title, for example "Meera & Arjun".');
  const count = db.prepare('SELECT COUNT(*) c FROM invitations WHERE user_id=?').get(req.user.id).c;
  if (count >= 200) return bad(res, 'You have reached the limit of 200 invitations.');
  const r = db.prepare('INSERT INTO invitations (user_id,title,host_line,note) VALUES (?,?,?,?)')
    .run(req.user.id, title, clean(req.body.hostLine, 120), cleanText(req.body.note, 400));
  res.status(201).json({ id: r.lastInsertRowid });
});

function detail(inv) {
  const functions = db.prepare(`SELECT id,name,date,time,venue,price FROM functions WHERE invitation_id=?
      ORDER BY CASE WHEN date='' THEN 1 ELSE 0 END, date, time, position, id`).all(inv.id);
  const fnSet = new Set(functions.map(f => f.id));
  const rows = db.prepare('SELECT id,name,phone,seats,token,fn_ids,note,responded_at FROM guests WHERE invitation_id=? ORDER BY name COLLATE NOCASE, id').all(inv.id);
  const resp = db.prepare('SELECT r.guest_id,r.function_id,r.status,r.count FROM responses r JOIN guests g ON g.id=r.guest_id WHERE g.invitation_id=?').all(inv.id);
  const by = {};
  resp.forEach(r => { (by[r.guest_id] || (by[r.guest_id] = {}))[r.function_id] = { status: r.status, count: r.count }; });
  const guests = rows.map(g => {
    let ids = null;
    try { ids = g.fn_ids ? JSON.parse(g.fn_ids).filter(x => fnSet.has(x)) : null; } catch (e) { ids = null; }
    return { id: g.id, name: g.name, phone: g.phone, seats: g.seats, token: g.token, fnIds: ids, note: g.note, respondedAt: g.responded_at, responses: by[g.id] || {} };
  });
  functions.forEach(f => {
    let yes = 0, maybe = 0, fy = 0, fm = 0, fn = 0, invited = 0;
    guests.forEach(g => {
      if (g.fnIds && !g.fnIds.includes(f.id)) return;
      invited++;
      const r = g.responses[f.id]; if (!r) return;
      if (r.status === 'yes') { yes += r.count; fy++; } else if (r.status === 'maybe') { maybe += r.count; fm++; } else { fn++; }
    });
    Object.assign(f, { yes, maybe, fy, fm, fn, invited, pending: invited - fy - fm - fn });
  });
  return { invitation: invitationOut(Object.assign({}, inv, { coverV: coverVersion(inv.id) })), functions, guests };
}

api.get('/invitations/:id', mine, (req, res) => {
  const inv = ownInvitation(req, res, req.params.id); if (!inv) return;
  res.json(detail(inv));
});

api.patch('/invitations/:id', mine, (req, res) => {
  const inv = ownInvitation(req, res, req.params.id); if (!inv) return;
  const title = req.body.title !== undefined ? clean(req.body.title, 80) : inv.title;
  if (!title) return bad(res, 'The title cannot be empty.');
  const hostLine = req.body.hostLine !== undefined ? clean(req.body.hostLine, 120) : inv.host_line;
  const note = req.body.note !== undefined ? cleanText(req.body.note, 400) : inv.note;
  const closed = typeof req.body.closed === 'boolean' ? (req.body.closed ? 1 : 0) : inv.closed;
  db.prepare('UPDATE invitations SET title=?,host_line=?,note=?,closed=? WHERE id=?').run(title, hostLine, note, closed, inv.id);
  res.json({ ok: true });
});

api.delete('/invitations/:id', mine, (req, res) => {
  const inv = ownInvitation(req, res, req.params.id); if (!inv) return;
  db.prepare('DELETE FROM invitations WHERE id=?').run(inv.id);
  res.json({ ok: true });
});

/* ---------- cover photo ----------
   The browser shrinks the picture to a JPEG before sending it. The server still checks that the bytes
   really are a JPEG of a sensible size, stores them in their own table and serves them as an image only. */
const COVER_MAX_BYTES = 900 * 1024;
function jpegSize(b) {
  if (!Buffer.isBuffer(b) || b.length < 100 || b[0] !== 0xFF || b[1] !== 0xD8 || b[2] !== 0xFF) return null;
  if (b[b.length - 2] !== 0xFF || b[b.length - 1] !== 0xD9) return null;
  let i = 2;
  for (let n = 0; n < 200 && i + 4 < b.length; n++) {
    if (b[i] !== 0xFF) return null;
    while (b[i + 1] === 0xFF && i + 2 < b.length) i++;
    const m = b[i + 1];
    if (m === 0x01 || (m >= 0xD0 && m <= 0xD8)) { i += 2; continue; }
    if (m === 0xD9 || m === 0xDA) return null;                        // ended before any frame header
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return null;
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      if (i + 9 > b.length) return null;
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}
function sendCover(res, invitationId) {
  const row = db.prepare('SELECT data FROM covers WHERE invitation_id=?').get(invitationId);
  if (!row) return bad(res, 'No photo.', 404);
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  res.send(row.data);
}
api.put('/invitations/:id/cover', mine, express.raw({ type: 'image/jpeg', limit: COVER_MAX_BYTES }), (req, res) => {
  const inv = ownInvitation(req, res, req.params.id); if (!inv) return;
  const size = jpegSize(req.body);
  if (!size) return bad(res, 'That file is not a usable photo. Choose a JPEG or PNG picture.');
  if (size.w < 200 || size.h < 200) return bad(res, 'The photo is too small. Use one at least 200 pixels wide.');
  if (size.w > 4096 || size.h > 4096) return bad(res, 'The photo is too large. Use one up to 4000 pixels wide.');
  db.prepare(`INSERT INTO covers (invitation_id,data,version) VALUES (?,?,1)
      ON CONFLICT(invitation_id) DO UPDATE SET data=excluded.data, version=covers.version+1`).run(inv.id, req.body);
  res.json({ ok: true, cover: coverVersion(inv.id) });
});
api.delete('/invitations/:id/cover', mine, (req, res) => {
  const inv = ownInvitation(req, res, req.params.id); if (!inv) return;
  db.prepare('DELETE FROM covers WHERE invitation_id=?').run(inv.id);
  res.json({ ok: true });
});
api.get('/invitations/:id/cover', mine, (req, res) => {
  const inv = ownInvitation(req, res, req.params.id); if (!inv) return;
  sendCover(res, inv.id);
});

/* ---------- functions ---------- */
function readFunction(body) {
  const name = clean(body.name, 60);
  const date = clean(body.date, 10), time = clean(body.time, 5);
  const price = intIn(body.price === '' || body.price == null ? 0 : body.price, 0, 1000000);
  if (!name) return { error: 'Enter a name for the function.' };
  if (!isDate(date)) return { error: 'Pick a valid date.' };
  if (!isTime(time)) return { error: 'Pick a valid time.' };
  if (price === null) return { error: 'Enter the price per plate as a whole number.' };
  return { v: { name, date, time, venue: clean(body.venue, 100), price } };
}
api.post('/invitations/:id/functions', mine, (req, res) => {
  const inv = ownInvitation(req, res, req.params.id); if (!inv) return;
  if (db.prepare('SELECT COUNT(*) c FROM functions WHERE invitation_id=?').get(inv.id).c >= 20) return bad(res, 'An invitation can have up to 20 functions.');
  const r = readFunction(req.body); if (r.error) return bad(res, r.error);
  const x = db.prepare('INSERT INTO functions (invitation_id,name,date,time,venue,price) VALUES (?,?,?,?,?,?)')
    .run(inv.id, r.v.name, r.v.date, r.v.time, r.v.venue, r.v.price);
  res.status(201).json({ id: x.lastInsertRowid });
});
api.patch('/functions/:id', mine, (req, res) => {
  const f = ownFunction(req, res, req.params.id); if (!f) return;
  const r = readFunction(Object.assign({}, f, req.body)); if (r.error) return bad(res, r.error);
  db.prepare('UPDATE functions SET name=?,date=?,time=?,venue=?,price=? WHERE id=?').run(r.v.name, r.v.date, r.v.time, r.v.venue, r.v.price, f.id);
  res.json({ ok: true });
});
api.delete('/functions/:id', mine, (req, res) => {
  const f = ownFunction(req, res, req.params.id); if (!f) return;
  db.prepare('DELETE FROM functions WHERE id=?').run(f.id);
  res.json({ ok: true });
});

/* ---------- guests and their personal links ---------- */
api.post('/invitations/:id/guests', mine, (req, res) => {
  const inv = ownInvitation(req, res, req.params.id); if (!inv) return;
  const list = Array.isArray(req.body.guests) ? req.body.guests : [];
  if (!list.length) return bad(res, 'Add at least one guest.');
  if (list.length > 500) return bad(res, 'Add up to 500 guests at a time.');
  const total = db.prepare('SELECT COUNT(*) c FROM guests WHERE invitation_id=?').get(inv.id).c;
  if (total + list.length > 2000) return bad(res, 'An invitation can have up to 2000 guests.');
  const ins = db.prepare('INSERT INTO guests (invitation_id,name,phone,seats,token) VALUES (?,?,?,?,?)');
  let added = 0;
  db.transaction(() => {
    for (const g of list) {
      const name = clean(g && g.name, 80); if (!name) continue;
      ins.run(inv.id, name, cleanPhone(g.phone), intIn(g.seats, 1, 20) || 2, S.newToken());
      added++;
    }
  })();
  if (!added) return bad(res, 'No valid names found. Put one guest on each line.');
  res.status(201).json({ added });
});

api.patch('/guests/:id', mine, (req, res) => {
  const g = ownGuest(req, res, req.params.id); if (!g) return;
  const name = req.body.name !== undefined ? clean(req.body.name, 80) : g.name;
  if (!name) return bad(res, 'The guest needs a name.');
  const phone = req.body.phone !== undefined ? cleanPhone(req.body.phone) : g.phone;
  const seats = req.body.seats !== undefined ? intIn(req.body.seats, 1, 20) : g.seats;
  if (!seats) return bad(res, 'Seats must be a number from 1 to 20.');
  let fnIds = g.fn_ids;
  if (req.body.fnIds !== undefined) {
    if (req.body.fnIds === null) fnIds = null;
    else if (Array.isArray(req.body.fnIds)) {
      const valid = new Set(db.prepare('SELECT id FROM functions WHERE invitation_id=?').all(g.invitation_id).map(r => r.id));
      const ids = [...new Set(req.body.fnIds.map(Number).filter(n => valid.has(n)))];
      fnIds = ids.length === valid.size ? null : JSON.stringify(ids);
    } else return bad(res, 'Invalid function list.');
  }
  const token = req.body.newLink === true ? S.newToken() : g.token;
  db.transaction(() => {
    db.prepare('UPDATE guests SET name=?,phone=?,seats=?,fn_ids=?,token=? WHERE id=?').run(name, phone, seats, fnIds, token, g.id);
    db.prepare("UPDATE responses SET count=? WHERE guest_id=? AND status!='no' AND count>?").run(seats, g.id, seats);
  })();
  res.json({ ok: true, token });
});

api.delete('/guests/:id', mine, (req, res) => {
  const g = ownGuest(req, res, req.params.id); if (!g) return;
  db.prepare('DELETE FROM guests WHERE id=?').run(g.id);
  res.json({ ok: true });
});

/* ---------- CSV export ---------- */
const csv = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
api.get('/invitations/:id/export.csv', mine, (req, res) => {
  const inv = ownInvitation(req, res, req.params.id); if (!inv) return;
  const d = detail(inv);
  const base = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/$/, '') : req.protocol + '://' + req.get('host');
  const L = { yes: 'Coming', maybe: 'Maybe', no: "Can't come" };
  const head = ['Guest', 'Phone', 'Seats', 'Link'];
  d.functions.forEach(f => { head.push(f.name + ' status', f.name + ' guests'); });
  head.push('Note');
  const rows = [head];
  d.guests.forEach(g => {
    const row = [g.name, g.phone, g.seats, base + '/r/' + g.token];
    d.functions.forEach(f => {
      if (g.fnIds && !g.fnIds.includes(f.id)) { row.push('Not invited', ''); return; }
      const r = g.responses[f.id]; row.push(r ? L[r.status] : 'No reply', r ? r.count : '');
    });
    row.push(g.note); rows.push(row);
  });
  rows.push([]);
  rows.push(['Function', 'Date', 'Plates confirmed', 'Plates maybe', 'Price per plate', 'Catering confirmed', 'Catering if all maybes come']);
  d.functions.forEach(f => rows.push([f.name, f.date, f.yes, f.maybe, f.price, f.yes * f.price, (f.yes + f.maybe) * f.price]));
  const slug = inv.title.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'invitation';
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="' + slug + '-rsvp.csv"');
  res.send('﻿' + rows.map(r => r.map(csv).join(',')).join('\r\n'));
});

/* ---------- guest side: no account, the link is the key ---------- */
const TOKEN = /^[A-Za-z0-9_-]{16,40}$/;
function guestByToken(req, res) {
  const t = req.params.token;
  const g = TOKEN.test(t) && db.prepare('SELECT * FROM guests WHERE token=?').get(t);
  if (!g) { bad(res, 'This link is not valid. Ask the hosts to send it again.', 404); return null; }
  return g;
}
function guestFunctions(g) {
  const all = db.prepare(`SELECT id,name,date,time,venue FROM functions WHERE invitation_id=?
      ORDER BY CASE WHEN date='' THEN 1 ELSE 0 END, date, time, position, id`).all(g.invitation_id);
  let ids = null; try { ids = g.fn_ids ? JSON.parse(g.fn_ids) : null; } catch (e) {}
  return ids ? all.filter(f => ids.includes(f.id)) : all;
}

api.get('/guest/:token', guestLimiter, (req, res) => {
  const g = guestByToken(req, res); if (!g) return;
  const inv = db.prepare('SELECT * FROM invitations WHERE id=?').get(g.invitation_id);
  const resp = {};
  db.prepare('SELECT function_id,status,count FROM responses WHERE guest_id=?').all(g.id).forEach(r => { resp[r.function_id] = { status: r.status, count: r.count }; });
  res.set('Cache-Control', 'no-store');
  res.json({
    guest: { name: g.name, seats: g.seats, note: g.note, replied: !!g.responded_at },
    invitation: { title: inv.title, hostLine: inv.host_line, note: inv.note, closed: !!inv.closed, cover: coverVersion(inv.id) },
    functions: guestFunctions(g),
    responses: resp
  });
});

api.get('/guest/:token/cover', guestLimiter, (req, res) => {
  const g = guestByToken(req, res); if (!g) return;
  sendCover(res, g.invitation_id);
});

api.post('/guest/:token', guestLimiter, (req, res) => {
  const g = guestByToken(req, res); if (!g) return;
  const inv = db.prepare('SELECT * FROM invitations WHERE id=?').get(g.invitation_id);
  if (inv.closed) return bad(res, 'The hosts have closed replies for this invitation.', 403);
  const fns = guestFunctions(g);
  const input = Array.isArray(req.body.responses) ? req.body.responses : [];
  const byFn = new Map(); input.forEach(r => { if (r) byFn.set(Number(r.functionId), r); });
  const rows = [];
  for (const f of fns) {
    const r = byFn.get(f.id);
    if (!r || !['yes', 'maybe', 'no'].includes(r.status)) return bad(res, 'Please answer for ' + f.name + '.');
    let count = 0;
    if (r.status !== 'no') { count = intIn(r.count, 1, g.seats); if (!count) return bad(res, 'For ' + f.name + ', choose between 1 and ' + g.seats + ' guests.'); }
    rows.push([g.id, f.id, r.status, count]);
  }
  const note = cleanText(req.body.note, 300);
  db.transaction(() => {
    db.prepare('DELETE FROM responses WHERE guest_id=?').run(g.id);
    const ins = db.prepare('INSERT INTO responses (guest_id,function_id,status,count) VALUES (?,?,?,?)');
    rows.forEach(r => ins.run(...r));
    db.prepare("UPDATE guests SET responded_at=datetime('now'), note=? WHERE id=?").run(note, g.id);
  })();
  res.json({ ok: true });
});

api.use((req, res) => bad(res, 'Not found.', 404));
api.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return bad(res, 'Invalid request.');
  if (err && err.type === 'entity.too.large') return bad(res, /\/cover$/.test(req.path) ? 'That photo is too large. Choose a smaller one.' : 'That request is too large.', 413);
  console.error(err);
  bad(res, 'Something went wrong on our side. Please try again.', 500);
});

module.exports = api;
