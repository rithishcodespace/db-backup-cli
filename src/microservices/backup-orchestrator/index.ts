import express from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from "../../lib/prisma";
import { createModuleLogger } from '../../logger';
import { BackupRequest, BackupResponse, BackupStatus } from '../shared/types';

const app = express();
app.use(express.json());

const log = createModuleLogger('backup-orchestrator');

const SERVICE_PORT = process.env.ORCHESTRATOR_PORT || 3001;
const SERVICE_NAME = 'backup-orchestrator';
const startTime = Date.now();

// Service registry (in production, use Consul/etcd)
const serviceRegistry = {
  postgresql: process.env.POSTGRES_SERVICE_URL || 'http://localhost:3010',
  mysql: process.env.MYSQL_SERVICE_URL || 'http://localhost:3011',
  mongodb: process.env.MONGODB_SERVICE_URL || 'http://localhost:3012',
  sqlite: process.env.SQLITE_SERVICE_URL || 'http://localhost:3013'
};

app.get('/health', (req, res) => {
  res.json({
    service: SERVICE_NAME,
    status: 'healthy',
    version: '1.0.0',
    uptime: (Date.now() - startTime) / 1000
  });
});

app.post('/backup', async (req, res) => {
  const { dbConfig, backupType, options } = req.body;
  const backupId = uuidv4();
  
  log.info('Received backup orchestration request', { backupId, dbType: dbConfig.type });
  
  try {
    type DBType = keyof typeof serviceRegistry;
    const dbType = dbConfig.type as DBType;

    // Validate database type
    if (!serviceRegistry[dbType]) {
      throw new Error(`Unsupported database type: ${dbConfig.type}`);
    }
    
    // Store backup name from options if provided
    const backupName = options?.backupName || null;
    
    // Create backup job record with full metadata
    await prisma.backupJob.create({
      data: {
        id: backupId,
        dbType: dbConfig.type,
        dbName: dbConfig.database,
        backupType: backupType,
        status: BackupStatus.RUNNING,
        startedAt: new Date(),
        fileName: backupName, // Store the backup name
        metadata: JSON.stringify({ 
          options,
          backupName,
          requestedAt: new Date().toISOString()
        })
      }
    });
    
    // Forward request to appropriate database service
    const serviceUrl = serviceRegistry[dbType];
    const response = await axios.post(`${serviceUrl}/backup`, {
      dbConfig,
      backupType,
      options
    });
    
    const result: BackupResponse = response.data;
    
    // Update job record with full results
    if (result.success) {
      await prisma.backupJob.update({
        where: { id: backupId },
        data: {
          status: BackupStatus.SUCCESS,
          filePath: result.filePath,
          fileSize: result.fileSize,
          duration: result.duration,
          completedAt: new Date(),
          fileName: result.metadata?.backupName || backupName || result.fileName,
          metadata: JSON.stringify({
            ...result.metadata,
            backupName: result.metadata?.backupName || backupName,
            requestedAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          })
        }
      });
      
      log.info('Backup orchestration completed', { backupId, duration: result.duration });
      res.json(result);
    } else {
      throw new Error(result.error);
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    await prisma.backupJob.update({
      where: { id: backupId },
      data: {
        status: BackupStatus.FAILED,
        error: errorMessage,
        completedAt: new Date()
      }
    });
    
    log.error('Backup orchestration failed', { backupId, error: errorMessage });
    res.status(500).json({
      success: false,
      backupId,
      error: errorMessage
    });
  }
});

app.get('/backup/:id/status', async (req, res) => {
  const { id } = req.params;
  
  const job = await prisma.backupJob.findUnique({
    where: { id }
  });
  
  if (!job) {
    res.status(404).json({ error: 'Backup job not found' });
    return;
  }
  
  res.json({
    id: job.id,
    status: job.status,
    progress: job.status === BackupStatus.RUNNING ? 50 : 100,
    filePath: job.filePath,
    fileSize: job.fileSize,
    duration: job.duration,
    error: job.error,
    createdAt: job.startedAt,
    completedAt: job.completedAt,
    backupName: job.fileName || 'N/A'
  });
});

app.listen(SERVICE_PORT, () => {
  log.info(`${SERVICE_NAME} listening on port ${SERVICE_PORT}`);
});

export default app;