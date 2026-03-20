#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool, migrate } = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const EMAIL    = process.env.ADMIN_EMAIL || process.argv[2] || 'admin@guestymigrate.com';
const PASSWORD = process.env.ADMIN_PASSWORD || process.argv[3] || crypto.randomBytes(16).toString('base64url');
const generatedPassword = !process.env.ADMIN_PASSWORD && !process.argv[3];

(async () => {
  await migrate();

  const hash = await bcrypt.hash(PASSWORD, 12);

  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, email_verified, is_admin)
     VALUES ($1, $2, true, true)
     ON CONFLICT (email) DO UPDATE
       SET password_hash   = EXCLUDED.password_hash,
           email_verified  = true,
           is_admin        = true
     RETURNING id, email, is_admin`,
    [EMAIL, hash],
  );

  const user = rows[0];
  console.log('\nAdmin user ready:');
  console.log('  ID:       ', user.id);
  console.log('  Email:    ', user.email);
  if (generatedPassword) {
    // Only print auto-generated passwords; never echo user-supplied ones
    console.log('  Password: ', PASSWORD);
    console.log('  ⚠  Save this password now — it will not be shown again.');
  } else {
    console.log('  Password:  (set via env/arg — not echoed)');
  }
  console.log('  is_admin: ', user.is_admin);
  console.log('');

  await pool.end();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
