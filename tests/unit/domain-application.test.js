require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { makeTempDir, cleanupTempDir } = require('../helpers/temp-dir');
const { AES256CryptoService } = require('../../src/infrastructure/crypto/aes256-crypto.service');
const { GzipCompressionService } = require('../../src/infrastructure/compression/gzip-compression.service');
const { DatabaseAdapterFactory } = require('../../src/infrastructure/database/database-adapter.factory');
const { RestoreUseCase } = require('../../src/application/use-cases/restore.use-case');
const { ConnectUseCase } = require('../../src/application/use-cases/connect.use-case');
const { ListBackupsUseCase } = require('../../src/application/use-cases/list-backups.use-case');
const {
  UnsupportedDatabaseTypeError,
  ChecksumMismatchError,
  RestoreExecutionError,
  DatabaseConnectionError,
} = require('../../src/domain/errors');

test('AES256CryptoService correctly encrypts and decrypts files with GCM authentication', async () => {
  const tmpDir = makeTempDir();
  try {
    const cryptoService = new AES256CryptoService();
    const originalText = 'Hello World - Enterprise Grade Database Backup!';
    const plainFile = path.join(tmpDir, 'plain.txt');
    const encryptedFile = path.join(tmpDir, 'plain.txt.enc');
    const decryptedFile = path.join(tmpDir, 'plain.txt.dec');

    fs.writeFileSync(plainFile, originalText, 'utf8');

    const key = cryptoService.generateKey();
    assert.equal(key.length, 64, 'Key must be 64 hexadecimal characters (32 bytes)');
    assert.equal(cryptoService.validateKey(key), true);
    assert.equal(cryptoService.validateKey('short-key'), false);

    const { iv, tag } = await cryptoService.encryptFile(plainFile, encryptedFile, key);
    assert.ok(iv, 'IV should be returned');
    assert.ok(tag, 'Auth tag should be returned');
    assert.notEqual(fs.readFileSync(encryptedFile, 'utf8'), originalText);

    await cryptoService.decryptFile(encryptedFile, decryptedFile, key, iv, tag);
    const restoredText = fs.readFileSync(decryptedFile, 'utf8');
    assert.equal(restoredText, originalText);

    // Tampered payload fails authentication
    const tamperedFile = path.join(tmpDir, 'tampered.enc');
    const buf = fs.readFileSync(encryptedFile);
    buf[0] ^= 0xff;
    fs.writeFileSync(tamperedFile, buf);

    await assert.rejects(
      async () => cryptoService.decryptFile(tamperedFile, path.join(tmpDir, 'out.txt'), key, iv, tag),
      /Unsupported state or unable to authenticate data|bad decrypt/
    );
  } finally {
    cleanupTempDir(tmpDir);
  }
});

test('GzipCompressionService compresses, decompresses, and detects magic bytes', async () => {
  const tmpDir = makeTempDir();
  try {
    const compressionService = new GzipCompressionService();
    const plainFile = path.join(tmpDir, 'data.sql');
    const gzFile = path.join(tmpDir, 'data.sql.gz');
    const decompressedFile = path.join(tmpDir, 'decompressed.sql');

    const sampleContent = 'CREATE TABLE users (id INT, email VARCHAR(255));\n'.repeat(100);
    fs.writeFileSync(plainFile, sampleContent, 'utf8');

    assert.equal(compressionService.isCompressed(plainFile), false);

    await compressionService.compressFile(plainFile, gzFile);
    assert.equal(compressionService.isCompressed(gzFile), true);
    assert.ok(fs.statSync(gzFile).size < fs.statSync(plainFile).size);

    await compressionService.decompressFile(gzFile, decompressedFile);
    assert.equal(fs.readFileSync(decompressedFile, 'utf8'), sampleContent);
  } finally {
    cleanupTempDir(tmpDir);
  }
});

test('DatabaseAdapterFactory resolves all supported engines and rejects unknown engines', () => {
  const factory = new DatabaseAdapterFactory();

  assert.ok(factory.getAdapter('postgresql'));
  assert.ok(factory.getAdapter('postgres'));
  assert.ok(factory.getAdapter('mysql'));
  assert.ok(factory.getAdapter('mariadb'));
  assert.ok(factory.getAdapter('mongodb'));
  assert.ok(factory.getAdapter('mongo'));
  assert.ok(factory.getAdapter('sqlite'));
  assert.ok(factory.getAdapter('sqlite3'));

  assert.throws(() => factory.getAdapter('cassandra'), UnsupportedDatabaseTypeError);

  // Open/Closed principle: custom adapter extension without modifying factory source
  const customAdapter = {
    supportedTypes: ['oracle', 'oracle-db'],
    testConnection: async () => ({ success: true }),
    backup: async () => ({ success: true, backupId: 'b-1', filePath: '', fileName: '', fileSize: 0, duration: 0 }),
    restore: async () => ({ success: true, message: 'ok', duration: 0 }),
  };
  factory.registerAdapter(customAdapter);
  assert.equal(factory.getAdapter('oracle'), customAdapter);
});

test('RestoreUseCase throws ChecksumMismatchError when checksum does not match', async () => {
  const tmpDir = makeTempDir();
  try {
    const backupFile = path.join(tmpDir, 'backup.sql');
    fs.writeFileSync(backupFile, 'actual-data');

    const mockRepo = {
      findJobById: async () => ({
        id: 'job-123',
        filePath: backupFile,
        checksum: 'mismatched-expected-sha256-hash',
        dbType: 'postgresql',
      }),
      findManyJobs: async () => [],
      createJob: async () => ({}),
      updateJob: async () => ({}),
      findStorageByName: async () => null,
      findDefaultStorage: async () => null,
      listStorages: async () => [],
    };

    const cryptoService = new AES256CryptoService();
    const compressionService = new GzipCompressionService();
    const adapterFactory = new DatabaseAdapterFactory();
    const mockConfig = {
      get: () => ({ type: 'postgresql', database: 'testdb' }),
      setDatabase: () => {},
    };
    const mockKeyManager = { getKey: () => null };

    const restoreUseCase = new RestoreUseCase(
      mockConfig,
      mockRepo,
      cryptoService,
      compressionService,
      adapterFactory,
      mockKeyManager
    );

    await assert.rejects(
      async () => restoreUseCase.execute({ backupId: 'job-123' }),
      ChecksumMismatchError
    );
  } finally {
    cleanupTempDir(tmpDir);
  }
});

test('ConnectUseCase validates database parameters and saves valid configuration', async () => {
  const saved = [];
  const mockConfig = {
    get: () => undefined,
    setDatabase: (cfg) => saved.push(cfg),
  };

  const mockAdapter = {
    supportedTypes: ['postgresql'],
    testConnection: async (cfg) => {
      if (cfg.database === 'valid_db') {
        return { success: true, version: 'PostgreSQL 16' };
      }
      return { success: false, error: 'Database does not exist' };
    },
    backup: async () => ({ success: true, backupId: 'b-1', filePath: '', fileName: '', fileSize: 0, duration: 0 }),
    restore: async () => ({ success: true, message: 'ok', duration: 0 }),
  };

  const factory = {
    getAdapter: () => mockAdapter,
  };

  const useCase = new ConnectUseCase(factory, mockConfig);

  // Missing database for non-sqlite throws DatabaseConnectionError
  await assert.rejects(
    async () => useCase.execute({ type: 'postgresql' }),
    DatabaseConnectionError
  );

  // Failed connection test throws DatabaseConnectionError
  await assert.rejects(
    async () => useCase.execute({ type: 'postgresql', database: 'invalid_db' }),
    DatabaseConnectionError
  );

  // Successful connection
  const res = await useCase.execute({ type: 'postgresql', database: 'valid_db', host: 'localhost' });
  assert.equal(res.success, true);
  assert.equal(res.database, 'valid_db');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].database, 'valid_db');
});

test('ListBackupsUseCase queries repository with filters and constraints', async () => {
  const mockJobs = [
    { id: 'b-1', dbName: 'prod_db', backupType: 'full', status: 'success' },
    { id: 'b-2', dbName: 'stage_db', backupType: 'incremental', status: 'success' },
  ];

  let queryCaptured = null;
  const mockRepo = {
    findManyJobs: async (query) => {
      queryCaptured = query;
      return mockJobs;
    },
    findJobById: async () => null,
    createJob: async () => ({}),
    updateJob: async () => ({}),
    findStorageByName: async () => null,
    findDefaultStorage: async () => null,
    listStorages: async () => [],
  };

  const useCase = new ListBackupsUseCase(mockRepo);
  const result = await useCase.execute({ database: 'prod_db', type: 'full', status: 'success', limit: 10 });

  assert.equal(result.length, 2);
  assert.equal(queryCaptured.where.dbName, 'prod_db');
  assert.equal(queryCaptured.where.backupType, 'full');
  assert.equal(queryCaptured.where.status, 'success');
  assert.equal(queryCaptured.take, 10);
});
