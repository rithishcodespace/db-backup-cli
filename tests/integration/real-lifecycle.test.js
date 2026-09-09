require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { makeTempDir, cleanupTempDir } = require('../helpers/temp-dir');
const { AES256CryptoService } = require('../../src/infrastructure/crypto/aes256-crypto.service');
const { GzipCompressionService } = require('../../src/infrastructure/compression/gzip-compression.service');
const { DatabaseAdapterFactory } = require('../../src/infrastructure/database/database-adapter.factory');
const { RestoreUseCase } = require('../../src/application/use-cases/restore.use-case');
const { ChecksumMismatchError } = require('../../src/domain/errors');

test('complete real data lifecycle: seed -> backup -> compress -> encrypt -> corrupt -> restore -> verify data fidelity', async () => {
  const tmpDir = makeTempDir();
  try {
    const dbPath = path.join(tmpDir, 'production.db');
    const backupStorageDir = path.join(tmpDir, 'backup_vault');
    fs.mkdirSync(backupStorageDir, { recursive: true });

    // 1. Seed Real Database
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE customers (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        balance REAL NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO customers (name, email, balance, created_at) VALUES
        ('Alice Johnson', 'alice@enterprise.com', 12500.50, '2026-01-15T10:00:00Z'),
        ('Bob Smith', 'bob@startup.io', 480.25, '2026-02-20T14:30:00Z'),
        ('Charlie Davis', 'charlie@devops.org', 98230.00, '2026-03-05T09:15:00Z');
    `);
    const initialRows = db.prepare('SELECT * FROM customers ORDER BY id ASC').all();
    db.close();

    // 2. Set Up Services
    const cryptoService = new AES256CryptoService();
    const compressionService = new GzipCompressionService();
    const adapterFactory = new DatabaseAdapterFactory();
    const encryptionKey = cryptoService.generateKey();
    const inMemoryKeystore = new Map();
    const keyManager = {
      getKey: (id) => inMemoryKeystore.get(id) || null,
      storeKey: (id, key) => inMemoryKeystore.set(id, { key }),
    };

    const storedJobs = new Map();
    const mockRepo = {
      createJob: async (data) => {
        const record = { id: data.id || 'b-test-1', ...data };
        storedJobs.set(record.id, record);
        return record;
      },
      updateJob: async (id, data) => {
        const existing = storedJobs.get(id) || { id };
        const updated = { ...existing, ...data };
        storedJobs.set(id, updated);
        return updated;
      },
      findJobById: async (id) => storedJobs.get(id) || null,
      findManyJobs: async () => Array.from(storedJobs.values()),
      findStorageByName: async () => null,
      findDefaultStorage: async () => null,
      listStorages: async () => [],
    };

    const configStore = {
      data: {
        database: { type: 'sqlite', database: dbPath },
        'storage.localPath': backupStorageDir,
      },
      get(key) {
        return this.data[key];
      },
      setDatabase(cfg) {
        this.data.database = cfg;
      },
    };

    // 3. Execute Real Backup
    const adapter = adapterFactory.getAdapter('sqlite');
    const backupResult = await adapter.backup(
      { type: 'sqlite', database: dbPath },
      { backupId: 'backup-lifecycle-001', outputPath: backupStorageDir, backupName: 'customer_backup' }
    );
    assert.ok(fs.existsSync(backupResult.filePath), 'Raw backup file should exist');

    // Compress
    const compressedPath = `${backupResult.filePath}.gz`;
    await compressionService.compressFile(backupResult.filePath, compressedPath);
    fs.unlinkSync(backupResult.filePath);
    assert.equal(compressionService.isCompressed(compressedPath), true, 'Must detect gzip magic bytes');

    // Encrypt
    const encryptedPath = `${compressedPath}.enc`;
    const { iv, tag } = await cryptoService.encryptFile(compressedPath, encryptedPath, encryptionKey);
    fs.unlinkSync(compressedPath);

    // Calculate Checksum of the encrypted artifact
    const checksum = await cryptoService.calculateChecksum(encryptedPath);

    keyManager.storeKey('backup-lifecycle-001', encryptionKey);
    await mockRepo.createJob({
      id: 'backup-lifecycle-001',
      filePath: encryptedPath,
      fileName: path.basename(encryptedPath),
      fileSize: fs.statSync(encryptedPath).size,
      dbType: 'sqlite',
      dbName: 'production.db',
      backupType: 'full',
      status: 'success',
      checksum,
      encrypted: true,
      encryptionType: 'AES-256-GCM',
      encryptionIv: iv,
      encryptionTag: tag,
      startedAt: new Date(),
      completedAt: new Date(),
    });

    // 4. Corrupt / Delete Database
    fs.unlinkSync(dbPath);
    assert.equal(fs.existsSync(dbPath), false, 'Database file should be completely deleted');

    // 5. Restore Database via RestoreUseCase
    const restoreUseCase = new RestoreUseCase(
      configStore,
      mockRepo,
      cryptoService,
      compressionService,
      adapterFactory,
      keyManager
    );

    const restoreResult = await restoreUseCase.execute({
      backupId: 'backup-lifecycle-001',
    });
    assert.equal(restoreResult.success, true);

    // 6. Verify 100% Data Fidelity
    assert.ok(fs.existsSync(dbPath), 'Restored database file must exist');
    const restoredDb = new Database(dbPath);
    const restoredRows = restoredDb.prepare('SELECT * FROM customers ORDER BY id ASC').all();
    restoredDb.close();
    assert.deepStrictEqual(restoredRows, initialRows, 'Restored data must match original data bit-for-bit');

    // 7. Verify Failure Scenario: Tampered Checksum Detection
    const unencryptedFile = path.join(backupStorageDir, 'plain_backup.db');
    fs.writeFileSync(unencryptedFile, 'corrupt data payload');
    const corruptJob = {
      id: 'backup-lifecycle-corrupt',
      filePath: unencryptedFile,
      fileName: 'plain_backup.db',
      fileSize: 100,
      dbType: 'sqlite',
      dbName: 'production.db',
      backupType: 'full',
      status: 'success',
      checksum: 'expected-valid-sha256-hash-that-will-not-match',
      encrypted: false,
      startedAt: new Date(),
    };
    mockRepo.findJobById = async () => corruptJob;

    await assert.rejects(
      async () => restoreUseCase.execute({ backupId: 'backup-lifecycle-corrupt' }),
      ChecksumMismatchError
    );

    // 8. Verify Failure Scenario: Invalid Decryption Key
    const badKeyManager = {
      getKey: () => ({ key: cryptoService.generateKey() }),
      storeKey: () => {},
    };
    const badKeyRestoreUseCase = new RestoreUseCase(
      configStore,
      mockRepo,
      cryptoService,
      compressionService,
      adapterFactory,
      badKeyManager
    );
    mockRepo.findJobById = async () => storedJobs.get('backup-lifecycle-001');

    await assert.rejects(
      async () => badKeyRestoreUseCase.execute({ backupId: 'backup-lifecycle-001' }),
      /Unsupported state or unable to authenticate data|bad decrypt/
    );
  } finally {
    cleanupTempDir(tmpDir);
  }
});
