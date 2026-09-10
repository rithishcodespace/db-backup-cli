require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const { Command } = require('commander');

const { withMockedModules, clearModule } = require('../../helpers/mock-require');
const { createNoopLogger, createOraMock, createProcessExitInterceptor } = require('../../helpers/mocks');

const path = require('path');
const modulePath = path.resolve(__dirname, '../../../src/commands/config-check.ts');

function loadConfigCheckCommand(overrides = {}) {
  const ora = createOraMock();
  const prisma = overrides.prisma || {
    storageLocation: {
      findFirst: async () => ({
        type: 'local',
        config: { basePath: __dirname },
      }),
    },
    backupSchedule: {
      findMany: async () => [],
    },
    notificationConfig: {
      findMany: async () => [],
    },
  };

  const clientIdManager = overrides.clientIdManager || {
    getClientId: () => 'test-device-client-id-123456789',
  };

  const config = overrides.config || {
    get(key) {
      if (key === 'database') {
        return {
          type: 'postgresql',
          database: 'testdb',
        };
      }
      return undefined;
    },
  };

  const testConnection = overrides.testConnection || (async () => ({ success: true, version: 'PostgreSQL 16' }));
  const keyManager = overrides.keyManager || { getAllKeys: () => [] };
  const httpClient = overrides.httpClient || { get: async () => ({ status: 200 }) };

  return withMockedModules(
    {
      ora,
      '../logger': { createModuleLogger: () => createNoopLogger() },
      '../config': { config },
      '../lib/client-id': { clientIdManager },
      '../lib/prisma': { prisma },
      '../lib/key-manager': { keyManager },
      '../utils/db_connection': { testConnection },
      '../utils/http-client': { default: httpClient },
    },
    () => {
      clearModule(modulePath);
      return { ...require(modulePath), ora, prisma, config };
    }
  );
}

test('config check command passes when database, storage, and identity are valid', async () => {
  const exit = createProcessExitInterceptor();

  try {
    const { registerConfigCheckCommand } = loadConfigCheckCommand();
    const program = new Command();
    registerConfigCheckCommand(program);

    await assert.rejects(
      program.parseAsync(['node', 'dbvault', 'config', 'check']),
      /process\.exit:0/
    );

    assert.equal(exit.calls.at(-1), 0);
  } finally {
    exit.restore();
  }
});

test('config check command fails when client identity is missing', async () => {
  const exit = createProcessExitInterceptor();

  try {
    const { registerConfigCheckCommand } = loadConfigCheckCommand({
      clientIdManager: {
        getClientId: () => null,
      },
    });

    const program = new Command();
    registerConfigCheckCommand(program);

    await assert.rejects(
      program.parseAsync(['node', 'dbvault', 'config', 'check']),
      /process\.exit:1/
    );

    assert.equal(exit.calls.at(-1), 1);
  } finally {
    exit.restore();
  }
});

test('config check command reports database connection failure', async () => {
  const exit = createProcessExitInterceptor();

  try {
    const { registerConfigCheckCommand } = loadConfigCheckCommand({
      testConnection: async () => ({ success: false, error: 'Connection timeout' }),
    });

    const program = new Command();
    registerConfigCheckCommand(program);

    await assert.rejects(
      program.parseAsync(['node', 'dbvault', 'config', 'check']),
      /process\.exit:1/
    );

    assert.equal(exit.calls.at(-1), 1);
  } finally {
    exit.restore();
  }
});
