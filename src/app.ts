import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env';
import { errorHandler } from './middleware/error.middleware';
import routes from './routes';
import { createModuleLogger } from './utils/logger';

const log = createModuleLogger('app');

export function createApp(): Express {
  const app: Express = express();

  // Security Headers
  app.use(helmet({
    contentSecurityPolicy: false, // allow Swagger UI and embedded Dashboard assets
  }));

  // CORS Configuration
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (CLI, server-to-server, curl) or allowed origins
        if (!origin || env.CORS_ORIGIN.includes(origin)) {
          return callback(null, true);
        }
        log.warn('CORS blocked request', { origin });
        return callback(new Error('Blocked by CORS policy'));
      },
      credentials: true,
    })
  );

  // Request Body Parsers
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Register All Modular Routes
  app.use(routes);

  // 404 Not Found Handler for unknown endpoints
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: 'Not Found',
      message: `Cannot ${req.method} ${req.path}`,
    });
  });

  // Centralized Error Handling Middleware
  app.use(errorHandler);

  return app;
}

export const app: Express = createApp();
export default app;
