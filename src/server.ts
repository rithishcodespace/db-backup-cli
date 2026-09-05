import http from 'http';
import { app } from './app';
import { env } from './config/env';
import { disconnectDatabase } from './config/database';
import { createModuleLogger } from './utils/logger';

const log = createModuleLogger('server');

const port = env.GATEWAY_PORT;
const server = http.createServer(app);

let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.info(`Received ${signal}, commencing graceful shutdown...`);

  // Stop accepting new connections
  server.close(async (err) => {
    if (err) {
      log.error('Error while closing HTTP server', { error: err.message });
    } else {
      log.info('HTTP server closed successfully');
    }

    try {
      await disconnectDatabase();
      log.info('Database connection disconnected cleanly');
    } catch (dbErr: any) {
      log.error('Error during database disconnect', { error: dbErr?.message });
    }

    process.exit(err ? 1 : 0);
  });

  // Force shutdown after timeout if connections hang
  setTimeout(() => {
    log.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception in server process', { error: error.message, stack: error.stack });
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason: any) => {
  log.error('Unhandled Promise Rejection in server process', { reason: reason?.message || reason });
});

server.listen(port, () => {
  log.info(`API Gateway listening on port ${port} (env: ${env.NODE_ENV})`);
  log.info(`Swagger UI documentation available at http://localhost:${port}/api-docs`);
  log.info(`Rate Limit: ${env.RATE_LIMIT_POINTS} requests per ${env.RATE_LIMIT_DURATION}s`);
  log.info(`Client ID config path: ${process.env.HOME || process.env.USERPROFILE}/.db-backup/config.json`);
});

export { server, app };
export default server;
