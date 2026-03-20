const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { pool } = require('../db');
const { generateToken, authenticateToken } = require('../auth');
const { logger } = require('../logger');

const router = express.Router();

// ── Helper: send email (via Resend or console fallback) ─────────────────────

async function sendEmail(to, subject, html) {
  let client;
  if (process.env.RESEND_API_KEY) {
    const { Resend } = require('resend');
    client = new Resend(process.env.RESEND_API_KEY);
  } else {
    client = {
      emails: {
        send: async (opts) => {
          logger.info('Email (no Resend configured)', { to: opts.to, subject: opts.subject });
          return { id: 'console-' + Date.now() };
        },
      },
    };
  }
  return client.emails.send({
    from: process.env.FROM_EMAIL || 'noreply@guestymigrate.com',
    to,
    subject,
    html,
  });
}

// ── POST /api/auth/register ─────────────────────────────────────────────────

router.post('/register',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { email, password } = req.body;

      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const verifyToken = crypto.randomBytes(32).toString('hex');
      const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      const isDemo = process.env.NODE_ENV === 'test';
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, email_verified, verify_token, verify_token_expires, is_demo)
         VALUES ($1, $2, false, $3, $4, $5)
         RETURNING id, email, is_demo, email_verified, created_at`,
        [email, passwordHash, verifyToken, verifyExpires, isDemo]
      );

      const user = result.rows[0];
      const token = generateToken(user);

      // Send verification email
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const verifyUrl = `${baseUrl}/verify-email?token=${verifyToken}`;
      try {
        await sendEmail(email, 'Verify your GuestyMigrate email', `
          <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
            <h2 style="color:#4f46e5">Verify Your Email</h2>
            <p>Thanks for signing up for GuestyMigrate. Click the button below to verify your email address.</p>
            <a href="${verifyUrl}" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
              Verify Email
            </a>
            <p style="color:#6b7280;font-size:14px">This link expires in 24 hours.</p>
          </div>
        `);
      } catch (emailErr) {
        logger.warn('Failed to send verification email', { error: emailErr.message });
      }

      res.status(201).json({ token, user: { id: user.id, email: user.email, is_demo: user.is_demo, email_verified: false } });
    } catch (err) {
      logger.error('Register error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── GET /api/auth/verify/:token ─────────────────────────────────────────────

router.get('/verify/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const result = await pool.query(
      `UPDATE users SET email_verified = true, verify_token = NULL, verify_token_expires = NULL
       WHERE verify_token = $1 AND verify_token_expires > NOW()
       RETURNING id, email`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired verification link' });
    }

    res.json({ success: true, message: 'Email verified successfully' });
  } catch (err) {
    logger.error('Verify error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/auth/login ────────────────────────────────────────────────────

router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { email, password } = req.body;

      const result = await pool.query('SELECT id, email, password_hash, is_demo, email_verified FROM users WHERE email = $1', [email]);
      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = generateToken(user);
      res.json({ token, user: { id: user.id, email: user.email, is_demo: user.is_demo, email_verified: user.email_verified } });
    } catch (err) {
      logger.error('Login error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── POST /api/auth/forgot-password ──────────────────────────────────────────

router.post('/forgot-password',
  body('email').isEmail().normalizeEmail(),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { email } = req.body;

      // Always return success to prevent email enumeration
      const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (result.rows.length === 0) {
        return res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
      }

      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await pool.query(
        'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE email = $3',
        [resetToken, resetExpires, email]
      );

      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

      await sendEmail(email, 'Reset your GuestyMigrate password', `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
          <h2 style="color:#4f46e5">Reset Your Password</h2>
          <p>You requested a password reset for your GuestyMigrate account. Click the button below to set a new password.</p>
          <a href="${resetUrl}" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
            Reset Password
          </a>
          <p style="color:#6b7280;font-size:14px">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
        </div>
      `);

      res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
    } catch (err) {
      logger.error('Forgot password error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── POST /api/auth/reset-password ───────────────────────────────────────────

router.post('/reset-password',
  body('token').notEmpty(),
  body('password').isLength({ min: 6 }),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { token, password } = req.body;
      const passwordHash = await bcrypt.hash(password, 10);

      const result = await pool.query(
        `UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL
         WHERE reset_token = $2 AND reset_token_expires > NOW()
         RETURNING id, email`,
        [passwordHash, token]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid or expired reset token' });
      }

      res.json({ success: true, message: 'Password reset successfully' });
    } catch (err) {
      logger.error('Reset password error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── GDPR Data Subject Rights ────────────────────────────────────────────────

// GET /api/auth/export — export all user data in JSON format
router.get('/export', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [userResult, migrationsResult, logsResult] = await Promise.all([
      pool.query('SELECT id, email, created_at, email_verified FROM users WHERE id = $1', [userId]),
      pool.query('SELECT id, status, manifest, selected_categories, selected_addons, pricing_mode, results, diff_report, created_at, completed_at FROM migrations WHERE user_id = $1 ORDER BY created_at DESC', [userId]),
      pool.query(
        `SELECT ml.* FROM migration_logs ml
         INNER JOIN migrations m ON m.id = ml.migration_id
         WHERE m.user_id = $1 ORDER BY ml.created_at ASC`,
        [userId]
      ),
    ]);

    res.json({
      user: userResult.rows[0] || null,
      migrations: migrationsResult.rows,
      migration_logs: logsResult.rows,
      exported_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Data export error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/auth/account — delete user account and cascade all data
router.delete('/account', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    await client.query('BEGIN');

    // Delete migration logs for all of this user's migrations
    await client.query(
      `DELETE FROM migration_logs WHERE migration_id IN (SELECT id FROM migrations WHERE user_id = $1)`,
      [userId]
    );

    // Delete migrations
    await client.query('DELETE FROM migrations WHERE user_id = $1', [userId]);

    // Delete user
    await client.query('DELETE FROM users WHERE id = $1', [userId]);

    await client.query('COMMIT');

    res.json({ success: true, message: 'Account and all associated data deleted' });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Account deletion error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
