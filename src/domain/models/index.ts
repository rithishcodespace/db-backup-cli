/**
 * Domain entities and value objects.
 */

export type DatabaseType = 'postgresql' | 'mysql' | 'mongodb' | 'sqlite';
export type BackupType = 'full' | 'incremental' | 'differential';
export type StorageType = 'local' | 's3';

export interface DatabaseConfigModel {
  type: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database: string;
  ssl?: boolean;
  connectionString?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  version?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface StorageLocationModel {
  id: string;
  name: string;
  type: string;
  bucket?: string | null;
  region?: string | null;
  accessKey?: string | null;
  secretKey?: string | null;
  prefix?: string | null;
  basePath?: string | null;
  config?: any;
  enabled: boolean;
  default: boolean;
}

export interface BackupJobModel {
  id: string;
  dbType: string;
  dbName: string;
  backupType: string;
  status: string;
  filePath?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  compressedSize?: number | null;
  checksum?: string | null;
  encrypted?: boolean | null;
  encryptionType?: string | null;
  encryptionKey?: string | null;
  encryptionIv?: string | null;
  encryptionTag?: string | null;
  baseBackupId?: string | null;
  parentBackupId?: string | null;
  backupLevel?: number | null;
  storageType?: string | null;
  storagePath?: string | null;
  storageLocationId?: string | null;
  startedAt: Date;
  completedAt?: Date | null;
  duration?: number | null;
  error?: string | null;
}
