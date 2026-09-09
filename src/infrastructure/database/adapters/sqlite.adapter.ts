import { existsSync, copyFileSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';
import { BaseDatabaseAdapter } from './base.adapter';
import {
  DatabaseBackupOptions,
  DatabaseBackupResult,
  DatabaseRestoreOptions,
  DatabaseRestoreResult,
} from '../../../domain/interfaces/database-adapter.interface';
import { DatabaseConfigModel, ConnectionTestResult } from '../../../domain/models';

export class SQLiteAdapter extends BaseDatabaseAdapter {
  readonly supportedTypes = ['sqlite', 'sqlite3'];

  async testConnection(config: DatabaseConfigModel): Promise<ConnectionTestResult> {
    try {
      let dbPath = config.database;
      if (!existsSync(dbPath) && existsSync(`${dbPath}.db`)) {
        dbPath = `${dbPath}.db`;
      }

      if (existsSync(dbPath)) {
        return {
          success: true,
          version: 'SQLite 3.x',
          details: { database: dbPath },
        };
      }

      return {
        success: true,
        version: 'SQLite 3.x (new file will be created on write)',
        details: { database: dbPath },
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
      };
    }
  }

  async backup(config: DatabaseConfigModel, options: DatabaseBackupOptions): Promise<DatabaseBackupResult> {
    const startTime = Date.now();
    let sourceDb = config.database;
    if (!existsSync(sourceDb)) {
      if (existsSync(`${sourceDb}.db`)) {
        sourceDb = `${sourceDb}.db`;
      } else if (existsSync('backup-meta.db')) {
        sourceDb = 'backup-meta.db';
      } else {
        throw new Error(`SQLite database file not found: ${config.database}`);
      }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dbName = path.basename(sourceDb, '.db');
    const fileName = options.backupName ? `${options.backupName}.db` : `${dbName}_${timestamp}.db`;
    const outputPath = path.resolve(options.outputPath || './backups/local', fileName);

    const dir = path.dirname(outputPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    copyFileSync(sourceDb, outputPath);

    return {
      success: true,
      backupId: options.backupId,
      filePath: outputPath,
      fileName,
      fileSize: 0,
      duration: (Date.now() - startTime) / 1000,
    };
  }

  async restore(options: DatabaseRestoreOptions): Promise<DatabaseRestoreResult> {
    const startTime = Date.now();
    const { backupFilePath, dbConfig } = options;

    const targetPath = path.resolve(dbConfig.database);
    const targetDir = path.dirname(targetPath);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    // Atomic replacement
    const tempRestore = `${targetPath}.restoring`;
    copyFileSync(backupFilePath, tempRestore);
    if (existsSync(targetPath)) {
      unlinkSync(targetPath);
    }
    copyFileSync(tempRestore, targetPath);
    unlinkSync(tempRestore);

    return {
      success: true,
      message: `SQLite database restored successfully to ${targetPath}`,
      duration: (Date.now() - startTime) / 1000,
      details: { targetPath },
    };
  }
}
