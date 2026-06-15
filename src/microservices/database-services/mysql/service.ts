import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { statSync } from 'fs';
// import { createGzip } from 'zlib';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseConfig, BackupOptions, BackupResponse } from '../../shared/types';
import { createModuleLogger } from '../../../logger';
import { config as appConfig } from '../../../config';

const execAsync = promisify(exec);
const log = createModuleLogger('mysql-backup-service');

const app = express();
app.use(express.json());

const SERVICE_PORT = process.env.MYSQL_SERVICE_PORT || 3011;
const SERVICE_NAME = 'mysql-backup-service';
const startTime = Date.now();

app.get('/health', (req, res) => {
  res.json({
    service: SERVICE_NAME,
    status: 'healthy',
    version: '1.0.0',
    uptime: (Date.now() - startTime) / 1000,
    timestamp: new Date()
  });
});

app.post('/backup', async (req, res) => {
  const backupId = uuidv4();
  const { dbConfig, backupType, options } = req.body;
  
  log.info('Received MySQL backup request', { backupId, database: dbConfig.database });
  
  try {
    const result = await performMySQLBackup(backupId, dbConfig, backupType, options);
    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('MySQL backup failed', { backupId, error: errorMessage });
    res.status(500).json({
      success: false,
      backupId,
      error: errorMessage
    });
  }
});

async function performMySQLBackup(
  backupId: string,
  dbConfig: DatabaseConfig,
  backupType: string,
  options: BackupOptions
): Promise<BackupResponse> {
  const startTime = Date.now();
  
  // Build mysqldump command
  let command = `mysqldump -h ${dbConfig.host} -P ${dbConfig.port || 3306} -u ${dbConfig.username}`;
  
  if (dbConfig.password) {
    command += ` -p${dbConfig.password}`;
  }
  
  command += ` ${dbConfig.database}`;
  
  if (options.tables && options.tables.length > 0) {
    command += ` ${options.tables.join(' ')}`;
  }
  
  if (options.excludeTables && options.excludeTables.length > 0) {
    command += ` --ignore-table=${dbConfig.database}.${options.excludeTables.join(` --ignore-table=${dbConfig.database}.`)}`;
  }
  
  command += ' --single-transaction --routines --triggers --events';
  
  // Generate backup filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `${dbConfig.database}_${timestamp}.${options.compress ? 'gz' : 'sql'}`;
  const backupPath = path.join(options.outputPath || appConfig.get('storage.localPath'), backupFileName);
  
  // Execute backup
  const finalCommand = options.compress 
    ? `${command} | gzip > "${backupPath}"`
    : `${command} > "${backupPath}"`;
  
  log.debug('Executing mysqldump', { backupId });
  
  try {
    await execAsync(finalCommand, { maxBuffer: 50 * 1024 * 1024 });
    
    const stats = statSync(backupPath);
    const duration = (Date.now() - startTime) / 1000;
    
    log.info('MySQL backup completed', { backupId, size: stats.size, duration });
    
    return {
      success: true,
      backupId,
      filePath: backupPath,
      fileSize: stats.size,
      duration,
      metadata: {
        id: backupId,
        dbType: 'mysql',
        dbName: dbConfig.database,
        backupType: backupType,
        size: stats.size,
        checksum: '',
        createdAt: new Date(),
        compression: options.compress ? 'gzip' : 'none'
      }
    };
  } catch (error) {
    throw new Error(`mysqldump failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

app.listen(SERVICE_PORT, () => {
  log.info(`${SERVICE_NAME} listening on port ${SERVICE_PORT}`);
});

export default app;