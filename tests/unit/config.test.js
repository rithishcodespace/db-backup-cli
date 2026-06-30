require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeTempDir, cleanupTempDir } = require('../helpers/temp-dir');
const { clearModule } = require('../helpers/mock-require');

const configModulePath = '../../src/config/index.ts';

function snapshotEnv(keys) {
  const saved = {};
  for (const key of keys) {
    saved[key] = process.env[key];
  }
  return saved;
}

function restoreEnv(saved) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test('config loads defaults and creates working directories', () => {
  const tmpDir = makeTempDir();
  const saved = snapshotEnv(['CONFIG_PATH', 'BACKUP_PATH', 'TEMP_PATH', 'LOG_PATH', 'BACKUP_RETENTION_DAYS', 'LOG_LEVEL']);

  try {
    const configPath = path.join(tmpDir, 'config.json');
    process.env.CONFIG_PATH = configPath;
    process.env.BACKUP_PATH = path.join(tmpDir, 'backups');
    process.env.TEMP_PATH = path.join(tmpDir, 'tmp');
    process.env.LOG_PATH = path.join(tmpDir, 'logs');
    process.env.BACKUP_RETENTION_DAYS = '45';
    process.env.LOG_LEVEL = 'debug';

    clearModule(configModulePath);
    const { config } = require(configModulePath);

    assert.equal(config.get('env'), 'development');
    assert.equal(config.get('storage.localPath'), path.join(tmpDir, 'backups'));
    assert.equal(config.get('storage.tempPath'), path.join(tmpDir, 'tmp'));
    assert.equal(config.get('storage.retention'), 45);
    assert.equal(config.get('logging.path'), path.join(tmpDir, 'logs'));

    assert.ok(fs.existsSync(path.join(tmpDir, 'backups')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'tmp')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'logs')));
  } finally {
    restoreEnv(saved);
    clearModule(configModulePath);
    cleanupTempDir(tmpDir);
  }
});

test('config persists database configuration without version metadata', () => {
  const tmpDir = makeTempDir();
  const saved = snapshotEnv(['CONFIG_PATH', 'BACKUP_PATH', 'TEMP_PATH', 'LOG_PATH']);

  try {
    const configPath = path.join(tmpDir, 'config.json');
    process.env.CONFIG_PATH = configPath;
    process.env.BACKUP_PATH = path.join(tmpDir, 'backups');
    process.env.TEMP_PATH = path.join(tmpDir, 'tmp');
    process.env.LOG_PATH = path.join(tmpDir, 'logs');

    clearModule(configModulePath);
    const { config } = require(configModulePath);

    config.setDatabase({
      type: 'postgresql',
      host: 'localhost',
      port: 5432,
      username: 'app',
      password: 'secret',
      database: 'appdb',
    });

    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    assert.deepEqual(savedConfig.database, {
      type: 'postgresql',
      host: 'localhost',
      port: 5432,
      username: 'app',
      password: 'secret',
      database: 'appdb',
    });
    assert.equal(savedConfig.version, undefined);
  } finally {
    restoreEnv(saved);
    clearModule(configModulePath);
    cleanupTempDir(tmpDir);
  }
});
