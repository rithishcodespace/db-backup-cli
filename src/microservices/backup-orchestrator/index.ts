import express from 'express';
import helmet from 'helmet';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { metadataClient } from "../../lib/metadata-client";
import { createModuleLogger } from '../../logger';
import { BackupRequest, BackupResponse, BackupStatus } from '../shared/types';
import { createBackupQueue, createRestoreQueue, createStorageQueue, createNotificationQueue } from '../../lib/queue-manager';
import { validateBody, validateParams, BackupRequestSchema, IdParamSchema } from '../shared/validators';
import { RestoreRequestSchema } from '../../schemas/restore.schema';
import { sanitizeErrorMessage } from '../../utils/credential-scrubber';

const app = express();
app.use(helmet());
app.use(express.json({ limit: '10mb' }));

const log = createModuleLogger('backup-orchestrator');

const SERVICE_PORT = process.env.ORCHESTRATOR_PORT || 3001;
const SERVICE_NAME = 'backup-orchestrator';
const startTime = Date.now();

// Service registry 
const serviceRegistry = {
  postgresql: process.env.POSTGRES_SERVICE_URL || 'http://localhost:3010',
  mysql: process.env.MYSQL_SERVICE_URL || 'http://localhost:3011',
  mongodb: process.env.MONGODB_SERVICE_URL || 'http://localhost:3012',
  sqlite: process.env.SQLITE_SERVICE_URL || 'http://localhost:3013'
};

// Queue instances (lazy loaded)
let backupQueue: any = null;
let restoreQueue: any = null;
let storageQueue: any = null;
let notificationQueue: any = null;

async function getQueues() {
  if (!backupQueue) {
    backupQueue = createBackupQueue();
    restoreQueue = createRestoreQueue();
    storageQueue = createStorageQueue();
    notificationQueue = createNotificationQueue();
  }
  return { backupQueue, restoreQueue, storageQueue, notificationQueue };
}

app.get('/health', (req, res) => {
  res.json({
    service: SERVICE_NAME,
    status: 'healthy',
    version: '1.0.0',
    uptime: (Date.now() - startTime) / 1000
  });
});

app.post('/backup', validateBody(BackupRequestSchema), async (req, res) => {
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
    
    // Get storage location ID from options
    let storageLocationId: string | null = null;
    const storageConfig = options?.storage || null;
    
    if (storageConfig && storageConfig.name) {
      const storage = await metadataClient.getStorage(storageConfig.name);
      
      if (storage) {
        storageLocationId = storage.id;
        log.debug('Using storage location', { 
          name: storage.name, 
          id: storageLocationId 
        });
      } else {
        // Storage not found - create it if it has all required fields
        if (storageConfig.type === 's3' && storageConfig.bucket) {
          const newStorage = await metadataClient.createStorage({
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
          });
          storageLocationId = newStorage.id;
          log.debug('Created new storage location', { 
            name: newStorage.name, 
            id: storageLocationId 
          });
        } else {
          // Local storage
          const newStorage = await metadataClient.createStorage({
            name: storageConfig.name,
            type: 'local',
            config: {
              basePath: storageConfig.basePath || './backups'
            },
            enabled: true,
            default: false
          });
          storageLocationId = newStorage.id;
          log.debug('Created new storage location', { 
            name: newStorage.name, 
            id: storageLocationId 
          });
        }
      }
    }

    const { backupQueue: queue } = await getQueues();

    const MAX_QUEUE_SIZE =
        parseInt(process.env.MAX_QUEUE_SIZE || "50");

    const waitingJobs = await queue.getWaitingCount();

    // Waiting queue limit
    if (waitingJobs >= MAX_QUEUE_SIZE) {
        return res.status(429).json({
            success: false,
            error: "Backup queue is full.",
            queueSize: waitingJobs,
            maxQueueSize: MAX_QUEUE_SIZE
        });
    }

    // CREATE BackupJob record with RUNNING status
    await metadataClient.createJob({
      id: backupId,
      dbType: dbConfig.type,
      dbName: dbConfig.database,
      backupType: backupType,
      status: BackupStatus.RUNNING,
      startedAt: new Date(),
      fileName: backupName,
      storageLocationId: storageLocationId,
      metadata: { 
        options,
        backupName,
        storageLocationId,
        requestedAt: new Date().toISOString()
      }
    });
    
    log.info('Backup job created', { backupId, status: BackupStatus.RUNNING });
    
    // ADD JOB TO QUEUE INSTEAD OF DIRECT CALL
    
    await queue.add('backup', { // backup is the name of job
      backupId,
      dbConfig,
      backupType,
      options: {
        ...options,
        backupId,
        storageLocationId,
        storage: storageConfig
      }
    }, {
      jobId: backupId, // Use backupId as jobId for tracking
    });
    
    log.info('Backup job queued', { backupId });
    
    // RETURN QUEUED RESPONSE IMMEDIATELY

    return res.json({
      success: true,
      backupId,
      queued: true,
      status: 'queued',
      message: 'Backup has been queued and will be processed shortly',
      statusUrl: `/backup/${backupId}/status`
    });
    
  } catch (error) {
    const rawError = error instanceof Error ? error.message : String(error);
    const errorMessage = sanitizeErrorMessage(rawError);
    
    // UPDATE BackupJob to FAILED on error
    try {
      await metadataClient.updateJob(backupId, {
        status: BackupStatus.FAILED,
        error: errorMessage,
        completedAt: new Date(),
        duration: (Date.now() - startTime) / 1000
      });
    } catch (updateError) {
      log.error('Failed to update backup status to FAILED', { backupId, error: updateError });
    }
    
    log.error('Backup orchestration failed', { backupId, error: errorMessage });
    return res.status(500).json({
      success: false,
      backupId,
      error: errorMessage
    });
  }
});

app.get('/backup/:id/status', validateParams(IdParamSchema), async (req, res) => {
  const id = req.params.id as string;
  
  try {
    // Get job from database
    const job = await metadataClient.getJob(id);
    
    if (!job) {
      res.status(404).json({ error: 'Backup job not found' });
      return;
    }
    
    // Get queue status if job is still in queue
    let queueStatus = null;
    try {
      const { backupQueue: queue } = await getQueues();
      const queueJob = await queue.getJob(id);
      if (queueJob) {
        const state = await queueJob.getState();
        queueStatus = {
          state: state,
          progress: queueJob.progress,
          attempts: queueJob.attemptsMade,
          maxAttempts: queueJob.opts.attempts,
        };
      }
    } catch (e) {
      // Ignore queue errors
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
      } : null,
      queueStatus
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Failed to get backup status', { backupId: id, error: errorMessage });
    res.status(500).json({
      error: 'Failed to get backup status',
      message: errorMessage
    });
  }
});

app.delete('/backup/:id', validateParams(IdParamSchema), async (req, res) => {
  const id = req.params.id as string;
  
  try {
    // Check if job exists
    const job = await metadataClient.getJob(id);
    
    if (!job) {
      res.status(404).json({ error: 'Backup job not found' });
      return;
    }
    
    // Remove from queue if still pending
    try {
      const { backupQueue: queue } = await getQueues();
      const queueJob = await queue.getJob(id);
      if (queueJob) {
        await queueJob.remove();
        log.info('Removed job from queue', { backupId: id });
      }
    } catch (e) {
      // Ignore queue errors
    }
    
    // Update status to cancelled
    await metadataClient.updateJob(id, {
      status: 'cancelled',
      completedAt: new Date()
    });
    
    res.json({
      success: true,
      message: 'Backup job cancelled'
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Failed to cancel backup', { backupId: id, error: errorMessage });
    res.status(500).json({
      error: 'Failed to cancel backup',
      message: errorMessage
    });
  }
});

app.get('/queue/stats', async (req, res) => {
  try {
    const { backupQueue: queue } = await getQueues();
    
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);
    
    res.json({
      queue: 'backup-queue',
      stats: {
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + completed + failed + delayed,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      error: 'Failed to get queue stats',
      message: errorMessage
    });
  }
});

app.post('/restore', validateBody(RestoreRequestSchema), async (req, res) => {
  const { dbConfig, backupId, filePath, options = {} } = req.body;
  const restoreId = uuidv4();

  log.info('Received restore orchestration request', { restoreId, backupId, filePath, dbType: dbConfig.type });

  try {
    type DBType = keyof typeof serviceRegistry;
    const dbType = dbConfig.type as DBType;

    if (!serviceRegistry[dbType]) {
      return res.status(400).json({
        success: false,
        error: `Unsupported database type: ${dbConfig.type}`
      });
    }

    if (backupId) {
      const backupJob = await metadataClient.getJob(backupId);
      if (!backupJob) {
        return res.status(404).json({
          success: false,
          error: `Backup job ${backupId} not found`
        });
      }
    }

    const { restoreQueue: queue } = await getQueues();

    await queue.add('restore', {
      restoreId,
      backupId,
      filePath,
      dbConfig,
      options
    }, {
      jobId: restoreId
    });

    log.info('Restore job queued', { restoreId });

    return res.json({
      success: true,
      restoreId,
      queued: true,
      status: 'queued',
      message: 'Restore has been queued and will be processed shortly',
      statusUrl: `/restore/${restoreId}/status`
    });
  } catch (error) {
    const rawError = error instanceof Error ? error.message : String(error);
    const errorMessage = sanitizeErrorMessage(rawError);
    log.error('Restore orchestration failed', { restoreId, error: errorMessage });
    return res.status(500).json({
      success: false,
      restoreId,
      error: errorMessage
    });
  }
});

app.get('/restore/:id/status', validateParams(IdParamSchema), async (req, res) => {
  const id = req.params.id as string;

  try {
    const { restoreQueue: queue } = await getQueues();
    const queueJob = await queue.getJob(id);

    if (!queueJob) {
      const logs = await metadataClient.getLogs({ backupJobId: id }).catch(() => []);
      if (logs && logs.length > 0) {
        const lastLog = logs[logs.length - 1];
        const isError = lastLog.level === 'ERROR';
        return res.json({
          id,
          status: isError ? 'failed' : 'completed',
          progress: isError ? 0 : 100,
          error: isError ? lastLog.message : null,
          logs
        });
      }

      return res.status(404).json({ error: 'Restore job not found in queue' });
    }

    const state = await queueJob.getState();
    const result = queueJob.returnvalue;
    const failedReason = queueJob.failedReason;

    return res.json({
      id: queueJob.id,
      status: state,
      progress: queueJob.progress,
      attempts: queueJob.attemptsMade,
      maxAttempts: queueJob.opts.attempts,
      result: result || null,
      error: failedReason || null
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Failed to get restore status', { restoreId: id, error: errorMessage });
    return res.status(500).json({
      error: 'Failed to get restore status',
      message: errorMessage
    });
  }
});

app.listen(SERVICE_PORT, () => {
  log.info(`${SERVICE_NAME} listening on port ${SERVICE_PORT}`);
});

export default app;