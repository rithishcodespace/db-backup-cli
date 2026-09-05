import { Router } from 'express';
import dashboardRoutes from '../modules/dashboard/dashboard.routes';

const router = Router();
router.use('/', dashboardRoutes);

export default router;
