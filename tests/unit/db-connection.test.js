require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');

const { withMockedModules, clearModule } = require('../helpers/mock-require');
const { createNoopLogger } = require('../helpers/mocks');

const modulePath = '../../src/utils/db_connection.ts';

test('testConnection rejects unsupported database types', async () => {
  clearModule(modulePath);
  const { testConnection } = require(modulePath);

  const result = await testConnection({
    type: 'oracle',
    database: 'appdb',
  });

  assert.equal(result.success, false);
  assert.match(result.error, /Unsupported database type/);
});

test('testConnection supports mysql, mongodb, and sqlite fallbacks', async () => {
  clearModule(modulePath);
  const { testConnection } = require(modulePath);

  for (const type of ['mysql', 'mongodb', 'sqlite']) {
    const result = await testConnection({ type, database: 'appdb' });
    assert.equal(result.success, true, `${type} should succeed`);
    assert.ok(result.version);
  }
});

test('testConnection uses the postgres client for PostgreSQL connections', async () => {
  class FakeClient {
    constructor(config) {
      FakeClient.instances.push(config);
    }

    async connect() {}

    async query() {
      return {
        rows: [
          {
            version: 'PostgreSQL 16.0 on x86_64-pc-linux-gnu',
            db: 'appdb',
            user: 'app',
          },
        ],
      };
    }

    async end() {}
  }

  FakeClient.instances = [];

  const loaded = withMockedModules(
    {
      pg: { Client: FakeClient },
      '../logger': { createModuleLogger: () => createNoopLogger() },
    },
    () => {
      clearModule(modulePath);
      return require(modulePath);
    }
  );

  const result = await loaded.testConnection({
    type: 'postgresql',
    host: 'localhost',
    port: 5432,
    username: 'app',
    password: 'secret',
    database: 'appdb',
  });

  assert.equal(result.success, true);
  assert.equal(result.version, 'PostgreSQL 16.0 on x86_64-pc-linux-gnu');
  assert.deepEqual(FakeClient.instances[0], {
    host: 'localhost',
    port: 5432,
    user: 'app',
    password: 'secret',
    database: 'appdb',
    ssl: false,
  });
});

test('getDatabaseSize queries postgres size for PostgreSQL databases', async () => {
  class FakeClient {
    constructor() {}
    async connect() {}
    async query() {
      return { rows: [{ size: 123456 }] };
    }
    async end() {}
  }

  const loaded = withMockedModules(
    {
      pg: { Client: FakeClient },
      '../logger': { createModuleLogger: () => createNoopLogger() },
    },
    () => {
      clearModule(modulePath);
      return require(modulePath);
    }
  );

  const size = await loaded.getDatabaseSize({
    type: 'postgresql',
    host: 'localhost',
    database: 'appdb',
  });

  assert.equal(size, 123456);
});
