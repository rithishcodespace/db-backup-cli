import dotenv from 'dotenv';
import fs from 'fs';

// Load environment variables
dotenv.config();

export interface DatabaseConfig {
  type: 'postgresql' | 'mysql' | 'mongodb' | 'sqlite';
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database: string;
  ssl?: boolean;
}

export interface StorageConfig {
  localPath: string;
  tempPath: string;
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
}

class ConfigManager {
  private config: AppConfig;
  private configPath: string;

  constructor() {
    this.configPath = process.env.CONFIG_PATH || './config.json';
    this.config = this.loadConfig();
  }

  private loadConfig(): AppConfig {
    let customConfig = {};

    if (fs.existsSync(this.configPath)) {
      try {
        const fileContent = fs.readFileSync(this.configPath, 'utf-8');
        customConfig = JSON.parse(fileContent);
        console.log(`Loaded configuration from ${this.configPath}`);
      } catch (error) {
        console.warn(`Failed to load config from ${this.configPath}:`, error);
      }
    }

    // Get package version
    let version = '1.0.0';
    try {
      const packageJson = require('../../package.json');
      version = packageJson.version;
    } catch (error) {
      // Ignore error
    }

    const defaultConfig: AppConfig = {
      env: process.env.NODE_ENV || 'development',
      version: version,
      storage: {
        localPath: process.env.BACKUP_PATH || './backups/local',
        tempPath: process.env.TEMP_PATH || './tmp',
      },
      logging: {
        level: process.env.LOG_LEVEL || 'info',
        path: process.env.LOG_PATH || './logs',
        maxFiles: parseInt(process.env.LOG_MAX_FILES || '30'),
        maxSize: process.env.LOG_MAX_SIZE || '20m',
      },
    };

    // Merge with custom config
    return this.mergeConfig(defaultConfig, customConfig);
  }

  private mergeConfig(defaultConfig: AppConfig, customConfig: any): AppConfig {
    return {
      ...defaultConfig,
      ...customConfig,
      storage: { ...defaultConfig.storage, ...(customConfig.storage || {}) },
      logging: { ...defaultConfig.logging, ...(customConfig.logging || {}) },
      database: customConfig.database || defaultConfig.database,
    };
  }

  get(key: string): any { // object is made generic (any)
    return key.split('.').reduce(
    (obj, k) => (obj as any)?.[k],
    this.config as any
);
  }

  getAll(): AppConfig {
    return this.config;
  }

  setDatabase(config: DatabaseConfig): void {
    this.config.database = config;
    this.saveConfig();
  }

  private saveConfig(): void {
    try {
      // Remove version from saved config (it comes from package.json)
      const configToSave = { ...this.config };
      delete configToSave.version;
      
      fs.writeFileSync(this.configPath, JSON.stringify(configToSave, null, 2));
      this.ensureDirectories();
    } catch (error) {
      console.error('Failed to save configuration:', error);
    }
  }

  private ensureDirectories(): void {
    // Ensure required directories exist
    const dirs = [
      this.config.storage.localPath,
      this.config.storage.tempPath,
      this.config.logging.path,
    ];

    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }
}

// Singleton instance
export const config = new ConfigManager();
export default config;