import { Request, Response, NextFunction } from 'express';
import { restoreService } from '../services/restore.service';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('restore-controller');

export class RestoreController {
  async restoreBackup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await restoreService.restoreBackup(req.body);
      res.json(result);
    } catch (error: any) {
      log.error('Restore operation failed', { error: error?.message });
      next(error);
    }
  }

  async getRestoreStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const result = await restoreService.getRestoreStatus(id);
      res.json(result);
    } catch (error: any) {
      log.error('Get restore status failed', { error: error?.message });
      next(error);
    }
  }
}

export const restoreController = new RestoreController();
export default restoreController;
