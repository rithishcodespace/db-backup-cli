import { MongoClient } from 'mongodb';
import path from 'path';
import { BaseDatabaseAdapter } from './base.adapter';
import {
  DatabaseBackupOptions,
  DatabaseBackupResult,
  DatabaseRestoreOptions,
  DatabaseRestoreResult,
} from '../../../domain/interfaces/database-adapter.interface';
import { DatabaseConfigModel, ConnectionTestResult } from '../../../domain/models';

export class MongoDBAdapter extends BaseDatabaseAdapter {
  readonly supportedTypes = ['mongodb', 'mongo'];

  async testConnection(config: DatabaseConfigModel): Promise<ConnectionTestResult> {
    let uri = config.connectionString;
    if (!uri) {
      const auth = config.username && config.password ? `${config.username}:${config.password}@` : '';
      uri = `mongodb://${auth}${config.host || 'localhost'}:${config.port || 27017}/${config.database}`;
    }

    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    try {
      await client.connect();
      const adminDb = client.db().admin();
      const serverStatus = await adminDb.serverStatus();
      await client.close();

      return {
        success: true,
        version: serverStatus.version || 'MongoDB',
        details: { database: config.database },
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
      };
    } finally {
      try {
        await client.close();
      } catch {
        // ignore close error
      }
    }
  }

  async backup(config: DatabaseConfigModel, options: DatabaseBackupOptions): Promise<DatabaseBackupResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = options.backupName || `${config.database}_${timestamp}`;
    const fileName = `${baseName}.archive`;
    const outputPath = path.resolve(options.outputPath || './backups/local', fileName);

    const args: string[] = [
      '--host', String(config.host || 'localhost'),
      '--port', String(config.port || 27017),
      '--db', String(config.database),
      `--archive=${outputPath}`,
    ];

    if (config.username) args.push('--username', config.username);
    if (config.password) args.push('--password', config.password);

    await this.executeCommand('mongodump', args);

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

    const args: string[] = [
      '--host', String(dbConfig.host || 'localhost'),
      '--port', String(dbConfig.port || 27017),
      '--db', String(dbConfig.database),
      `--archive=${backupFilePath}`,
      '--drop',
    ];

    if (dbConfig.username) args.push('--username', dbConfig.username);
    if (dbConfig.password) args.push('--password', dbConfig.password);

    await this.executeCommand('mongorestore', args);

    return {
      success: true,
      message: 'MongoDB database restored successfully',
      duration: (Date.now() - startTime) / 1000,
    };
  }
}
