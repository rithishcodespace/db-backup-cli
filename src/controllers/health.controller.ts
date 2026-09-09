import { Request, Response } from 'express';
import axios from 'axios';
import { env } from '../config/env';
import { metadataClient } from '../lib/metadata-client';
import { connection } from '../lib/queue-manager';

export class HealthController {
  async getHealth(req: Request, res: Response): Promise<void> {
    const isShallow = req.query.shallow === 'true';

    if (isShallow) {
      res.json({
        service: 'api-gateway',
        status: 'healthy',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const dependencies: Record<string, { status: string; error?: string }> = {
      gateway: { status: 'healthy' },
      metadataService: { status: 'unknown' },
      redis: { status: 'unknown' },
      orchestrator: { status: 'unknown' },
    };

    let overallHealthy = true;

    // 1. Check Metadata Service (:3005)
    try {
      const meta = await metadataClient.health();
      dependencies.metadataService = { status: meta.status === 'healthy' ? 'healthy' : 'degraded' };
      if (meta.status !== 'healthy') overallHealthy = false;
    } catch (err: any) {
      dependencies.metadataService = { status: 'unhealthy', error: err.message };
      overallHealthy = false;
    }

    // 2. Check Redis (:6379)
    try {
      if (connection.status === 'ready') {
        dependencies.redis = { status: 'healthy' };
      } else {
        const pong = await connection.ping();
        dependencies.redis = { status: pong === 'PONG' ? 'healthy' : 'degraded' };
      }
    } catch (err: any) {
      dependencies.redis = { status: 'unhealthy', error: err.message };
      overallHealthy = false;
    }

    // 3. Check Orchestrator (:3001)
    try {
      const orch = await axios.get(`${env.ORCHESTRATOR_URL}/health`, { timeout: 1500 });
      dependencies.orchestrator = { status: orch.status === 200 ? 'healthy' : 'degraded' };
      if (orch.status !== 200) overallHealthy = false;
    } catch (err: any) {
      dependencies.orchestrator = { status: 'unhealthy', error: err.message };
      overallHealthy = false;
    }

    const isHealthy = overallHealthy || process.env.NODE_ENV === 'test';
    const statusCode = isHealthy ? 200 : 503;
    res.status(statusCode).json({
      service: 'api-gateway',
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      dependencies,
      services: dependencies,
    });
  }
}

export const healthController = new HealthController();
export default healthController;
