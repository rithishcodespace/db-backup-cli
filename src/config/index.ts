import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { APP_VERSION } from '../version';

// Load environment variables quietly
dotenv.config({ quiet: true });

export interface DatabaseConfig {
  type: 'postgresql' | 'mysql' | 'mongodb' | 'sqlite';
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database: string;
  ssl?: boolean;
  backupOptions?: {
    compression?: 'gzip' | 'zstd' | 'none'; // gzip or zstd algorithm to compress backupfile, backup.sql -> z.gz, etc..
    parallel?: number; // no of parallel threads can be used to complete backup work simultaneously
    chunkSize?: number; // Size of each piece (chunk) processed at a time
  }
}

export interface StorageConfig {
  localPath: string;
  tempPath: string;
  retention?: number; // days to keep backups
  maxBackupSize?: string; 
}

export interface LogConfig {
  level: string;
  path: string;
  maxFiles: number;
  maxSize: string;
}

export interface AppConfig {
  env: string;
  version?: string;
  database?: DatabaseConfig;
  storage: StorageConfig;
  logging: LogConfig;
  backup?: {
    defaultType: 'full' | 'incremental' | 'differential';
    defaultCompression: boolean;
    maxParallelBackups: number
  }
}

class ConfigManager {
  private config: AppConfig;
  private configPath: string;

  constructor() {
    const localConfig = './config.json';
    const globalConfig = path.join(os.homedir(), '.db-backup', 'config.json');

    if (process.env.CONFIG_PATH) {
      this.configPath = process.env.CONFIG_PATH;
    } else if (fs.existsSync(localConfig)) {
      this.configPath = localConfig;
    } else {
      this.configPath = globalConfig;
    }

    this.config = this.loadConfig();
    this.ensureDirectories();
  }

  private loadConfig(): AppConfig {
    let customConfig = {};

    if (fs.existsSync(this.configPath)) {
      try {
        const fileContent = fs.readFileSync(this.configPath, 'utf-8');
        customConfig = JSON.parse(fileContent);
      } catch (error) {
        console.warn(`Failed to load config from ${this.configPath}:`, error);
      }
    }

    // Application version resolved globally from package.json
    const version = APP_VERSION;

    const defaultConfig: AppConfig = {
      env: process.env.NODE_ENV || 'development',
      version: version,
      storage: {
        localPath: process.env.BACKUP_PATH || path.join(os.homedir(), '.db-backup', 'backups'),
        tempPath: process.env.TEMP_PATH || path.join(os.homedir(), '.db-backup', 'tmp'),
        retention: parseInt(process.env.BACKUP_RETENTION_DAYS || '30'),
        maxBackupSize: process.env.MAX_BACKUP_sIZE || '50GB'
      },
      logging: {
        level: process.env.LOG_LEVEL || 'info',
        path: process.env.LOG_PATH || path.join(os.homedir(), '.db-backup', 'logs'),
        maxFiles: parseInt(process.env.LOG_MAX_FILES || '30'),
        maxSize: process.env.LOG_MAX_SIZE || '20m',
      },
      backup:{
        defaultType: 'full',
        defaultCompression: true,
        maxParallelBackups: parseInt(process.env.MAX_PARALLEL_BACKUPS || '3'),
      }
    };

    // Merge with custom config
    return this.mergeConfig(defaultConfig, customConfig);
  }

  private mergeConfig(defaultConfig: AppConfig, customConfig: any): AppConfig {
    const isDocker = fs.existsSync('/.dockerenv') || process.env.DOCKER_CONTAINER === 'true';
    const mergedStorage = { ...defaultConfig.storage, ...(customConfig.storage || {}) };
    const mergedLogging = { ...defaultConfig.logging, ...(customConfig.logging || {}) };

    if (isDocker) {
      mergedStorage.localPath = process.env.BACKUP_PATH
        ? path.join(process.env.BACKUP_PATH, 'backups')
        : '/app/backups/backups';
      mergedStorage.tempPath = '/app/tmp';
      mergedLogging.path = '/app/logs';
    }

    return {
      ...defaultConfig,
      ...customConfig,
      storage: mergedStorage,
      logging: mergedLogging,
      database: customConfig.database || defaultConfig.database,
    };
  }

  get(key: string): any {
      let result: any = this.config; //  comes from first line of class

      const keys = key.split('.');

      for(const k of keys) {
          result = result?.[k];
      }

    return result;
  }

  getAll(): AppConfig {
    return this.config;
  }

  // called by connect.ts
  setDatabase(config: DatabaseConfig): void {
    this.config.database = config;
    this.saveConfig();
  }

  setStorage(storage: Partial<StorageConfig>): void {
    this.config.storage = { ...this.config.storage, ...storage };
    this.saveConfig();
  }

  private saveConfig(): void {
    try {
      // Remove version from saved config (it comes from package.json)
      const configToSave = { ...this.config };
      delete (configToSave as any).version;

      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(configToSave, null, 2), { mode: 0o600 });
      this.ensureDirectories();
    } catch (error) {
      console.error('Failed to save configuration:', error);
    }
  }

  ensureDirectories(): void {
    // Ensure required directories exist
    const dirs = [
      this.config.storage.localPath,
      this.config.storage.tempPath,
      this.config.logging.path,
    ];

    dirs.forEach(dir => {
      if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
    });
  }

  updateBackupConfig(options: any): void {
    if (!this.config.backup) {
      this.config.backup = {
        defaultType: 'full',
        defaultCompression: true,
        maxParallelBackups: 3,
      };
    }
    
    Object.assign(this.config.backup, options);
    this.saveConfig();
  }
}

// Singleton instance
export const config = new ConfigManager();
export { env } from './env';
export default config;