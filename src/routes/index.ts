import { Router, static as expressStatic } from 'express';
import path from 'path';
import fs from 'fs';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from '../swagger/openapi';
import healthRoutes from './health.routes';
import systemRoutes from './system.routes';
import backupRoutes from './backup.routes';
import dashboardRoutes from './dashboard.routes';
import restoreRoutes from './restore.routes';
import metadataRoutes from './metadata.routes';
import { authMiddleware } from '../middleware/auth.middleware';
import { backupRateLimiter, apiRateLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

// Health route (unprotected, unthrottled)
router.use('/health', healthRoutes);

// Swagger Documentation JSON & UI endpoints
router.get('/api-docs/json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(swaggerSpec);
});
router.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Static Dashboard serving for production and npm deployment
const dashboardDistPath = [
  path.resolve(__dirname, '../../dashboard/dist'),
  path.resolve(__dirname, '../../../dashboard/dist'),
  path.resolve(process.cwd(), 'dashboard/dist'),
].find((p) => fs.existsSync(p)) || path.resolve(__dirname, '../../dashboard/dist');

router.get('/', (_req, res) => {
  res.redirect('/dashboard');
});
router.use('/dashboard', expressStatic(dashboardDistPath));
router.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(dashboardDistPath, 'index.html'));
});
router.use('/', expressStatic(dashboardDistPath));

// Dashboard API (no client ID required for dashboard telemetry reading)
router.use('/api/dashboard', dashboardRoutes);

// Protected and rate-limited API routes
router.use('/api/backup', authMiddleware, backupRateLimiter, backupRoutes);
router.use('/api/restore', authMiddleware, apiRateLimiter, restoreRoutes);
router.use('/api', metadataRoutes);
router.use('/api', systemRoutes);

export default router;
