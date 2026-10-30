'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'rsvp.db');
fs.mkdirSync(path.dirname(file), { recursive: true });

const db = new Database(file);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'host' CHECK (role IN ('admin','host')),
  active        INTEGER NOT NULL DEFAULT 1,
  must_change   INTEGER NOT NULL DEFAULT 0,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login    TEXT
);

CREATE TABLE IF NOT EXISTS invitations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  host_line  TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  closed     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inv_user ON invitations(user_id);

CREATE TABLE IF NOT EXISTS functions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invitation_id INTEGER NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  date          TEXT NOT NULL DEFAULT '',
  time          TEXT NOT NULL DEFAULT '',
  venue         TEXT NOT NULL DEFAULT '',
  price         INTEGER NOT NULL DEFAULT 0,
  position      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_fn_inv ON functions(invitation_id);

CREATE TABLE IF NOT EXISTS guests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invitation_id INTEGER NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL DEFAULT '',
  seats         INTEGER NOT NULL DEFAULT 2,
  token         TEXT NOT NULL UNIQUE,
  fn_ids        TEXT,
  note          TEXT NOT NULL DEFAULT '',
  responded_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_guest_inv ON guests(invitation_id);

CREATE TABLE IF NOT EXISTS responses (
  guest_id    INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  function_id INTEGER NOT NULL REFERENCES functions(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('yes','maybe','no')),
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guest_id, function_id)
);

CREATE TABLE IF NOT EXISTS covers (
  invitation_id INTEGER PRIMARY KEY REFERENCES invitations(id) ON DELETE CASCADE,
  data          BLOB NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1
);
`);

module.exports = db;
