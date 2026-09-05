import { Router } from 'express';
import { systemController } from '../controllers/system.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { apiRateLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

router.get('/client-id', (req, res) => systemController.getClientId(req, res));

router.get('/rate-limit/status', authMiddleware, apiRateLimiter, (req, res) =>
  systemController.getRateLimitStatus(req, res)
);

router.get('/services/health', authMiddleware, apiRateLimiter, (req, res) =>
  systemController.getServicesHealth(req, res)
);

export default router;
