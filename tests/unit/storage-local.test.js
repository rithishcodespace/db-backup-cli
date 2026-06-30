require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeTempDir, cleanupTempDir } = require('../helpers/temp-dir');
const { clearModule } = require('../helpers/mock-require');
const { createNoopLogger } = require('../helpers/mocks');

const modulePath = '../../src/microservices/storage-service/providers/local.ts';

function loadProvider() {
  return require(modulePath).LocalStorageProvider;
}

test('LocalStorageProvider initializes storage and manages files', async () => {
  const tmpDir = makeTempDir();

  try {
    const Provider = require(modulePath).LocalStorageProvider;
    const provider = new Provider({
      type: 'local',
      bucket: '',
      basePath: path.join(tmpDir, 'backups'),
    });

    await provider.initialize();
    assert.ok(fs.existsSync(path.join(tmpDir, 'backups')));

    const sourceFile = path.join(tmpDir, 'source.txt');
    fs.writeFileSync(sourceFile, 'backup-data');

    const uploadResult = await provider.upload(sourceFile, 'nested/backup.txt');
    assert.equal(uploadResult.size, 'backup-data'.length);
    assert.ok(fs.existsSync(path.join(tmpDir, 'backups', 'nested', 'backup.txt')));

    const listed = await provider.list('nested');
    assert.deepEqual(listed, ['nested/backup.txt']);

    const downloadTarget = path.join(tmpDir, 'downloaded.txt');
    const downloadResult = await provider.download('nested/backup.txt', downloadTarget);
    assert.equal(downloadResult.size, 'backup-data'.length);
    assert.equal(fs.readFileSync(downloadTarget, 'utf8'), 'backup-data');

    const url = await provider.getUrl('nested/backup.txt');
    assert.equal(url, path.join(tmpDir, 'backups', 'nested/backup.txt'));

    await provider.delete('nested/backup.txt');
    assert.equal(fs.existsSync(path.join(tmpDir, 'backups', 'nested', 'backup.txt')), false);
  } finally {
    cleanupTempDir(tmpDir);
    clearModule(modulePath);
  }
});
