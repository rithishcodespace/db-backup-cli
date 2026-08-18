require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PostgresPitrService } = require('../../src/services/postgres-pitr.service');
const { S3StorageProvider } = require('../../src/microservices/storage-service/providers/s3');
const { prisma } = require('../../src/lib/prisma');

test('PostgreSQL PITR workflow with S3StorageProvider and dynamic timestamps', async () => {
  const dbConfig = {
    type: 'postgresql',
    host: 'localhost',
    port: 5432,
    username: 'postgres',
    password: '',
    database: 'pitr_s3_test_db',
  };

  const now = new Date();
  const t1 = new Date(now.getTime() - 120000).toISOString();
  const t2 = new Date(now.getTime() - 60000).toISOString();
  const t3 = new Date(now.getTime()).toISOString();

  assert.ok(t1.includes('Z'));
  assert.ok(t3.includes('Z'));

  const s3LocationName = 'test-s3-pitr-storage';
  await prisma.storageLocation.upsert({
    where: { name: s3LocationName },
    update: {
      type: 's3',
      bucket: 'test-pitr-bucket',
      region: 'us-east-1',
      accessKey: 'mockAccessKey',
      secretKey: 'mockSecretKey',
      enabled: true,
    },
    create: {
      name: s3LocationName,
      type: 's3',
      bucket: 'test-pitr-bucket',
      region: 'us-east-1',
      accessKey: 'mockAccessKey',
      secretKey: 'mockSecretKey',
      enabled: true,
    },
  });

  const pitrService = new PostgresPitrService(dbConfig);
  assert.ok(pitrService);

  const walFileName = '0000000100000000000000C2';
  const dummyWalDir = path.join(process.cwd(), 'tmp', 's3_test_wal_source');
  if (!fs.existsSync(dummyWalDir)) {
    fs.mkdirSync(dummyWalDir, { recursive: true });
  }

  const dummyWalPath = path.join(dummyWalDir, walFileName);
  const sampleData = Buffer.from('POSTGRESQL WAL SEGMENT HEADER DATA CONTENT FOR S3 TEST', 'utf8');
  fs.writeFileSync(dummyWalPath, sampleData);

  let s3UploadedPath = '';
  const originalInit = S3StorageProvider.prototype.initialize;
  const originalUpload = S3StorageProvider.prototype.upload;
  const originalDownload = S3StorageProvider.prototype.download;
  const originalList = S3StorageProvider.prototype.list;

  const virtualS3Storage = new Map();

  S3StorageProvider.prototype.initialize = async function () {
    return true;
  };


  S3StorageProvider.prototype.upload = async function (localPath, remotePath) {
    const data = fs.readFileSync(localPath);
    virtualS3Storage.set(remotePath, data);
    s3UploadedPath = remotePath;
    return remotePath;
  };

  S3StorageProvider.prototype.download = async function (remotePath, localPath) {
    const data = virtualS3Storage.get(remotePath);
    if (!data) throw new Error(`S3 Object not found: ${remotePath}`);
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(localPath, data);
    return localPath;
  };

  S3StorageProvider.prototype.list = async function (prefix) {
    return Array.from(virtualS3Storage.keys()).filter((k) => k.startsWith(prefix));
  };

  try {
    const archiveSuccess = await pitrService.archiveWal(walFileName, dummyWalPath, {
      storageName: s3LocationName,
      key: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    });
    assert.equal(archiveSuccess, true);
    assert.ok(s3UploadedPath.includes(walFileName));

    const destWalPath = path.join(process.cwd(), 'tmp', 's3_test_wal_fetched', walFileName);
    const fetchSuccess = await pitrService.fetchWal(walFileName, destWalPath, {
      storageName: s3LocationName,
      key: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    });

    assert.equal(fetchSuccess, true);
    assert.ok(fs.existsSync(destWalPath));

    const restoredData = fs.readFileSync(destWalPath);
    assert.equal(restoredData.toString('utf8'), sampleData.toString('utf8'));
  } finally {
    S3StorageProvider.prototype.initialize = originalInit;
    S3StorageProvider.prototype.upload = originalUpload;
    S3StorageProvider.prototype.download = originalDownload;
    S3StorageProvider.prototype.list = originalList;


    if (fs.existsSync(dummyWalDir)) {
      fs.rmSync(dummyWalDir, { recursive: true, force: true });
    }
  }
});
