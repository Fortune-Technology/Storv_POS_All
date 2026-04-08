/**
 * Image upload routes for the e-commerce module.
 * Stores images in ecom-backend/uploads/ and serves them statically.
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { protect, authorize } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${nanoid(12)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed (JPEG, PNG, GIF, WebP, SVG)'));
  },
});

const router = Router();
const auth = [protect, authorize('owner', 'admin', 'manager', 'superadmin')];

router.post('/upload', ...auth, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided' });
  }
  const url = `/uploads/${req.file.filename}`;
  res.json({ success: true, url, filename: req.file.filename });
});

export default router;
