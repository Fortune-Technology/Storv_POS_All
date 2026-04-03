import express from 'express';
import { getFeeMappings, upsertFeeMapping, deleteFeeMapping } from '../controllers/feeMappingController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);
router.use(authorize('admin', 'store'));

router.get('/', getFeeMappings);
router.post('/', upsertFeeMapping);
router.delete('/:id', deleteFeeMapping);

export default router;
