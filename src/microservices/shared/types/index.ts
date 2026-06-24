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
  fileName?: string;
}

export interface DatabaseConfig {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database: string;
  ssl?: boolean;
  connectionString?: string; // MongoDB
}

/**
 * Storage configuration
 */
export interface StorageOptions {
  type: 'local' | 's3';

  // Common
  name?: string;

  // Local storage
  basePath?: string;

  // S3 storage
  bucket?: string;
  region?: string;
  accessKey?: string;
  secretKey?: string;
  prefix?: string;
}

/**
 * Backup options
 */
export interface BackupOptions {
  compress: boolean;

  tables?: string[];
  excludeTables?: string[];

  outputPath?: string;
  backupName?: string;

  // NEW
  storage?: StorageOptions;
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

  backupName?: string;
  note?: string;

  // NEW
  storageType?: 'local' | 's3';
  storagePath?: string;

  storage?: {
    name?: string;
    type: 'local' | 's3';

    // local
    path?: string;

    // s3
    bucket?: string;
    region?: string;
    key?: string;
    etag?: string;
    versionId?: string;
  };
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