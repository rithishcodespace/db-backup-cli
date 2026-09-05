import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { backupService } from '../services/backup.service';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('backup-controller');

export class BackupController {
  async triggerBackup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clientId = (req as any).clientId;
      const result = await backupService.triggerBackup(req.body, clientId);
      res.json(result);
    } catch (error: any) {
      log.error('Backup trigger failed in controller', { error: error?.message });
      if (axios.isAxiosError(error) && error.response) {
        res.status(error.response.status).json(error.response.data);
        return;
      }
      next(error);
    }
  }

  async getBackupStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await backupService.getBackupStatus(id);
      res.json(result);
    } catch (error: any) {
      log.error('Backup status query failed in controller', { error: error?.message });
      if (axios.isAxiosError(error) && error.response) {
        res.status(error.response.status).json(error.response.data);
        return;
      }
      next(error);
    }
  }
}

export const backupController = new BackupController();
export default backupController;
