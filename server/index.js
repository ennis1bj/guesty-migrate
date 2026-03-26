require('dotenv').config();
const { OperatorDeck } = require('./operatordeck');
OperatorDeck.captureConsole();

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
const { pool, migrate, purgeExpiredCredentials } = require('./db');
const { initQueue, recoverStuckMigrations, getQueueHealth } = require('./queue');
const { logger, requestIdMiddleware } = require('./logger');

const authRoutes = require('./routes/auth');
const migrationRoutes = require('./routes/migrations');
const webhookRoutes = require('./routes/webhooks');
const adminRoutes = require('./routes/admin');
const publicRoutes = require('./routes/public');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust the first proxy (required on Replit/Heroku/etc. for rate-limit IP detection)
app.set('trust proxy', 1);

// Request ID + structured logging middleware
app.use(requestIdMiddleware);

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://js.stripe.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://open-api.guesty.com https://js.stripe.com https://api.stripe.com; frame-src https://js.stripe.com; object-src 'none'; base-uri 'self'"
  );
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// CORS — restrict to FRONTEND_URL in production; explicit localhost allowlist in dev
const isProd = process.env.NODE_ENV === 'production';
const isDev = process.env.NODE_ENV === 'development';
app.use(cors({
  origin: isProd
    ? (process.env.FRONTEND_URL || false)
    : isDev
      ? ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173']
      : false,  // NODE_ENV not set — deny by default for safety
  credentials: true,
}));

// Webhook routes need raw body — mount before json parser
app.use('/api/webhooks', webhookRoutes);

// JSON parser for all other routes
app.use(express.json());

// Cookie parser for httpOnly JWT cookies
const cookieParser = require('cookie-parser');
app.use(cookieParser());

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

// Public routes (no auth required) with dedicated rate limiter
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api', publicLimiter, publicRoutes);

// Health check — verifies database connectivity and reports job execution mode (#78)
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    const queueHealth = getQueueHealth();
    const status = queueHealth.degraded ? 'degraded' : 'ok';
    const statusCode = queueHealth.degraded ? 200 : 200; // still 200 — app works in degraded mode
    res.status(statusCode).json({
      status,
      timestamp: new Date().toISOString(),
      database: 'connected',
      jobs: queueHealth,
    });
  } catch (err) {
    logger.error('Health check failed', { error: err.message });
    const queueHealth = getQueueHealth();
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'unreachable',
      error: 'Database unreachable',
      jobs: queueHealth,
    });
  }
});

// API documentation (Swagger UI) — only in explicit development mode
if (process.env.NODE_ENV === 'development') {
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

    // Purge credentials from completed migrations older than 30 days
    await purgeExpiredCredentials();

    // Recover any stuck migrations from before restart
    await recoverStuckMigrations();

    // Initialize job queue (async — pre-tests Redis before handing to BullMQ)
    await initQueue();

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
