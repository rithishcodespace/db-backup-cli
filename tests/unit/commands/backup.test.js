require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const { Command } = require('commander');

const { withMockedModules, clearModule } = require('../../helpers/mock-require');
const { createNoopLogger, createOraMock, createProcessExitInterceptor, createAxiosMock } = require('../../helpers/mocks');

const path = require('path');
const modulePath = path.resolve(__dirname, '../../../src/commands/backup.ts');

function loadBackupCommand(overrides = {}) {
  const ora = createOraMock();
  const axios = overrides.axios || createAxiosMock();
  const prisma = overrides.prisma || {
    storageLocation: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
    },
  };
  const config = overrides.config || {
    get(key) {
      if (key === 'database') {
        return {
          type: 'postgresql',
          host: 'localhost',
          port: 5432,
          username: 'app',
          password: 'secret',
          database: 'appdb',
          ssl: false,
        };
      }

      if (key === 'storage.localPath') {
        return './backups/local';
      }

      return undefined;
    },
  };

  const httpClient = overrides.httpClient || overrides.axios || createAxiosMock();

  return withMockedModules(
    {
      ora,
      axios,
      '../logger': { createModuleLogger: () => createNoopLogger() },
      '../config': { config },
      '../lib/prisma': { prisma },
      '../utils/http-client': { __esModule: true, default: httpClient, httpClient },
      '../infrastructure': overrides.infrastructure || { infrastructureManager: { ensureInfrastructure: async () => ({ healthy: true, running: true }) } },
    },
    () => {
      clearModule(modulePath);
      return { ...require(modulePath), ora, axios, httpClient, prisma, config };
    }
  );
}

test('backup command sends the selected storage configuration to the gateway', async () => {
  const requests = [];
  const { registerBackupCommand } = loadBackupCommand({
    prisma: {
      storageLocation: {
        findUnique: async ({ where }) => {
          if (where.name === 'offsite') {
            return {
              id: 'storage-1',
              name: 'offsite',
              type: 's3',
              bucket: 'bucket-name',
              region: 'us-east-1',
              accessKey: 'access-key',
              secretKey: 'secret-key',
              config: { prefix: 'db-backups' },
            };
          }

          return null;
        },
        findFirst: async () => null,
        findMany: async () => [],
      },
    },
    httpClient: {
      post: async (url, payload) => {
        requests.push({ url, payload });
        return { data: { success: true, backupId: 'backup-1', duration: 11.25, fileSize: 1024 } };
      },
    },
  });

  const program = new Command();
  registerBackupCommand(program);

  await program.parseAsync([
    'node',
    'dbvault',
    'backup',
    '--type',
    'full',
    '--storage',
    'offsite',
    '--name',
    'nightly',
  ]);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://localhost:3000/api/backup');
  assert.equal(requests[0].payload.options.storageLocationId, 'storage-1');
  assert.equal(requests[0].payload.options.storage.type, 's3');
  assert.equal(requests[0].payload.options.backupName, 'nightly');
});

test('backup command exits when the requested storage location does not exist', async () => {
  const exit = createProcessExitInterceptor();

  try {
    const { registerBackupCommand } = loadBackupCommand({
      prisma: {
        storageLocation: {
          findUnique: async () => null,
          findFirst: async () => null,
          findMany: async () => [],
        },
      },
    });

    const program = new Command();
    registerBackupCommand(program);

    await assert.rejects(
      program.parseAsync(['node', 'dbvault', 'backup', '--storage', 'missing']),
      /process\.exit:1/
    );
  } finally {
    exit.restore();
  }
});
