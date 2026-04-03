import express from 'express';
import {
  queueUpload,
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

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
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

// NEW: instant-queue endpoint (responds immediately, processes in background)
router.post('/queue', upload.array('invoices'), queueUpload);

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
