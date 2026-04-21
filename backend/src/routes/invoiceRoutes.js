import express from 'express';
import {
  queueUpload,
  queueMultipageUpload,
  uploadInvoices,
  confirmInvoice,
  getInvoiceHistory,
  getInvoiceDrafts,
  getInvoiceById,
  deleteDraft,
  saveDraft,
  clearInvoicePOSCache,
  getMatchAccuracy,
  rematchInvoice,
  getVendorInvoiceSummary,
} from '../controllers/invoiceController.js';
import { protect } from '../middleware/auth.js';
import { requirePermission } from '../rbac/permissionService.js';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Absolute path — resolves correctly regardless of where Node is started from.
// Resolves to <repo-root>/backend/uploads
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../../uploads');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = /pdf|png|jpg|jpeg/;
    const ext = file.originalname.split('.').pop().toLowerCase();
    if (allowed.test(file.mimetype) && allowed.test(ext)) return cb(null, true);
    cb(new Error('Only PDF, PNG, JPG and JPEG files are allowed'));
  },
});

router.use(protect);

// Writes (upload / confirm / rematch / draft)
router.post('/queue',           requirePermission('invoices.create'), upload.array('invoices'), queueUpload);
router.post('/queue-multipage', requirePermission('invoices.create'), upload.array('invoices'), queueMultipageUpload);
router.post('/upload',          requirePermission('invoices.create'), upload.array('invoices'), uploadInvoices);
router.post('/confirm',         requirePermission('invoices.edit'),   confirmInvoice);
router.post('/clear-pos-cache', requirePermission('invoices.edit'),   clearInvoicePOSCache);
router.patch('/:id/draft',      requirePermission('invoices.edit'),   saveDraft);
router.post('/:id/rematch',     requirePermission('invoices.edit'),   rematchInvoice);
router.delete('/drafts/:id',    requirePermission('invoices.delete'), deleteDraft);

// Reads
router.get('/accuracy',        requirePermission('invoices.view'), getMatchAccuracy);
router.get('/history',         requirePermission('invoices.view'), getInvoiceHistory);
router.get('/drafts',          requirePermission('invoices.view'), getInvoiceDrafts);
router.get('/vendor-summary',  requirePermission('invoices.view'), getVendorInvoiceSummary);
router.get('/:id',             requirePermission('invoices.view'), getInvoiceById);

export default router;
