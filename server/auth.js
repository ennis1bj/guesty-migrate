const jwt = require('jsonwebtoken');

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      is_demo: !!user.is_demo,
      is_beta: !!user.is_beta,
      beta_expires_at: user.beta_expires_at || null,
      is_admin: !!user.is_admin,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

async function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  // Re-verify admin status from the database on each request to prevent
  // privilege escalation via stale JWT claims
  try {
    const { pool } = require('./db');
    const result = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows[0]?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Authorization check failed' });
  }
  next();
}

module.exports = { generateToken, authenticateToken, requireAdmin };
