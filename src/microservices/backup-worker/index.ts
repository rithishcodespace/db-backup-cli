// src/microservices/backup-worker/index.ts

import {
    registerBackupWorker,
    registerStorageWorker,
    registerNotificationWorker,
    registerRestoreWorker,
    createStorageQueue,
    createNotificationQueue
} from '../../lib/queue-manager';
import { Job } from 'bullmq';
import axios from 'axios';
import { IncomingWebhook } from '@slack/webhook';
import nodemailer from 'nodemailer';
import { metadataClient } from '../../lib/metadata-client';
import { BackupStatus } from '../shared/types';
import { createModuleLogger } from '../../logger';
import { S3StorageProvider } from '../storage-service/providers/s3';
import { LocalStorageProvider } from '../storage-service/providers/local';
import { handleRestoreJob } from './restore.worker';

const log = createModuleLogger('backup-worker');

const serviceRegistry: Record<string, string> = {
    postgresql: process.env.POSTGRES_SERVICE_URL || 'http://localhost:3010',
    mysql: process.env.MYSQL_SERVICE_URL || 'http://localhost:3011',
    mongodb: process.env.MONGODB_SERVICE_URL || 'http://localhost:3012',
    sqlite: process.env.SQLITE_SERVICE_URL || 'http://localhost:3013'
};

function getServiceUrl(dbType: string): string {
    const url = serviceRegistry[dbType];
    if (!url) {
        throw new Error(`Unsupported database type: ${dbType}`);
    }
    return url;
}

async function createLog(backupJobId: string, level: string, message: string, details?: string) {
    try {
        await metadataClient.addLog(backupJobId, {
            level,
            message,
            details: details || undefined,
        });
    } catch (err) {
        log.error('Failed to insert backupLog', { backupJobId, error: (err as any).message });
    }
}

// ==========================================
// BACKUP WORKER PROCESSOR
// ==========================================

export async function handleBackupJob(job: Job) {
    const { backupId, dbConfig, backupType, options = {} } = job.data;
    
    log.info('Processing backup job', { backupId, dbType: dbConfig.type });
    await createLog(backupId, 'INFO', `Backup execution started for ${dbConfig.type}/${dbConfig.database}`, `Backup Mode: ${backupType}`);
    
    try {
        await job.updateProgress(10);
        
        await metadataClient.updateJob(backupId, {
            status: BackupStatus.RUNNING
        });
        await createLog(backupId, 'INFO', `Database job status updated to RUNNING`);
        
        const serviceUrl = getServiceUrl(dbConfig.type);
        
        await job.updateProgress(30);
        await createLog(backupId, 'INFO', `Connecting to ${dbConfig.type} backup microservice at ${serviceUrl}/backup`);
        
        // Small delay to allow dashboard active queue polling to catch streaming state
        await new Promise((resolve) => setTimeout(resolve, 500));

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
            await metadataClient.updateJob(backupId, {
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
            });
            await createLog(backupId, 'INFO', `Backup archive created successfully: ${result.fileName}`, `Size: ${result.fileSize || 0} bytes | Duration: ${result.duration}s`);
            
            await job.updateProgress(90);
            
            // Queue downstream storage job if configured (e.g. S3)
            if (options.storage && options.storage.type === 's3') {
                const storageQueue = createStorageQueue();
                await storageQueue.add('upload', {
                    backupId,
                    filePath: result.filePath,
                    storageConfig: options.storage,
                    fileName: result.fileName,
                    dbConfig,
                    backupType,
                    duration: result.duration,
                    fileSize: result.fileSize,
                }, {
                    jobId: `storage_${backupId}`
                });
                await createLog(backupId, 'INFO', `Queued cloud storage upload to bucket: ${options.storage.bucket}`);
            } else {
                // If no remote storage needed, queue notification directly
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
                await createLog(backupId, 'INFO', `Triggered completion notification alert`);
            }
            
            await job.updateProgress(100);
            
            log.info('Backup job completed successfully', { backupId });
            return { success: true, backupId };
        } else {
            throw new Error(result.error || 'Backup failed');
        }
        
    } catch (error) {
        let errorMessage = error instanceof Error ? error.message : String(error);
        let errorDetails: string | undefined = undefined;

        if (axios.isAxiosError(error) && error.response) {
            const resData = error.response.data;
            if (resData && typeof resData === 'object') {
                errorMessage = resData.error || resData.message || errorMessage;
                errorDetails = JSON.stringify(resData);
            } else if (typeof resData === 'string') {
                errorDetails = resData;
            }
        }
        
        log.error('Backup job failed', { backupId, error: errorMessage });
        await createLog(backupId, 'ERROR', `Backup job failed: ${errorMessage}`, errorDetails);
        
        await metadataClient.updateJob(backupId, {
            status: BackupStatus.FAILED,
            error: errorMessage,
            completedAt: new Date()
        });
        
        // Queue failure notification downstream
        try {
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
        } catch (queueErr) {
            log.warn('Failed to enqueue failure notification', { backupId, error: (queueErr as any).message });
        }
        
        throw new Error(errorMessage);
    }
}

// ==========================================
// STORAGE WORKER PROCESSOR (DIRECT EXECUTION)
// ==========================================

export async function handleStorageJob(job: Job) {
    const { backupId, filePath, storageConfig, fileName, dbConfig, backupType, duration, fileSize } = job.data;
    
    log.info('Processing storage upload via queue worker', { backupId, storageType: storageConfig?.type });
    await createLog(backupId, 'INFO', `Storage worker processing upload for ${fileName || backupId}`);
    
    try {
        await job.updateProgress(10);
        
        // Idempotency check: check if already uploaded in metadata service
        const existingJob = await metadataClient.getJob(backupId);
        let uploadResult = existingJob?.metadata?.uploadResult;

        if (!existingJob?.storagePath || existingJob.storagePath !== fileName) {
            const storageType = storageConfig?.type || 's3';
            let provider: any;
            
            if (storageType === 's3') {
                provider = new S3StorageProvider({
                    type: 's3',
                    bucket: storageConfig.bucket,
                    region: storageConfig.region || 'us-east-1',
                    accessKey: storageConfig.accessKey,
                    secretKey: storageConfig.secretKey,
                    prefix: storageConfig.prefix || '',
                });
            } else {
                provider = new LocalStorageProvider({
                    type: 'local',
                    bucket: 'local',
                    basePath: storageConfig?.basePath || './backups',
                });
            }

            await provider.initialize();
            await job.updateProgress(30);

            uploadResult = await provider.upload(filePath, fileName);
            await job.updateProgress(80);

            // Update metadata record
            await metadataClient.updateJob(backupId, {
                storageType: storageType,
                storagePath: fileName,
                metadata: {
                    ...(existingJob?.metadata || {}),
                    uploadResult,
                }
            });
            await createLog(backupId, 'INFO', `Storage upload completed: ${fileName}`);
        } else {
            await createLog(backupId, 'INFO', `Storage upload previously completed for ${fileName}, skipping duplicate upload`);
        }
        
        await job.updateProgress(90);

        // Downstream: Enqueue completion notification
        const notificationQueue = createNotificationQueue();
        await notificationQueue.add('notify', {
            backupId,
            success: true,
            dbConfig: dbConfig || (existingJob ? { type: existingJob.dbType, database: existingJob.dbName } : {}),
            backupType: backupType || existingJob?.backupType || 'full',
            duration: duration || existingJob?.duration,
            fileSize: fileSize || existingJob?.fileSize,
        }, {
            jobId: `notify_${backupId}`,
        });
        await createLog(backupId, 'INFO', `Triggered completion notification alert from storage worker`);

        await job.updateProgress(100);
        log.info('Storage upload completed', { backupId });
        return { success: true, backupId, uploadResult };
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Storage upload failed', { backupId, error: errorMessage });
        await createLog(backupId, 'ERROR', `Storage upload failed: ${errorMessage}`);
        throw error;
    }
}

// ==========================================
// NOTIFICATION WORKER PROCESSOR (DIRECT EXECUTION)
// ==========================================

export async function handleNotificationJob(job: Job) {
    const {
        backupId,
        success,
        dbConfig = {},
        backupType = 'full',
        duration,
        fileSize,
        error,
        message: customMessage,
        config: customConfig,
        type: customType
    } = job.data;
    
    log.info('Processing notification via queue worker', { backupId, success });
    
    try {
        const type = customType || (process.env.SLACK_WEBHOOK_URL ? 'slack' : 'email');
        const isSuccess = success !== false;

        const message = customMessage || {
            subject: isSuccess 
                ? `Backup Completed - ${dbConfig.database || 'Database'}` 
                : `Backup Failed - ${dbConfig.database || 'Database'}`,
            text: `Backup ${isSuccess ? 'Completed Successfully' : 'Failed'}\n\nDatabase: ${dbConfig.type || 'N/A'}/${dbConfig.database || 'N/A'}\nType: ${backupType}\nTime: ${new Date().toISOString()}\n${duration ? `Duration: ${Number(duration).toFixed(2)} seconds\n` : ''}${fileSize ? `Size: ${(Number(fileSize) / 1024 / 1024).toFixed(2)} MB\n` : ''}${error ? `Error: ${error}\n` : ''}`,
            attachments: [
                {
                    color: isSuccess ? '#36a64f' : '#ff0000',
                    title: isSuccess ? 'Backup Successful' : 'Backup Failed',
                    fields: [
                        { title: 'Database', value: `${dbConfig.type || 'N/A'}/${dbConfig.database || 'N/A'}`, short: true },
                        { title: 'Type', value: backupType, short: true },
                        { title: 'Duration', value: duration ? `${Number(duration).toFixed(2)}s` : 'N/A', short: true },
                        { title: 'Backup ID', value: backupId || 'N/A', short: true },
                        { title: 'Size', value: fileSize ? `${(Number(fileSize) / 1024 / 1024).toFixed(2)} MB` : 'N/A', short: true }
                    ],
                    footer: 'DB Backup CLI',
                    ts: Math.floor(Date.now() / 1000)
                }
            ]
        };

        let result: any = null;

        if (type === 'slack') {
            const webhookUrl = customConfig?.webhookUrl || customConfig?.webhook || process.env.SLACK_WEBHOOK_URL;
            if (webhookUrl) {
                const webhook = new IncomingWebhook(webhookUrl);
                await webhook.send({
                    text: message.text,
                    attachments: message.attachments || [],
                    ...(message.blocks && { blocks: message.blocks }),
                });
                result = { success: true, platform: 'slack' };
                log.info('Slack notification sent', { backupId });
            } else {
                log.warn('Slack notification skipped: No webhook URL configured', { backupId });
            }
        } else if (type === 'email') {
            const smtpHost = customConfig?.smtpHost || process.env.SMTP_HOST;
            const smtpUser = customConfig?.username || customConfig?.smtpUser || process.env.SMTP_USER;
            const smtpPass = customConfig?.password || customConfig?.smtpPassword || process.env.SMTP_PASS;

            if (smtpHost && smtpUser && smtpPass) {
                const transporter = nodemailer.createTransport({
                    host: smtpHost,
                    port: parseInt(customConfig?.smtpPort || process.env.SMTP_PORT || '587', 10),
                    secure: customConfig?.smtpSecure || process.env.SMTP_SECURE === 'true' || false,
                    auth: {
                        user: smtpUser,
                        pass: smtpPass,
                    },
                });

                const mailOptions = {
                    from: customConfig?.from || process.env.SMTP_FROM || smtpUser,
                    to: customConfig?.to || process.env.SMTP_TO,
                    subject: message.subject,
                    text: message.text,
                    html: message.html || message.text?.replace(/\n/g, '<br>'),
                };

                if (mailOptions.to) {
                    const info = await transporter.sendMail(mailOptions);
                    result = { success: true, platform: 'email', messageId: info.messageId };
                    log.info('Email notification sent', { backupId, to: mailOptions.to });
                } else {
                    log.warn('Email notification skipped: No recipient configured', { backupId });
                }
            } else {
                log.info('Email notification skipped: SMTP not configured', { backupId });
            }
        }

        // Record audit in metadata service
        try {
            await metadataClient.recordNotification({
                backupJobId: backupId || null,
                type: type,
                status: result ? 'sent' : 'skipped',
                recipient: customConfig?.recipient || customConfig?.to || customConfig?.webhookUrl || process.env.SMTP_TO || process.env.SLACK_WEBHOOK_URL || 'unconfigured',
                subject: message.subject,
                message: message.text,
                sentAt: new Date(),
            });
        } catch (auditErr: any) {
            log.warn('Failed to record notification audit in metadata service', { error: auditErr?.message });
        }

        return { success: true, backupId, result };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Notification failed', { backupId, error: errorMessage });
        try {
            await metadataClient.recordNotification({
                backupJobId: backupId || null,
                type: 'error',
                status: 'failed',
                subject: 'Notification Failure',
                message: errorMessage,
                sentAt: new Date(),
            });
        } catch {}
        return { success: false, backupId, error: errorMessage };
    }
}

// ==========================================
// REGISTER QUEUE WORKERS
// ==========================================

let backupWorker: any;
let restoreWorker: any;
let storageWorker: any;
let notificationWorker: any;

export function startWorkers() {
    backupWorker = registerBackupWorker(handleBackupJob);
    restoreWorker = registerRestoreWorker(handleRestoreJob);
    storageWorker = registerStorageWorker(handleStorageJob);
    notificationWorker = registerNotificationWorker(handleNotificationJob);

    log.info('All workers started');
    log.info(`  Backup Worker: ${process.env.MAX_CONCURRENT_BACKUPS || 3} concurrent`);
    log.info(`  Restore Worker: 1 concurrent`);
    log.info(`  Storage Worker: ${process.env.MAX_CONCURRENT_STORAGE || 5} concurrent`);
    log.info('  Notification Worker: 10 concurrent');

    return { backupWorker, restoreWorker, storageWorker, notificationWorker };
}

const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT) || process.argv.some(arg => arg.includes('test'));
if (!isTestEnv) {
    startWorkers();
}

export {
    backupWorker,
    restoreWorker,
    storageWorker,
    notificationWorker,
    handleRestoreJob
};