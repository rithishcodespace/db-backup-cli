// src/microservices/backup-worker/index.ts

import { registerBackupWorker, registerStorageWorker, registerNotificationWorker } from '../../lib/queue-manager';
import { Job } from 'bullmq';
import axios from 'axios';
import { prisma } from '../../lib/prisma';
import { BackupStatus } from '../shared/types';
import { createModuleLogger } from '../../logger';

const log = createModuleLogger('backup-worker');

const serviceRegistry = {
    postgresql: process.env.POSTGRES_SERVICE_URL || 'http://localhost:3010',
    mysql: process.env.MYSQL_SERVICE_URL || 'http://localhost:3011',
    mongodb: process.env.MONGODB_SERVICE_URL || 'http://localhost:3012',
    sqlite: process.env.SQLITE_SERVICE_URL || 'http://localhost:3013'
};

const STORAGE_SERVICE_URL = process.env.STORAGE_SERVICE_URL || 'http://localhost:3030';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3040';

function getServiceUrl(dbType: string): string {
    const registry = serviceRegistry as Record<string, string>;
    const url = registry[dbType];
    if (!url) {
        throw new Error(`Unsupported database type: ${dbType}`);
    }
    return url;
}

// BACKUP WORKER PROCESSOR

async function handleBackupJob(job: Job) {
    const { backupId, dbConfig, backupType, options } = job.data;
    
    log.info('Processing backup job', { backupId, dbType: dbConfig.type });
    
    try {
        await job.updateProgress(10);
        
        await prisma.backupJob.update({
            where: { id: backupId },
            data: { status: BackupStatus.RUNNING }
        });
        
        const serviceUrl = getServiceUrl(dbConfig.type);
        
        await job.updateProgress(30);
        
        const response = await axios.post(`${serviceUrl}/backup`, {
            dbConfig,
            backupType,
            options: {
                ...options,
                backupId
            }
        }, {
            timeout: 3600000
        });
        
        await job.updateProgress(80);
        
        const result = response.data;
        
        if (result.success) {
            await prisma.backupJob.update({
                where: { id: backupId },
                data: {
                    status: BackupStatus.SUCCESS,
                    filePath: result.filePath,
                    fileSize: result.fileSize,
                    duration: result.duration,
                    completedAt: new Date(),
                    fileName: result.fileName,
                    checksum: result.checksum,
                    encrypted: result.encrypted,
                    encryptionType: result.encryptionType,
                    encryptionMetadata: result.encryptionMetadata,
                    parentBackupId: result.parentBackupId || result.metadata?.parentBackupId || null,
                    baseBackupId: result.baseBackupId || result.metadata?.baseBackupId || null,
                    backupLevel: result.backupLevel !== undefined ? result.backupLevel : (result.metadata?.backupLevel ?? null),
                    binlogFile: result.binlogFile || result.metadata?.startBinlogFile || null,
                    binlogPosition: result.binlogPosition ?? result.metadata?.startBinlogPosition ?? null,
                    metadata: {
                        ...result.metadata,
                        completedAt: new Date().toISOString()
                    }
                }
            });
            
            await job.updateProgress(90);
            
            // Queue storage job if S3
            if (options.storage && options.storage.type === 's3') {
                const { createStorageQueue } = require('../../lib/queue-manager');
                const storageQueue = createStorageQueue();
                await storageQueue.add('upload', {
                    backupId,
                    filePath: result.filePath,
                    storageConfig: options.storage,
                    fileName: result.fileName,
                }, {
                    jobId: `storage_${backupId}`
                });
                log.info('Storage job queued', { backupId });
            }
            
            // Queue notification job
            const { createNotificationQueue } = require('../../lib/queue-manager');
            const notificationQueue = createNotificationQueue();
            await notificationQueue.add('notify', {
                backupId,
                success: true,
                dbConfig,
                backupType,
                duration: result.duration,
                fileSize: result.fileSize,
            }, {
                jobId: `notify_${backupId}`
            });
            
            await job.updateProgress(100);
            
            log.info('Backup job completed successfully', { backupId });
            return { success: true, backupId };
        } else {
            throw new Error(result.error || 'Backup failed');
        }
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        log.error('Backup job failed', { backupId, error: errorMessage });
        
        await prisma.backupJob.update({
            where: { id: backupId },
            data: {
                status: BackupStatus.FAILED,
                error: errorMessage,
                completedAt: new Date()
            }
        });
        
        // Queue failure notification
        const { createNotificationQueue } = require('../../lib/queue-manager');
        const notificationQueue = createNotificationQueue();
        await notificationQueue.add('notify', {
            backupId,
            success: false,
            dbConfig,
            backupType,
            error: errorMessage,
        }, {
            jobId: `notify_${backupId}`
        });
        
        throw error;
    }
}

// STORAGE WORKER PROCESSOR

async function handleStorageJob(job: Job) {
    const { backupId, filePath, storageConfig, fileName } = job.data;
    
    log.info('Processing storage upload', { backupId, storageType: storageConfig.type });
    
    try {
        const payload = {
            storageType: storageConfig.type,
            config: {
                bucket: storageConfig.bucket,
                region: storageConfig.region || 'us-east-1',
                accessKey: storageConfig.accessKey,
                secretKey: storageConfig.secretKey,
                prefix: storageConfig.prefix || ''
            },
            localPath: filePath,
            remotePath: fileName,
            backupId: backupId
        };
        
        const response = await axios.post(`${STORAGE_SERVICE_URL}/api/storage/upload`, payload, {
            timeout: 1800000
        });
        
        if (!response.data.success) {
            throw new Error(response.data.error || 'Storage upload failed');
        }
        
        log.info('Storage upload completed', { backupId });
        return { success: true, backupId };
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Storage upload failed', { backupId, error: errorMessage });
        throw error;
    }
}

// NOTIFICATION WORKER PROCESSOR

async function handleNotificationJob(job: Job) {
    const { backupId, success, dbConfig, backupType, duration, fileSize, error } = job.data;
    
    log.info('Processing notification', { backupId, success });
    
    try {
        const message = {
            subject: success 
                ? `Backup Completed - ${dbConfig.database}` 
                : `Backup Failed - ${dbConfig.database}`,
            text: `Backup ${success ? 'Completed Successfully' : 'Failed'}\n\nDatabase: ${dbConfig.type}/${dbConfig.database}\nType: ${backupType}\nTime: ${new Date().toISOString()}\n${duration ? `Duration: ${duration.toFixed(2)} seconds\n` : ''}${fileSize ? `Size: ${(fileSize / 1024 / 1024).toFixed(2)} MB\n` : ''}${error ? `Error: ${error}\n` : ''}`,
            attachments: [
                {
                    color: success ? '#36a64f' : '#ff0000',
                    title: success ? 'Backup Successful' : 'Backup Failed',
                    fields: [
                        { title: 'Database', value: `${dbConfig.type}/${dbConfig.database}`, short: true },
                        { title: 'Type', value: backupType, short: true },
                        { title: 'Duration', value: duration ? `${duration.toFixed(2)}s` : 'N/A', short: true },
                        { title: 'Backup ID', value: backupId, short: true },
                        { title: 'Size', value: fileSize ? `${(fileSize / 1024 / 1024).toFixed(2)} MB` : 'N/A', short: true }
                    ],
                    footer: 'DB Backup CLI',
                    ts: Math.floor(Date.now() / 1000)
                }
            ]
        };
        
        const config = {
            smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
            smtpPort: parseInt(process.env.SMTP_PORT || '587'),
            username: process.env.SMTP_USER,
            password: process.env.SMTP_PASS,
            from: process.env.SMTP_FROM || 'backup@system.local',
            to: process.env.SMTP_TO
        };
        
        const payload = {
            type: 'email',
            backupId: backupId,
            config: config,
            message: message
        };
        
        await axios.post(`${NOTIFICATION_SERVICE_URL}/api/notify`, payload, {
            timeout: 30000
        });
        
        log.info('Notification sent', { backupId, success });
        return { success: true, backupId };
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Notification failed', { backupId, error: errorMessage });
        return { success: false, backupId, error: errorMessage };
    }
}

// create the worker + pass processor to workers

const backupWorker = registerBackupWorker(handleBackupJob);
const storageWorker = registerStorageWorker(handleStorageJob);
const notificationWorker = registerNotificationWorker(handleNotificationJob);

log.info('All workers started');
log.info(`  Backup Worker: ${process.env.MAX_CONCURRENT_BACKUPS || 3} concurrent`);
log.info(`  Storage Worker: ${process.env.MAX_CONCURRENT_STORAGE || 5} concurrent`);
log.info('  Notification Worker: 10 concurrent');

export { backupWorker, storageWorker, notificationWorker };