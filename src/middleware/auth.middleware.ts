import { Request, Response, NextFunction } from 'express';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('auth-middleware');

export interface AuthenticatedRequest extends Request {
  clientId?: string;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const clientId = req.header('x-client-id');

  if (!clientId) {
    res.status(400).json({
      success: false,
      error: 'Missing x-client-id header',
      message: 'A valid x-client-id header is required for this request',
    });
    return;
  }

  (req as AuthenticatedRequest).clientId = clientId;

  log.debug('Client ID detected', {
    clientId: clientId.length > 8 ? `${clientId.substring(0, 8)}...` : clientId,
  });

  next();
}

export const clientIdMiddleware = authMiddleware;
export default authMiddleware;
