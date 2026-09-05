require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateBody,
  validateQuery,
  validateParams,
  validateRequest,
  IdParamSchema,
  BackupRequestSchema,
  TriggerBackupSchema,
  DashboardBackupsQuerySchema,
  ScheduleRequestSchema,
  StorageUploadSchema,
  NotificationRequestSchema,
} = require('../../src/validators');

function createMockReqRes({ body = {}, query = {}, params = {}, headers = {} } = {}) {
  const req = {
    body,
    query,
    params,
    headers,
    originalUrl: '/test-endpoint',
    method: 'POST',
  };

  let statusCode = 200;
  let jsonResponse = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResponse = data;
      return this;
    },
    getStatusCode() {
      return statusCode;
    },
    getResponse() {
      return jsonResponse;
    },
  };

  return { req, res };
}

test('validateBody rejects missing or invalid request body with HTTP 400', () => {
  const middleware = validateBody(BackupRequestSchema);
  const { req, res } = createMockReqRes({ body: {} });
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.getStatusCode(), 400);
  const response = res.getResponse();
  assert.equal(response.success, false);
  assert.equal(response.error, 'Validation Error');
  assert.ok(response.issues.length > 0);
  assert.ok(response.issues.some((i) => i.field.includes('dbConfig')));
});

test('validateBody accepts valid backup payload and forwards to next()', () => {
  const middleware = validateBody(BackupRequestSchema);
  const validPayload = {
    dbConfig: {
      type: 'postgresql',
      database: 'production_db',
      host: '127.0.0.1',
      port: 5432,
    },
    backupType: 'full',
    options: {
      compress: true,
    },
  };
  const { req, res } = createMockReqRes({ body: validPayload });
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.getStatusCode(), 200);
  assert.equal(req.body.dbConfig.database, 'production_db');
  assert.equal(req.body.backupType, 'full');
});

test('validateParams rejects empty or missing id parameter with HTTP 400', () => {
  const middleware = validateParams(IdParamSchema);
  const { req, res } = createMockReqRes({ params: { id: '   ' } });
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.getStatusCode(), 400);
  const response = res.getResponse();
  assert.equal(response.success, false);
  assert.ok(response.issues.some((i) => i.field === 'id'));
});

test('validateParams accepts valid id parameter and proceeds', () => {
  const middleware = validateParams(IdParamSchema);
  const { req, res } = createMockReqRes({ params: { id: 'backup-job-12345' } });
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.getStatusCode(), 200);
  assert.equal(req.params.id, 'backup-job-12345');
});

test('validateQuery transforms numeric strings and enforces bounds', () => {
  const middleware = validateQuery(DashboardBackupsQuerySchema);
  
  // Test valid query params
  const { req: validReq, res: validRes } = createMockReqRes({
    query: { limit: '25', page: '2', status: 'success' },
  });
  let validNextCalled = false;

  middleware(validReq, validRes, () => {
    validNextCalled = true;
  });

  assert.equal(validNextCalled, true);
  assert.equal(validReq.query.limit, 25);
  assert.equal(validReq.query.page, 2);
  assert.equal(validReq.query.status, 'success');

  // Test invalid query params (limit > 500)
  const { req: invalidReq, res: invalidRes } = createMockReqRes({
    query: { limit: '9999' },
  });
  let invalidNextCalled = false;

  middleware(invalidReq, invalidRes, () => {
    invalidNextCalled = true;
  });

  assert.equal(invalidNextCalled, false);
  assert.equal(invalidRes.getStatusCode(), 400);
  assert.ok(invalidRes.getResponse().issues.some((i) => i.field === 'limit'));
});

test('BackupRequestSchema validates all supported database types', () => {
  const types = ['postgresql', 'mysql', 'mongodb', 'sqlite'];
  const middleware = validateBody(BackupRequestSchema);

  for (const dbType of types) {
    const { req, res } = createMockReqRes({
      body: {
        dbConfig: {
          type: dbType,
          database: `test_${dbType}`,
        },
      },
    });
    let nextCalled = false;
    middleware(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true, `Should accept database type: ${dbType}`);
  }
});

test('BackupRequestSchema rejects unsupported database types', () => {
  const middleware = validateBody(BackupRequestSchema);
  const { req, res } = createMockReqRes({
    body: {
      dbConfig: {
        type: 'oracle',
        database: 'test_db',
      },
    },
  });
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.getStatusCode(), 400);
  assert.ok(res.getResponse().issues.some((i) => i.field === 'dbConfig.type'));
});

test('BackupRequestSchema enforces 64 hex character encryption key when encrypt is true', () => {
  const middleware = validateBody(BackupRequestSchema);

  // Invalid key length (too short)
  const { req: invalidReq, res: invalidRes } = createMockReqRes({
    body: {
      dbConfig: { type: 'postgresql', database: 'testdb' },
      options: {
        encrypt: true,
        encryptionKey: 'short-key',
      },
    },
  });
  let invalidNext = false;
  middleware(invalidReq, invalidRes, () => {
    invalidNext = true;
  });
  assert.equal(invalidNext, false);
  assert.equal(invalidRes.getStatusCode(), 400);

  // Valid 64-hex character key
  const valid64HexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const { req: validReq, res: validRes } = createMockReqRes({
    body: {
      dbConfig: { type: 'postgresql', database: 'testdb' },
      options: {
        encrypt: true,
        encryptionKey: valid64HexKey,
      },
    },
  });
  let validNext = false;
  middleware(validReq, validRes, () => {
    validNext = true;
  });
  assert.equal(validNext, true);
});

test('TriggerBackupSchema validates quick dashboard backup parameters', () => {
  const middleware = validateBody(TriggerBackupSchema);

  const { req: validReq, res: validRes } = createMockReqRes({
    body: {
      dbType: 'mysql',
      dbName: 'ecommerce',
      backupType: 'full',
      storageType: 'local',
    },
  });
  let validNext = false;
  middleware(validReq, validRes, () => {
    validNext = true;
  });
  assert.equal(validNext, true);

  const { req: invalidReq, res: invalidRes } = createMockReqRes({
    body: {
      dbType: 'mysql',
      dbName: '', // empty dbName
    },
  });
  let invalidNext = false;
  middleware(invalidReq, invalidRes, () => {
    invalidNext = true;
  });
  assert.equal(invalidNext, false);
  assert.equal(invalidRes.getStatusCode(), 400);
});

test('ScheduleRequestSchema validates cron expression correctly', () => {
  const middleware = validateBody(ScheduleRequestSchema);

  // Valid cron
  const { req: validReq, res: validRes } = createMockReqRes({
    body: {
      schedule: '0 2 * * *',
      dbConfig: { type: 'postgresql', database: 'nightly' },
    },
  });
  let validNext = false;
  middleware(validReq, validRes, () => {
    validNext = true;
  });
  assert.equal(validNext, true);

  // Malformed cron
  const { req: invalidReq, res: invalidRes } = createMockReqRes({
    body: {
      schedule: 'not-a-cron-expression',
      dbConfig: { type: 'postgresql', database: 'nightly' },
    },
  });
  let invalidNext = false;
  middleware(invalidReq, invalidRes, () => {
    invalidNext = true;
  });
  assert.equal(invalidNext, false);
  assert.equal(invalidRes.getStatusCode(), 400);
  assert.ok(invalidRes.getResponse().issues.some((i) => i.field === 'schedule'));
});

test('StorageUploadSchema requires required storage paths and IDs', () => {
  const middleware = validateBody(StorageUploadSchema);

  const { req: validReq, res: validRes } = createMockReqRes({
    body: {
      storageType: 'local',
      config: { basePath: './backups' },
      localPath: '/tmp/test.dump',
      remotePath: 'backups/test.dump',
      backupId: 'backup-123',
    },
  });
  let validNext = false;
  middleware(validReq, validRes, () => {
    validNext = true;
  });
  assert.equal(validNext, true);

  const { req: invalidReq, res: invalidRes } = createMockReqRes({
    body: {
      storageType: 'invalid-type',
      config: {},
    },
  });
  let invalidNext = false;
  middleware(invalidReq, invalidRes, () => {
    invalidNext = true;
  });
  assert.equal(invalidNext, false);
  assert.equal(invalidRes.getStatusCode(), 400);
});

test('NotificationRequestSchema enforces valid notification provider types', () => {
  const middleware = validateBody(NotificationRequestSchema);

  const { req: validReq, res: validRes } = createMockReqRes({
    body: {
      type: 'slack',
      config: { webhookUrl: 'https://hooks.slack.com/services/xxx' },
      message: { text: 'Backup completed' },
    },
  });
  let validNext = false;
  middleware(validReq, validRes, () => {
    validNext = true;
  });
  assert.equal(validNext, true);

  const { req: invalidReq, res: invalidRes } = createMockReqRes({
    body: {
      type: 'sms', // Unsupported
      config: {},
      message: {},
    },
  });
  let invalidNext = false;
  middleware(invalidReq, invalidRes, () => {
    invalidNext = true;
  });
  assert.equal(invalidNext, false);
  assert.equal(invalidRes.getStatusCode(), 400);
  assert.ok(invalidRes.getResponse().issues.some((i) => i.field === 'type'));
});
