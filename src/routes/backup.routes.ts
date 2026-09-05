import { Router } from 'express';
import { backupController } from '../controllers/backup.controller';
import { validateBody, validateParams } from '../middleware/validation.middleware';
import { BackupRequestSchema, IdParamSchema } from '../schemas';

const router = Router();

router.post('/', validateBody(BackupRequestSchema), (req, res, next) =>
  backupController.triggerBackup(req, res, next)
);

router.get('/:id/status', validateParams(IdParamSchema), (req, res, next) =>
  backupController.getBackupStatus(req, res, next)
);

export default router;
