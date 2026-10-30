'use strict';
/* Adds a sample wedding (3 functions, 12 guests with replies) to an existing account.
   Usage: node scripts/seed-demo.js you@example.com                                   */
require('dotenv').config({ quiet: true });
const db = require('../src/db');
const { newToken } = require('../src/security');

const email = (process.argv[2] || '').toLowerCase();
const user = db.prepare('SELECT id FROM users WHERE email=?').get(email);
if (!user) { console.error('No account with that email. Create it first by signing up in the app.'); process.exit(1); }

const inv = db.prepare('INSERT INTO invitations (user_id,title,host_line,note) VALUES (?,?,?,?)')
  .run(user.id, 'Meera & Arjun', 'Together with their families', 'Please reply by 20 January. Tell us how many will join you at each function.').lastInsertRowid;
const fn = db.prepare('INSERT INTO functions (invitation_id,name,date,time,venue,price) VALUES (?,?,?,?,?,?)');
const f = [
  fn.run(inv, 'Mehendi', '2027-02-10', '16:00', 'Garden Lawn', 1800).lastInsertRowid,
  fn.run(inv, 'Sangeet', '2027-02-11', '19:30', 'Grand Ballroom', 3200).lastInsertRowid,
  fn.run(inv, 'Wedding & Dinner', '2027-02-12', '20:00', 'Grand Ballroom', 4500).lastInsertRowid
];
const G = [
  ['Sharma family', '9829012345', 5, [['yes', 5], ['yes', 5], ['yes', 5]]],
  ['Rao family', '9414011122', 4, [['yes', 4], ['maybe', 4], ['yes', 4]]],
  ['Kavita Menon', '', 2, [['yes', 2], ['yes', 2], ['yes', 2]]],
  ['Iyer family', '9001122334', 3, [['no', 0], ['maybe', 3], ['yes', 3]]],
  ['Dev & Anika', '', 2, [['yes', 2], ['yes', 2], ['maybe', 2]]],
  ['Mehta family', '9928877665', 6, [['maybe', 6], ['yes', 6], ['yes', 6]]],
  ['Farhan Qureshi', '', 1, [['no', 0], ['yes', 1], ['yes', 1]]],
  ['Bansal family', '9887766554', 3, [['yes', 3], ['yes', 3], ['yes', 3]]],
  ['Neha Kapoor', '', 2, [['no', 0], ['no', 0], ['yes', 2]]],
  ['Singh family', '9460011223', 4, [['maybe', 4], ['maybe', 4], ['yes', 4]]],
  ['Joshi family', '', 3, null],
  ['Pooja & Karan', '9414099887', 2, null]
];
const gi = db.prepare('INSERT INTO guests (invitation_id,name,phone,seats,token,responded_at) VALUES (?,?,?,?,?,?)');
const ri = db.prepare('INSERT INTO responses (guest_id,function_id,status,count) VALUES (?,?,?,?)');
db.transaction(() => {
  G.forEach(([name, phone, seats, rs]) => {
    const id = gi.run(inv, name, phone, seats, newToken(), rs ? new Date().toISOString() : null).lastInsertRowid;
    if (rs) rs.forEach((r, i) => ri.run(id, f[i], r[0], r[1]));
  });
})();
console.log('Sample invitation added to ' + email + '.');
