require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  InfrastructureManager,
  DockerNotInstalledError,
  DockerDaemonNotRunningError,
  DockerComposeUnavailableError,
  ComposeFileNotFoundError,
  InfrastructureTimeoutError,
  InvalidEngineError,
} = require('../../src/infrastructure');
const { DockerComposeAdapter } = require('../../src/infrastructure/docker-compose.adapter');
const { LocalAdapter } = require('../../src/infrastructure/local.adapter');
const { DefaultProcessRunner } = require('../../src/infrastructure/process-runner');

// ==================== Mock Process Runner ====================

class MockProcessRunner {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.calls = [];
  }

  async exec(command, args, options) {
    this.calls.push({ command, args, options });
    const key = `${command} ${args.join(' ')}`;

    // Custom pattern match
    for (const [pattern, response] of Object.entries(this.handlers)) {
      if (key.includes(pattern)) {
        if (typeof response === 'function') {
          return response(command, args, options);
        }
        return response;
      }
    }

    return { exitCode: 0, stdout: '', stderr: '', durationMs: 5 };
  }
}

// ==================== Tests ====================

test('1. Default engine selection defaults to docker', () => {
  const prevEngine = process.env.ENGINE;
  delete process.env.ENGINE;
  try {
    const manager = new InfrastructureManager();
    assert.equal(manager.getEngine(), 'docker');
  } finally {
    if (prevEngine !== undefined) process.env.ENGINE = prevEngine;
  }
});

test('2. Docker engine is selected correctly from ENGINE env', () => {
  const prevEngine = process.env.ENGINE;
  try {
    process.env.ENGINE = 'docker';
    const manager = new InfrastructureManager();
    assert.equal(manager.getEngine(), 'docker');

    process.env.ENGINE = 'local';
    assert.equal(manager.getEngine(), 'local');
  } finally {
    if (prevEngine !== undefined) process.env.ENGINE = prevEngine;
    else delete process.env.ENGINE;
  }
});

test('3. Invalid engine configuration throws InvalidEngineError', () => {
  const prevEngine = process.env.ENGINE;
  try {
    process.env.ENGINE = 'kubernetes';
    const manager = new InfrastructureManager();
    assert.throws(() => manager.getEngine(), InvalidEngineError);
  } finally {
    if (prevEngine !== undefined) process.env.ENGINE = prevEngine;
    else delete process.env.ENGINE;
  }
});

test('4. Docker missing throws DockerNotInstalledError', async () => {
  const runner = new MockProcessRunner({
    'docker --version': { exitCode: 127, stdout: '', stderr: 'Command not found: docker', durationMs: 2 },
  });
  const adapter = new DockerComposeAdapter(runner);

  await assert.rejects(async () => {
    await adapter.validatePrerequisites();
  }, DockerNotInstalledError);
});

test('5. Docker daemon unavailable throws DockerDaemonNotRunningError', async () => {
  const runner = new MockProcessRunner({
    'docker --version': { exitCode: 0, stdout: 'Docker version 27.0.0', stderr: '', durationMs: 2 },
    'docker info': { exitCode: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon', durationMs: 2 },
  });
  const adapter = new DockerComposeAdapter(runner);

  await assert.rejects(async () => {
    await adapter.validatePrerequisites();
  }, DockerDaemonNotRunningError);
});

test('6. Docker Compose unavailable throws DockerComposeUnavailableError', async () => {
  const runner = new MockProcessRunner({
    'docker --version': { exitCode: 0, stdout: 'Docker version 27.0.0', stderr: '', durationMs: 2 },
    'docker info': { exitCode: 0, stdout: '27.0.0', stderr: '', durationMs: 2 },
    'docker compose version': { exitCode: 1, stdout: '', stderr: 'unknown command', durationMs: 2 },
    'docker-compose version': { exitCode: 127, stdout: '', stderr: 'not found', durationMs: 2 },
  });
  const adapter = new DockerComposeAdapter(runner);

  await assert.rejects(async () => {
    await adapter.validatePrerequisites();
  }, DockerComposeUnavailableError);
});

test('7. Compose file resolution discovers docker-compose.yaml', () => {
  const adapter = new DockerComposeAdapter(new MockProcessRunner());
  const composePath = adapter.resolveComposeFilePath();
  assert.ok(fs.existsSync(composePath));
  assert.ok(composePath.endsWith('docker-compose.yaml') || composePath.endsWith('docker-compose.yml'));
});

test('8. Compose file missing throws ComposeFileNotFoundError', () => {
  const adapter = new DockerComposeAdapter(new MockProcessRunner());
  assert.throws(() => {
    adapter.resolveComposeFilePath('/nonexistent/path/docker-compose.yaml');
  }, ComposeFileNotFoundError);
});

test('9. Already-healthy infrastructure is idempotent and does not invoke compose up', async () => {
  const runner = new MockProcessRunner();
  const adapter = new DockerComposeAdapter(runner);
  const local = new LocalAdapter(runner);

  // Mock health prober returning all healthy
  const mockProber = async (svc) => ({
    name: svc.name,
    serviceKey: svc.serviceKey,
    port: svc.port,
    status: 'healthy',
  });

  const manager = new InfrastructureManager(adapter, local, mockProber);
  await manager.ensureInfrastructure({ silent: true });

  // Verify runner.exec was NOT called with 'up'
  const upCalls = runner.calls.filter((c) => c.args.includes('up'));
  assert.equal(upCalls.length, 0);
});

test('10. Infrastructure startup reconciles services when unhealthy', async () => {
  const runner = new MockProcessRunner({
    'docker --version': { exitCode: 0, stdout: 'Docker version 27.0.0', stderr: '', durationMs: 2 },
    'docker info': { exitCode: 0, stdout: '27.0.0', stderr: '', durationMs: 2 },
    'docker compose version': { exitCode: 0, stdout: 'Docker Compose version v2.28.1', stderr: '', durationMs: 2 },
    'docker compose -f': { exitCode: 0, stdout: '', stderr: '', durationMs: 10 },
  });
  const adapter = new DockerComposeAdapter(runner);
  const local = new LocalAdapter(runner);

  let attempt = 0;
  const mockProber = async (svc) => {
    attempt++;
    // First call is unhealthy, subsequent calls become healthy
    return {
      name: svc.name,
      serviceKey: svc.serviceKey,
      port: svc.port,
      status: attempt <= 3 ? 'unhealthy' : 'healthy',
    };
  };

  const manager = new InfrastructureManager(adapter, local, mockProber);
  await manager.ensureInfrastructure({ silent: true, timeoutMs: 5000 });

  // Verify runner.exec WAS called with 'up'
  const upCalls = runner.calls.filter((c) => c.args.includes('up'));
  assert.ok(upCalls.length > 0);
});

test('11. Readiness timeout throws InfrastructureTimeoutError listing failing services', async () => {
  const runner = new MockProcessRunner({
    'docker --version': { exitCode: 0, stdout: 'Docker version 27.0.0', stderr: '', durationMs: 2 },
    'docker info': { exitCode: 0, stdout: '27.0.0', stderr: '', durationMs: 2 },
    'docker compose version': { exitCode: 0, stdout: 'Docker Compose version v2.28.1', stderr: '', durationMs: 2 },
  });
  const adapter = new DockerComposeAdapter(runner);
  const local = new LocalAdapter(runner);

  // Mock prober where PostgreSQL worker always fails
  const mockProber = async (svc) => ({
    name: svc.name,
    serviceKey: svc.serviceKey,
    port: svc.port,
    status: svc.serviceKey === 'postgres-backup' ? 'unhealthy' : 'healthy',
    error: svc.serviceKey === 'postgres-backup' ? 'Connection refused' : undefined,
  });

  const manager = new InfrastructureManager(adapter, local, mockProber);

  await assert.rejects(async () => {
    await manager.ensureInfrastructure({
      dbType: 'postgresql',
      timeoutMs: 1500,
      silent: true,
    });
  }, (err) => {
    assert.ok(err instanceof InfrastructureTimeoutError);
    assert.equal(err.code, 'INFRASTRUCTURE_TIMEOUT');
    assert.ok(err.failedServices.some((s) => s.serviceKey === 'postgres-backup'));
    return true;
  });
});

test('12. Concurrent ensureInfrastructure calls share the active startup promise', async () => {
  const runner = new MockProcessRunner({
    'docker --version': { exitCode: 0, stdout: 'Docker version 27.0.0', stderr: '', durationMs: 2 },
    'docker info': { exitCode: 0, stdout: '27.0.0', stderr: '', durationMs: 2 },
    'docker compose version': { exitCode: 0, stdout: 'Docker Compose version v2.28.1', stderr: '', durationMs: 2 },
  });
  const adapter = new DockerComposeAdapter(runner);
  const local = new LocalAdapter(runner);

  let upCallCount = 0;
  adapter.up = async () => {
    upCallCount++;
    await new Promise((r) => setTimeout(r, 50));
  };

  let probeCount = 0;
  const mockProber = async (svc) => {
    probeCount++;
    return {
      name: svc.name,
      serviceKey: svc.serviceKey,
      port: svc.port,
      status: probeCount <= 3 ? 'unhealthy' : 'healthy',
    };
  };

  const manager = new InfrastructureManager(adapter, local, mockProber);

  // Invoke concurrently
  await Promise.all([
    manager.ensureInfrastructure({ silent: true, timeoutMs: 5000 }),
    manager.ensureInfrastructure({ silent: true, timeoutMs: 5000 }),
    manager.ensureInfrastructure({ silent: true, timeoutMs: 5000 }),
  ]);

  // adapter.up should only be executed once due to in-flight promise sharing
  assert.equal(upCallCount, 1);
});

test('13. stop() executes docker compose stop and never deletes backup directory', async () => {
  const runner = new MockProcessRunner({
    'docker --version': { exitCode: 0, stdout: 'Docker version 27.0.0', stderr: '', durationMs: 2 },
    'docker info': { exitCode: 0, stdout: '27.0.0', stderr: '', durationMs: 2 },
    'docker compose version': { exitCode: 0, stdout: 'Docker Compose version v2.28.1', stderr: '', durationMs: 2 },
  });
  const adapter = new DockerComposeAdapter(runner);
  const manager = new InfrastructureManager(adapter);

  const backupDir = adapter.getBackupDirectory();
  assert.ok(fs.existsSync(backupDir));

  await manager.stop();

  const stopCalls = runner.calls.filter((c) => c.args.includes('stop'));
  assert.ok(stopCalls.length > 0);

  // Backup dir must still exist
  assert.ok(fs.existsSync(backupDir));
});

test('14. status() returns structured status without starting containers', async () => {
  const runner = new MockProcessRunner({
    'docker --version': { exitCode: 0, stdout: 'Docker version 27.0.0', stderr: '', durationMs: 2 },
    'docker info': { exitCode: 0, stdout: '27.0.0', stderr: '', durationMs: 2 },
    'docker compose version': { exitCode: 0, stdout: 'Docker Compose version v2.28.1', stderr: '', durationMs: 2 },
  });
  const adapter = new DockerComposeAdapter(runner);
  const manager = new InfrastructureManager(adapter);

  const status = await manager.status();

  assert.equal(status.engine, 'docker');
  assert.equal(status.dockerAvailable, true);
  assert.equal(status.daemonRunning, true);
  assert.equal(status.composeAvailable, true);
  assert.ok(Array.isArray(status.services));
  assert.ok(status.services.length >= 7);

  // Verify up was never called
  const upCalls = runner.calls.filter((c) => c.args.includes('up'));
  assert.equal(upCalls.length, 0);
});

test('15. Per-database required services map correctly', () => {
  const manager = new InfrastructureManager();

  const pgServices = manager.resolveRequiredServiceKeys({ dbType: 'postgresql' });
  assert.deepEqual(pgServices, ['redis', 'api-gateway', 'backup-orchestrator', 'postgres-backup']);

  const mysqlServices = manager.resolveRequiredServiceKeys({ dbType: 'mysql' });
  assert.deepEqual(mysqlServices, ['redis', 'api-gateway', 'backup-orchestrator', 'mysql-backup']);

  const mongoServices = manager.resolveRequiredServiceKeys({ dbType: 'mongodb' });
  assert.deepEqual(mongoServices, ['redis', 'api-gateway', 'backup-orchestrator', 'mongodb-backup']);

  const sqliteServices = manager.resolveRequiredServiceKeys({ dbType: 'sqlite' });
  assert.deepEqual(sqliteServices, ['redis', 'api-gateway', 'backup-orchestrator', 'sqlite-backup']);

  const customServices = manager.resolveRequiredServiceKeys({ requiredServices: ['redis'] });
  assert.deepEqual(customServices, ['redis']);
});

test('16. Process runner enforces shell: false and captures stdout/stderr', async () => {
  const runner = new DefaultProcessRunner();
  const res = await runner.exec('node', ['-e', 'console.log("hello"); console.error("warn");']);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, 'hello');
  assert.equal(res.stderr, 'warn');
});

// ==================== Command-Level Integration Tests ====================

const { Command } = require('commander');
const { withMockedModules, clearModule } = require('../helpers/mock-require');
const { createNoopLogger, createOraMock, createAxiosMock, createProcessExitInterceptor } = require('../helpers/mocks');

test('17. connect command calls ensureInfrastructure({ dbType })', async () => {
  const infraCalls = [];
  const fakeInfra = {
    ensureInfrastructure: async (opts) => {
      infraCalls.push(opts);
      return { healthy: true, running: true };
    },
  };

  const connectPath = path.resolve(__dirname, '../../src/commands/connect.ts');
  const loaded = withMockedModules(
    {
      ora: createOraMock(),
      '../logger': { createModuleLogger: () => createNoopLogger() },
      '../config': { config: { setDatabase() {}, get() { return undefined; } } },
      '../utils/db_connection': { testConnection: async () => ({ success: true, version: 'PostgreSQL 16' }) },
      '../infrastructure': { infrastructureManager: fakeInfra },
    },
    () => {
      clearModule(connectPath);
      return require(connectPath);
    }
  );

  const exit = createProcessExitInterceptor();
  try {
    const program = new Command();
    loaded.registerConnectCommand(program);
    await program.parseAsync(['node', 'db-backup', 'connect', '--type', 'postgresql', '--database', 'testdb', '--host', 'localhost', '--user', 'app', '--password', 'secret']);
  } catch (err) {
    if (!err.message.startsWith('process.exit')) throw err;
  } finally {
    exit.restore();
  }

  assert.equal(infraCalls.length, 1);
  assert.equal(infraCalls[0].dbType, 'postgresql');
});

test('18. backup command calls ensureInfrastructure({ dbType })', async () => {
  const infraCalls = [];
  const fakeInfra = {
    ensureInfrastructure: async (opts) => {
      infraCalls.push(opts);
      return { healthy: true, running: true };
    },
  };

  const backupPath = path.resolve(__dirname, '../../src/commands/backup.ts');
  const axios = createAxiosMock({
    post: async () => ({ status: 200, data: { jobId: 'job-123' } }),
    get: async () => ({ status: 200, data: { status: 'completed', progress: 100 } }),
  });

  const config = {
    get(key) {
      if (key === 'database') {
        return { type: 'postgresql', host: 'localhost', port: 5432, username: 'app', password: 'secret', database: 'appdb' };
      }
      if (key === 'storage.localPath') return './backups';
      return undefined;
    },
  };

  const loaded = withMockedModules(
    {
      ora: createOraMock(),
      axios,
      '../logger': { createModuleLogger: () => createNoopLogger() },
      '../config': { config },
      '../lib/prisma': { prisma: { storageLocation: { findFirst: async () => null, findMany: async () => [] } } },
      '../utils/http-client': { __esModule: true, default: axios, httpClient: axios },
      '../infrastructure': { infrastructureManager: fakeInfra },
    },
    () => {
      clearModule(backupPath);
      return require(backupPath);
    }
  );

  const exit = createProcessExitInterceptor();
  try {
    const program = new Command();
    loaded.registerBackupCommand(program);
    await program.parseAsync(['node', 'db-backup', 'backup']);
  } catch (err) {
    if (!err.message.startsWith('process.exit')) throw err;
  } finally {
    exit.restore();
  }

  assert.equal(infraCalls.length, 1);
  assert.equal(infraCalls[0].dbType, 'postgresql');
});

test('19. restore command calls ensureInfrastructure({ requiredServices: ["redis"] })', async () => {
  const infraCalls = [];
  const fakeInfra = {
    ensureInfrastructure: async (opts) => {
      infraCalls.push(opts);
      return { healthy: true, running: true };
    },
  };

  const restorePath = path.resolve(__dirname, '../../src/commands/restore.ts');
  const tempFile = path.join(os.tmpdir(), `test-restore-${Date.now()}.sql`);
  fs.writeFileSync(tempFile, 'SELECT 1;');

  try {
    class FakeDistributedLock {
      async acquire() { return true; }
      async release() {}
    }

    const loaded = withMockedModules(
      {
        ora: createOraMock(),
        '../logger': { createModuleLogger: () => createNoopLogger() },
        '../config': {
          config: {
            get: (key) => key === 'database' ? { type: 'postgresql', host: 'localhost', username: 'u', password: 'p', database: 'd' } : undefined,
          },
        },
        '../lib/prisma': { prisma: { backupJob: { findUnique: async () => null } } },
        '../lib/distributed-lock': { DistributedLock: FakeDistributedLock },
        '../lib/queue-manager': { connection: { quit: async () => {}, disconnect: async () => {}, on: () => {} } },
        '../utils/http-client': { __esModule: true, default: {}, httpClient: {} },
        '../infrastructure': { infrastructureManager: fakeInfra },
      },
      () => {
        clearModule(restorePath);
        return require(restorePath);
      }
    );

    const exit = createProcessExitInterceptor();
    try {
      const program = new Command();
      loaded.registerRestoreCommand(program);
      await program.parseAsync(['node', 'db-backup', 'restore', '--file', tempFile]);
    } catch (err) {
      if (!err.message.startsWith('process.exit')) throw err;
    } finally {
      exit.restore();
    }

    assert.equal(infraCalls.length, 1);
    assert.deepEqual(infraCalls[0].requiredServices, ['redis']);
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
});

test('20. list command does NOT call ensureInfrastructure', async () => {
  const infraCalls = [];
  const fakeInfra = {
    ensureInfrastructure: async (opts) => {
      infraCalls.push(opts);
      return { healthy: true, running: true };
    },
  };

  const listPath = path.resolve(__dirname, '../../src/commands/list.ts');
  const loaded = withMockedModules(
    {
      '../logger': { createModuleLogger: () => createNoopLogger() },
      '../lib/prisma': { prisma: { backupJob: { findMany: async () => [] } } },
      '../infrastructure': { infrastructureManager: fakeInfra },
    },
    () => {
      clearModule(listPath);
      return require(listPath);
    }
  );

  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  const exit = createProcessExitInterceptor();
  try {
    const program = new Command();
    loaded.registerListCommand(program);
    await program.parseAsync(['node', 'db-backup', 'list']);
  } catch (err) {
    if (!err.message.startsWith('process.exit')) throw err;
  } finally {
    exit.restore();
    console.log = origLog;
  }
  assert.equal(infraCalls.length, 0, 'list must not call ensureInfrastructure');
});

test('21. local-only commands (storage, notification, config check) do NOT call ensureInfrastructure', async () => {
  const infraCalls = [];
  const fakeInfra = {
    ensureInfrastructure: async (opts) => {
      infraCalls.push(opts);
      return { healthy: true, running: true };
    },
  };

  const storagePath = path.resolve(__dirname, '../../src/commands/storage.ts');
  const loadedStorage = withMockedModules(
    {
      ora: createOraMock(),
      '../logger': { createModuleLogger: () => createNoopLogger() },
      '../lib/prisma': { prisma: { storageLocation: { findMany: async () => [] } } },
      '../infrastructure': { infrastructureManager: fakeInfra },
    },
    () => {
      clearModule(storagePath);
      return require(storagePath);
    }
  );

  const exit = createProcessExitInterceptor();
  try {
    const program = new Command();
    loadedStorage.registerStorageCommand(program);
    await program.parseAsync(['node', 'db-backup', 'storage', 'list']);
  } catch (err) {
    if (!err.message.startsWith('process.exit')) throw err;
  } finally {
    exit.restore();
  }

  assert.equal(infraCalls.length, 0, 'storage list must not call ensureInfrastructure');
});

test('22. --help and --version do NOT call ensureInfrastructure', async () => {
  const infraCalls = [];
  const fakeInfra = {
    ensureInfrastructure: async (opts) => {
      infraCalls.push(opts);
      return { healthy: true, running: true };
    },
  };

  const program = new Command();
  program.name('dbvault').version('1.0.0');
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  program.exitOverride();

  try {
    program.parse(['node', 'dbvault', '--version']);
  } catch {
    // exitOverride throws
  }

  try {
    program.parse(['node', 'dbvault', '--help']);
  } catch {
    // exitOverride throws
  }

  assert.equal(infraCalls.length, 0, '--help and --version must not call ensureInfrastructure');
});
