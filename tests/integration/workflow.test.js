require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const { Command } = require('commander');

const { withMockedModules, clearModule } = require('../helpers/mock-require');
const { createNoopLogger } = require('../helpers/mocks');

const connectModulePath = '../../src/commands/connect.ts';
const backupModulePath = '../../src/commands/backup.ts';
const listModulePath = '../../src/commands/list.ts';

test('mocked workflow connects, backs up, and lists backups end to end', async () => {
  const state = {
    database: null,
    backups: [],
  };

  const modules = withMockedModules(
    {
      ora: () => ({ start() { return this; }, succeed() { return this; }, fail() { return this; }, stop() { return this; } }),
      axios: {
        post: async (url, payload) => {
          if (url.includes('/api/backup')) {
            const record = {
              id: 'backup-1',
              startedAt: new Date(),
              backupType: payload.backupType,
              status: 'success',
              dbType: payload.dbConfig.type,
              dbName: payload.dbConfig.database,
              fileSize: 1024,
              duration: 1.5,
              filePath: '/backups/backup-1.sql.gz',
            };

            state.backups.push(record);
            return { data: { success: true, backupId: record.id, duration: record.duration, fileSize: record.fileSize, filePath: record.filePath } };
          }

          return { data: { success: true } };
        },
      },
      '../logger': { createModuleLogger: () => createNoopLogger() },
      '../config': {
        config: {
          get(key) {
            if (key === 'database') return state.database;
            if (key === 'storage.localPath') return './backups/local';
            if (key === 'version') return '1.0.0';
            return undefined;
          },
          setDatabase(config) {
            state.database = config;
          },
        },
      },
      '../utils/db_connection': {
        testConnection: async () => ({ success: true, version: 'PostgreSQL 16.0' }),
      },
      '../lib/prisma': {
        prisma: {
          storageLocation: {
            findUnique: async () => null,
            findFirst: async () => null,
            findMany: async () => [],
          },
          backupJob: {
            findMany: async () => state.backups,
          },
        },
      },
    },
    () => {
      clearModule(connectModulePath);
      clearModule(backupModulePath);
      clearModule(listModulePath);
      return {
        ...require(connectModulePath),
        ...require(backupModulePath),
        ...require(listModulePath),
      };
    }
  );

  const program = new Command();
  modules.registerConnectCommand(program);
  modules.registerBackupCommand(program);
  modules.registerListCommand(program);

  await program.parseAsync(['node', 'db-backup', 'connect', '--type', 'postgresql', '--database', 'appdb']);
  await program.parseAsync(['node', 'db-backup', 'backup', '--type', 'full']);
  await program.parseAsync(['node', 'db-backup', 'list']);

  assert.equal(state.database.database, 'appdb');
  assert.equal(state.backups.length, 1);
});
