export interface ActiveBackupDTO {
  id: string;
  dbType: string;
  dbName: string;
  backupType: string;
  status: string;
  startedAt: string;
  elapsedSeconds: number;
  stage: string;
  progress: number | null;
  fileName: string | null;
  storageLocationName: string | null;
  storageType: string | null;
  error?: string | null;
}

export interface QueueStateCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  total: number;
}

export interface QueueStatsDTO {
  backupQueue: QueueStateCounts;
  storageQueue: QueueStateCounts;
  notificationQueue: QueueStateCounts;
}

export interface ServiceHealthItem {
  name: string;
  port: number | null;
  status: 'healthy' | 'unhealthy' | 'degraded';
  url: string;
  responseTimeMs?: number;
  details?: any;
}

export interface SystemHealthDTO {
  status: 'healthy' | 'degraded' | 'critical';
  services: ServiceHealthItem[];
  workers: {
    name: string;
    concurrency: number;
    activeCount: number;
    status: 'running' | 'offline';
  }[];
  redisConnected: boolean;
  timestamp: string;
}

export interface BackupHistoryDTO {
  id: string;
  dbType: string;
  dbName: string;
  backupType: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  fileSizeBytes: number | null;
  formattedSize: string;
  fileName: string | null;
  filePath: string | null;
  storageType: string;
  storageName: string | null;
  error: string | null;
  humanError?: string | null;
  metadata?: any;
}

export interface LogItemDTO {
  id: number;
  backupJobId: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  message: string;
  details?: string | null;
}

export interface DashboardSummaryDTO {
  activeBackupsCount: number;
  maxConcurrencyLimit: number;
  activeConcurrencyCount: number;
  queueStats: QueueStatsDTO;
  successRate24h: number;
  totalBackups24h: number;
  failedBackups24h: number;
  systemStatus: 'healthy' | 'degraded' | 'critical';
  alertsCount: number;
  timestamp: string;
}

export interface AlertDTO {
  id: string;
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  humanizedAction?: string;
  timestamp: string;
  source: string;
}
