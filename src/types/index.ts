// Type definitions for the project

export interface BackupMetadata {
  id: string;
  dbType: string;
  dbName: string;
  backupType: 'full' | 'incremental' | 'differential';
  status: 'pending' | 'running' | 'success' | 'failed';
  filePath?: string;
  fileSize?: number;
  checksum?: string;
  startedAt: Date;
  completedAt?: Date;
  duration?: number;
  error?: string;
}

export interface BackupOptions {
  type: 'full' | 'incremental' | 'differential';
  compress: boolean;
  output?: string;
  name?: string;
}

export interface RestoreOptions {
  file: string;
  tables?: string[];
  dropExisting?: boolean;
}

export interface ScheduleOptions {
  cron: string;
  backupType: 'full' | 'incremental' | 'differential';
  retention?: number; // days to keep backups
}

export interface StorageProvider {
  upload(localPath: string, remotePath: string): Promise<string>;
  download(remotePath: string, localPath: string): Promise<string>;
  list(prefix?: string): Promise<string[]>;
  delete(remotePath: string): Promise<void>;
}

export type DatabaseType = 'postgresql' | 'mysql' | 'mongodb' | 'sqlite';
export type BackupStatus = 'pending' | 'running' | 'success' | 'failed';3.