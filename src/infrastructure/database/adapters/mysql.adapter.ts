import mysql from 'mysql2/promise';
import path from 'path';
import { BaseDatabaseAdapter } from './base.adapter';
import {
  DatabaseBackupOptions,
  DatabaseBackupResult,
  DatabaseRestoreOptions,
  DatabaseRestoreResult,
} from '../../../domain/interfaces/database-adapter.interface';
import { DatabaseConfigModel, ConnectionTestResult } from '../../../domain/models';
import { createModuleLogger } from '../../../logger';

const log = createModuleLogger('mysql-adapter');

export class MySQLAdapter extends BaseDatabaseAdapter {
  readonly supportedTypes = ['mysql', 'mariadb'];

  async testConnection(config: DatabaseConfigModel): Promise<ConnectionTestResult> {
    try {
      const connection = await mysql.createConnection({
        host: config.host || 'localhost',
        port: config.port || 3306,
        user: config.username || 'root',
        password: config.password,
        database: config.database,
        connectTimeout: 5000,
      });

      const [rows] = await connection.query('SELECT VERSION() as version, DATABASE() as db, CURRENT_USER() as user');
      const row = (rows as any[])[0];
      await connection.end();

      return {
        success: true,
        version: row?.version || 'MySQL',
        details: { database: row?.db, user: row?.user },
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
    const host = config.host || 'localhost';
    const port = config.port || 3306;
    const user = config.username || 'root';
    const password = config.password || '';

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = options.backupName || `${config.database}_${timestamp}`;
    const fileName = `${baseName}.sql`;
    const outputPath = path.resolve(options.outputPath || './backups/local', fileName);

    const args: string[] = [
      '-h', String(host),
      '-P', String(port),
      '-u', String(user),
      '--single-transaction',
      '--quick',
      '--result-file', outputPath,
    ];

    if (password) {
      args.push(`-p${password}`);
    }

    args.push(config.database);

    if (options.tables && Array.isArray(options.tables)) {
      args.push(...options.tables);
    }

    await this.executeCommand('mysqldump', args);

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

    const backupId = options.backupRecord?.id || path.basename(backupFilePath).split('.')[0];
    try {
      const { MySQLIncrementalBackupManager } = require('../../../microservices/database-services/mysql/manager');
      const manager = MySQLIncrementalBackupManager.getInstance();
      const chain = await manager.getBackupChain(backupId);
      if (chain) {
        log.info('Restoring MySQL point-in-time chain', { backupId });
        await manager.restoreToPointInTime(dbConfig, backupId);
        return {
          success: true,
          message: 'MySQL incremental backup chain restored successfully',
          duration: (Date.now() - startTime) / 1000,
        };
      }
    } catch {
      // Non-incremental or manager not available
    }

    const host = dbConfig.host || 'localhost';
    const port = dbConfig.port || 3306;
    const user = dbConfig.username || 'root';
    const password = dbConfig.password || '';
    const database = dbConfig.database;

    const args: string[] = [
      '-h', String(host),
      '-P', String(port),
      '-u', String(user),
    ];

    if (password) {
      args.push(`-p${password}`);
    }

    args.push(database, '-e', `source ${backupFilePath}`);

    await this.executeCommand('mysql', args);

    return {
      success: true,
      message: 'MySQL database restored successfully',
      duration: (Date.now() - startTime) / 1000,
    };
  }
}
