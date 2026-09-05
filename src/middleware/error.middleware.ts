import { Request, Response, NextFunction } from 'express';
import { createModuleLogger } from '../utils/logger';
import { sanitizeErrorMessage } from '../utils/credential-scrubber';
import { env } from '../config/env';

const log = createModuleLogger('error-middleware');

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const rawMessage = err?.message || 'Internal Server Error';
  const cleanMsg = sanitizeErrorMessage(rawMessage);
  const statusCode = err?.statusCode || err?.status || 500;
  const errorName = err?.name || 'Internal Server Error';

  log.error('Unhandled request error', {
    path: req.originalUrl || req.url,
    method: req.method,
    statusCode,
    error: cleanMsg,
  });

  res.status(statusCode).json({
    success: false,
    error: errorName,
    message: env.isProduction && statusCode === 500 ? 'An unexpected internal server error occurred' : cleanMsg,
    issues: err?.issues || undefined,
  });
}

export default errorHandler;
