import axios from 'axios';
import { backupRepository } from '../repositories/backup.repository';
import { createBackupQueue, createStorageQueue, createNotificationQueue, connection } from '../lib/queue-manager';
import { createModuleLogger } from '../utils/logger';
import {
  DashboardSummaryDTO,
  ActiveBackupDTO,
  QueueStatsDTO,
  QueueStateCounts,
  SystemHealthDTO,
  ServiceHealthItem,
  BackupHistoryDTO,
  LogItemDTO,
  AlertDTO,
} from '../types/dashboard.types';

const log = createModuleLogger('dashboard-service');

const MAX_CONCURRENT_BACKUPS = parseInt(process.env.MAX_CONCURRENT_BACKUPS || '3', 10);

let backupQueueInstance: any = null;
let storageQueueInstance: any = null;
let notificationQueueInstance: any = null;

function getQueues() {
  if (!backupQueueInstance) {
    backupQueueInstance = createBackupQueue();
    storageQueueInstance = createStorageQueue();
    notificationQueueInstance = createNotificationQueue();
  }
  return {
    backupQueue: backupQueueInstance,
    storageQueue: storageQueueInstance,
    notificationQueue: notificationQueueInstance,
  };
}

function toIso(d: any): string | null {
  if (!d) return null;
  if (typeof d.toISOString === 'function') return d.toISOString();
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? String(d) : parsed.toISOString();
}

export function humanizeError(rawError: string | null | undefined): string {
  if (!rawError) return 'No detailed error message was recorded.';
  const err = rawError.toString();

  if (err.includes('ECONNREFUSED')) {
    return 'Database Connection Error: The target database server refused the connection. Please verify that the database service is running on the specified host and port.';
  }
  if (err.includes('ETIMEDOUT') || err.includes('timeout')) {
    return 'Connection Timeout: The database or network request timed out. High server load or firewall block might be delaying responses.';
  }
  if (err.includes('Access denied') || err.includes('Authentication failed') || err.includes('password') || err.includes('ER_ACCESS_DENIED')) {
    return 'Authentication Failure: The configured database credentials (username/password) were rejected by the database server.';
  }
  if (err.includes('NoSuchBucket') || err.includes('InvalidAccessKeyId') || err.includes('SignatureDoesNotMatch') || err.includes('s3')) {
    return 'S3 Storage Error: Cloud storage provider rejected the upload. Check your AWS access key, secret key, or S3 bucket name.';
  }
  if (err.includes('ENOSPC') || err.includes('space left on device')) {
    return 'Storage Disk Full: The local disk destination ran out of available storage space during backup creation.';
  }
  if (err.includes('pg_dump') || err.includes('mysqldump') || err.includes('mongodump')) {
    return 'CLI Tool Error: The underlying database backup binary failed to execute. Ensure native client utilities are installed.';
  }
  if (err.includes('Queue is full')) {
    return 'Queue Saturation: The backup queue has reached maximum allowed waiting items. Please allow current backups to finish.';
  }

  return `Operational Issue: ${err.length > 180 ? err.substring(0, 180) + '...' : err}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || isNaN(bytes) || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export class DashboardService {
  async getQueueStats(): Promise<QueueStatsDTO> {
    const emptyStats: QueueStateCounts = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, total: 0 };
    try {
      const { backupQueue, storageQueue, notificationQueue } = getQueues();

      const [bWait, bAct, bComp, bFail, bDel] = await Promise.all([
        backupQueue.getWaitingCount().catch(() => 0),
        backupQueue.getActiveCount().catch(() => 0),
        backupQueue.getCompletedCount().catch(() => 0),
        backupQueue.getFailedCount().catch(() => 0),
        backupQueue.getDelayedCount().catch(() => 0),
      ]);

      const [sWait, sAct, sComp, sFail, sDel] = await Promise.all([
        storageQueue.getWaitingCount().catch(() => 0),
        storageQueue.getActiveCount().catch(() => 0),
        storageQueue.getCompletedCount().catch(() => 0),
        storageQueue.getFailedCount().catch(() => 0),
        storageQueue.getDelayedCount().catch(() => 0),
      ]);

      const [nWait, nAct, nComp, nFail, nDel] = await Promise.all([
        notificationQueue.getWaitingCount().catch(() => 0),
        notificationQueue.getActiveCount().catch(() => 0),
        notificationQueue.getCompletedCount().catch(() => 0),
        notificationQueue.getFailedCount().catch(() => 0),
        notificationQueue.getDelayedCount().catch(() => 0),
      ]);

      return {
        backupQueue: {
          waiting: bWait,
          active: bAct,
          completed: bComp,
          failed: bFail,
          delayed: bDel,
          total: bWait + bAct + bComp + bFail + bDel,
        },
        storageQueue: {
          waiting: sWait,
          active: sAct,
          completed: sComp,
          failed: sFail,
          delayed: sDel,
          total: sWait + sAct + sComp + sFail + sDel,
        },
        notificationQueue: {
          waiting: nWait,
          active: nAct,
          completed: nComp,
          failed: nFail,
          delayed: nDel,
          total: nWait + nAct + nComp + nFail + nDel,
        },
      };
    } catch (err) {
      log.error('Failed to get queue stats', { error: (err as any).message });
      return {
        backupQueue: emptyStats,
        storageQueue: emptyStats,
        notificationQueue: emptyStats,
      };
    }
  }

  async getActiveBackups(): Promise<ActiveBackupDTO[]> {
    try {
      const activeJobs = await backupRepository.findActiveJobs();
      const { backupQueue } = getQueues();

      const results: ActiveBackupDTO[] = [];
      const now = Date.now();

      for (const job of activeJobs) {
        let progress: number | null = null;
        let stage = 'Processing Dump';

        try {
          const queueJob = await backupQueue.getJob(job.id);
          if (queueJob) {
            progress = typeof queueJob.progress === 'number' ? queueJob.progress : null;
            if (progress !== null) {
              if (progress < 30) stage = 'Exporting Database';
              else if (progress < 80) stage = 'Executing Backup';
              else if (progress < 90) stage = 'Writing Storage';
              else stage = 'Finalizing & Notifying';
            }
          }
        } catch (e) {
          // Ignore queue lookup errors
        }

        const elapsedSeconds = Math.max(0, Math.floor((now - new Date(job.startedAt).getTime()) / 1000));

        results.push({
          id: job.id,
          dbType: job.dbType,
          dbName: job.dbName,
          backupType: job.backupType,
          status: job.status,
          startedAt: toIso(job.startedAt) || new Date().toISOString(),
          elapsedSeconds,
          stage,
          progress,
          fileName: job.fileName,
          storageLocationName: job.storageLocation?.name || null,
          storageType: job.storageType || job.storageLocation?.type || 'local',
          error: job.error,
        });
      }

      return results;
    } catch (err) {
      log.error('Failed to fetch active backups', { error: (err as any).message });
      return [];
    }
  }

  async getSummary(): Promise<DashboardSummaryDTO> {
    const activeBackups = await this.getActiveBackups();
    const queueStats = await this.getQueueStats();
    const activeConcurrencyCount = queueStats.backupQueue.active || activeBackups.length;

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [total24h, failed24h, healthData] = await Promise.all([
      backupRepository.countJobsSince(since24h).catch(() => 0),
      backupRepository.countJobsSince(since24h, ['failed', 'FAILED']).catch(() => 0),
      this.getSystemHealth().catch(() => null),
    ]);

    const success24h = Math.max(0, total24h - failed24h);
    const successRate24h = total24h > 0 ? Math.round((success24h / total24h) * 100) : 100;

    let systemStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (healthData) {
      systemStatus = healthData.status;
    } else if (failed24h > 0 || queueStats.backupQueue.failed > 0) {
      systemStatus = 'degraded';
    }

    const alerts = await this.getAlerts();

    return {
      activeBackupsCount: activeBackups.length,
      maxConcurrencyLimit: MAX_CONCURRENT_BACKUPS,
      activeConcurrencyCount,
      queueStats,
      successRate24h,
      totalBackups24h: total24h,
      failedBackups24h: failed24h,
      systemStatus,
      alertsCount: alerts.length,
      timestamp: new Date().toISOString(),
    };
  }

  async getBackupHistory(query: {
    status?: string;
    dbType?: string;
    search?: string;
    limit?: number;
    page?: number;
  }): Promise<{ backups: BackupHistoryDTO[]; total: number; page: number; limit: number }> {
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const page = Math.max(1, query.page || 1);
    const skip = (page - 1) * limit;

    const whereClause: any = {};
    if (query.status && query.status !== 'all') {
      const s = query.status.trim();
      whereClause.status = { in: [s.toLowerCase(), s.toUpperCase()] };
    }
    if (query.dbType && query.dbType !== 'all') {
      whereClause.dbType = query.dbType.toLowerCase();
    }
    if (query.search && query.search.trim()) {
      const q = query.search.trim();
      whereClause.OR = [
        { id: { contains: q } },
        { dbName: { contains: q } },
        { fileName: { contains: q } },
        { backupName: { contains: q } },
      ];
    }

    const [jobs, total] = await Promise.all([
      backupRepository.findManyJobs({
        where: whereClause,
        include: { storageLocation: true },
        orderBy: { startedAt: 'desc' },
        take: limit,
        skip: skip,
      }),
      backupRepository.countJobs(whereClause),
    ]);

    const backups: BackupHistoryDTO[] = jobs.map((job: any) => ({
      id: job.id,
      dbType: job.dbType,
      dbName: job.dbName,
      backupType: job.backupType,
      status: job.status,
      startedAt: toIso(job.startedAt) || new Date().toISOString(),
      completedAt: toIso(job.completedAt),
      durationSeconds: job.duration ? job.duration : null,
      fileSizeBytes: job.fileSize || null,
      formattedSize: formatBytes(job.fileSize),
      fileName: job.fileName,
      filePath: job.filePath,
      storageType: job.storageType || job.storageLocation?.type || 'local',
      storageName: job.storageLocation?.name || null,
      error: job.error,
      humanError: job.error ? humanizeError(job.error) : null,
      metadata: job.metadata,
    }));

    return { backups, total, page, limit };
  }

  async getLogs(query: {
    level?: string;
    jobId?: string;
    search?: string;
    limit?: number;
  }): Promise<LogItemDTO[]> {
    const limit = Math.min(200, Math.max(1, query.limit || 50));
    const whereClause: any = {};

    if (query.level && query.level !== 'ALL') {
      whereClause.level = query.level.toUpperCase();
    }
    if (query.jobId && query.jobId.trim()) {
      whereClause.backupJobId = query.jobId.trim();
    }
    if (query.search && query.search.trim()) {
      whereClause.message = { contains: query.search.trim() };
    }

    const logs = await backupRepository.findLogs({
      where: whereClause,
      take: limit,
      orderBy: { timestamp: 'desc' },
    });

    return logs.map((l: any) => ({
      id: l.id,
      backupJobId: l.backupJobId,
      timestamp: toIso(l.timestamp) || new Date().toISOString(),
      level: (l.level?.toUpperCase() as any) || 'INFO',
      message: l.message,
      details: l.details,
    }));
  }

  async getAlerts(): Promise<AlertDTO[]> {
    const alerts: AlertDTO[] = [];
    const nowStr = new Date().toISOString();

    const failedJobs = await backupRepository.findRecentFailedJobs(
      new Date(Date.now() - 24 * 60 * 60 * 1000),
      5
    );

    for (const job of failedJobs) {
      alerts.push({
        id: `failed-job-${job.id}`,
        type: 'error',
        title: `Backup Failed: ${job.dbType}/${job.dbName}`,
        message: humanizeError(job.error),
        humanizedAction: 'Check database connectivity and credentials in CLI',
        timestamp: toIso(job.startedAt) || new Date().toISOString(),
        source: 'Backup Execution',
      });
    }

    try {
      const { backupQueue } = getQueues();
      const waiting = await backupQueue.getWaitingCount();
      const MAX_QUEUE_SIZE = parseInt(process.env.MAX_QUEUE_SIZE || '50', 10);
      if (waiting >= MAX_QUEUE_SIZE * 0.8) {
        alerts.push({
          id: 'queue-saturation',
          type: 'warning',
          title: 'Queue Saturation Warning',
          message: `Backup queue is ${Math.round((waiting / MAX_QUEUE_SIZE) * 100)}% full (${waiting}/${MAX_QUEUE_SIZE} jobs waiting).`,
          humanizedAction: 'Wait for current backups to finish before submitting new CLI backup commands.',
          timestamp: nowStr,
          source: 'BullMQ Queue Manager',
        });
      }
    } catch (e) {}

    const health = await this.getSystemHealth();
    const offlineServices = health.services.filter((s) => s.status !== 'healthy');
    for (const s of offlineServices) {
      alerts.push({
        id: `svc-offline-${s.name}`,
        type: 'warning',
        title: `Service Offline: ${s.name}`,
        message: `Service at ${s.url} did not respond to health check.`,
        humanizedAction: 'Inspect container logs via "dbvault logs" or run "dbvault restart"',
        timestamp: nowStr,
        source: 'System Health Check',
      });
    }

    return alerts;
  }

  async getSystemHealth(): Promise<SystemHealthDTO> {
    const servicesToPing = [
      { name: 'API Gateway', url: 'http://localhost:3000/health', port: 3000 },
      { name: 'Backup Orchestrator', url: 'http://localhost:3001/health', port: 3001 },
      { name: 'Scheduler Service', url: 'http://localhost:3020/health', port: 3020 },
      { name: 'Storage Service', url: 'http://localhost:3030/health', port: 3030 },
      { name: 'Notification Service', url: 'http://localhost:3040/health', port: 3040 },
      { name: 'PostgreSQL Service', url: 'http://localhost:3010/health', port: 3010 },
      { name: 'MySQL Service', url: 'http://localhost:3011/health', port: 3011 },
      { name: 'MongoDB Service', url: 'http://localhost:3012/health', port: 3012 },
      { name: 'SQLite Service', url: 'http://localhost:3013/health', port: 3013 },
    ];

    const serviceResults: ServiceHealthItem[] = await Promise.all(
      servicesToPing.map(async (svc) => {
        const start = Date.now();
        try {
          const res = await axios.get(svc.url, { timeout: 2500 });
          return {
            name: svc.name,
            port: svc.port,
            status: res.status === 200 ? ('healthy' as const) : ('degraded' as const),
            url: svc.url,
            responseTimeMs: Date.now() - start,
            details: res.data,
          };
        } catch (error) {
          return {
            name: svc.name,
            port: svc.port,
            status: 'unhealthy' as const,
            url: svc.url,
            responseTimeMs: Date.now() - start,
            details: { error: 'Service unreachable' },
          };
        }
      })
    );

    let redisConnected = false;
    try {
      redisConnected = connection.status === 'ready' || connection.status === 'connect';
    } catch (e) {}

    const queueStats = await this.getQueueStats();
    const backupWorkerActive = queueStats.backupQueue.active;
    const storageWorkerActive = queueStats.storageQueue.active;

    const workers = [
      {
        name: 'Backup Worker',
        concurrency: MAX_CONCURRENT_BACKUPS,
        activeCount: backupWorkerActive,
        status: redisConnected ? ('running' as const) : ('offline' as const),
      },
      {
        name: 'Storage Worker',
        concurrency: parseInt(process.env.MAX_CONCURRENT_STORAGE || '5', 10),
        activeCount: storageWorkerActive,
        status: redisConnected ? ('running' as const) : ('offline' as const),
      },
      {
        name: 'Notification Worker',
        concurrency: 10,
        activeCount: queueStats.notificationQueue.active,
        status: redisConnected ? ('running' as const) : ('offline' as const),
      },
    ];

    const unhealthyCount = serviceResults.filter((s) => s.status === 'unhealthy').length;
    let overallStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';

    if (!redisConnected || unhealthyCount >= 3) {
      overallStatus = 'critical';
    } else if (unhealthyCount > 0) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      services: serviceResults,
      workers,
      redisConnected,
      timestamp: new Date().toISOString(),
    };
  }

  async cancelWaitingJob(id: string): Promise<{ success: boolean; message: string }> {
    const { backupQueue } = getQueues();
    const queueJob = await backupQueue.getJob(id);

    if (!queueJob) {
      throw new Error(`Job ${id} not found in backup queue`);
    }

    const state = await queueJob.getState();
    if (state !== 'waiting' && state !== 'delayed') {
      throw new Error(`Only WAITING or DELAYED jobs can be safely cancelled. Current job state is '${state}'.`);
    }

    await queueJob.remove();
    await backupRepository.updateJob(id, {
      status: 'CANCELLED',
      completedAt: new Date(),
      error: 'Cancelled by operator via Dashboard while waiting in queue.',
    });

    log.info('Waiting job cancelled by operator', { jobId: id });
    return {
      success: true,
      message: `Job ${id} was removed from the waiting queue safely.`,
    };
  }

  async triggerBackup(payload: {
    dbType: string;
    dbName: string;
    backupType?: string;
    storageType?: string;
  }): Promise<{ success: boolean; backupId?: string; message: string }> {
    const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:3001';
    const dbType = (payload.dbType || 'postgresql').toLowerCase();
    const dbName = payload.dbName || 'appdb';
    const backupType = payload.backupType || 'full';
    const storageType = payload.storageType || 'local';

    try {
      const response = await axios.post(
        `${ORCHESTRATOR_URL}/backup`,
        {
          dbConfig: {
            type: dbType,
            database: dbName,
          },
          backupType,
          options: {
            backupName: `${dbName}_${backupType}_${Date.now()}`,
            storage: {
              name: storageType,
              type: storageType,
            },
          },
        },
        {
          headers: {
            'x-client-id': 'dashboard-admin-ui',
          },
        }
      );

      return {
        success: true,
        backupId: response.data.backupId,
        message: response.data.message || `Quick backup triggered for ${dbType}/${dbName}`,
      };
    } catch (err: any) {
      const errMsg = err.response?.data?.error || err.message || 'Failed to trigger backup';
      log.error('Failed to trigger quick backup', { error: errMsg });
      throw new Error(errMsg);
    }
  }
}

export const dashboardService = new DashboardService();
export default dashboardService;
