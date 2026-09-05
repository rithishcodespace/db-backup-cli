require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  backupRepository,
  storageRepository,
  scheduleRepository,
  notificationRepository,
} = require('../../src/repositories');

test('backupRepository exposes all required data access methods', () => {
  assert.equal(typeof backupRepository.findActiveJobs, 'function');
  assert.equal(typeof backupRepository.findJobById, 'function');
  assert.equal(typeof backupRepository.findManyJobs, 'function');
  assert.equal(typeof backupRepository.countJobs, 'function');
  assert.equal(typeof backupRepository.createJob, 'function');
  assert.equal(typeof backupRepository.updateJob, 'function');
  assert.equal(typeof backupRepository.findLogs, 'function');
  assert.equal(typeof backupRepository.createLog, 'function');
  assert.equal(typeof backupRepository.countJobsSince, 'function');
  assert.equal(typeof backupRepository.findRecentFailedJobs, 'function');
});

test('storageRepository exposes all required storage CRUD methods', () => {
  assert.equal(typeof storageRepository.findById, 'function');
  assert.equal(typeof storageRepository.findByName, 'function');
  assert.equal(typeof storageRepository.findDefault, 'function');
  assert.equal(typeof storageRepository.findMany, 'function');
  assert.equal(typeof storageRepository.count, 'function');
  assert.equal(typeof storageRepository.create, 'function');
  assert.equal(typeof storageRepository.update, 'function');
  assert.equal(typeof storageRepository.delete, 'function');
  assert.equal(typeof storageRepository.setDefault, 'function');
});

test('scheduleRepository exposes schedule CRUD methods', () => {
  assert.equal(typeof scheduleRepository.findById, 'function');
  assert.equal(typeof scheduleRepository.findMany, 'function');
  assert.equal(typeof scheduleRepository.count, 'function');
  assert.equal(typeof scheduleRepository.create, 'function');
  assert.equal(typeof scheduleRepository.update, 'function');
  assert.equal(typeof scheduleRepository.delete, 'function');
});

test('notificationRepository exposes notification config methods', () => {
  assert.equal(typeof notificationRepository.findByType, 'function');
  assert.equal(typeof notificationRepository.findMany, 'function');
  assert.equal(typeof notificationRepository.count, 'function');
  assert.equal(typeof notificationRepository.upsert, 'function');
  assert.equal(typeof notificationRepository.delete, 'function');
});
