'use strict';
// Sets a new password for an account (and makes it admin with --admin).
// Usage: node src/reset-password.js you@email.com NewPassword123 [--admin]
const db = require('./db');
const { hashPassword } = require('./util');

(async () => {
  const [email, password, flag] = process.argv.slice(2);
  if (!email || !password || password.length < 8) {
    console.log('Usage: node src/reset-password.js email new-password(8+ chars) [--admin]');
    process.exit(1);
  }
  const user = db.getUserByEmail(email);
  if (!user) { console.log(`No account with email ${email}`); process.exit(1); }
  const fields = { password_hash: await hashPassword(password), status: 'active' };
  if (flag === '--admin') fields.role = 'admin';
  db.updateUser(user.id, fields);
  db.deleteUserSessions(user.id);
  console.log(`Password updated for ${email}${flag === '--admin' ? ' (admin)' : ''}`);
})();
