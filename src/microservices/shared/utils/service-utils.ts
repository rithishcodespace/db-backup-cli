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

export function sanitizeConfig(config: any): any {
  const sanitized = { ...config };
  if (sanitized.password) sanitized.password = '***';
  if (sanitized.connectionString) sanitized.connectionString = '***';
  return sanitized;
}