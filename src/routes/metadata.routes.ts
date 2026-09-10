import { Router, Request, Response } from 'express';
import axios from 'axios';
import { env } from '../config/env';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('metadata-proxy');
const router = Router();

/**
 * Universal proxy handler that forwards requests to the container-internal Metadata Service (:3005).
 */
async function forwardToMetadataService(req: Request, res: Response): Promise<void> {
  const metadataBaseUrl = env.METADATA_SERVICE_URL || 'http://127.0.0.1:3005';
  const targetUrl = `${metadataBaseUrl}${req.originalUrl}`;

  try {
    const response = await axios({
      method: req.method as any,
      url: targetUrl,
      params: req.query,
      data: req.body,
      headers: {
        'content-type': req.headers['content-type'] || 'application/json',
        'accept': 'application/json',
      },
      validateStatus: () => true, // Pass through any HTTP status code directly
      timeout: 10000,
    });

    res.status(response.status).json(response.data);
  } catch (err: any) {
    log.error('Failed to proxy request to internal metadata service', {
      method: req.method,
      targetUrl,
      error: err.message,
    });
    res.status(502).json({
      error: 'Metadata service gateway error',
      message: err.message,
    });
  }
}

// Register all metadata endpoints on Gateway
router.use('/jobs-active', forwardToMetadataService);
router.use('/jobs-stats', forwardToMetadataService);
router.use('/jobs', forwardToMetadataService);
router.use('/logs', forwardToMetadataService);
router.use('/schedules', forwardToMetadataService);
router.use('/storage-default', forwardToMetadataService);
router.use('/storage', forwardToMetadataService);
router.use('/notifications', forwardToMetadataService);

export default router;
