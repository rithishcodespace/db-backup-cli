import { Router } from 'express';
import { dashboardController } from './dashboard.controller';

const router = Router();

router.get('/summary', (req, res) => dashboardController.getSummary(req, res));
router.get('/backups', (req, res) => dashboardController.getBackups(req, res));
router.get('/backups/active', (req, res) => dashboardController.getActiveBackups(req, res));
router.get('/queues', (req, res) => dashboardController.getQueues(req, res));
router.get('/logs', (req, res) => dashboardController.getLogs(req, res));
router.get('/alerts', (req, res) => dashboardController.getAlerts(req, res));
router.get('/health', (req, res) => dashboardController.getHealth(req, res));
router.post('/backups/:id/cancel-waiting', (req, res) => dashboardController.cancelWaitingJob(req, res));

export default router;
