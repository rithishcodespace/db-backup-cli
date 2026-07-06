import { Queue, Worker, QueueEvents, Job } from 'bullmq'; // QueueEvents -> Allows listening for queue events. like completed, failed etc
import IORedis from 'ioredis';
import { createModuleLogger } from '../logger';

const log = createModuleLogger('queue-manager');

// Redis connection
const connection = new IORedis({ // connects to redis server
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
});

// Queue names
export const QUEUES = {
    BACKUP: process.env.BACKUP_QUEUE_NAME || 'backup-queue',
    STORAGE: process.env.STORAGE_QUEUE_NAME || 'storage-queue',
    NOTIFICATION: process.env.NOTIFICATION_QUEUE_NAME || 'notification-queue',
};

// Queue Factories

export function createBackupQueue() {
    return new Queue(QUEUES.BACKUP, {
        connection: connection as any,
        defaultJobOptions: {
            attempts: parseInt(process.env.BACKUP_RETRY_ATTEMPTS || '3'),
            backoff: { // retry once after 5's
                type: 'exponential',
                delay: parseInt(process.env.BACKUP_RETRY_DELAY || '5000'),
            },
            removeOnComplete: { // after one hour keep only completed 100 jobs, remove old ones
                age: 3600, // 1 hour
                count: 100,
            },
            removeOnFail: { // 
                age: 86400, // remove after 24 hours
            },
        },
    });
}

export function createStorageQueue() {
    return new Queue(QUEUES.STORAGE, {
        connection: connection as any,
        defaultJobOptions: {
            attempts: 5,
            backoff: {
                type: 'exponential',
                delay: 10000,
            },
            removeOnComplete: {
                age: 3600,
                count: 50,
            },
            removeOnFail: {
                age: 86400,
            },
        },
    });
}

export function createNotificationQueue() {
    return new Queue(QUEUES.NOTIFICATION, {
        connection: connection as any,
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 5000,
            },
            removeOnComplete: {
                age: 3600,
                count: 200,
            },
            removeOnFail: {
                age: 86400,
            },
        },
    });
}

// Job Progress Tracking 

export interface JobProgress {
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress: number;
    message?: string;
    data?: any;
}

export async function updateJobProgress(jobId: string, progress: JobProgress) {
    // Store progress in Redis or database
    // This can be retrieved by the status endpoint
}

// Worker Registration 

export function registerBackupWorker(processor: (job: Job) => Promise<any>) { // processor is a backup function (async job => await backupDatabase(job.data))
    const worker = new Worker(QUEUES.BACKUP, processor, {
        connection: connection as any,
        concurrency: parseInt(process.env.MAX_CONCURRENT_BACKUPS || '3'), // controls how many jobs this single worker can process at the same time.
    });

    worker.on('completed', (job) => {
        log.info(`Backup job completed`, { jobId: job.id });
    });

    worker.on('failed', (job, err) => {
        log.error(`Backup job failed`, { jobId: job?.id, error: err.message });
    });

    worker.on('progress', (job, progress) => {
        log.debug(`Backup job progress`, { jobId: job.id, progress });
    });

    return worker;
}

export function registerStorageWorker(processor: (job: Job) => Promise<any>) {
    const worker = new Worker(QUEUES.STORAGE, processor, {
        connection: connection as any,
        concurrency: parseInt(process.env.MAX_CONCURRENT_STORAGE || '5'),
    });

    worker.on('completed', (job) => {
        log.info(`Storage job completed`, { jobId: job.id });
    });

    worker.on('failed', (job, err) => {
        log.error(`Storage job failed`, { jobId: job?.id, error: err.message });
    });

    return worker;
}

export function registerNotificationWorker(processor: (job: Job) => Promise<any>) {
    const worker = new Worker(QUEUES.NOTIFICATION, processor, {
        connection: connection as any,
        concurrency: 10,
    });

    worker.on('completed', (job) => {
        log.info(`Notification job completed`, { jobId: job.id });
    });

    worker.on('failed', (job, err) => {
        log.error(`Notification job failed`, { jobId: job?.id, error: err.message });
    });

    return worker;
}

export { connection };