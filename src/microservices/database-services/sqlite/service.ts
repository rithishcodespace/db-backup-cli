import express from 'express';
import fs from 'fs';
import path from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
// import Database from 'better-sqlite3';
import { DatabaseConfig, BackupOptions, BackupResponse } from '../../shared/types';
import { createModuleLogger } from '../../../logger';
import { config as appConfig } from '../../../config';

const streamPipeline = promisify(pipeline);
const log = createModuleLogger('sqlite-backup-service');

const app = express();
app.use(express.json());

const SERVICE_PORT = process.env.SQLITE_SERVICE_PORT || 3013;
const SERVICE_NAME = 'sqlite-backup-service';
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
  
  log.info('Received SQLite backup request', { backupId, database: dbConfig.database });
  
  try {
    const result = await performSQLiteBackup(backupId, dbConfig, backupType, options);
    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('SQLite backup failed', { backupId, error: errorMessage });
    res.status(500).json({
      success: false,
      backupId,
      error: errorMessage
    });
  }
});

async function performSQLiteBackup(
  backupId: string,
  dbConfig: DatabaseConfig,
  backupType: string,
  options: BackupOptions
): Promise<BackupResponse> {
  const startTime = Date.now();
  
  // SQLite backup is simple file copy
  const sourceDb = dbConfig.database; // db name
  
  if (!fs.existsSync(sourceDb)) {
    throw new Error(`SQLite database file not found: ${sourceDb}`);
  }
  
  // Generate backup filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dbName = path.basename(sourceDb, '.db');
  const backupFileName = `${dbName}_${timestamp}.${options.compress ? 'db.gz' : 'db'}`;
  const backupPath = path.join(options.outputPath || appConfig.get('storage.localPath'), backupFileName);
  
  log.debug('Copying SQLite database', { backupId, source: sourceDb, dest: backupPath });
  
  try {
    if (options.compress) {
      // Compressed backup
      const sourceStream = fs.createReadStream(sourceDb);
      const gzipStream = createGzip();
      const destStream = fs.createWriteStream(backupPath);
      await streamPipeline(sourceStream, gzipStream, destStream);
    } else {
      // Simple copy
      fs.copyFileSync(sourceDb, backupPath);
    }
    
    const stats = fs.statSync(backupPath);
    const duration = (Date.now() - startTime) / 1000;
    
    log.info('SQLite backup completed', { backupId, size: stats.size, duration });
    
    return {
      success: true,
      backupId,
      filePath: backupPath,
      fileSize: stats.size,
      duration,
      metadata: {
        id: backupId,
        dbType: 'sqlite',
        dbName: dbName,
        backupType: backupType,
        size: stats.size,
        checksum: '',
        createdAt: new Date(),
        compression: options.compress ? 'gzip' : 'none'
      }
    };
  } catch (error) {
    throw new Error(`SQLite backup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

app.listen(SERVICE_PORT, () => {
  log.info(`${SERVICE_NAME} listening on port ${SERVICE_PORT}`);
});

export default app;