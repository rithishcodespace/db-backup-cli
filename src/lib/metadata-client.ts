import axios, { AxiosInstance, AxiosError } from 'axios';
import { createModuleLogger } from '../logger';

const log = createModuleLogger('metadata-client');

export interface MetadataClientConfig {
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface CreateJobInput {
  id?: string;
  dbType: string;
  dbName: string;
  backupType: string;
  status?: string;
  filePath?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  compressedSize?: number | null;
  checksum?: string | null;
  baseBackupId?: string | null;
  parentBackupId?: string | null;
  backupLevel?: number | null;
  walPosition?: string | null;
  binlogFile?: string | null;
  binlogPosition?: number | null;
  oplogTimestamp?: string | null;
  backupName?: string | null;
  startedAt?: Date | string;
  completedAt?: Date | string | null;
  duration?: number | null;
  expiresAt?: Date | string | null;
  storageType?: string;
  storagePath?: string | null;
  storageRegion?: string | null;
  storageLocationId?: string | null;
  compressionType?: string | null;
  encryptionType?: string | null;
  encrypted?: boolean;
  encryptionMetadata?: any;
  backupVersion?: string | null;
  retryCount?: number;
  error?: string | null;
  metadata?: any;
}

export interface UpdateJobInput {
  status?: string;
  filePath?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  compressedSize?: number | null;
  checksum?: string | null;
  baseBackupId?: string | null;
  parentBackupId?: string | null;
  backupLevel?: number | null;
  walPosition?: string | null;
  binlogFile?: string | null;
  binlogPosition?: number | null;
  oplogTimestamp?: string | null;
  backupName?: string | null;
  startedAt?: Date | string;
  completedAt?: Date | string | null;
  duration?: number | null;
  expiresAt?: Date | string | null;
  storageType?: string;
  storagePath?: string | null;
  storageRegion?: string | null;
  storageLocationId?: string | null;
  compressionType?: string | null;
  encryptionType?: string | null;
  encrypted?: boolean;
  encryptionMetadata?: any;
  backupVersion?: string | null;
  retryCount?: number;
  error?: string | null;
  metadata?: any;
}

export interface CreateScheduleInput {
  name?: string;
  dbType: string;
  dbName: string;
  schedule: string;
  backupType: string;
  compress?: boolean;
  storageType?: string;
  retention?: number;
  enabled?: boolean;
  notifyOnSuccess?: boolean;
  notifyOnError?: boolean;
  slackWebhook?: string | null;
  emailRecipients?: string | null;
  metadata?: any;
  createdBy?: string | null;
}

export interface CreateStorageInput {
  id?: string;
  name: string;
  type: string;
  bucket?: string | null;
  region?: string | null;
  accessKey?: string | null;
  secretKey?: string | null;
  config?: any;
  enabled?: boolean;
  default?: boolean;
}

export class MetadataClient {
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(config: MetadataClientConfig = {}) {
    this.baseUrl = config.baseUrl || process.env.METADATA_SERVICE_URL || 'http://127.0.0.1:3005';
    this.maxRetries = config.maxRetries !== undefined ? config.maxRetries : (process.env.METADATA_SERVICE_URL ? 2 : 0);
    this.retryDelayMs = config.retryDelayMs || 150;

    const axiosLib: any = axios;
    if (typeof axiosLib?.create === 'function') {
      this.client = axiosLib.create({
        baseURL: this.baseUrl,
        timeout: config.timeout || 5000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
    } else {
      this.client = axiosLib;
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private async request<T>(fn: () => Promise<{ data: T }>, operationName: string): Promise<T> {
    let attempt = 0;
    while (true) {
      attempt++;
      try {
        const response = await fn();
        return response.data;
      } catch (error: any) {
        const isAxios = axios.isAxiosError(error);
        const status = isAxios ? error.response?.status : undefined;
        const isNetworkOrTimeout = isAxios && (
          !error.response ||
          error.code === 'ECONNREFUSED' ||
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          (status && status >= 502 && status <= 504)
        );

        if (isNetworkOrTimeout && attempt <= this.maxRetries) {
          log.warn(`Metadata Service call failed (${operationName}), retrying attempt ${attempt}/${this.maxRetries}...`, {
            error: error.message,
          });
          await new Promise((r) => setTimeout(r, this.retryDelayMs * Math.pow(2, attempt - 1)));
          continue;
        }

        // Format explicit descriptive error
        if (isAxios) {
          if (!error.response) {
            if (error.code === 'ECONNREFUSED') {
              throw new Error(`dbvault background runtime is offline. Run "dbvault start" to launch background services.`);
            }
            throw new Error(`Metadata service unavailable: ${error.message} (${operationName})`);
          }
          const serverError = error.response.data?.error || error.response.data?.message;
          const detailMsg = serverError ? `: ${serverError}` : ` (HTTP ${status})`;
          const customErr: any = new Error(`${operationName} failed${detailMsg}`);
          customErr.status = status;
          customErr.statusCode = status;
          customErr.response = error.response;
          throw customErr;
        }

        throw new Error(`${operationName} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // ==================== Health ====================

  async health(): Promise<{ status: string; database: string; uptime?: number }> {
    return this.request(
      () => this.client.get('/health'),
      'Metadata service health check'
    );
  }

  // ==================== Backup Jobs ====================

  async createJob(data: CreateJobInput): Promise<any> {
    return this.request(
      () => this.client.post('/api/jobs', data),
      'Job creation'
    );
  }

  async getJob(id: string, includeLogs = false): Promise<any | null> {
    try {
      return await this.request(
        () => this.client.get(`/api/jobs/${encodeURIComponent(id)}`, {
          params: { includeLogs },
        }),
        `Get job '${id}'`
      );
    } catch (err: any) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        return null;
      }
      if (err.message && err.message.includes('HTTP 404')) {
        return null;
      }
      throw err;
    }
  }

  async updateJob(id: string, data: UpdateJobInput): Promise<any> {
    return this.request(
      () => this.client.patch(`/api/jobs/${encodeURIComponent(id)}`, data),
      `Job update '${id}'`
    );
  }

  async listJobs(params: {
    status?: string | string[];
    dbType?: string;
    dbName?: string;
    since?: Date | string;
    limit?: number;
    take?: number;
    skip?: number;
    orderBy?: 'asc' | 'desc';
  } = {}): Promise<{ success: boolean; jobs: any[]; total: number }> {
    const queryParams: any = { ...params };
    if (Array.isArray(queryParams.status)) {
      queryParams.status = queryParams.status.join(',');
    }
    if (queryParams.since instanceof Date) {
      queryParams.since = queryParams.since.toISOString();
    }
    return this.request(
      () => this.client.get('/api/jobs', { params: queryParams }),
      'List jobs'
    );
  }

  async countJobs(where?: any): Promise<number> {
    const params: any = { countOnly: 'true' };
    if (where?.status) {
      params.status = Array.isArray(where.status?.in) ? where.status.in.join(',') : where.status;
    }
    if (where?.startedAt?.gte) {
      params.since = where.startedAt.gte instanceof Date ? where.startedAt.gte.toISOString() : where.startedAt.gte;
    }
    if (where?.dbType) params.dbType = where.dbType;
    if (where?.dbName) params.dbName = where.dbName;

    const res: any = await this.request(
      () => this.client.get('/api/jobs', { params }),
      'Count jobs'
    );
    return res.count || 0;
  }

  async getActiveJobs(): Promise<any[]> {
    const res: any = await this.request(
      () => this.client.get('/api/jobs-active'),
      'Get active jobs'
    );
    return res.jobs || [];
  }

  async getJobStats(since?: Date): Promise<{
    activeJobs: number;
    countSince: number;
    failedSince: number;
    totalJobs: number;
    recentFailed: any[];
  }> {
    const params: any = {};
    if (since) params.since = since.toISOString();
    return this.request(
      () => this.client.get('/api/jobs-stats', { params }),
      'Get job stats'
    );
  }

  // ==================== Backup Logs ====================

  async addLog(jobId: string, logData: { level: string; message: string; details?: string }): Promise<any> {
    return this.request(
      () => this.client.post(`/api/jobs/${encodeURIComponent(jobId)}/logs`, logData),
      `Add log to job '${jobId}'`
    );
  }

  async getJobLogs(jobId: string): Promise<any[]> {
    const res: any = await this.request(
      () => this.client.get(`/api/jobs/${encodeURIComponent(jobId)}/logs`),
      `Get logs for job '${jobId}'`
    );
    return res.logs || [];
  }

  async getLogs(params: { backupJobId?: string; level?: string; limit?: number; take?: number; skip?: number } = {}): Promise<any[]> {
    const res: any = await this.request(
      () => this.client.get('/api/logs', { params }),
      'Query logs'
    );
    return res.logs || [];
  }

  // ==================== Schedules ====================

  async listSchedules(enabledOnly?: boolean): Promise<any[]> {
    const params: any = {};
    if (enabledOnly !== undefined) params.enabled = String(enabledOnly);
    const res: any = await this.request(
      () => this.client.get('/api/schedules', { params }),
      'List schedules'
    );
    return res.schedules || [];
  }

  async countSchedules(where?: any): Promise<number> {
    const params: any = { countOnly: 'true' };
    if (where?.enabled !== undefined) params.enabled = String(where.enabled);
    const res: any = await this.request(
      () => this.client.get('/api/schedules', { params }),
      'Count schedules'
    );
    return res.count || 0;
  }

  async getSchedule(id: string): Promise<any | null> {
    try {
      return await this.request(
        () => this.client.get(`/api/schedules/${encodeURIComponent(id)}`),
        `Get schedule '${id}'`
      );
    } catch (err: any) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return null;
      if (err.message && err.message.includes('HTTP 404')) return null;
      throw err;
    }
  }

  async createSchedule(data: CreateScheduleInput): Promise<any> {
    return this.request(
      () => this.client.post('/api/schedules', data),
      'Create schedule'
    );
  }

  async updateSchedule(id: string, data: any): Promise<any> {
    return this.request(
      () => this.client.patch(`/api/schedules/${encodeURIComponent(id)}`, data),
      `Update schedule '${id}'`
    );
  }

  async deleteSchedule(id: string): Promise<boolean> {
    await this.request(
      () => this.client.delete(`/api/schedules/${encodeURIComponent(id)}`),
      `Delete schedule '${id}'`
    );
    return true;
  }

  // ==================== Storage Locations ====================

  async listStorage(enabledOnly?: boolean): Promise<any[]> {
    const params: any = {};
    if (enabledOnly !== undefined) params.enabled = String(enabledOnly);
    const res: any = await this.request(
      () => this.client.get('/api/storage', { params }),
      'List storage locations'
    );
    return res.storages || [];
  }

  async countStorage(where?: any): Promise<number> {
    const params: any = { countOnly: 'true' };
    if (where?.enabled !== undefined) params.enabled = String(where.enabled);
    const res: any = await this.request(
      () => this.client.get('/api/storage', { params }),
      'Count storage locations'
    );
    return res.count || 0;
  }

  async getDefaultStorage(): Promise<any | null> {
    try {
      return await this.request(
        () => this.client.get('/api/storage-default'),
        'Get default storage'
      );
    } catch (err: any) {
      if (err.status === 404 || err.statusCode === 404 || (axios.isAxiosError(err) && err.response?.status === 404)) return null;
      if (err.message && (err.message.includes('HTTP 404') || err.message.toLowerCase().includes('not found') || err.message.includes('No default storage'))) return null;
      throw err;
    }
  }

  async getStorage(nameOrId: string): Promise<any | null> {
    try {
      return await this.request(
        () => this.client.get(`/api/storage/${encodeURIComponent(nameOrId)}`),
        `Get storage '${nameOrId}'`
      );
    } catch (err: any) {
      if (err.status === 404 || err.statusCode === 404 || (axios.isAxiosError(err) && err.response?.status === 404)) return null;
      if (err.message && (err.message.includes('HTTP 404') || err.message.toLowerCase().includes('not found'))) return null;
      throw err;
    }
  }

  async createStorage(data: CreateStorageInput): Promise<any> {
    return this.request(
      () => this.client.post('/api/storage', data),
      `Create storage '${data.name}'`
    );
  }

  async updateStorage(id: string, data: any): Promise<any> {
    return this.request(
      () => this.client.patch(`/api/storage/${encodeURIComponent(id)}`, data),
      `Update storage '${id}'`
    );
  }

  async setDefaultStorage(nameOrId: string): Promise<any> {
    return this.request(
      () => this.client.post(`/api/storage/${encodeURIComponent(nameOrId)}/default`),
      `Set default storage '${nameOrId}'`
    );
  }

  async deleteStorage(nameOrId: string): Promise<boolean> {
    await this.request(
      () => this.client.delete(`/api/storage/${encodeURIComponent(nameOrId)}`),
      `Delete storage '${nameOrId}'`
    );
    return true;
  }

  // ==================== Notification Configs ====================

  async listNotificationConfigs(): Promise<any[]> {
    const res: any = await this.request(
      () => this.client.get('/api/notifications/config'),
      'List notification configs'
    );
    return res.configs || [];
  }

  async countNotificationConfigs(): Promise<number> {
    const res: any = await this.request(
      () => this.client.get('/api/notifications/config', { params: { countOnly: 'true' } }),
      'Count notification configs'
    );
    return res.count || 0;
  }

  async getNotificationConfig(type: string): Promise<any | null> {
    try {
      return await this.request(
        () => this.client.get(`/api/notifications/config/${encodeURIComponent(type)}`),
        `Get notification config '${type}'`
      );
    } catch (err: any) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return null;
      if (err.message && err.message.includes('HTTP 404')) return null;
      throw err;
    }
  }

  async upsertNotificationConfig(type: string, data: any): Promise<any> {
    return this.request(
      () => this.client.post(`/api/notifications/config/${encodeURIComponent(type)}`, data),
      `Upsert notification config '${type}'`
    );
  }

  async deleteNotificationConfig(type: string): Promise<boolean> {
    await this.request(
      () => this.client.delete(`/api/notifications/config/${encodeURIComponent(type)}`),
      `Delete notification config '${type}'`
    );
    return true;
  }

  // ==================== Notification Audit ====================

  async recordNotification(data: {
    backupJobId?: string | null;
    type: string;
    status: string;
    recipient?: string | null;
    subject?: string | null;
    message?: string | null;
    sentAt?: Date | string;
    error?: string | null;
    retryCount?: number;
  }): Promise<any> {
    return this.request(
      () => this.client.post('/api/notifications', data),
      'Record notification'
    );
  }
}

export const metadataClient = new MetadataClient();
export default metadataClient;
