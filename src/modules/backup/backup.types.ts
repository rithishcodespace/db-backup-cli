export interface BackupRequestDTO {
  dbConfig: {
    type: 'postgresql' | 'mysql' | 'mongodb' | 'sqlite';
    database: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    ssl?: boolean;
    tables?: string[];
    excludeTables?: string[];
  };
  backupType?: 'full' | 'incremental' | 'differential';
  options?: {
    backupName?: string;
    compress?: boolean;
    compression?: 'gzip' | 'zstd' | 'none';
    encrypt?: boolean;
    encryptionKey?: string;
    storage?: {
      name?: string;
      type?: 'local' | 's3';
      bucket?: string;
      prefix?: string;
    };
    storageLocationId?: string;
  };
}

export interface BackupResponseDTO {
  success: boolean;
  backupId?: string;
  duration?: number;
  fileSize?: number;
  message?: string;
  error?: string;
}

export interface BackupStatusDTO {
  id: string;
  status: string;
  progress?: number;
  stage?: string;
  error?: string;
}
