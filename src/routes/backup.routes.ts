import { Router } from 'express';
import backupRoutes from '../modules/backup/backup.routes';

const router = Router();
router.use('/', backupRoutes);

export default router;
