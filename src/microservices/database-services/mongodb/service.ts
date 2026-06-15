import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { statSync } from 'fs';
// import { createGzip } from 'zlib';
import { pipeline } from 'stream';
import { promisify as promisifyStream } from 'util';
// import { createWriteStream } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseConfig, BackupOptions, BackupResponse } from '../../shared/types';
import { createModuleLogger } from '../../../logger';
import { config as appConfig } from '../../../config';

const execAsync = promisify(exec);
const streamPipeline = promisifyStream(pipeline);
const log = createModuleLogger('mongodb-backup-service');

const app = express();
app.use(express.json());

const SERVICE_PORT = process.env.MONGODB_SERVICE_PORT || 3012;
const SERVICE_NAME = 'mongodb-backup-service';
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
  
  log.info('Received MongoDB backup request', { backupId, database: dbConfig.database });
  
  try {
    const result = await performMongoDBBackup(backupId, dbConfig, backupType, options);
    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('MongoDB backup failed', { backupId, error: errorMessage });
    res.status(500).json({
      success: false,
      backupId,
      error: errorMessage
    });
  }
});

async function performMongoDBBackup(
  backupId: string,
  dbConfig: DatabaseConfig,
  backupType: string,
  options: BackupOptions
): Promise<BackupResponse> {
  const startTime = Date.now();
  
  // Build mongodump command
  let command = `mongodump --host ${dbConfig.host} --port ${dbConfig.port || 27017}`;
  
  if (dbConfig.username && dbConfig.password) {
    command += ` --username ${dbConfig.username} --password ${dbConfig.password}`;
  }
  
  command += ` --db ${dbConfig.database}`;
  
  if (options.tables && options.tables.length > 0) {
    command += ` --collection ${options.tables.join(' --collection ')}`;
  }
  
  // Generate backup filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `${dbConfig.database}_${timestamp}.${options.compress ? 'gz' : 'archive'}`;
  const backupPath = path.join(options.outputPath || appConfig.get('storage.localPath'), backupFileName);
  
  // MongoDB dump creates a directory, we need to archive it
  const tempDir = path.join(appConfig.get('storage.tempPath'), backupId);
  command += ` --out ${tempDir}`;
  
  log.debug('Executing mongodump', { backupId, command });
  
  try {
    await execAsync(command, { maxBuffer: 50 * 1024 * 1024 });
    
    // Archive and compress the dump directory
    const archiveCommand = options.compress
      ? `tar czf "${backupPath}" -C "${tempDir}" .`
      : `tar cf "${backupPath}" -C "${tempDir}" .`;
    
    await execAsync(archiveCommand);
    
    // Cleanup temp directory
    await execAsync(`rm -rf ${tempDir}`);
    
    const stats = statSync(backupPath);
    const duration = (Date.now() - startTime) / 1000;
    
    log.info('MongoDB backup completed', { backupId, size: stats.size, duration });
    
    return {
      success: true,
      backupId,
      filePath: backupPath,
      fileSize: stats.size,
      duration,
      metadata: {
        id: backupId,
        dbType: 'mongodb',
        dbName: dbConfig.database,
        backupType: backupType,
        size: stats.size,
        checksum: '',
        createdAt: new Date(),
        compression: options.compress ? 'gzip' : 'tar'
      }
    };
  } catch (error) {
    throw new Error(`mongodump failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

app.listen(SERVICE_PORT, () => {
  log.info(`${SERVICE_NAME} listening on port ${SERVICE_PORT}`);
});

export default app;