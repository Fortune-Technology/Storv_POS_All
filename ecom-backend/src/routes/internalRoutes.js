/**
 * Internal routes — health check, ISR revalidation trigger.
 */

import { Router } from 'express';

const router = Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ecom-backend',
    timestamp: new Date().toISOString(),
  });
});

export default router;
