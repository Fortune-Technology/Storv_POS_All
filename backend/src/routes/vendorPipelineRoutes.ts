// ─────────────────────────────────────────────────
// Vendor Pipeline route — unified per-vendor list (S80)
// Mounted at /api/admin/vendor-pipeline
// ─────────────────────────────────────────────────
import express from 'express';
import { protect } from '../middleware/auth.js';
import { adminListPipeline } from '../controllers/vendorPipelineController.js';

const router = express.Router();
router.get('/', protect, adminListPipeline);

export default router;
