require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PostgresPitrService } = require('../../src/services/postgres-pitr.service');
const { LocalStorageProvider } = require('../../src/microservices/storage-service/providers/local');

test('PostgreSQL PITR workflow with LocalStorageProvider and dynamic timestamps', async () => {
  const dbConfig = {
    type: 'postgresql',
    host: 'localhost',
    port: 5432,
    username: 'postgres',
    password: '',
    database: 'pitr_test_db',
  };

  const t1 = new Date(Date.now() - 60000).toISOString();
  const t2 = new Date(Date.now() - 40000).toISOString();
  const t3 = new Date(Date.now() - 20000).toISOString();
  const t4 = new Date().toISOString();

  assert.ok(t1.includes('Z'));
  assert.ok(t4.includes('Z'));

  const pitrService = new PostgresPitrService(dbConfig);
  assert.ok(pitrService);

  const testWalName = '0000000100000000000000A1';
  const dummyWalDir = path.join(process.cwd(), 'tmp', 'test_wal_source');
  if (!fs.existsSync(dummyWalDir)) {
    fs.mkdirSync(dummyWalDir, { recursive: true });
  }

  const dummyWalPath = path.join(dummyWalDir, testWalName);
  const sampleWalBuffer = Buffer.alloc(1024 * 64, 0xab);
  fs.writeFileSync(dummyWalPath, sampleWalBuffer);

  const archiveSuccess = await pitrService.archiveWal(testWalName, dummyWalPath, { key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
  assert.equal(archiveSuccess, true);

  const destWalPath = path.join(process.cwd(), 'tmp', 'test_wal_fetched', testWalName);
  const fetchSuccess = await pitrService.fetchWal(testWalName, destWalPath, { key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
  assert.equal(fetchSuccess, true);
  assert.ok(fs.existsSync(destWalPath));

  const fetchedBuffer = fs.readFileSync(destWalPath);
  assert.equal(fetchedBuffer.length, sampleWalBuffer.length);
  assert.deepEqual(fetchedBuffer, sampleWalBuffer);

  if (fs.existsSync(dummyWalDir)) {
    fs.rmSync(dummyWalDir, { recursive: true, force: true });
  }
  if (fs.existsSync(path.dirname(destWalPath))) {
    fs.rmSync(path.dirname(destWalPath), { recursive: true, force: true });
  }
});
