import { Request, Response } from 'express';
import { env } from '../config/env';

export class HealthController {
  getHealth(_req: Request, res: Response): void {
    res.json({
      service: 'api-gateway',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        orchestrator: env.ORCHESTRATOR_URL,
      },
    });
  }
}

export const healthController = new HealthController();
export default healthController;
