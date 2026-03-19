require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { pool, migrate } = require('./db');
const { initQueue, recoverStuckMigrations } = require('./queue');

const authRoutes = require('./routes/auth');
const migrationRoutes = require('./routes/migrations');
const webhookRoutes = require('./routes/webhooks');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS for development
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
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

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/migrations', migrationRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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
    console.log('Database ready');

    // Recover any stuck migrations from before restart
    await recoverStuckMigrations();

    // Initialize job queue
    initQueue();

    app.listen(PORT, () => {
      console.log(`GuestyMigrate server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
