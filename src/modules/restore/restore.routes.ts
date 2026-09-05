import { Router } from 'express';
import { restoreController } from './restore.controller';

const router = Router();

router.post('/', (req, res, next) => restoreController.restoreBackup(req, res, next));

export default router;
