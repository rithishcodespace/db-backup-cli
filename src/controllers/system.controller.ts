import { Request, Response } from 'express';
import axios from 'axios';
import { clientIdManager } from '../lib/client-id';
import { rateLimiters } from '../middleware/rate-limit.middleware';
import { env } from '../config/env';

export class SystemController {
  getClientId(_req: Request, res: Response): void {
    const clientId = clientIdManager.getClientId();
    const cfg = clientIdManager.getConfig();

    res.json({
      clientId,
      createdAt: cfg?.createdAt || null,
      lastUpdated: cfg?.lastUpdated || null,
      configPath: `${process.env.HOME || process.env.USERPROFILE}/.db-backup/config.json`,
    });
  }

  async getRateLimitStatus(req: Request, res: Response): Promise<void> {
    try {
      const clientId = (req as any).clientId || req.ip || 'unknown';

      const [apiStatus, backupStatus] = await Promise.all([
        rateLimiters.api.get(clientId),
        rateLimiters.backup.get(clientId),
      ]);

      res.json({
        clientId: clientId.length > 8 ? `${clientId.substring(0, 8)}...` : clientId,
        limits: {
          api: {
            points: env.RATE_LIMIT_POINTS,
            duration: env.RATE_LIMIT_DURATION,
            remaining: apiStatus?.remainingPoints ?? env.RATE_LIMIT_POINTS,
            msBeforeNext: apiStatus?.msBeforeNext || 0,
          },
          backup: {
            points: env.RATE_LIMIT_BACKUP_POINTS,
            duration: env.RATE_LIMIT_BACKUP_DURATION,
            remaining: backupStatus?.remainingPoints ?? env.RATE_LIMIT_BACKUP_POINTS,
            msBeforeNext: backupStatus?.msBeforeNext || 0,
          },
        },
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get rate limit status' });
    }
  }

  async getServicesHealth(_req: Request, res: Response): Promise<void> {
    const services = ['postgresql', 'mysql', 'mongodb', 'sqlite'];
    const health: Record<string, any> = {};

    for (const service of services) {
      try {
        const port =
          service === 'postgresql' ? 3010 :
          service === 'mysql' ? 3011 :
          service === 'mongodb' ? 3012 : 3013;

        const response = await axios.get(`http://localhost:${port}/health`, {
          timeout: 3000,
        });
        health[service] = response.data;
      } catch (error) {
        health[service] = {
          status: 'unhealthy',
          error: 'Service unreachable',
        };
      }
    }

    res.json(health);
  }
}

export const systemController = new SystemController();
export default systemController;
