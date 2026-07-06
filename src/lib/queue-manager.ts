import { Queue, Worker, QueueEvents, Job } from 'bullmq'; // QueueEvents -> Allows listening for queue events. like completed, failed etc
import IORedis from 'ioredis';
import { createModuleLogger } from '../logger';

const log = createModuleLogger('queue-manager');

// Redis Connection

const connection = new IORedis({ // connects to redis server
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

connection.on('connect', () => {
    log.info('Redis connected');
});

connection.on('error', (err) => {
    log.error('Redis connection error', { error: err.message });
});

// Queue Names

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
            backoff: {
                type: 'exponential',
                delay: parseInt(process.env.BACKUP_RETRY_DELAY || '5000'),
            },
            removeOnComplete: {
                age: 3600, // 1 hour
                count: 100,
            },
            removeOnFail: {
                age: 86400, // 24 hours
            }
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
            }
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
            }
        },
    });
}

// Queue Events (for monitoring)

export function createQueueEvents(queueName: string) {
    const queueEvents = new QueueEvents(queueName, { connection: connection as any, });
    
    queueEvents.on('completed', ({ jobId }) => {
        log.info(`Job ${jobId} completed`, { queue: queueName });
    });
    
    queueEvents.on('failed', ({ jobId, failedReason }) => {
        log.error(`Job ${jobId} failed`, { queue: queueName, error: failedReason });
    });
    
    queueEvents.on('progress', ({ jobId, data }) => {
        log.debug(`Job ${jobId} progress`, { queue: queueName, progress: data });
    });
    
    queueEvents.on('stalled', ({ jobId }) => {
        log.warn(`Job ${jobId} stalled`, { queue: queueName });
    });
    
    return queueEvents;
}

// Worker Registration

export function registerBackupWorker(processor: (job: Job) => Promise<any>) {
    const worker = new Worker(QUEUES.BACKUP, processor, {
        connection: connection as any,
        concurrency: parseInt(process.env.MAX_CONCURRENT_BACKUPS || '3'),
        lockDuration: 60000, // 1 minute lock
        stalledInterval: 30000, // 30 seconds
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

    worker.on('stalled', (jobId) => {
        log.warn(`Backup job stalled`, { jobId });
    });

    return worker;
}

export function registerStorageWorker(processor: (job: Job) => Promise<any>) {
    const worker = new Worker(QUEUES.STORAGE, processor, {
        connection: connection as any,
        concurrency: parseInt(process.env.MAX_CONCURRENT_STORAGE || '5'),
        lockDuration: 30000,
        stalledInterval: 30000,
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
        lockDuration: 10000,
    });

    worker.on('completed', (job) => {
        log.info(`Notification job completed`, { jobId: job.id });
    });

    worker.on('failed', (job, err) => {
        log.error(`Notification job failed`, { jobId: job?.id, error: err.message });
    });

    return worker;
}

// Graceful Shutdown

export async function closeAllQueues() {
    log.info('Closing all queues...');
    
    const queues = [
        QUEUES.BACKUP,
        QUEUES.STORAGE,
        QUEUES.NOTIFICATION,
    ];
    
    for (const queueName of queues) {
        try {
            const queue = new Queue(queueName, { connection: connection as any,});
            await queue.close();
            log.info(`Queue ${queueName} closed`);
        } catch (error) {
            log.error(`Failed to close queue ${queueName}`, { error });
        }
    }
    
    await connection.quit();
    log.info('Redis connection closed');
}

export { connection };