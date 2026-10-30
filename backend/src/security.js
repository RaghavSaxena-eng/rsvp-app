'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const isProd = process.env.NODE_ENV === 'production';
const COOKIE = 'rsvp_token';
const SESSION_HOURS = 12;

/* ---- signing secret ----
   Production must supply JWT_SECRET. In development a random one is created once and kept in data/. */
function loadSecret() {
  const env = process.env.JWT_SECRET;
  if (env) {
    if (env.length < 32) { console.error('JWT_SECRET must be at least 32 characters.'); process.exit(1); }
    return env;
  }
  if (isProd) { console.error('JWT_SECRET is required when NODE_ENV=production.'); process.exit(1); }
  const f = path.join(__dirname, '..', 'data', '.dev-secret');
  try { return fs.readFileSync(f, 'utf8'); } catch (e) {}
  const s = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, s, { mode: 0o600 });
  console.warn('No JWT_SECRET set. Using a development secret stored in data/.dev-secret.');
  return s;
}
const SECRET = loadSecret();

/* ---- passwords ---- */
const BCRYPT_COST = 12;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);
const hashPassword = (pw) => bcrypt.hash(pw, BCRYPT_COST);
async function checkPassword(pw, hash) { return bcrypt.compare(pw, hash || DUMMY_HASH); }
function passwordProblem(pw) {
  if (typeof pw !== 'string') return 'Enter a password.';
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 100) return 'Use at most 100 characters.';
  if (/^(.)\1+$/.test(pw)) return 'Choose a password that is not one repeated character.';
  return null;
}

/* ---- sessions ---- */
function issue(res, user) {
  const token = jwt.sign({ sub: user.id, tv: user.token_version }, SECRET, { algorithm: 'HS256', expiresIn: SESSION_HOURS + 'h' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === '1' : isProd,
    maxAge: SESSION_HOURS * 3600 * 1000,
    path: '/'
  });
}
function clear(res) { res.clearCookie(COOKIE, { path: '/' }); }

function currentUser(req) {
  const t = req.cookies && req.cookies[COOKIE];
  if (!t) return null;
  let p;
  try { p = jwt.verify(t, SECRET, { algorithms: ['HS256'] }); } catch (e) { return null; }
  const u = db.prepare('SELECT id,name,email,role,active,must_change,token_version FROM users WHERE id=?').get(p.sub);
  if (!u || !u.active || u.token_version !== p.tv) return null;
  return u;
}
function requireAuth(req, res, next) {
  const u = currentUser(req);
  if (!u) { clear(res); return res.status(401).json({ error: 'Please sign in.' }); }
  req.user = u; next();
}
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only the owner can do this.' });
  next();
}

/* ---- cross-site request protection ----
   Cookies are SameSite=Lax. Every state-changing call must also send our custom header
   (a cross-site form cannot) and, when a browser sends Origin, it must match this host. */
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'rsvp') return res.status(403).json({ error: 'Request blocked.' });
  const origin = req.get('origin');
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === req.get('host'); } catch (e) {}
    if (!ok) return res.status(403).json({ error: 'Request blocked.' });
  }
  next();
}

/* ---- per-account lockout after repeated failures ---- */
const fails = new Map();
const MAX_FAILS = 8, LOCK_MS = 15 * 60 * 1000;
function isLocked(email) {
  const f = fails.get(email); if (!f) return false;
  if (f.until && f.until > Date.now()) return true;
  if (f.until && f.until <= Date.now()) fails.delete(email);
  return false;
}
function noteFail(email) {
  const f = fails.get(email) || { n: 0, until: 0 };
  f.n += 1; if (f.n >= MAX_FAILS) { f.until = Date.now() + LOCK_MS; f.n = 0; }
  fails.set(email, f);
}
function clearFails(email) { fails.delete(email); }
setInterval(() => { const now = Date.now(); for (const [k, v] of fails) if (v.until && v.until < now) fails.delete(k); }, 10 * 60 * 1000).unref();

const newToken = () => crypto.randomBytes(16).toString('base64url');

module.exports = { hashPassword, checkPassword, passwordProblem, issue, clear, currentUser, requireAuth, requireAdmin, csrfGuard, isLocked, noteFail, clearFails, newToken, isProd };
