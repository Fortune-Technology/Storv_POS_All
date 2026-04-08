/**
 * E-commerce backend server for the Storv POS platform.
 * Separate Express app with its own PostgreSQL database.
 *
 * Redis is OPTIONAL: if not available, sync worker doesn't start
 * and inventory caching is disabled. The API still works for
 * browsing products and managing the store.
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

import { connectPostgres, disconnectPostgres } from './config/postgres.js';
import { getRedisClient, disconnectRedis, isRedisAvailable } from '@storv/redis';

import path from 'path';
import { fileURLToPath } from 'url';
import publicRoutes from './routes/publicRoutes.js';
import manageRoutes from './routes/manageRoutes.js';
import customerAuthRoutes from './routes/customerAuthRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import syncRoutes from './routes/syncRoutes.js';
import internalRoutes from './routes/internalRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 5005;

// ── CORS ────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:3000')
  .split(',')
  .map(s => s.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ── Static files (uploaded images) ───────────────────────────────────────
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

// ── Routes ──────────────────────────────────────────────────────────────
app.use('/api', publicRoutes);           // Public storefront API
app.use('/api', customerAuthRoutes);     // Customer auth (signup/login/profile)
app.use('/api/manage', manageRoutes);    // Portal management API
app.use('/api/manage', uploadRoutes);    // Image upload
app.use('/api/internal', syncRoutes);    // Direct sync (POS → ecom, no Redis)
app.use('/', internalRoutes);            // Health check

// ── Error handler ───────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Startup ─────────────────────────────────────────────────────────────
const startServer = async () => {
  // Connect to e-commerce database
  const pgOk = await connectPostgres();
  if (!pgOk) {
    console.error('✗ E-commerce database connection failed');
    process.exit(1);
  }

  // Try Redis (optional)
  try {
    const redis = getRedisClient();
    if (redis) {
      await redis.ping();
      console.log('✓ Redis connected (ecom-backend)');
    }
  } catch (err) {
    console.log('⚠ Redis not available — sync worker and inventory cache disabled');
  }

  // Start BullMQ sync worker only if Redis is available
  if (isRedisAvailable()) {
    try {
      const { startSyncWorker } = await import('./workers/syncWorker.js');
      startSyncWorker();
    } catch (err) {
      console.log('⚠ Sync worker failed to start:', err.message);
    }
  } else {
    console.log('⚠ Sync worker skipped — Redis not available');
  }

  app.listen(PORT, () => {
    console.log(`✓ E-commerce backend running on port ${PORT}`);
    console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`✓ Redis: ${isRedisAvailable() ? 'connected' : 'not available (optional)'}`);
  });
};

// ── Graceful shutdown ───────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('SIGTERM received — shutting down');
  await disconnectPostgres();
  await disconnectRedis();
  process.exit(0);
});

startServer();

export default app;
