import { DatabaseConfigModel, StorageLocationModel } from '../../domain/models';

export interface ConnectDTO {
  type: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
}

export interface ConnectResultDTO {
  success: boolean;
  version?: string;
  error?: string;
  database?: string;
  host?: string;
}

export interface BackupRequestInputDTO {
  type?: string;
  incremental?: boolean;
  parentId?: string;
  physical?: boolean;
  compress?: boolean;
  output?: string;
  name?: string;
  tables?: string[];
  excludeTables?: string[];
  async?: boolean;
  storage?: string;
  encrypt?: boolean;
  key?: string;
  noStoreKey?: boolean;
}

export interface BackupExecutionResultDTO {
  success: boolean;
  backupId: string;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  duration?: number;
  status?: string;
  message?: string;
  error?: string;
  queued?: boolean;
}

export interface RestoreRequestInputDTO {
  backupId?: string;
  filePath?: string;
  database?: string;
  target?: string;
  tables?: string[];
  key?: string;
  dryRun?: boolean;
  clean?: boolean;
  ifExists?: boolean;
  singleTransaction?: boolean;
  skipChecksum?: boolean;
}

export interface RestoreExecutionResultDTO {
  success: boolean;
  backupId?: string;
  message: string;
  duration?: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface ListBackupsInputDTO {
  type?: string;
  limit?: number;
  database?: string;
  status?: string;
}

