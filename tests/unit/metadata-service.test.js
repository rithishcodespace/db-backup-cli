require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const request = require('supertest');

const { withMockedModules, clearModule } = require('../helpers/mock-require');
const { createNoopLogger } = require('../helpers/mocks');
const { MetadataClient } = require('../../src/lib/metadata-client');

const servicePath = path.resolve(__dirname, '../../src/microservices/metadata-service/index.ts');

function loadMetadataService(prismaMock = {}) {
  const fakePrisma = {
    $queryRawUnsafe: prismaMock.$queryRawUnsafe || (async () => [{ 1: 1 }]),
    backupJob: prismaMock.backupJob || {
      create: async ({ data }) => ({ id: data.id || 'job-123', ...data, createdAt: new Date() }),
      findUnique: async ({ where }) => {
        if (where.id === 'job-123') {
          return { id: 'job-123', dbType: 'postgresql', dbName: 'testdb', status: 'completed' };
        }
        return null;
      },
      findFirst: async () => null,
      findMany: async () => [
        { id: 'job-123', dbType: 'postgresql', dbName: 'testdb', status: 'completed' },
      ],
      update: async ({ where, data }) => ({ id: where.id, ...data }),
      count: async () => 1,
    },
    backupLog: prismaMock.backupLog || {
      create: async ({ data }) => ({ id: 'log-1', ...data, timestamp: new Date() }),
      findMany: async () => [{ id: 'log-1', backupJobId: 'job-123', level: 'info', message: 'Backup started' }],
    },
    backupSchedule: prismaMock.backupSchedule || {
      findMany: async () => [{ id: 'sched-1', name: 'daily', schedule: '0 2 * * *', enabled: true }],
      findUnique: async ({ where }) => ({ id: where.id, name: 'daily', schedule: '0 2 * * *' }),
      create: async ({ data }) => ({ id: 'sched-1', ...data }),
      update: async ({ where, data }) => ({ id: where.id, ...data }),
      delete: async ({ where }) => ({ id: where.id }),
      count: async () => 1,
    },
    storageLocation: prismaMock.storageLocation || {
      findFirst: async ({ where }) => {
        if (where?.default) return { id: 'loc-1', name: 'local-default', type: 'local', default: true };
        return null;
      },
      findUnique: async ({ where }) => {
        if (where.id === 'loc-1' || where.name === 'local-default') {
          return { id: 'loc-1', name: 'local-default', type: 'local', default: true };
        }
        return null;
      },
      findMany: async () => [{ id: 'loc-1', name: 'local-default', type: 'local', default: true }],
      create: async ({ data }) => ({ id: 'loc-new', ...data }),
      upsert: async ({ create, update }) => ({ id: 'loc-new', ...create, ...update }),
      update: async ({ where, data }) => ({ id: where.id, ...data }),
      delete: async ({ where }) => ({ id: where.id }),
      count: async () => 1,
    },
    notificationConfig: prismaMock.notificationConfig || {
      findUnique: async ({ where }) => {
        if (where.type === 'slack') return { id: 'notif-1', type: 'slack', webhook: 'https://hooks.slack.com/123' };
        return null;
      },
      findMany: async () => [{ id: 'notif-1', type: 'slack' }],
      upsert: async ({ create, update }) => ({ id: 'notif-1', ...create, ...update }),
      delete: async ({ where }) => ({ id: 'notif-1', type: where.type }),
      count: async () => 1,
    },
    notification: prismaMock.notification || {
      create: async ({ data }) => ({ id: 'notif-entry-1', ...data, timestamp: new Date() }),
      findMany: async () => [],
    },
    $disconnect: async () => {},
  };

  const databaseModule = {
    prisma: fakePrisma,
    connectDatabase: async () => {},
    disconnectDatabase: async () => {},
  };

  return withMockedModules(
    {
      '../../config/database': databaseModule,
      '../../logger': { createModuleLogger: () => createNoopLogger() },
    },
    () => {
      clearModule(servicePath);
      return {
        ...require(servicePath),
        prisma: fakePrisma,
      };
    }
  );
}

// ==================== 1. Metadata Service HTTP API Tests ====================

test('1. GET /health returns 200 with healthy status when DB query succeeds', async () => {
  const { app } = loadMetadataService();
  const res = await request(app).get('/health');

  assert.equal(res.status, 200);
  assert.equal(res.body.service, 'metadata-service');
  assert.equal(res.body.status, 'healthy');
  assert.equal(res.body.database, 'connected');
  assert.ok(typeof res.body.uptime === 'number');
});

test('2. GET /health returns 503 with unhealthy status when DB query fails', async () => {
  const { app } = loadMetadataService({
    $queryRawUnsafe: async () => {
      throw new Error('SQLite busy: database is locked');
    },
  });

  const res = await request(app).get('/health');
  assert.equal(res.status, 503);
  assert.equal(res.body.status, 'unhealthy');
  assert.equal(res.body.database, 'disconnected');
  assert.ok(res.body.error.includes('database is locked'));
});

test('3. POST /api/jobs creates job and returns 201', async () => {
  const { app } = loadMetadataService();
  const payload = {
    dbType: 'postgresql',
    dbName: 'production_db',
    backupType: 'full',
  };

  const res = await request(app).post('/api/jobs').send(payload);
  assert.equal(res.status, 201);
  assert.equal(res.body.dbType, 'postgresql');
  assert.equal(res.body.dbName, 'production_db');
});

test('4. POST /api/jobs returns 400 when required fields are missing', async () => {
  const { app } = loadMetadataService();
  const res = await request(app).post('/api/jobs').send({ dbType: 'postgresql' });

  assert.equal(res.status, 400);
  assert.ok(res.body.error.includes('required'));
});

test('5. GET /api/jobs/:id returns 200 for existing job and 404 for nonexistent job', async () => {
  const { app } = loadMetadataService();

  const found = await request(app).get('/api/jobs/job-123');
  assert.equal(found.status, 200);
  assert.equal(found.body.id, 'job-123');

  const notFound = await request(app).get('/api/jobs/missing-id');
  assert.equal(notFound.status, 404);
  assert.ok(notFound.body.error.includes('not found'));
});

test('6. PATCH /api/jobs/:id updates job status and returns 200', async () => {
  const { app } = loadMetadataService();
  const res = await request(app)
    .patch('/api/jobs/job-123')
    .send({ status: 'completed', fileSize: 1048576, checksum: 'sha256-abc' });

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'completed');
  assert.equal(res.body.fileSize, 1048576);
});

test('7. GET /api/jobs returns paginated job list', async () => {
  const { app } = loadMetadataService();
  const res = await request(app).get('/api/jobs?limit=10');

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.jobs));
  assert.equal(res.body.total, 1);
});

test('8. POST and GET /api/jobs/:id/logs handles job logging', async () => {
  const { app } = loadMetadataService();

  const postRes = await request(app)
    .post('/api/jobs/job-123/logs')
    .send({ level: 'info', message: 'Dumping database...' });

  assert.equal(postRes.status, 201);
  assert.equal(postRes.body.message, 'Dumping database...');

  const getRes = await request(app).get('/api/jobs/job-123/logs');
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.success, true);
  assert.ok(Array.isArray(getRes.body.logs));
});

test('9. Storage endpoints manage storage locations via HTTP', async () => {
  const { app } = loadMetadataService();

  const listRes = await request(app).get('/api/storage');
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.success, true);
  assert.ok(Array.isArray(listRes.body.storages));

  const defRes = await request(app).get('/api/storage-default');
  assert.equal(defRes.status, 200);
  assert.equal(defRes.body.default, true);

  const createRes = await request(app)
    .post('/api/storage')
    .send({ name: 's3-primary', type: 's3', bucket: 'my-backups' });
  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.name, 's3-primary');
});

test('10. Schedule and notification endpoints handle CRUD operations', async () => {
  const { app } = loadMetadataService();

  const schedRes = await request(app).get('/api/schedules');
  assert.equal(schedRes.status, 200);
  assert.equal(schedRes.body.success, true);
  assert.ok(Array.isArray(schedRes.body.schedules));

  const notifRes = await request(app).get('/api/notifications/config/slack');
  assert.equal(notifRes.status, 200);
  assert.equal(notifRes.body.type, 'slack');

  const upsertRes = await request(app)
    .post('/api/notifications/config/slack')
    .send({ webhook: 'https://hooks.slack.com/updated', enabled: true });
  assert.equal(upsertRes.status, 200);
  assert.equal(upsertRes.body.type, 'slack');
});

// ==================== 2. MetadataClient Typed SDK Tests ====================

test('11. MetadataClient initializes with default or custom URL and config', () => {
  const defaultClient = new MetadataClient();
  assert.equal(defaultClient.getBaseUrl(), 'http://127.0.0.1:3005');

  const customClient = new MetadataClient({ baseUrl: 'http://custom-host:3005' });
  assert.equal(customClient.getBaseUrl(), 'http://custom-host:3005');
});

test('12. MetadataClient retries on transient network errors and fails fast with descriptive error', async () => {
  // Point client to a port with nothing running
  const client = new MetadataClient({
    baseUrl: 'http://127.0.0.1:59999',
    timeout: 300,
    maxRetries: 1,
    retryDelayMs: 20,
  });

  await assert.rejects(
    async () => {
      await client.health();
    },
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes('Metadata service unavailable') ||
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('dbvault background runtime is offline'),
        `Unexpected error message: ${err.message}`
      );
      assert.ok(err.message.includes('59999') || err.message.includes('dbvault start'));
      return true;
    }
  );
});

test('13. MetadataClient methods communicate with live Express app over HTTP', async () => {
  const { app } = loadMetadataService();

  // Spin up an ephemeral HTTP server from the metadata app
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const client = new MetadataClient({
      baseUrl: `http://127.0.0.1:${port}`,
      timeout: 3000,
    });

    const health = await client.health();
    assert.equal(health.status, 'healthy');
    assert.equal(health.database, 'connected');

    const createdJob = await client.createJob({
      dbType: 'postgresql',
      dbName: 'client_test_db',
      backupType: 'full',
    });
    assert.ok(createdJob.id);
    assert.equal(createdJob.dbName, 'client_test_db');

    const fetchedJob = await client.getJob('job-123');
    assert.ok(fetchedJob);
    assert.equal(fetchedJob.id, 'job-123');

    const updatedJob = await client.updateJob('job-123', { status: 'completed' });
    assert.equal(updatedJob.status, 'completed');

    const storage = await client.getDefaultStorage();
    assert.ok(storage);
    assert.equal(storage.default, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
