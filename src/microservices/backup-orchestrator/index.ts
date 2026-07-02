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
    
    // ============================================================
    // Get storage location ID from options
    // ============================================================
    let storageLocationId: string | null = null;
    const storageConfig = options?.storage || null;
    
    if (storageConfig && storageConfig.name) {
      const storage = await prisma.storageLocation.findUnique({
        where: { name: storageConfig.name }
      });
      
      if (storage) {
        storageLocationId = storage.id;
        log.debug('Using storage location', { 
          name: storage.name, 
          id: storageLocationId 
        });
      } else {
        // Storage not found - create it if it has all required fields
        if (storageConfig.type === 's3' && storageConfig.bucket) {
          const newStorage = await prisma.storageLocation.create({
            data: {
              name: storageConfig.name,
              type: 's3',
              bucket: storageConfig.bucket,
              region: storageConfig.region || 'us-east-1',
              accessKey: storageConfig.accessKey,
              secretKey: storageConfig.secretKey,
              config: {
                prefix: storageConfig.prefix || ''
              },
              enabled: true,
              default: false
            }
          });
          storageLocationId = newStorage.id;
          log.debug('Created new storage location', { 
            name: newStorage.name, 
            id: storageLocationId 
          });
        } else {
          // Local storage
          const newStorage = await prisma.storageLocation.create({
            data: {
              name: storageConfig.name,
              type: 'local',
              config: {
                basePath: storageConfig.basePath || './backups'
              },
              enabled: true,
              default: false
            }
          });
          storageLocationId = newStorage.id;
          log.debug('Created new storage location', { 
            name: newStorage.name, 
            id: storageLocationId 
          });
        }
      }
    }
    
    // ============================================================
    // CREATE BackupJob record with RUNNING status (Single Owner)
    // ============================================================
    const backupJob = await prisma.backupJob.create({
      data: {
        id: backupId,
        dbType: dbConfig.type,
        dbName: dbConfig.database,
        backupType: backupType,
        status: BackupStatus.RUNNING,
        startedAt: new Date(),
        fileName: backupName,
        storageLocationId: storageLocationId,
        metadata: JSON.stringify({ 
          options,
          backupName,
          storageLocationId,
          requestedAt: new Date().toISOString()
        })
      }
    });
    
    log.info('Backup job created', { backupId, status: BackupStatus.RUNNING });
    
    // ============================================================
    // Forward request to database service
    // ============================================================
    const serviceUrl = serviceRegistry[dbType];
    const response = await axios.post(`${serviceUrl}/backup`, {
      dbConfig,
      backupType,
      options: {
        ...options,
        backupId: backupId // Pass backupId for reference
      }
    });
    
    const result: BackupResponse = response.data;
    
    // ============================================================
    // UPDATE BackupJob to SUCCESS (Single Owner)
    // ============================================================
    if (result.success) {
      await prisma.backupJob.update({
        where: { id: backupId },
        data: {
          status: BackupStatus.SUCCESS,
          filePath: result.filePath,
          fileSize: result.fileSize,
          duration: result.duration,
          completedAt: new Date(),
          fileName: backupName || result.fileName,
          checksum: result.checksum,
          encrypted: result.encrypted,
          encryptionType: result.encryptionType,
          encryptionMetadata: result.encryptionMetadata,
          metadata: JSON.stringify({
            ...result.metadata,
            backupName: backupName,
            storageLocationId: storageLocationId,
            requestedAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          })
        }
      });
      
      log.info('Backup orchestration completed', { 
        backupId, 
        duration: result.duration,
        storageLocationId,
        status: BackupStatus.SUCCESS
      });
      res.json(result);
    } else {
      throw new Error(result.error || 'Backup failed with unknown error');
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // ============================================================
    // UPDATE BackupJob to FAILED on error (Single Owner)
    // ============================================================
    try {
      await prisma.backupJob.update({
        where: { id: backupId },
        data: {
          status: BackupStatus.FAILED,
          error: errorMessage,
          completedAt: new Date(),
          duration: (Date.now() - startTime) / 1000
        }
      });
    } catch (updateError) {
      log.error('Failed to update backup status to FAILED', { backupId, error: updateError });
    }
    
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
    where: { id },
    include: {
      storageLocation: true
    }
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
    backupName: job.fileName || 'N/A',
    storage: job.storageLocation ? {
      name: job.storageLocation.name,
      type: job.storageLocation.type
    } : null
  });
});

app.listen(SERVICE_PORT, () => {
  log.info(`${SERVICE_NAME} listening on port ${SERVICE_PORT}`);
});

export default app;