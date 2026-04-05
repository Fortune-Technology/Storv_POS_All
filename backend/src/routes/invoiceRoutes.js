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
} from '../controllers/invoiceController.js';
import { protect, authorize } from '../middleware/auth.js';
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
router.use(authorize('superadmin', 'admin', 'owner', 'manager', 'cashier', 'store'));

// instant-queue: single or multiple separate invoices
router.post('/queue', upload.array('invoices'), queueUpload);
// instant-queue: multiple files as ONE multi-page invoice
router.post('/queue-multipage', upload.array('invoices'), queueMultipageUpload);

// Legacy synchronous upload (kept for compatibility)
router.post('/upload', upload.array('invoices'), uploadInvoices);

router.post('/confirm', confirmInvoice);
router.post('/clear-pos-cache', clearInvoicePOSCache);
router.get('/history', getInvoiceHistory);
router.get('/drafts', getInvoiceDrafts);
router.patch('/:id/draft', saveDraft);
router.get('/:id', getInvoiceById);
router.delete('/drafts/:id', deleteDraft);

export default router;
