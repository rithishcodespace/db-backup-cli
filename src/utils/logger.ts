import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env';

const logDir = env.LOG_PATH || './logs';

// Ensure log directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, module, ...meta }) => {
    const moduleStr = module ? `[${module}] ` : '';
    let metaStr = '';
    if (Object.keys(meta).length) {
      try {
        metaStr = `\n${JSON.stringify(meta, null, 2)}`;
      } catch {
        metaStr = `\n[Circular/Complex Metadata]`;
      }
    }
    return `${timestamp} ${level}: ${moduleStr}${message}${metaStr}`;
  })
);

// Custom format for file output (JSON for parsing)
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
export const logger = winston.createLogger({
  level: env.LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
      silent: env.isTest,
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      format: fileFormat,
      maxsize: parseInt(env.LOG_MAX_SIZE || '20971520', 10),
      maxFiles: env.LOG_MAX_FILES || 30,
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: parseInt(env.LOG_MAX_SIZE || '20971520', 10),
      maxFiles: env.LOG_MAX_FILES || 30,
    }),
  ],
});

// Helper function to create child loggers for different modules
export const createModuleLogger = (moduleName: string) => {
  return logger.child({ module: moduleName });
};

export default logger;
