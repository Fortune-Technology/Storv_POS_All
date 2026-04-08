/**
 * Express server for the Future Foods Portal
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import apiRoutes from './routes/api.js';
import authRoutes from './routes/authRoutes.js';
import tenantRoutes from './routes/tenantRoutes.js';
import storeRoutes from './routes/storeRoutes.js';
import userManagementRoutes from './routes/userManagementRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import invoiceRoutes from './routes/invoiceRoutes.js';
import productRoutes from './routes/productRoutes.js';
import feeMappingRoutes from './routes/feeMappingRoutes.js';
import posRoutes from './routes/posRoutes.js';
import salesRoutes from './routes/salesRoutes.js';
import weatherRoutes from './routes/weatherRoutes.js';
import catalogRoutes     from './routes/catalogRoutes.js';
import posTerminalRoutes from './routes/posTerminalRoutes.js';
import reportsRoutes     from './routes/reportsRoutes.js';
import lotteryRoutes     from './routes/lotteryRoutes.js';
import paymentRoutes     from './routes/paymentRoutes.js';
import adminRoutes       from './routes/adminRoutes.js';
import publicRoutes      from './routes/publicRoutes.js';
import ticketRoutes      from './routes/ticketRoutes.js';
import { startTokenRefreshScheduler } from './utils/posScheduler.js';
import { connectPostgres, disconnectPostgres } from './config/postgres.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 5000;

// Middleware
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:5174,http://localhost:5175')
  .split(',')
  .map(s => s.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    // Check if '*' is in allowedOrigins or if origin is in the list
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`⚠️ CORS blocked for origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// API routes
app.use('/api/auth',         authRoutes);
app.use('/api/tenants',      tenantRoutes);
app.use('/api/stores',       storeRoutes);
app.use('/api/users',        userManagementRoutes);
app.use('/api/customers',    customerRoutes);
app.use('/api/invoice',      invoiceRoutes);
app.use('/api/products',     productRoutes);
app.use('/api/fees-mappings', feeMappingRoutes);
app.use('/api/pos',          posRoutes);
app.use('/api/sales',        salesRoutes);
app.use('/api/weather',      weatherRoutes);
app.use('/api/catalog',       catalogRoutes);
app.use('/api/pos-terminal', posTerminalRoutes);
app.use('/api/reports',      reportsRoutes);
app.use('/api/lottery',      lotteryRoutes);
app.use('/api/payment',      paymentRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/public',       publicRoutes);
app.use('/api/tickets',      ticketRoutes);
app.use('/api',              apiRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status:     'ok',
    timestamp:  new Date().toISOString(),
    database:   'postgresql',
    multiTenant: true,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum size is 10 MB.' });
    }
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start server
const startServer = async () => {
  const pgOk = await connectPostgres();

  if (!pgOk) {
    console.error('✗ PostgreSQL connection failed — set DATABASE_URL and ensure the server is running.');
    process.exit(1);
  }

  startTokenRefreshScheduler();

  app.listen(PORT, () => {
    console.log(`✓ Server running on port ${PORT}`);
    console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`✓ CORS enabled for: ${allowedOrigins.join(', ')}`);
    console.log('✓ Database: PostgreSQL (Prisma)');
  });
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received — shutting down gracefully');
  await disconnectPostgres();
  process.exit(0);
});

startServer();

export default app;
