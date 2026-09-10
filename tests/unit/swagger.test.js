require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');

const { swaggerSpec } = require('../../src/swagger/openapi');
const { APP_VERSION } = require('../../src/version');

test('swaggerSpec exports valid OpenAPI 3.0 specification metadata', () => {
  assert.equal(swaggerSpec.openapi, '3.0.0');
  assert.equal(swaggerSpec.info.title, 'dbvault API Gateway');
  assert.equal(swaggerSpec.info.version, APP_VERSION);
  assert.ok(swaggerSpec.info.description.includes('OpenAPI 3.0'));
});

test('swaggerSpec defines all essential service routes', () => {
  const paths = swaggerSpec.paths;
  
  // Health & Gateway
  assert.ok(paths['/health']);
  assert.ok(paths['/api/client-id']);
  assert.ok(paths['/api/rate-limit/status']);
  assert.ok(paths['/api/services/health']);
  
  // Backups
  assert.ok(paths['/api/backup']);
  assert.ok(paths['/api/backup/{id}/status']);
  assert.ok(paths['/backup/{id}']);
  assert.ok(paths['/queue/stats']);
  
  // Dashboard
  assert.ok(paths['/api/dashboard/summary']);
  assert.ok(paths['/api/dashboard/backups']);
  assert.ok(paths['/api/dashboard/backups/active']);
  assert.ok(paths['/api/dashboard/queues']);
  assert.ok(paths['/api/dashboard/logs']);
  assert.ok(paths['/api/dashboard/alerts']);
  assert.ok(paths['/api/dashboard/health']);
  
  // Scheduler
  assert.ok(paths['/api/schedule']);
  assert.ok(paths['/api/schedule/{id}/stop']);
  
  // Notification
  assert.ok(paths['/api/notify']);
  assert.ok(paths['/api/notify/test/slack']);
  assert.ok(paths['/api/notify/test/email']);
  
  // Storage
  assert.ok(paths['/api/storage/upload']);
  assert.ok(paths['/api/storage/download']);
  assert.ok(paths['/api/storage/list']);
  assert.ok(paths['/api/storage/delete']);
});

test('swaggerSpec defines complete component schemas and security', () => {
  const schemas = swaggerSpec.components.schemas;
  
  assert.ok(schemas.BackupRequest);
  assert.ok(schemas.BackupResponse);
  assert.ok(schemas.BackupJobStatus);
  assert.ok(schemas.DashboardSummary);
  assert.ok(schemas.QueueStats);
  assert.ok(schemas.RateLimitStatus);
  assert.ok(schemas.ScheduleRequest);
  assert.ok(schemas.NotificationRequest);
  assert.ok(schemas.StorageUploadRequest);
  assert.ok(schemas.ErrorResponse);
  
  assert.ok(swaggerSpec.components.securitySchemes.ApiKeyAuth);
  assert.equal(swaggerSpec.components.securitySchemes.ApiKeyAuth.name, 'x-client-id');
});
