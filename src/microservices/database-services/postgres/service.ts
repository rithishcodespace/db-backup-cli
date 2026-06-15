import express from 'express';
import { exec } from 'child_process'; // runs shell commands
import { promisify } from 'util'; // allows callbacks to use async/await
import { statSync } from 'fs'; // reads file info like size
import { createGzip } from 'zlib';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseConfig, BackupOptions, BackupResponse } from '../../shared/types';
import { createModuleLogger } from '../../../logger';
import { config as appConfig } from '../../../config';

const execAsync = promisify(exec);
const log = createModuleLogger('postgres-backup-service');

const app = express();
app.use(express.json());

const SERVICE_PORT = process.env.POSTGRES_SERVICE_PORT || 3010;
const SERVICE_NAME = 'postgres-backup-service';
const startTime = Date.now();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    service: SERVICE_NAME,
    status: 'healthy',
    version: '1.0.0',
    uptime: (Date.now() - startTime) / 1000,
    timestamp: new Date()
  });
});

// Backup endpoint
app.post('/backup', async (req, res) => {
  const backupId = uuidv4();
  const { dbConfig, backupType, options } = req.body;
  
  log.info('Received backup request', { backupId, dbType: dbConfig.type, backupType });
  
  try {
    const result = await performBackup(backupId, dbConfig, backupType, options);
    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Backup failed', { backupId, error: errorMessage });
    res.status(500).json({
      success: false,
      backupId,
      error: errorMessage
    });
  }
});

async function performBackup(
  backupId: string,
  dbConfig: DatabaseConfig,
  backupType: string,
  options: BackupOptions
): Promise<BackupResponse> {
  const startTime = Date.now();
  
  // Build pg_dump command
  let command = `pg_dump -h ${dbConfig.host} -p ${dbConfig.port || 5432} -U ${dbConfig.username} -d ${dbConfig.database}`; // pg_dump -h localhost -p 5432 -U postgres -d mydb
  command += ' --format=custom --verbose --no-owner --no-privileges';
  
  if (options.tables && options.tables.length > 0) {
    options.tables.forEach(table => { command += ` -t ${table}`; });
  }
  
  if (options.excludeTables && options.excludeTables.length > 0) {
    options.excludeTables.forEach(table => { command += ` -T ${table}`; });
  }
  
  // Generate backup filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `${dbConfig.database}_${timestamp}.${options.compress ? 'gz' : 'dump'}`; // mydb_2026-06-15T10-30-00.gz
  const backupPath = path.join(options.outputPath || appConfig.get('storage.localPath'), backupFileName);
  
  // Execute backup - compress or not (.gz or .dump)
  const finalCommand = options.compress 
    ? `${command} | gzip > "${backupPath}"`
    : `${command} > "${backupPath}"`;
  
  log.debug('Executing backup command', { backupId, command: finalCommand.substring(0, 200) });
  
  try {
    await execAsync(finalCommand, {
      maxBuffer: 50 * 1024 * 1024, // // 50MB buffer (max output to be stored size)
      env: { ...process.env, PGPASSWORD: dbConfig.password }
    });
    
    const stats = statSync(backupPath);
    const duration = (Date.now() - startTime) / 1000;
    
    log.info('Backup completed', { backupId, size: stats.size, duration });
    
    return {
      success: true,
      backupId,
      filePath: backupPath,
      fileSize: stats.size,
      duration,
      metadata: {
        id: backupId,
        dbType: 'postgresql',
        dbName: dbConfig.database,
        backupType: backupType,
        size: stats.size,
        checksum: '', // Will calculate in Phase 4
        createdAt: new Date(),
        compression: options.compress ? 'gzip' : 'none'
      }
    };
  } catch (error) {
    throw new Error(`pg_dump failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Start service
app.listen(SERVICE_PORT, () => {
  log.info(`${SERVICE_NAME} listening on port ${SERVICE_PORT}`);
});

export default app;