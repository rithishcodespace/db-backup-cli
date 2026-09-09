import os from 'os';
import { ServiceHealth } from '../types';

export function getServiceHealth(serviceName: string, version: string, startTime: number): ServiceHealth {
  return {
    service: serviceName,
    status: 'healthy',
    version: version,
    uptime: (Date.now() - startTime) / 1000,
    timestamp: new Date(),
    details: {
      platform: os.platform(),
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage(),
      cpuCount: os.cpus().length
    }
  };
}

export function generateBackupId(dbType: string, dbName: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${dbType}_${dbName}_${timestamp}_${random}`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export { sanitizeErrorMessage, sanitizeObject } from '../../../utils/credential-scrubber';

export function sanitizeConfig(config: any): any {
  const sanitized = { ...config };
  if (sanitized.password) sanitized.password = '***';
  if (sanitized.connectionString) sanitized.connectionString = '***';
  return sanitized;
}

/**
 * Resolves the database host for containerized and local runtime environments.
 * If running inside a Docker container and target is 'localhost' or '127.0.0.1',
 * routes to 'host.docker.internal' so host databases and port-forwarded containers can be reached.
 */
export function resolveDatabaseHost(targetHost?: string): string {
  const host = targetHost || '127.0.0.1';
  if (host === 'localhost' || host === '127.0.0.1') {
    if (process.env.DOCKER_HOST_OVERRIDE) {
      return process.env.DOCKER_HOST_OVERRIDE;
    }
    try {
      const fs = require('fs');
      if (
        fs.existsSync('/.dockerenv') ||
        (fs.existsSync('/etc/hosts') && fs.readFileSync('/etc/hosts', 'utf8').includes('host.docker.internal'))
      ) {
        return 'host.docker.internal';
      }
    } catch {
      // Fallback to original host if check fails
    }
  }
  return host;
}