import { DatabaseConfigModel, ConnectionTestResult } from '../models';

export interface DatabaseBackupOptions {
  backupId: string;
  outputPath?: string;
  backupName?: string;
  compress?: boolean;
  encrypt?: boolean;
  encryptionKey?: string;
  tables?: string[];
  excludeTables?: string[];
  parentBackupId?: string;
  physical?: boolean;
  [key: string]: unknown;
}

export interface DatabaseBackupResult {
  success: boolean;
  backupId: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  duration: number;
  checksum?: string;
  encrypted?: boolean;
  encryptionType?: string;
  encryptionIv?: string;
  encryptionTag?: string;
  metadata?: Record<string, unknown>;
}

export interface DatabaseRestoreOptions {
  backupFilePath: string;
  dbConfig: DatabaseConfigModel;
  tables?: string[];
  clean?: boolean;
  ifExists?: boolean;
  singleTransaction?: boolean;
  targetDir?: string;
  dryRun?: boolean;
  backupRecord?: any;
  [key: string]: unknown;
}

export interface DatabaseRestoreResult {
  success: boolean;
  message?: string;
  tablesRestored?: number;
  duration?: number;
  details?: Record<string, unknown>;
}

export interface IDatabaseConnectionTester {
  testConnection(config: DatabaseConfigModel): Promise<ConnectionTestResult>;
}

export interface IDatabaseBackupExecutor {
  backup(config: DatabaseConfigModel, options: DatabaseBackupOptions): Promise<DatabaseBackupResult>;
}

export interface IDatabaseRestoreExecutor {
  restore(options: DatabaseRestoreOptions): Promise<DatabaseRestoreResult>;
}

export interface IDatabaseAdapter
  extends IDatabaseConnectionTester,
    IDatabaseBackupExecutor,
    IDatabaseRestoreExecutor {
  readonly supportedTypes: string[];
}
