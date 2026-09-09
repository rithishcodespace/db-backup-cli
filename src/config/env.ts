import dotenv from 'dotenv';

dotenv.config();

export interface EnvironmentConfig {
  NODE_ENV: string;
  GATEWAY_PORT: number;
  PORT: number;
  ORCHESTRATOR_URL: string;
  METADATA_SERVICE_URL: string;
  DATABASE_URL: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  CORS_ORIGIN: string[];
  RATE_LIMIT_POINTS: number;
  RATE_LIMIT_DURATION: number;
  RATE_LIMIT_BACKUP_POINTS: number;
  RATE_LIMIT_BACKUP_DURATION: number;
  MAX_CONCURRENT_BACKUPS: number;
  MAX_QUEUE_SIZE: number;
  LOG_LEVEL: string;
  LOG_PATH: string;
  LOG_MAX_SIZE: string;
  LOG_MAX_FILES: number;
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
}

function parsePort(val: string | undefined, defaultPort: number): number {
  if (!val) return defaultPort;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) || parsed <= 0 || parsed > 65535 ? defaultPort : parsed;
}

function parseCorsOrigins(val: string | undefined): string[] {
  if (!val) {
    return ['http://localhost:5173', 'http://localhost:3000'];
  }
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}

const nodeEnv = process.env.NODE_ENV || 'development';
const gatewayPort = parsePort(process.env.GATEWAY_PORT || process.env.PORT, 3000);

export const env: EnvironmentConfig = {
  NODE_ENV: nodeEnv,
  GATEWAY_PORT: gatewayPort,
  PORT: gatewayPort,
  ORCHESTRATOR_URL: process.env.ORCHESTRATOR_URL || 'http://localhost:3001',
  METADATA_SERVICE_URL: process.env.METADATA_SERVICE_URL || 'http://127.0.0.1:3005',
  DATABASE_URL: process.env.DATABASE_URL || 'file:./backup-meta.db',
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parsePort(process.env.REDIS_PORT, 6379),
  CORS_ORIGIN: parseCorsOrigins(process.env.CORS_ORIGIN),
  RATE_LIMIT_POINTS: parseInt(process.env.RATE_LIMIT_POINTS || '100', 10),
  RATE_LIMIT_DURATION: parseInt(process.env.RATE_LIMIT_DURATION || '60', 10),
  RATE_LIMIT_BACKUP_POINTS: parseInt(process.env.RATE_LIMIT_BACKUP_POINTS || '10', 10),
  RATE_LIMIT_BACKUP_DURATION: parseInt(process.env.RATE_LIMIT_BACKUP_DURATION || '60', 10),
  MAX_CONCURRENT_BACKUPS: parseInt(process.env.MAX_CONCURRENT_BACKUPS || '3', 10),
  MAX_QUEUE_SIZE: parseInt(process.env.MAX_QUEUE_SIZE || '50', 10),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOG_PATH: process.env.LOG_PATH || './logs',
  LOG_MAX_SIZE: process.env.LOG_MAX_SIZE || '20971520',
  LOG_MAX_FILES: parseInt(process.env.LOG_MAX_FILES || '30', 10),
  isProduction: nodeEnv === 'production',
  isDevelopment: nodeEnv === 'development',
  isTest: nodeEnv === 'test',
};

export default env;
