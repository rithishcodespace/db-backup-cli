import { Client, ClientConfig } from 'pg';
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

const log = createModuleLogger('postgres-adapter');

export class PostgresAdapter extends BaseDatabaseAdapter {
  readonly supportedTypes = ['postgresql', 'postgres', 'pg'];

  async testConnection(config: DatabaseConfigModel): Promise<ConnectionTestResult> {
    const clientConfig: ClientConfig = {
      host: config.host || 'localhost',
      port: config.port || 5432,
      user: config.username,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
    };

    const client = new Client(clientConfig);
    try {
      await client.connect();
      const res = await client.query('SELECT version() as version, current_database() as db, current_user as user');
      const versionStr = res.rows[0]?.version?.split(',')[0] || 'PostgreSQL';
      await client.end();

      return {
        success: true,
        version: versionStr,
        details: {
          database: res.rows[0]?.db,
          user: res.rows[0]?.user,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
      };
    } finally {
      try {
        await client.end();
      } catch {
        // ignore end error
      }
    }
  }

  async backup(config: DatabaseConfigModel, options: DatabaseBackupOptions): Promise<DatabaseBackupResult> {
    const startTime = Date.now();
    const host = config.host || '127.0.0.1';
    const port = config.port || 5432;
    const username = config.username || 'postgres';
    const password = config.password || '';

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = options.backupName || `${config.database}_${timestamp}`;
    const fileName = `${baseName}.dump`;
    const outputPath = path.resolve(options.outputPath || './backups/local', fileName);

    const args: string[] = [
      '-h', String(host),
      '-p', String(port),
      '-U', String(username),
      '-d', String(config.database),
      '--format=custom',
      '--blobs',
      '--clean',
      '--if-exists',
      '-f', outputPath,
    ];

    if (options.tables && Array.isArray(options.tables)) {
      options.tables.forEach((t) => args.push('-t', t));
    }
    if (options.excludeTables && Array.isArray(options.excludeTables)) {
      options.excludeTables.forEach((t) => args.push('-T', t));
    }

    await this.executeCommand('pg_dump', args, { PGPASSWORD: password });

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

    if (options.backupRecord && (options.backupRecord.backupType === 'incremental' || options.backupRecord.parentBackupId)) {
      log.info('Restoring PostgreSQL incremental backup chain', { backupId: options.backupRecord.id });
      const { PostgresIncrementalService } = await import('../../../services/postgres-incremental.service');
      const chainResult = await PostgresIncrementalService.restoreBackupChain(options.backupRecord.id, dbConfig as any);
      return {
        success: true,
        message: 'PostgreSQL incremental backup chain restored successfully',
        duration: chainResult.duration,
      };
    }

    const host = dbConfig.host || 'localhost';
    const port = dbConfig.port || 5432;
    const username = dbConfig.username || 'postgres';
    const password = dbConfig.password || '';
    const database = dbConfig.database;

    const isCustomDump = backupFilePath.endsWith('.dump') || backupFilePath.endsWith('.custom');
    const env = { PGPASSWORD: password };

    if (isCustomDump) {
      const args: string[] = [
        '-h', String(host),
        '-p', String(port),
        '-U', String(username),
        '-d', String(database),
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
      ];

      if (options.tables && options.tables.length > 0) {
        options.tables.forEach((t) => args.push('-t', t));
      }

      args.push(backupFilePath);
      await this.executeCommand('pg_restore', args, env);
    } else {
      // Plain SQL dump executed via psql
      const args: string[] = [
        '-h', String(host),
        '-p', String(port),
        '-U', String(username),
        '-d', String(database),
        '-f', backupFilePath,
      ];
      await this.executeCommand('psql', args, env);
    }

    return {
      success: true,
      message: 'PostgreSQL restore completed successfully',
      duration: (Date.now() - startTime) / 1000,
    };
  }
}
