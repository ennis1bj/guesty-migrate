require('dotenv').config();

// Validate required environment variables at startup
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'ENCRYPTION_KEY'];
const OPTIONAL_ENV = ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET'];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('See .env.example for required values.');
  process.exit(1);
}
const missingOptional = OPTIONAL_ENV.filter((key) => !process.env[key]);
if (missingOptional.length > 0) {
  console.warn(`Optional environment variables not set (some features may be unavailable): ${missingOptional.join(', ')}`);
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { pool, migrate } = require('./db');
const { initQueue, recoverStuckMigrations } = require('./queue');
const { logger, requestIdMiddleware } = require('./logger');

const authRoutes = require('./routes/auth');
const migrationRoutes = require('./routes/migrations');
const webhookRoutes = require('./routes/webhooks');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3001;

// Request ID + structured logging middleware
app.use(requestIdMiddleware);

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// CORS — restrict to FRONTEND_URL in production, allow all in development
const isProd = process.env.NODE_ENV === 'production';
app.use(cors({
  origin: isProd ? (process.env.FRONTEND_URL || false) : true,
  credentials: true,
}));

// Webhook routes need raw body — mount before json parser
app.use('/api/webhooks', webhookRoutes);

// JSON parser for all other routes
app.use(express.json());

// Rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/auth', authLimiter);

// Rate limiting for migration routes
const migrationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/migrations', migrationLimiter);

// Rate limiting for admin routes
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/admin', adminLimiter);

// Rate limiting for webhook routes
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests' },
});
app.use('/api/webhooks', webhookLimiter);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/migrations', migrationRoutes);
app.use('/api/admin', adminRoutes);

// Public pricing endpoint (no auth required)
app.get('/api/pricing', migrationRoutes.getPricingHandler);

// Health check — verifies database connectivity
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('Health check failed', { error: err.message });
    res.status(503).json({ status: 'degraded', timestamp: new Date().toISOString(), error: 'Database unreachable' });
  }
});

// API documentation (Swagger UI)
if (process.env.NODE_ENV !== 'production') {
  const { mountSwagger } = require('./swagger');
  mountSwagger(app);
  logger.info('API docs available at /api/docs');
}

// Serve frontend in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Start server
async function start() {
  try {
    // Run database migrations
    await migrate();
    logger.info('Database ready');

    // Recover any stuck migrations from before restart
    await recoverStuckMigrations();

    // Initialize job queue
    initQueue();

    app.listen(PORT, () => {
      logger.info(`GuestyMigrate server running on port ${PORT}`);
    });
  } catch (err) {
    logger.error('Failed to start server', { error: err.message });
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = app;
