require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Command } = require('commander');

const { withMockedModules, clearModule } = require('../../helpers/mock-require');
const { createNoopLogger, createProcessExitInterceptor } = require('../../helpers/mocks');

const modulePath = path.resolve(__dirname, '../../../src/commands/doctor.ts');

function loadDoctorCommand(overrides = {}) {
  const prisma = overrides.prisma || {
    backupJob: {
      findMany: async () => [],
    },
    storageLocation: {
      findFirst: async () => ({
        type: 'local',
        config: { basePath: './backups' },
      }),
    },
  };

  const config = overrides.config || {
    get(key) {
      if (key === 'database') {
        return {
          type: 'postgresql',
          database: 'testdb',
          host: 'localhost',
          password: 'SUPER_SECRET_PASSWORD_123',
        };
      }
      return undefined;
    },
  };

  const testConnection = overrides.testConnection || (async () => ({ success: true, version: 'PostgreSQL 16' }));
  const keyManager = overrides.keyManager || { getAllKeys: () => [{ id: 'key1' }] };

  let ensureInfraCalled = false;
  let startCalled = false;
  let restartCalled = false;

  const infrastructureManager = overrides.infrastructureManager || {
    status: async () => ({
      engine: 'docker',
      dockerAvailable: true,
      daemonRunning: true,
      composeAvailable: true,
      composeVersion: 'docker compose',
      composeFile: '/app/docker-compose.yaml',
      backupDir: '/tmp/.db-backup',
      running: true,
      healthy: true,
      services: [
        { name: 'Redis', status: 'healthy', port: 6379 },
        { name: 'API Gateway', status: 'healthy', port: 3000 },
        { name: 'Backup Orchestrator', status: 'healthy', port: 3001 },
        { name: 'PostgreSQL Worker', status: 'healthy', port: 3010 },
      ],
    }),
    ensureInfrastructure: async () => {
      ensureInfraCalled = true;
      throw new Error('Doctor should never call ensureInfrastructure');
    },
    start: async () => {
      startCalled = true;
      throw new Error('Doctor should never call start');
    },
    restart: async () => {
      restartCalled = true;
      throw new Error('Doctor should never call restart');
    },
  };

  const metadataClient = overrides.metadataClient || {
    health: async () => {
      if (overrides.prisma && overrides.prisma.backupJob && overrides.prisma.backupJob.findMany) {
        await overrides.prisma.backupJob.findMany();
      }
      return { status: 'healthy', database: 'connected' };
    },
  };

  const dockerRuntime = overrides.dockerRuntime || {
    probeGatewayHealth: async () => ({
      healthy: true,
      data: {
        status: 'healthy',
        dependencies: {
          gateway: { status: 'healthy' },
          metadataService: { status: 'healthy' },
          redis: { status: 'healthy' },
          orchestrator: { status: 'healthy' },
        },
      },
    }),
  };

  const loaded = withMockedModules(
    {
      '../logger': { createModuleLogger: () => createNoopLogger() },
      '../config': { config },
      '../lib/prisma': { prisma },
      '../lib/metadata-client': { metadataClient },
      '../lib/key-manager': { keyManager },
      '../utils/db_connection': { testConnection },
      '../infrastructure': { infrastructureManager },
      '../infrastructure/docker-runtime': { dockerRuntime },
    },
    () => {
      clearModule(modulePath);
      return require(modulePath);
    }
  );

  return {
    ...loaded,
    getMutationCalls: () => ({ ensureInfraCalled, startCalled, restartCalled }),
  };
}

test('1. Healthy environment exits with code 0', async () => {
  const exit = createProcessExitInterceptor();
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const { registerDoctorCommand } = loadDoctorCommand();
    const program = new Command();
    registerDoctorCommand(program);

    await assert.rejects(
      program.parseAsync(['node', 'db-backup', 'doctor']),
      /process\.exit:0/
    );

    assert.equal(exit.calls.at(-1), 0);
    assert.ok(logs.some((l) => l.includes('environment is healthy')));
  } finally {
    console.log = origLog;
    exit.restore();
  }
});

test('2. Docker not installed causes diagnostic failure with exit code 1', async () => {
  const exit = createProcessExitInterceptor();
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const { registerDoctorCommand } = loadDoctorCommand({
      infrastructureManager: {
        status: async () => ({
          engine: 'docker',
          dockerAvailable: false,
          daemonRunning: false,
          composeAvailable: false,
          services: [],
        }),
      },
    });
    const program = new Command();
    registerDoctorCommand(program);

    await assert.rejects(
      program.parseAsync(['node', 'db-backup', 'doctor']),
      /process\.exit:1/
    );

    assert.equal(exit.calls.at(-1), 1);
    assert.ok(logs.some((l) => l.includes('Docker installed') && l.includes('Not found')));
    assert.ok(logs.some((l) => l.includes('Install Docker')));
  } finally {
    console.log = origLog;
    exit.restore();
  }
});

test('3. Docker daemon stopped causes diagnostic failure with exit code 1 and actionable suggestion', async () => {
  const exit = createProcessExitInterceptor();
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const { registerDoctorCommand } = loadDoctorCommand({
      infrastructureManager: {
        status: async () => ({
          engine: 'docker',
          dockerAvailable: true,
          daemonRunning: false,
          composeAvailable: true,
          composeFile: '/app/docker-compose.yaml',
          services: [
            { name: 'Redis', status: 'unhealthy', error: 'ECONNREFUSED' },
          ],
        }),
      },
    });
    const program = new Command();
    registerDoctorCommand(program);

    await assert.rejects(
      program.parseAsync(['node', 'db-backup', 'doctor']),
      /process\.exit:1/
    );

    assert.equal(exit.calls.at(-1), 1);
    assert.ok(logs.some((l) => l.includes('Docker daemon') && l.includes('Not running')));
    assert.ok(logs.some((l) => l.includes('Start the Docker daemon') && l.includes('doctor` again.')));
  } finally {
    console.log = origLog;
    exit.restore();
  }
});

test('4. Docker Compose unavailable causes diagnostic failure with exit code 1', async () => {
  const exit = createProcessExitInterceptor();
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const { registerDoctorCommand } = loadDoctorCommand({
      infrastructureManager: {
        status: async () => ({
          engine: 'docker',
          dockerAvailable: true,
          daemonRunning: true,
          composeAvailable: false,
          composeFile: '/app/docker-compose.yaml',
          services: [],
        }),
      },
    });
    const program = new Command();
    registerDoctorCommand(program);

    await assert.rejects(
      program.parseAsync(['node', 'db-backup', 'doctor']),
      /process\.exit:1/
    );

    assert.equal(exit.calls.at(-1), 1);
    assert.ok(logs.some((l) => l.includes('Docker Compose') && l.includes('Unavailable')));
  } finally {
    console.log = origLog;
    exit.restore();
  }
});

test('5. Services unhealthy reports failing services and exits with code 1', async () => {
  const exit = createProcessExitInterceptor();
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const { registerDoctorCommand } = loadDoctorCommand({
      infrastructureManager: {
        status: async () => ({
          engine: 'docker',
          dockerAvailable: true,
          daemonRunning: true,
          composeAvailable: true,
          composeFile: '/app/docker-compose.yaml',
          services: [
            { name: 'Redis', status: 'healthy', port: 6379 },
            { name: 'API Gateway', status: 'unhealthy', port: 3000, error: 'connect ECONNREFUSED 127.0.0.1:3000' },
          ],
        }),
      },
    });
    const program = new Command();
    registerDoctorCommand(program);

    await assert.rejects(
      program.parseAsync(['node', 'db-backup', 'doctor']),
      /process\.exit:1/
    );

    assert.equal(exit.calls.at(-1), 1);
    assert.ok(logs.some((l) => l.includes('API Gateway') && l.includes('Unhealthy')));
    assert.ok(logs.some((l) => l.includes('infra start')));
  } finally {
    console.log = origLog;
    exit.restore();
  }
});

test('6. Inaccessible metadata database causes diagnostic failure with exit code 1', async () => {
  const exit = createProcessExitInterceptor();
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const { registerDoctorCommand } = loadDoctorCommand({
      prisma: {
        backupJob: {
          findMany: async () => {
            throw new Error('Sqlite database file locked');
          },
        },
        storageLocation: {
          findFirst: async () => null,
        },
      },
    });
    const program = new Command();
    registerDoctorCommand(program);

    await assert.rejects(
      program.parseAsync(['node', 'db-backup', 'doctor']),
      /process\.exit:1/
    );

    assert.equal(exit.calls.at(-1), 1);
    assert.ok(logs.some((l) => l.includes('Metadata database') && l.includes('Inaccessible')));
  } finally {
    console.log = origLog;
    exit.restore();
  }
});

test('7. Local engine mode performs local diagnostics without requiring Docker', async () => {
  const exit = createProcessExitInterceptor();
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const { registerDoctorCommand } = loadDoctorCommand({
      infrastructureManager: {
        status: async () => ({
          engine: 'local',
          dockerAvailable: false,
          daemonRunning: false,
          composeAvailable: false,
          services: [
            { name: 'API Gateway', status: 'healthy', port: 3000 },
          ],
        }),
      },
    });
    const program = new Command();
    registerDoctorCommand(program);

    await assert.rejects(
      program.parseAsync(['node', 'db-backup', 'doctor']),
      /process\.exit:0/
    );

    assert.equal(exit.calls.at(-1), 0);
    assert.ok(logs.some((l) => l.includes('Local Engine (PM2)')));
    // Should NOT report Docker errors in local mode
    assert.ok(!logs.some((l) => l.includes('Install Docker')));
  } finally {
    console.log = origLog;
    exit.restore();
  }
});

test('8. Doctor NEVER calls ensureInfrastructure(), start(), or restart()', async () => {
  const exit = createProcessExitInterceptor();

  try {
    const { registerDoctorCommand, getMutationCalls } = loadDoctorCommand();
    const program = new Command();
    registerDoctorCommand(program);

    await assert.rejects(
      program.parseAsync(['node', 'db-backup', 'doctor']),
      /process\.exit:0/
    );

    const calls = getMutationCalls();
    assert.equal(calls.ensureInfraCalled, false, 'ensureInfrastructure must never be called');
    assert.equal(calls.startCalled, false, 'start must never be called');
    assert.equal(calls.restartCalled, false, 'restart must never be called');
  } finally {
    exit.restore();
  }
});

test('9. Secrets and passwords are NEVER printed in diagnostic output', async () => {
  const exit = createProcessExitInterceptor();
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const secretPassword = 'SUPER_SECRET_PASSWORD_123';
    const { registerDoctorCommand } = loadDoctorCommand({
      config: {
        get(key) {
          if (key === 'database') {
            return {
              type: 'postgresql',
              database: 'testdb',
              host: 'localhost',
              password: secretPassword,
            };
          }
          return undefined;
        },
      },
      testConnection: async () => ({
        success: false,
        error: `connection to postgresql://admin:${secretPassword}@localhost:5432 failed`,
      }),
    });

    const program = new Command();
    registerDoctorCommand(program);

    await assert.rejects(
      program.parseAsync(['node', 'db-backup', 'doctor']),
      /process\.exit:1/
    );

    const fullOutput = logs.join('\n');
    assert.ok(!fullOutput.includes(secretPassword), 'Secret password must not appear anywhere in doctor output');
    assert.ok(fullOutput.includes('***'), 'Secret password should be masked');
  } finally {
    console.log = origLog;
    exit.restore();
  }
});
