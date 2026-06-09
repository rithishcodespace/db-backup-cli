import winston from 'winston';
import path from 'path';
import fs from 'fs';

const logDir = process.env.LOG_PATH || './logs';

// Ensure log directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(), // INFO -> green, ERROR -> red, WARN -> yellow
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, module, ...meta }) => {
    const moduleStr = module ? `[${module}] ` : ''; // Useful when many parts of the app write logs.
    const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : ''; // include metadata object
    return `${timestamp} ${level}: ${moduleStr}${message}${metaStr}`; // 2026-06-09 20:30:15 info: Backup completed
  })
);

// Custom format for file output (JSON for parsing)
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }), // level
  winston.format.json() // message
);

// Create logger instance
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info', // allows -> info, warn, error types
  transports: [ // where should the logs be sent
    // Console transport for development
    new winston.transports.Console({
      format: consoleFormat,
      silent: process.env.NODE_ENV === 'test', // during tests, console logs won't be created
    }),
    // File transport for all logs (info, warn, error)
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      format: fileFormat,
      maxsize: parseInt(process.env.LOG_MAX_SIZE || '20971520'), // 20MB
      maxFiles: parseInt(process.env.LOG_MAX_FILES || '30'),
    }),
    // Separate file for errors
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: parseInt(process.env.LOG_MAX_SIZE || '20971520'),
      maxFiles: parseInt(process.env.LOG_MAX_FILES || '30'),
    }),
  ],
});

// Helper function to create child loggers for different modules
export const createModuleLogger = (moduleName: string) => {
  return logger.child({ module: moduleName });
};

export default logger;