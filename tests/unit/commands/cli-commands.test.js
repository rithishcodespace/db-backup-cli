require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const { Command } = require('commander');

const { withMockedModules, clearModule } = require('../../helpers/mock-require');
const { createNoopLogger, createOraMock, createProcessExitInterceptor } = require('../../helpers/mocks');

const path = require('path');
const connectModulePath = path.resolve(__dirname, '../../../src/commands/connect.ts');
const listModulePath = path.resolve(__dirname, '../../../src/commands/list.ts');
const storageModulePath = path.resolve(__dirname, '../../../src/commands/storage.ts');

function loadConnectCommand(overrides = {}) {
  const ora = createOraMock();
  const config = overrides.config || { setDatabase() {}, get() { return undefined; } };
  const testConnection = overrides.testConnection || (async () => ({ success: true, version: 'PostgreSQL 16' }));

  const loaded = withMockedModules(
    {
      ora,
      '../logger': { createModuleLogger: () => createNoopLogger() },
      '../config': { config },
      '../utils/db_connection': { testConnection },
      '../infrastructure': overrides.infrastructure || { infrastructureManager: { ensureInfrastructure: async () => ({ healthy: true, running: true }) } },
    },
    () => {
      clearModule(connectModulePath);
      return require(connectModulePath);
    }
  );

  return { ...loaded, ora, config };
}

function loadListCommand(overrides = {}) {
  const prisma = overrides.prisma || {
    backupJob: {
      findMany: async () => [],
    },
  };

  return withMockedModules(
    {
      '../logger': { createModuleLogger: () => createNoopLogger() },
      '../lib/prisma': { prisma },
    },
    () => {
      clearModule(listModulePath);
      return require(listModulePath);
    }
  );
}

function loadStorageCommand(overrides = {}) {
  const ora = createOraMock();
  const prisma = overrides.prisma || {
    storageLocation: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async (payload) => ({ id: 'storage-1', name: payload.data.name, type: payload.data.type }),
      updateMany: async () => ({ count: 0 }),
      update: async () => ({ id: 'storage-1' }),
      delete: async () => ({}),
    },
  };

  const loaded = withMockedModules(
    {
      ora,
      '../logger': { createModuleLogger: () => createNoopLogger() },
      '../lib/prisma': { prisma },
    },
    () => {
      clearModule(storageModulePath);
      return require(storageModulePath);
    }
  );

  return { ...loaded, ora, prisma };
}

test('connect command saves database configuration after a successful connection', async () => {
  const saved = [];
  const { registerConnectCommand } = loadConnectCommand({
    config: {
      setDatabase(config) {
        saved.push(config);
      },
      get() { return undefined; },
    },
    testConnection: async () => ({ success: true, version: 'PostgreSQL 16.0' }),
  });

  const program = new Command();
  registerConnectCommand(program);

  await program.parseAsync(['node', 'dbvault', 'connect', '--type', 'postgresql', '--database', 'appdb', '--host', 'localhost', '--user', 'app', '--password', 'secret']);

  assert.equal(saved.length, 1);
  assert.equal(saved[0].database, 'appdb');
  assert.equal(saved[0].type, 'postgresql');
});

test('connect command exits when the database name is missing for a non-SQLite database', async () => {
  const exit = createProcessExitInterceptor();

  try {
    const { registerConnectCommand } = loadConnectCommand();
    const program = new Command();
    registerConnectCommand(program);

    await assert.rejects(
      program.parseAsync(['node', 'dbvault', 'connect', '--type', 'postgresql']),
      /process\.exit:1/
    );

    assert.ok(exit.calls.length >= 1);
    assert.equal(exit.calls.at(-1), 1);
  } finally {
    exit.restore();
  }
});

test('list command renders the latest successful backups', async () => {
  const backups = [
    {
      id: 'backup-1',
      startedAt: new Date('2026-06-30T00:00:00Z'),
      backupType: 'full',
      status: 'success',
      dbType: 'postgresql',
      dbName: 'appdb',
      fileSize: 1024 * 1024,
      duration: 12.5,
      filePath: '/backups/appdb.sql.gz',
      error: null,
    },
  ];

  const { registerListCommand } = loadListCommand({
    prisma: {
      backupJob: {
        findMany: async () => backups,
      },
    },
  });

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const program = new Command();
    registerListCommand(program);
    await program.parseAsync(['node', 'dbvault', 'list']);

    assert.ok(logs.some((line) => line.includes('backup-1')));
    assert.ok(logs.some((line) => line.includes('appdb')));
  } finally {
    console.log = originalLog;
  }
});

test('storage add and set-default commands persist locations', async () => {
  const created = [];
  const updated = [];
  const storageByName = new Map();

  const { registerStorageCommand } = loadStorageCommand({
    prisma: {
      storageLocation: {
        findUnique: async ({ where }) => {
          return storageByName.get(where.name) || null;
        },
        findMany: async () => [],
        create: async ({ data }) => {
          created.push(data);
          const storage = { id: 'storage-1', name: data.name, type: data.type, config: data.config, default: false, enabled: true, createdAt: new Date(), updatedAt: new Date() };
          storageByName.set(data.name, storage);
          return storage;
        },
        updateMany: async (payload) => {
          updated.push(payload);
          return { count: 1 };
        },
        update: async ({ where, data }) => {
          const current = storageByName.get(where.name);
          const updatedStorage = { ...current, ...data };
          storageByName.set(where.name, updatedStorage);
          return updatedStorage;
        },
        delete: async () => ({}),
      },
    },
  });

  const program = new Command();
  registerStorageCommand(program);

  await program.parseAsync(['node', 'dbvault', 'storage', 'add', '--type', 'local', '--name', 'offsite', '--path', './backups']);
  await program.parseAsync(['node', 'dbvault', 'storage', 'set-default', 'offsite']);

  assert.equal(created[0].name, 'offsite');
  assert.equal(created[0].type, 'local');
  assert.equal(updated.length, 1);
  assert.equal(updated[0].data.default, false);
});
