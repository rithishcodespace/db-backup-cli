export interface RestoreRequestDTO {
  backupId?: string;
  filePath?: string;
  dbConfig?: {
    type: 'postgresql' | 'mysql' | 'mongodb' | 'sqlite';
    database: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    ssl?: boolean;
  };
  options?: {
    dropExisting?: boolean;
    dryRun?: boolean;
    storageType?: 'local' | 's3';
  };
}

export interface RestoreResponseDTO {
  success: boolean;
  message: string;
  backupId?: string;
  duration?: number;
  details?: any;
}
