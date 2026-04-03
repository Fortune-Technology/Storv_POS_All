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
import { startTokenRefreshScheduler } from './utils/posScheduler.js';
import { connectPostgres, disconnectPostgres } from './config/postgres.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:5174')
    .split(',').map(s => s.trim()),
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
      return res.status(400).json({ error: 'File too large' });
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
    console.log(`✓ CORS enabled for: ${process.env.CORS_ORIGIN || 'http://localhost:5173, http://localhost:5174'}`);
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
