'use strict';
/* End-to-end check of accounts, JWT sessions, tenant isolation and guest replies.
   Runs against a throwaway database: `npm test` */
const os = require('os'), path = require('path'), fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rsvp-'));
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../server');

let base, server;
class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body, opts = {}) {
    const headers = { 'X-Requested-With': 'rsvp' };
    if (opts.noHeader) delete headers['X-Requested-With'];
    if (this.cookie) headers.Cookie = this.cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    set.forEach((c) => { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (k === 'rsvp_token') this.cookie = v ? 'rsvp_token=' + v : ''; });
    let data = null; try { data = await r.json(); } catch (e) {}
    return { status: r.status, data, headers: r.headers, setCookie: set };
  }
  get(u) { return this.req('GET', u); }
  post(u, b, o) { return this.req('POST', u, b || {}, o); }
  patch(u, b) { return this.req('PATCH', u, b || {}); }
  del(u) { return this.req('DELETE', u); }
}

test.before(async () => { await new Promise((ok) => { server = app.listen(0, () => { base = 'http://127.0.0.1:' + server.address().port; ok(); }); }); });
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const owner = new Client(), host = new Client(), guest = new Client(), stranger = new Client();
let invId, fnA, fnB, token, guestId, hostId;

test('first visit asks for the owner account; weak passwords are refused', async () => {
  assert.equal((await owner.get('/api/auth/status')).data.needsSetup, true);
  assert.equal((await owner.post('/api/auth/register', { name: 'Raghav', email: 'raghav@example.com', password: 'short' })).status, 400);
  const r = await owner.post('/api/auth/register', { name: 'Raghav', email: 'raghav@example.com', password: 'a long owner password' });
  assert.equal(r.status, 201); assert.equal(r.data.user.role, 'admin');
  const sc = r.setCookie.join(' ');
  assert.match(sc, /HttpOnly/i); assert.match(sc, /SameSite=Lax/i);
});

test('public sign-up is closed once the owner exists', async () => {
  const r = await stranger.post('/api/auth/register', { name: 'X', email: 'x@example.com', password: 'another long password' });
  assert.equal(r.status, 403);
});

test('sign-in rejects bad credentials with one generic message', async () => {
  const c = new Client();
  const a = await c.post('/api/auth/login', { email: 'raghav@example.com', password: 'wrong wrong wrong' });
  const b = await c.post('/api/auth/login', { email: 'nobody@example.com', password: 'wrong wrong wrong' });
  assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.data.error, b.data.error);
});

test('state-changing calls without the CSRF header are blocked', async () => {
  const r = await owner.post('/api/invitations', { title: 'x' }, { noHeader: true });
  assert.equal(r.status, 403);
});

test('forged and tampered tokens are refused', async () => {
  const c = new Client();
  c.cookie = 'rsvp_token=' + jwt.sign({ sub: 1, tv: 0 }, 'some-other-secret-some-other-secret-1');
  assert.equal((await c.get('/api/me')).status, 401);
  c.cookie = 'rsvp_token=' + jwt.sign({ sub: 1, tv: 0 }, null, { algorithm: 'none' });
  assert.equal((await c.get('/api/me')).status, 401);
});

test('owner builds an invitation with two functions and guests', async () => {
  invId = (await owner.post('/api/invitations', { title: 'Meera & Arjun', hostLine: 'Together with their families' })).data.id;
  fnA = (await owner.post(`/api/invitations/${invId}/functions`, { name: 'Sangeet', date: '2027-02-11', time: '19:30', venue: 'Ballroom', price: 3200 })).data.id;
  fnB = (await owner.post(`/api/invitations/${invId}/functions`, { name: 'Wedding', date: '2027-02-12', price: 4500 })).data.id;
  const g = await owner.post(`/api/invitations/${invId}/guests`, { guests: [{ name: 'Sharma family', phone: '98290 12345', seats: 5 }, { name: 'Kavita Menon' }, { name: '   ' }] });
  assert.equal(g.data.added, 2);
  const d = (await owner.get(`/api/invitations/${invId}`)).data;
  assert.equal(d.guests.length, 2);
  const sh = d.guests.find((x) => x.name === 'Sharma family');
  token = sh.token; guestId = sh.id;
  assert.match(token, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(sh.phone, '9829012345');
});

test('a guest opens only their own link and never sees prices or other guests', async () => {
  const r = await guest.get('/api/guest/' + token);
  assert.equal(r.status, 200);
  const text = JSON.stringify(r.data);
  assert.ok(!text.includes('3200') && !text.includes('price'));
  assert.ok(!text.includes('Kavita'));
  assert.equal(r.data.functions.length, 2);
  assert.equal((await guest.get('/api/guest/not-a-real-token-123456')).status, 404);
  assert.equal((await guest.get('/api/guest/' + 'A'.repeat(22))).status, 404);
});

test('guest replies are validated against seats and invited functions', async () => {
  const bodyOf = (a, b) => ({ responses: [{ functionId: fnA, ...a }, { functionId: fnB, ...b }] });
  assert.equal((await guest.post('/api/guest/' + token, bodyOf({ status: 'yes', count: 6 }, { status: 'no' }))).status, 400);
  assert.equal((await guest.post('/api/guest/' + token, bodyOf({ status: 'yes', count: 0 }, { status: 'no' }))).status, 400);
  assert.equal((await guest.post('/api/guest/' + token, { responses: [{ functionId: fnA, status: 'yes', count: 2 }] })).status, 400);
  assert.equal((await guest.post('/api/guest/' + token, bodyOf({ status: 'yes', count: 4 }, { status: 'maybe', count: 3 }))).status, 200);
});

test('totals and catering cost follow the replies; changing a reply replaces it', async () => {
  let d = (await owner.get(`/api/invitations/${invId}`)).data;
  const a = d.functions.find((f) => f.id === fnA), b = d.functions.find((f) => f.id === fnB);
  assert.equal(a.yes, 4); assert.equal(b.maybe, 3);
  const list = (await owner.get('/api/invitations')).data.invitations[0];
  assert.equal(list.cost, 4 * 3200); assert.equal(list.costMax, 4 * 3200 + 3 * 4500); assert.equal(list.replied, 1);
  await guest.post('/api/guest/' + token, { responses: [{ functionId: fnA, status: 'no' }, { functionId: fnB, status: 'yes', count: 5 }], note: 'Vegetarian' });
  d = (await owner.get(`/api/invitations/${invId}`)).data;
  assert.equal(d.functions.find((f) => f.id === fnA).yes, 0);
  assert.equal(d.functions.find((f) => f.id === fnB).yes, 5);
  assert.equal(d.guests.find((g) => g.id === guestId).note, 'Vegetarian');
});

test('inviting a guest to one function only is enforced', async () => {
  await owner.patch('/api/guests/' + guestId, { fnIds: [fnB] });
  const r = await guest.get('/api/guest/' + token);
  assert.deepEqual(r.data.functions.map((f) => f.id), [fnB]);
  await owner.patch('/api/guests/' + guestId, { fnIds: [fnA, fnB] });
});

test('CSV export contains links and no spreadsheet formulas', async () => {
  await owner.post(`/api/invitations/${invId}/guests`, { guests: [{ name: '=HYPERLINK("http://evil")' }] });
  const r = await fetch(base + `/api/invitations/${invId}/export.csv`, { headers: { Cookie: owner.cookie } });
  const t = await r.text();
  assert.equal(r.status, 200); assert.match(t, /\/r\//); assert.ok(!/\n=HYPERLINK/.test(t)); assert.match(t, /'=HYPERLINK/);
});

test('owner adds a client account; the client must change the temporary password', async () => {
  const r = await owner.post('/api/admin/users', { name: 'Royal Palace', email: 'hall@example.com', password: 'temporary pass 123' });
  assert.equal(r.status, 201); hostId = r.data.id;
  const l = await host.post('/api/auth/login', { email: 'HALL@example.com', password: 'temporary pass 123' });
  assert.equal(l.status, 200); assert.equal(l.data.user.mustChange, true); assert.equal(l.data.user.role, 'host');
});

test('a host cannot see the owner\'s data or use owner tools', async () => {
  assert.equal((await host.get(`/api/invitations/${invId}`)).status, 404);
  assert.equal((await host.patch(`/api/invitations/${invId}`, { title: 'hijack' })).status, 404);
  assert.equal((await host.del(`/api/invitations/${invId}`)).status, 404);
  assert.equal((await host.patch('/api/guests/' + guestId, { name: 'hijack' })).status, 404);
  assert.equal((await host.del('/api/functions/' + fnA)).status, 404);
  assert.equal((await host.get('/api/admin/users')).status, 403);
  assert.equal((await host.get('/api/invitations')).data.invitations.length, 0);
});

test('changing a password signs other devices out but keeps this one in', async () => {
  const second = new Client();
  await second.post('/api/auth/login', { email: 'hall@example.com', password: 'temporary pass 123' });
  assert.equal((await second.get('/api/me')).status, 200);
  assert.equal((await host.post('/api/me/password', { current: 'wrong', next: 'a brand new password' })).status, 403);
  const r = await host.post('/api/me/password', { current: 'temporary pass 123', next: 'a brand new password' });
  assert.equal(r.status, 200); assert.equal(r.data.user.mustChange, false);
  assert.equal((await host.get('/api/me')).status, 200);
  assert.equal((await second.get('/api/me')).status, 401);
});

test('closing replies locks guest links', async () => {
  await owner.patch(`/api/invitations/${invId}`, { closed: true });
  const r = await guest.post('/api/guest/' + token, { responses: [{ functionId: fnA, status: 'no' }, { functionId: fnB, status: 'no' }] });
  assert.equal(r.status, 403);
  await owner.patch(`/api/invitations/${invId}`, { closed: false });
});

test('a new link replaces the old one', async () => {
  const r = await owner.patch('/api/guests/' + guestId, { newLink: true });
  assert.notEqual(r.data.token, token);
  assert.equal((await guest.get('/api/guest/' + token)).status, 404);
  token = r.data.token;
  assert.equal((await guest.get('/api/guest/' + token)).status, 200);
});

test('disabling an account ends its session immediately', async () => {
  assert.equal((await owner.patch('/api/admin/users/' + hostId, { active: false })).status, 200);
  assert.equal((await host.get('/api/me')).status, 401);
  assert.equal((await new Client().post('/api/auth/login', { email: 'hall@example.com', password: 'a brand new password' })).status, 401);
  await owner.patch('/api/admin/users/' + hostId, { active: true });
  assert.equal((await host.post('/api/auth/login', { email: 'hall@example.com', password: 'a brand new password' })).status, 200);
});

test('the owner cannot lock themselves out', async () => {
  const me = (await owner.get('/api/me')).data.user.id;
  assert.equal((await owner.patch('/api/admin/users/' + me, { active: false })).status, 400);
  assert.equal((await owner.del('/api/admin/users/' + me)).status, 400);
});

test('sign out clears the cookie; sign out everywhere kills every session', async () => {
  const a = new Client(), b = new Client();
  await a.post('/api/auth/login', { email: 'hall@example.com', password: 'a brand new password' });
  await b.post('/api/auth/login', { email: 'hall@example.com', password: 'a brand new password' });
  await a.post('/api/auth/logout', {});
  assert.equal((await a.get('/api/me')).status, 401);
  assert.equal((await b.get('/api/me')).status, 200);
  await b.post('/api/auth/logout', { all: true });
  assert.equal((await host.get('/api/me')).status, 401);
});

test('repeated wrong passwords lock the account for a while', async () => {
  const c = new Client();
  let last;
  for (let i = 0; i < 9; i++) last = await c.post('/api/auth/login', { email: 'lockme@example.com', password: 'nope nope nope' });
  assert.equal(last.status, 429);
});

test('security headers are present', async () => {
  const r = await fetch(base + '/');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
  const g = await fetch(base + '/r/' + 'A'.repeat(22));
  assert.match(g.headers.get('x-robots-tag'), /noindex/);
});

test('cover photo: only a real JPEG from the owner is accepted, and guests can see it', async () => {
  const jpg = Buffer.from(fs.readFileSync(path.join(__dirname, 'cover.b64'), 'utf8'), 'base64');
  const url = `/api/invitations/${invId}/cover`;
  const put = (u, body, type, cookie) => fetch(base + u, { method: 'PUT', headers: { 'X-Requested-With': 'rsvp', 'Content-Type': type, Cookie: cookie || '' }, body });

  assert.equal((await put(url, jpg, 'image/jpeg', '')).status, 401);                        // not signed in
  const other = new Client();
  await other.post('/api/auth/login', { email: 'hall@example.com', password: 'a brand new password' });
  assert.equal((await put(url, jpg, 'image/jpeg', other.cookie)).status, 404);              // someone else's invitation
  assert.equal((await other.get(url)).status, 404);

  assert.equal((await put(url, Buffer.from('<svg onload=alert(1)>'.repeat(20)), 'image/jpeg', owner.cookie)).status, 400);  // not a JPEG
  assert.equal((await put(url, jpg, 'text/html', owner.cookie)).status, 400);               // wrong content type
  const huge = Buffer.concat([jpg.subarray(0, jpg.length - 2), Buffer.alloc(950 * 1024), Buffer.from([0xFF, 0xD9])]);
  assert.equal((await put(url, huge, 'image/jpeg', owner.cookie)).status, 413);             // too big
  assert.equal((await put(url, jpg.subarray(0, 60), 'image/jpeg', owner.cookie)).status, 400); // cut off

  assert.equal((await owner.get(`/api/invitations/${invId}`)).data.invitation.cover, 0);
  const ok = await put(url, jpg, 'image/jpeg', owner.cookie);
  assert.equal(ok.status, 200); assert.equal((await ok.json()).cover, 1);

  const mine = await fetch(base + url, { headers: { Cookie: owner.cookie } });
  assert.equal(mine.status, 200); assert.equal(mine.headers.get('content-type'), 'image/jpeg');
  assert.equal(mine.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Buffer.from(await mine.arrayBuffer()).length, jpg.length);

  const g = await guest.get('/api/guest/' + token);
  assert.equal(g.data.invitation.cover, 1);
  const gi = await fetch(base + '/api/guest/' + token + '/cover');
  assert.equal(gi.status, 200); assert.equal(gi.headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(base + '/api/guest/' + 'A'.repeat(22) + '/cover')).status, 404);

  assert.equal((await (await put(url, jpg, 'image/jpeg', owner.cookie)).json()).cover, 2);  // replacing bumps the version
  const list = (await owner.get('/api/invitations')).data.invitations.find((i) => i.id === invId);
  assert.equal(list.cover, 2); assert.equal(list.firstDate, '2027-02-11');

  assert.equal((await owner.del(url)).status, 200);
  assert.equal((await owner.get(`/api/invitations/${invId}`)).data.invitation.cover, 0);
  assert.equal((await fetch(base + '/api/guest/' + token + '/cover')).status, 404);
  assert.equal((await put(url, jpg, 'image/jpeg', owner.cookie)).status, 200);             // leave one so deleting the invitation covers cascade
});

test('deleting an invitation removes its guests and links', async () => {
  assert.equal((await owner.del(`/api/invitations/${invId}`)).status, 200);
  assert.equal((await guest.get('/api/guest/' + token)).status, 404);
  const left = require('../src/db').prepare('SELECT COUNT(*) c FROM covers WHERE invitation_id=?').get(invId).c;
  assert.equal(left, 0);                                                                    // its cover went with it
});

test('a setup key, when configured, protects the first owner account', async () => {
  const os2 = require('os'), path2 = require('path'), fs2 = require('fs');
  const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'rsvp-key-'));
  const { spawn } = require('child_process');
  const port = 3999;
  const child = spawn(process.execPath, ['server.js'], { cwd: path2.join(__dirname, '..'), env: Object.assign({}, process.env, { DB_FILE: path2.join(dir, 'k.db'), PORT: String(port), SETUP_KEY: 'open-sesame-123' }), stdio: 'ignore' });
  try {
    let up = false;
    for (let i = 0; i < 40 && !up; i++) { try { await fetch('http://127.0.0.1:' + port + '/healthz'); up = true; } catch (e) { await new Promise((r) => setTimeout(r, 150)); } }
    assert.ok(up);
    const hdr = { 'Content-Type': 'application/json', 'X-Requested-With': 'rsvp' };
    const body = (k) => JSON.stringify({ name: 'Owner', email: 'o@example.com', password: 'a long owner password', setupKey: k });
    const st = await (await fetch('http://127.0.0.1:' + port + '/api/auth/status')).json();
    assert.equal(st.needsSetupKey, true);
    assert.equal((await fetch('http://127.0.0.1:' + port + '/api/auth/register', { method: 'POST', headers: hdr, body: body('guess') })).status, 403);
    assert.equal((await fetch('http://127.0.0.1:' + port + '/api/auth/register', { method: 'POST', headers: hdr, body: body('open-sesame-123') })).status, 201);
  } finally { child.kill(); fs2.rmSync(dir, { recursive: true, force: true }); }
});
