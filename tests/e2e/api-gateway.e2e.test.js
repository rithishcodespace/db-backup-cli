require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

// Load Express app from src/app.ts
const { app } = require('../../src/app');

test('GET /health returns healthy status', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'healthy');
  assert.equal(res.body.service, 'api-gateway');
  assert.ok(res.body.services.orchestrator);
});

test('GET /api-docs/json returns OpenAPI specification', async () => {
  const res = await request(app).get('/api-docs/json');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.openapi, '3.0.0');
  assert.ok(res.body.paths);
});

test('GET /api/client-id returns client identifier', async () => {
  const res = await request(app).get('/api/client-id');
  assert.equal(res.statusCode, 200);
  assert.ok(typeof res.body.clientId === 'string');
});

test('POST /api/backup rejects request missing x-client-id header', async () => {
  const res = await request(app)
    .post('/api/backup')
    .send({
      dbConfig: {
        type: 'postgresql',
        database: 'testdb',
      },
    });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /x-client-id/i);
});

test('POST /api/backup rejects invalid payload with validation error', async () => {
  const res = await request(app)
    .post('/api/backup')
    .set('x-client-id', 'test-client-123')
    .send({
      invalidKey: 'test',
    });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.ok(Array.isArray(res.body.issues));
});

test('GET /api/backup/:id/status rejects empty id parameter', async () => {
  const res = await request(app)
    .get('/api/backup/%20/status')
    .set('x-client-id', 'test-client-123');

  assert.equal(res.statusCode, 400);
});

test('GET /unknown-endpoint returns 404 Not Found', async () => {
  const res = await request(app).get('/some-nonexistent-route-xyz');
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'Not Found');
});

test.after(() => {
  const { connection } = require('../../src/lib/queue-manager');
  try {
    connection.disconnect();
  } catch (e) {}
});

