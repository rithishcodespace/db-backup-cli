require('ts-node/register/transpile-only');

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const v = require('valibot');

process.on('unhandledRejection', (err) => {
  if (err && err.message && (err.message.includes('Connection is closed') || err.message.includes('ECONNREFUSED'))) {
    return;
  }
  console.error('Unhandled rejection in test:', err);
});

const {
  QUEUES,
  createRestoreQueue,
  createBackupQueue,
  createStorageQueue,
  createNotificationQueue,
  connection,
} = require('../../src/lib/queue-manager');

const { RestoreRequestSchema, RestoreOptionsSchema } = require('../../src/schemas/restore.schema');
const { handleRestoreJob } = require('../../src/microservices/backup-worker/restore.worker');
const {
  handleBackupJob,
  handleStorageJob,
  handleNotificationJob,
} = require('../../src/microservices/backup-worker');

const { makeTempDir, cleanupTempDir } = require('../helpers/temp-dir');

// =========================================================================
// 1. Queue Infrastructure Tests
// =========================================================================

test('Queue Manager defines RESTORE queue and creates queue with retries', async () => {
  assert.equal(QUEUES.RESTORE, 'restore-queue');
  assert.equal(QUEUES.BACKUP, 'backup-queue');
  assert.equal(QUEUES.STORAGE, 'storage-queue');
  assert.equal(QUEUES.NOTIFICATION, 'notification-queue');

  const BullMQ = require('bullmq');
  const OriginalQueue = BullMQ.Queue;
  try {
    BullMQ.Queue = class MockQueue {
      constructor(name, opts) {
        this.name = name;
        this.defaultJobOptions = opts?.defaultJobOptions;
      }
      async close() {}
    };

    const restoreQueue = createRestoreQueue();
    assert.ok(restoreQueue);
    assert.equal(restoreQueue.name, 'restore-queue');
    assert.equal(restoreQueue.defaultJobOptions?.attempts, 2);
    assert.equal(restoreQueue.defaultJobOptions?.backoff?.type, 'exponential');
  } finally {
    BullMQ.Queue = OriginalQueue;
  }
});

// =========================================================================
// 2. Restore Request Schema Validation Tests
// =========================================================================

test('RestoreRequestSchema rejects payloads missing both backupId and filePath', () => {
  const invalidPayload = {
    dbConfig: {
      type: 'postgresql',
      host: 'localhost',
      port: 5432,
      database: 'mydb',
      username: 'postgres',
    },
  };

  assert.throws(() => {
    v.parse(RestoreRequestSchema, invalidPayload);
  }, /Either backupId or filePath must be provided for restore/);
});

test('RestoreRequestSchema rejects unsupported database types', () => {
  const invalidPayload = {
    dbConfig: {
      type: 'oracle',
      host: 'localhost',
      database: 'mydb',
    },
    backupId: 'backup-123',
  };

  assert.throws(() => {
    v.parse(RestoreRequestSchema, invalidPayload);
  });
});

test('RestoreRequestSchema accepts valid restore payloads', () => {
  const validPayload = {
    dbConfig: {
      type: 'postgresql',
      host: 'localhost',
      port: 5432,
      database: 'mydb',
      username: 'postgres',
      password: 'secretpassword',
    },
    backupId: 'backup-uuid-123',
    options: {
      clean: true,
      ifExists: true,
      dryRun: false,
    },
  };

  const parsed = v.parse(RestoreRequestSchema, validPayload);
  assert.equal(parsed.backupId, 'backup-uuid-123');
  assert.equal(parsed.dbConfig.type, 'postgresql');
  assert.equal(parsed.options?.clean, true);
});

// =========================================================================
// 3. Restore Worker Tests (handleRestoreJob)
// =========================================================================

test('handleRestoreJob throws clear error when backup is not found in metadata', async () => {
  const { metadataClient } = require('../../src/lib/metadata-client');
  const originalGetJob = metadataClient.getJob;
  const originalAddLog = metadataClient.addLog;

  metadataClient.getJob = async () => null;
  metadataClient.addLog = async () => ({});

  try {
    const job = {
      data: {
        restoreId: 'restore-test-01',
        backupId: 'nonexistent-backup-id',
        dbConfig: {
          type: 'postgresql',
          database: 'testdb',
        },
      },
      updateProgress: async () => {},
    };

    await assert.rejects(
      async () => handleRestoreJob(job),
      /not found in metadata service/i
    );
  } finally {
    metadataClient.getJob = originalGetJob;
    metadataClient.addLog = originalAddLog;
  }
});

test('handleRestoreJob verifies checksum and fails when corrupted', async () => {
  const tmpDir = makeTempDir();
  try {
    const backupFile = path.join(tmpDir, 'backup.sql');
    fs.writeFileSync(backupFile, 'actual content on disk');

    const job = {
      data: {
        restoreId: 'restore-test-02',
        backupId: 'mock-corrupted-job',
        filePath: backupFile,
        dbConfig: {
          type: 'postgresql',
          database: 'testdb',
        },
      },
      updateProgress: async () => {},
    };

    // Mock metadataClient getJob to return an expected checksum that doesn't match
    const { metadataClient } = require('../../src/lib/metadata-client');
    const originalGetJob = metadataClient.getJob;
    const originalAddLog = metadataClient.addLog;

    metadataClient.getJob = async () => ({
      id: 'mock-corrupted-job',
      filePath: backupFile,
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // sha256 of empty string
    });
    metadataClient.addLog = async () => ({});

    try {
      await assert.rejects(
        async () => handleRestoreJob(job),
        /Checksum mismatch/i
      );
    } finally {
      metadataClient.getJob = originalGetJob;
      metadataClient.addLog = originalAddLog;
    }
  } finally {
    cleanupTempDir(tmpDir);
  }
});

// =========================================================================
// 4. Storage Worker Tests (handleStorageJob & Idempotency)
// =========================================================================

test('handleStorageJob skips duplicate upload when already recorded in metadata (Idempotency)', async () => {
  const { metadataClient } = require('../../src/lib/metadata-client');
  const queueManager = require('../../src/lib/queue-manager');
  const originalGetJob = metadataClient.getJob;
  const originalUpdateJob = metadataClient.updateJob;
  const originalAddLog = metadataClient.addLog;
  const originalCreateNotificationQueue = queueManager.createNotificationQueue;

  let updateCalled = false;
  let notificationEnqueued = false;

  metadataClient.getJob = async () => ({
    id: 'backup-idem-1',
    storageType: 's3',
    storagePath: 'already-uploaded-file.sql.gz',
    metadata: {
      uploadResult: { ETag: '"dummy-etag"' },
    },
  });
  metadataClient.updateJob = async () => {
    updateCalled = true;
  };
  metadataClient.addLog = async () => ({});
  queueManager.createNotificationQueue = () => ({
    add: async () => {
      notificationEnqueued = true;
    },
  });

  const job = {
    data: {
      backupId: 'backup-idem-1',
      filePath: '/tmp/test.sql.gz',
      fileName: 'already-uploaded-file.sql.gz',
      storageConfig: { type: 's3', bucket: 'test-bucket' },
      dbConfig: { type: 'postgresql', database: 'testdb' },
    },
    updateProgress: async () => {},
  };

  try {
    const result = await handleStorageJob(job);
    assert.equal(result.success, true);
    assert.equal(result.backupId, 'backup-idem-1');
    // updateJob should NOT have been called because it was already uploaded!
    assert.equal(updateCalled, false);
    assert.equal(notificationEnqueued, true);
  } finally {
    metadataClient.getJob = originalGetJob;
    metadataClient.updateJob = originalUpdateJob;
    metadataClient.addLog = originalAddLog;
    queueManager.createNotificationQueue = originalCreateNotificationQueue;
  }
});

// =========================================================================
// 5. Notification Worker Tests (handleNotificationJob & Audit Record)
// =========================================================================

test('handleNotificationJob formats message and records audit in metadata service', async () => {
  const { metadataClient } = require('../../src/lib/metadata-client');
  const originalRecordNotification = metadataClient.recordNotification;

  let recordedNotification = null;
  metadataClient.recordNotification = async (data) => {
    recordedNotification = data;
    return { id: 'notif-1', ...data };
  };

  const job = {
    data: {
      backupId: 'backup-notif-1',
      success: true,
      dbConfig: { type: 'postgresql', database: 'prod_database' },
      backupType: 'full',
      duration: 12.34,
      fileSize: 10485760, // 10 MB
      type: 'slack',
      config: { webhookUrl: '' }, // empty webhook url -> will skip external call but record audit
    },
  };

  const originalSlackUrl = process.env.SLACK_WEBHOOK_URL;
  delete process.env.SLACK_WEBHOOK_URL;

  try {
    const result = await handleNotificationJob(job);
    assert.equal(result.success, true);
    assert.equal(result.backupId, 'backup-notif-1');

    assert.ok(recordedNotification);
    assert.equal(recordedNotification.backupJobId, 'backup-notif-1');
    assert.equal(recordedNotification.type, 'slack');
    assert.match(recordedNotification.subject, /Backup Completed - prod_database/);
    assert.match(recordedNotification.message, /postgresql\/prod_database/);
  } finally {
    metadataClient.recordNotification = originalRecordNotification;
    if (originalSlackUrl !== undefined) {
      process.env.SLACK_WEBHOOK_URL = originalSlackUrl;
    }
  }
});

after(async () => {
  try {
    await connection.quit();
  } catch {}
});

