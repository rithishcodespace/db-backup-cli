export interface BackupRequest {
  id: string;
  dbType: 'postgresql' | 'mysql' | 'mongodb' | 'sqlite';
  dbConfig: DatabaseConfig;
  backupType: 'full' | 'incremental' | 'differential';
  options: BackupOptions;
  timestamp: Date;
}

export interface BackupResponse {
  success: boolean;
  backupId?: string;
  filePath?: string;
  fileSize?: number;
  duration?: number;
  error?: string;
  metadata?: BackupMetadata;
}

export interface DatabaseConfig {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database: string;
  ssl?: boolean;
  connectionString?: string;  // For MongoDB
}

export interface BackupOptions {
  compress: boolean;
  tables?: string[];
  excludeTables?: string[];
  outputPath?: string;
}

export interface BackupMetadata {
  id: string;
  dbType: string;
  dbName: string;
  backupType: string;
  size: number;
  checksum: string;
  createdAt: Date;
  compression: string;
}

export interface ServiceHealth {
  service: string;
  status: 'healthy' | 'unhealthy';
  version: string;
  uptime: number;
  timestamp: Date;
  details?: any;
}

export enum BackupStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed'
}