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

const app = express();
const PORT = process.env.PORT || 3001;

// Request ID + structured logging middleware
app.use(requestIdMiddleware);

// CORS for development
app.use(cors({
  origin: true,
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

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/migrations', migrationRoutes);

// Public pricing endpoint (no auth required)
app.get('/api/pricing', migrationRoutes.getPricingHandler);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
