import { Router } from 'express';
import restoreRoutes from '../modules/restore/restore.routes';

const router = Router();
router.use('/', restoreRoutes);

export default router;
