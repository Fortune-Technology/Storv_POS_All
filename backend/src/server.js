/**
 * Express server for the StoreVeu POS Portal
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import apiRoutes from './routes/api.js';
import { autoAudit } from './middleware/autoAudit.js';
import authRoutes from './routes/authRoutes.js';
import tenantRoutes from './routes/tenantRoutes.js';
import storeRoutes from './routes/storeRoutes.js';
import userManagementRoutes from './routes/userManagementRoutes.js';
import invitationRoutes from './routes/invitationRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import invoiceRoutes from './routes/invoiceRoutes.js';
import productRoutes from './routes/productRoutes.js';
import feeMappingRoutes from './routes/feeMappingRoutes.js';
import posRoutes from './routes/posRoutes.js';
import salesRoutes from './routes/salesRoutes.js';
import weatherRoutes from './routes/weatherRoutes.js';
import catalogRoutes     from './routes/catalogRoutes.js';
import vendorTemplateRoutes from './routes/vendorTemplateRoutes.js';
import posTerminalRoutes from './routes/posTerminalRoutes.js';
import reportsRoutes     from './routes/reportsRoutes.js';
import lotteryRoutes     from './routes/lotteryRoutes.js';
import dailySaleRoutes   from './routes/dailySaleRoutes.js';
import fuelRoutes        from './routes/fuelRoutes.js';
import { scanDataRouter, couponsRouter } from './routes/scanDataRoutes.js';
import loyaltyRoutes     from './routes/loyaltyRoutes.js';
import dejavooPaymentRoutes from './routes/dejavooPaymentRoutes.js';
import dejavooHppRoutes     from './routes/dejavooHppRoutes.js';
import adminRoutes       from './routes/adminRoutes.js';
import priceScenarioRoutes from './routes/priceScenarioRoutes.js';
import stateRoutes        from './routes/stateRoutes.js';
import quickButtonRoutes  from './routes/quickButtonRoutes.js';
import publicRoutes      from './routes/publicRoutes.js';
import ticketRoutes      from './routes/ticketRoutes.js';
import billingRoutes     from './routes/billingRoutes.js';
import equipmentRoutes   from './routes/equipmentRoutes.js';
import orderRoutes        from './routes/orderRoutes.js';
import vendorReturnRoutes         from './routes/vendorReturnRoutes.js';
import inventoryAdjustmentRoutes  from './routes/inventoryAdjustmentRoutes.js';
import reportsHubRoutes           from './routes/reportsHubRoutes.js';
import chatRoutes        from './routes/chatRoutes.js';
import taskRoutes        from './routes/taskRoutes.js';
import auditRoutes       from './routes/auditRoutes.js';
import { spawnRecurringTasks } from './controllers/taskController.js';
import labelQueueRoutes  from './routes/labelQueueRoutes.js';
import labelPrintJobRoutes from './routes/labelPrintJobRoutes.js';
import roleRoutes        from './routes/roleRoutes.js';
import integrationRoutes from './routes/integrationRoutes.js';
import webhookRoutes     from './routes/webhookRoutes.js';
import storefrontAuthRoutes from './routes/storefrontAuthRoutes.js';
import exchangeRoutes       from './routes/exchangeRoutes.js';
import aiAssistantRoutes    from './routes/aiAssistantRoutes.js';
import { startTokenRefreshScheduler } from './utils/posScheduler.js';
import { startBillingScheduler } from './services/billingScheduler.js';
import { startShiftScheduler }  from './services/shiftScheduler.js';
import { startLoyaltyScheduler } from './services/loyaltyScheduler.js';
import { startPendingMoveScheduler } from './services/lottery/index.js';
import { startScanDataScheduler } from './services/scanData/scanDataScheduler.js';
import { startAckPoller } from './services/scanData/ackPoller.js';
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
  // Expose download-related + row-count headers so the frontend can read the
  // server-provided filename + rowCount from CSV/PDF/XLSX exports
  exposedHeaders: ['Content-Disposition', 'X-Row-Count'],
}));
// Body parser. The `verify` callback stashes the raw byte buffer on req.rawBody
// so HMAC-signed webhooks (Dejavoo HPP, future webhook providers) can verify
// signatures against the exact bytes received — JSON.stringify(req.body) is
// NOT byte-identical to the original payload (key order, whitespace differ).
app.use(express.json({
  limit: '15mb',
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
}));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Static files — re-hosted product images
app.use('/uploads/product-images', express.static(path.join(__dirname, '..', 'uploads', 'product-images'), {
  maxAge: '30d',
  immutable: true,
}));

// Static files — quick-button tile images. Not marked `immutable` because
// users may overwrite an image with a new upload and expect the new one.
app.use('/uploads/quick-buttons', express.static(path.join(__dirname, '..', 'uploads', 'quick-buttons'), {
  maxAge: '1d',
}));

// Global fire-and-forget audit logger for every POST/PUT/PATCH/DELETE.
// Runs AFTER the response is sent, so it never blocks the request path.
app.use('/api', autoAudit({ logFailures: true }));

// API routes
app.use('/api/auth',         authRoutes);
app.use('/api/tenants',      tenantRoutes);
app.use('/api/stores',       storeRoutes);
app.use('/api/users',        userManagementRoutes);
app.use('/api/invitations',  invitationRoutes);
app.use('/api/customers',    customerRoutes);
app.use('/api/invoice',      invoiceRoutes);
app.use('/api/products',     productRoutes);
app.use('/api/fees-mappings', feeMappingRoutes);
app.use('/api/pos',          posRoutes);
app.use('/api/sales',        salesRoutes);
app.use('/api/weather',      weatherRoutes);
app.use('/api/catalog',       catalogRoutes);
app.use('/api/vendor-templates', vendorTemplateRoutes);
app.use('/api/pos-terminal', posTerminalRoutes);
app.use('/api/reports',      reportsRoutes);
app.use('/api/lottery',      lotteryRoutes);
app.use('/api/daily-sale',   dailySaleRoutes);
app.use('/api/fuel',         fuelRoutes);
// Session 45 — Scan Data / Tobacco compliance + Manufacturer Coupons
app.use('/api/scan-data',    scanDataRouter);
app.use('/api/coupons',      couponsRouter);
app.use('/api/loyalty',      loyaltyRoutes);
// HPP routes mount BEFORE SPIn — order matters because dejavooPaymentRoutes
// applies `protect` (JWT) globally, which would block the public webhook
// and the internal-API-key create-session call. Mounting the more-specific
// path first lets Express match HPP requests before they reach the SPIn router.
app.use('/api/payment/dejavoo/hpp', dejavooHppRoutes);
app.use('/api/payment/dejavoo',     dejavooPaymentRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/price-scenarios', priceScenarioRoutes);
app.use('/api/states',          stateRoutes);
app.use('/api/quick-buttons',   quickButtonRoutes);
app.use('/api/billing',        billingRoutes);
app.use('/api/equipment',      equipmentRoutes);
app.use('/api/vendor-orders',   orderRoutes);
app.use('/api/vendor-returns',          vendorReturnRoutes);
app.use('/api/inventory/adjustments',  inventoryAdjustmentRoutes);
app.use('/api/reports/hub',    reportsHubRoutes);
app.use('/api/chat',           chatRoutes);
app.use('/api/tasks',          taskRoutes);
app.use('/api/audit',          auditRoutes);
app.use('/api/label-queue',    labelQueueRoutes);
app.use('/api/label-print-jobs', labelPrintJobRoutes);
app.use('/api/roles',          roleRoutes);
app.use('/api/public',         publicRoutes);
app.use('/api/tickets',        ticketRoutes);
app.use('/api/integrations',   integrationRoutes);
app.use('/api/storefront',     storefrontAuthRoutes);
app.use('/api/exchange',       exchangeRoutes);
app.use('/api/ai-assistant',   aiAssistantRoutes);
app.use('/webhook',            webhookRoutes);      // PUBLIC — no auth middleware
app.use('/api',                apiRoutes);

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
  startBillingScheduler();
  startShiftScheduler();
  startLoyaltyScheduler();
  startPendingMoveScheduler();
  startScanDataScheduler();
  startAckPoller();

  // Recurring task spawner — checks every 15 minutes for tasks due
  setInterval(() => spawnRecurringTasks().catch(() => {}), 15 * 60 * 1000);
  spawnRecurringTasks().catch(() => {}); // Initial run on startup

  // Start order auto-scheduler (daily at 6 AM)
  import('./services/orderScheduler.js')
    .then(m => m.startOrderScheduler())
    .catch(err => console.warn('⚠ Order scheduler not started:', err.message));

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
