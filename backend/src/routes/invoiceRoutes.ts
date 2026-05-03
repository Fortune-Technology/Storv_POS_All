import express from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
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

// Session 39 Round 5 — accepted file types. HEIC/HEIF is common on iPhones
// (iOS default camera format) and was previously silently rejected; it's
// now converted to JPEG server-side in gptService before OCR.
// Invoice Scanning follow-up — added the non-standard JPEG variants
// ('image/jpg', 'image/pjpeg') some Android/Windows browsers send, plus
// the generic 'application/octet-stream' and '' (empty) cases that
// occasionally slip through from mobile drag-drop / share-sheet uploads.
// These only pass when the file extension is also valid — see fileFilter.
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);
const ALLOWED_EXTS = /^(pdf|png|jpe?g|heic|heif)$/i;

const upload = multer({
  storage,
  // 20 MB — phone cameras routinely produce 6–15 MB photos. Previous 10 MB
  // limit was rejecting large iPhone/Galaxy captures with a generic 500.
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    const mimeOk = ALLOWED_MIMES.has(file.mimetype.toLowerCase());
    const extOk  = ALLOWED_EXTS.test(ext);
    if (mimeOk || extOk) return cb(null, true);
    // Attach an error code multer forwards to the route-level handler
    const err = new Error(`Unsupported file type: ${file.originalname} (${file.mimetype}). Accepted: PDF, PNG, JPG/JPEG, HEIC/HEIF.`) as Error & { code?: string };
    err.code = 'UNSUPPORTED_FILE_TYPE';
    cb(err);
  },
});

// Session 39 Round 5 — per-route wrapper that translates multer errors into
// descriptive JSON responses instead of the generic 500 the user was seeing.
// Previously a 10 MB photo or a HEIC file both hit "Unhandled error: ..."
// with no clue what was wrong. Now the upload UI gets a specific message.
type MulterErr = Error & { code?: string };
const handleMulterError =
  (uploader: RequestHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    uploader(req, res, ((err?: unknown) => {
      if (!err) return next();
      const muErr = err as MulterErr;
      if (muErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: 'File too large',
          detail: `One of the uploaded files exceeds the 20 MB limit. Reduce the image resolution or use PDF.`,
          code: 'FILE_TOO_LARGE',
        });
      }
      if (muErr.code === 'UNSUPPORTED_FILE_TYPE') {
        return res.status(415).json({ error: muErr.message, code: 'UNSUPPORTED_FILE_TYPE' });
      }
      if (muErr.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Unexpected file field', code: 'UNEXPECTED_FIELD' });
      }
      // Anything else — surface the message
      return res
        .status(500)
        .json({ error: muErr.message || 'Upload failed', code: muErr.code || 'UPLOAD_ERROR' });
    }) as NextFunction);
  };

router.use(protect);

// Writes (upload / confirm / rematch / draft)
router.post('/queue',           requirePermission('invoices.create'), handleMulterError(upload.array('invoices')), queueUpload);
router.post('/queue-multipage', requirePermission('invoices.create'), handleMulterError(upload.array('invoices')), queueMultipageUpload);
router.post('/upload',          requirePermission('invoices.create'), handleMulterError(upload.array('invoices')), uploadInvoices);
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
