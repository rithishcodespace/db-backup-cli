import { Request, Response } from 'express';
import { dashboardService } from './dashboard.service';
import { createModuleLogger } from '../../../../logger';

const log = createModuleLogger('dashboard-controller');

export class DashboardController {
  async getSummary(_req: Request, res: Response) {
    try {
      const summary = await dashboardService.getSummary();
      res.json(summary);
    } catch (err: any) {
      log.error('Failed to get dashboard summary', { error: err.message });
      res.status(500).json({ error: 'Failed to retrieve dashboard summary', message: err.message });
    }
  }

  async getActiveBackups(_req: Request, res: Response) {
    try {
      const active = await dashboardService.getActiveBackups();
      res.json(active);
    } catch (err: any) {
      log.error('Failed to get active backups', { error: err.message });
      res.status(500).json({ error: 'Failed to retrieve active backups', message: err.message });
    }
  }

  async getQueues(_req: Request, res: Response) {
    try {
      const queues = await dashboardService.getQueueStats();
      res.json(queues);
    } catch (err: any) {
      log.error('Failed to get queue stats', { error: err.message });
      res.status(500).json({ error: 'Failed to retrieve queue stats', message: err.message });
    }
  }

  async getBackups(req: Request, res: Response) {
    try {
      const { status, dbType, search, limit, page } = req.query;
      const history = await dashboardService.getBackupHistory({
        status: status as string,
        dbType: dbType as string,
        search: search as string,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        page: page ? parseInt(page as string, 10) : undefined,
      });
      res.json(history);
    } catch (err: any) {
      log.error('Failed to get backup history', { error: err.message });
      res.status(500).json({ error: 'Failed to retrieve backup history', message: err.message });
    }
  }

  async getLogs(req: Request, res: Response) {
    try {
      const { level, jobId, search, limit } = req.query;
      const logs = await dashboardService.getLogs({
        level: level as string,
        jobId: jobId as string,
        search: search as string,
        limit: limit ? parseInt(limit as string, 10) : undefined,
      });
      res.json(logs);
    } catch (err: any) {
      log.error('Failed to get logs', { error: err.message });
      res.status(500).json({ error: 'Failed to retrieve logs', message: err.message });
    }
  }

  async getAlerts(_req: Request, res: Response) {
    try {
      const alerts = await dashboardService.getAlerts();
      res.json(alerts);
    } catch (err: any) {
      log.error('Failed to get alerts', { error: err.message });
      res.status(500).json({ error: 'Failed to retrieve alerts', message: err.message });
    }
  }

  async getHealth(_req: Request, res: Response) {
    try {
      const health = await dashboardService.getSystemHealth();
      res.json(health);
    } catch (err: any) {
      log.error('Failed to get system health', { error: err.message });
      res.status(500).json({ error: 'Failed to retrieve system health', message: err.message });
    }
  }

  async cancelWaitingJob(req: Request, res: Response) {
    try {
      const jobId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await dashboardService.cancelWaitingJob(String(jobId));
      res.json(result);
    } catch (err: any) {
      log.error('Failed to cancel waiting job', { id: req.params.id, error: err.message });
      res.status(400).json({ error: 'Job cancellation rejected', message: err.message });
    }
  }

  async triggerBackup(req: Request, res: Response) {
    try {
      const result = await dashboardService.triggerBackup(req.body);
      res.json(result);
    } catch (err: any) {
      log.error('Failed to trigger quick backup', { error: err.message });
      res.status(400).json({ error: 'Trigger failed', message: err.message });
    }
  }
}

export const dashboardController = new DashboardController();
