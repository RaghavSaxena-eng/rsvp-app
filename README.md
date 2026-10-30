# RSVP Desk

A minimal invitation and RSVP manager for wedding venues, banquet halls, planners and couples.
Every guest gets a **personal link**. Every account sees **only its own** invitations.

- Node.js + Express, SQLite (no database server to install)
- Sign-in with **JWT** in an httpOnly cookie, bcrypt passwords, rate limits and lockouts
- The owner creates accounts for clients; clients cannot see each other's data
- Plain HTML/CSS/JS front end, no build step

## Folders

```
rsvp-app/
  backend/     the server: API, accounts, JWT, database (Node + Express + SQLite)
  frontend/    what the browser loads: sign-in, dashboard, guest page (plain HTML/CSS/JS)
```

The backend serves the frontend folder and its own API from one address, so you deploy just one service.

## Run it on your computer

Needs **Node.js 22 or newer** (check with `node -v`).

```bash
cd backend
npm install
cp .env.example .env        # optional for local use
npm start                   # http://localhost:3000
```

Open http://localhost:3000. The **first account you create becomes the owner**.
To see sample data (from the `backend` folder): `node scripts/seed-demo.js you@example.com`

Run the tests (from the `backend` folder): `npm test`

## How it works day to day

1. **Create an invitation** ("Meera & Arjun").
2. **Add functions** (Mehendi, Sangeet, Reception) with date, venue and price per plate.
3. **Add guests**: paste names one per line. Optional phone and seats: `Sharma family, 98290 12345, 5`.
4. **Send links**: each guest row has *Copy link* and *WhatsApp* (opens WhatsApp with a ready message and the guest's personal link). *Copy all links* and *Export CSV* give you every link at once.
5. Watch the **Summary** tab: confirmed plates, maybes, and catering cost per function.
6. When the headcount is final, turn off **Accept replies** in Details.

### Guest links

A link looks like `https://your-site.com/r/Qe3x...` (22 random characters, one per guest).
It opens that guest's reply page, with their name, only the functions they are invited to, and a seat limit.
No sign-in is needed. If a link leaks, open the guest and choose **New link**; the old one stops working.

## Accounts, logout and security

| Need | Where |
| --- | --- |
| Sign out | Click your name (bottom of the sidebar, or top right on a phone) and choose **Sign out** |
| Sign out of every device | Same menu, **Sign out of all devices** |
| Add a client account | Owner only: **Accounts** > **Add account**. They get a temporary password and must change it at first sign-in |
| Reset a client's password | **Accounts** > **Reset password** |
| Disable a client | **Accounts** > **Disable** (signed out instantly) |

What protects the site:

- Passwords hashed with bcrypt (cost 12); minimum 10 characters.
- JWT (HS256, 12 hour expiry) stored in an **httpOnly, SameSite=Lax, Secure** cookie, so page scripts can never read it.
  Each token carries a version number; changing a password, disabling an account or "sign out everywhere" invalidates all older tokens.
- Cross-site request protection: every change needs a custom header and a matching Origin.
- Rate limits on every route, plus a 15 minute lockout after 8 wrong passwords for one email.
- Every query is parameterised. Every record is checked against the signed-in owner, so one client can never read or change another client's data.
- Strict Content-Security-Policy, no inline scripts, no framing, `noindex` on guest links.
- Guest pages never show prices or other guests.
- The server refuses to start in production without a strong `JWT_SECRET`.

Plain sign-out removes the cookie on that device. A copied token would stay valid until it expires (12 hours) unless you use "Sign out of all devices" or change the password.

## Put it online

You need a host that runs Node **and keeps a disk** (the SQLite file lives in `data/`).

1. Push this folder to a private GitHub repository.
2. Create a web service on Render, Railway or Fly.io from the repository.
   - Root directory: `backend`  Build: `npm install`  Start: `npm start`
   - Use `npm install`, not `npm ci`. The project turns off the lockfile on purpose, because the SQLite package ships ready-made binaries and a lockfile makes npm try to compile it.
3. Add a **persistent disk or volume** and set `DB_FILE` to a path on it (for example `/data/rsvp.db`).
4. Set environment variables: `NODE_ENV=production`, `JWT_SECRET` (32+ random characters), `SETUP_KEY` (any secret phrase), `TRUST_PROXY=1`, `ALLOW_SIGNUP=0`, `PUBLIC_URL`.
5. Open the site and create the owner account **immediately** (you will be asked for the setup key).
6. Point your own domain at it. HTTPS is provided by these hosts.
7. **Back up** the database file regularly (copy `rsvp.db`).

Free tiers without a disk lose data on every restart. Use a paid plan with a volume, or move the data layer to a hosted database.

## Folder map

```
backend/
  server.js             app setup, security headers, serves ../frontend
  src/db.js             tables
  src/security.js       passwords, JWT, CSRF, lockout
  src/routes.js         the whole API (/api/...)
  test/flow.test.js     end-to-end checks (npm test)
  scripts/seed-demo.js  sample wedding for demos
  .env.example          settings to copy into .env
frontend/
  index.html + js/login.js   sign-in
  app.html + js/app.js       dashboard
  guest.html + js/guest.js   guest reply page
  css/app.css                all styling
  css/fonts.css + fonts/     Cormorant and Instrument Sans, served from your own server (no Google Fonts)
  js/common.js, js/theme.js  shared helpers
```

## Cover photos

Open an invitation, then Details, then Cover photo. Guests see it at the top of their invitation.
Photos are resized in the browser and stored as JPEG in the database (up to about 900 KB). Without a photo, a painted arch is shown.
