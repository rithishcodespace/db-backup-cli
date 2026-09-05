import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { connection } from '../lib/queue-manager';
import { env } from '../config/env';
import { createModuleLogger } from '../utils/logger';

const log = createModuleLogger('rate-limiter');

export const rateLimiters = {
  api: new RateLimiterRedis({
    storeClient: connection,
    points: env.RATE_LIMIT_POINTS,
    duration: env.RATE_LIMIT_DURATION,
    keyPrefix: 'gateway_rate_limit_api',
  }),
  backup: new RateLimiterRedis({
    storeClient: connection,
    points: env.RATE_LIMIT_BACKUP_POINTS,
    duration: env.RATE_LIMIT_BACKUP_DURATION,
    keyPrefix: 'gateway_rate_limit_backup',
  }),
};

export const createRateLimiter = (limiter: RateLimiterRedis, defaultLimit: number = env.RATE_LIMIT_POINTS) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = (req as any).clientId || req.ip || 'unknown';
      await limiter.consume(key);
      next();
    } catch (error: any) {
      if (error instanceof Error && error.message?.includes('Rate limit exceeded')) {
        log.warn('Rate limit exceeded', {
          clientId: (req as any).clientId ? `${(req as any).clientId.substring(0, 8)}...` : undefined,
          ip: req.ip,
          path: req.path,
        });

        res.set('X-RateLimit-Limit', String(defaultLimit));
        res.status(429).json({
          success: false,
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please try again later.',
        });
        return;
      }

      // If rate limiter fails (e.g. Redis disconnect), log and fail open
      log.error('Rate limiter error', { error: error?.message });
      next();
    }
  };
};

export const apiRateLimiter = createRateLimiter(rateLimiters.api, env.RATE_LIMIT_POINTS);
export const backupRateLimiter = createRateLimiter(rateLimiters.backup, env.RATE_LIMIT_BACKUP_POINTS);
