import { Router } from 'express';
import { dashboardController } from './dashboard.controller';
import {
  validateBody,
  validateParams,
  validateQuery,
  IdParamSchema,
  TriggerBackupSchema,
  DashboardBackupsQuerySchema,
  DashboardLogsQuerySchema,
} from '../../../../validators';

const router = Router();

router.get('/summary', (req, res) => dashboardController.getSummary(req, res));
router.get('/backups', validateQuery(DashboardBackupsQuerySchema), (req, res) => dashboardController.getBackups(req, res));
router.get('/backups/active', (req, res) => dashboardController.getActiveBackups(req, res));
router.get('/queues', (req, res) => dashboardController.getQueues(req, res));
router.get('/logs', validateQuery(DashboardLogsQuerySchema), (req, res) => dashboardController.getLogs(req, res));
router.get('/alerts', (req, res) => dashboardController.getAlerts(req, res));
router.get('/health', (req, res) => dashboardController.getHealth(req, res));
router.post('/backups/:id/cancel-waiting', validateParams(IdParamSchema), (req, res) => dashboardController.cancelWaitingJob(req, res));
router.post('/trigger-backup', validateBody(TriggerBackupSchema), (req, res) => dashboardController.triggerBackup(req, res));

export default router;
