require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DockerRuntime,
  DockerNotInstalledError,
  DockerDaemonNotRunningError,
  DockerPermissionDeniedError,
  PortConflictError,
  ImagePullError,
  InfrastructureTimeoutError,
} = require('../../src/infrastructure');

// Mock Process Runner for unit testing without a real Docker daemon
class MockProcessRunner {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.calls = [];
  }

  async exec(command, args, options) {
    this.calls.push({ command, args, options });
    const key = `${command} ${args.join(' ')}`;

    for (const [pattern, response] of Object.entries(this.handlers)) {
      if (key.includes(pattern)) {
        if (typeof response === 'function') {
          return response(command, args, options);
        }
        return response;
      }
    }

    return { exitCode: 0, stdout: '', stderr: '', durationMs: 2 };
  }
}

// Mock Compose Adapter
class MockComposeAdapter {
  constructor() {
    this.composeCommand = ['docker', 'compose'];
  }
  async getComposeCommand() {
    return this.composeCommand;
  }
  resolveComposeFilePath() {
    return '/app/docker-compose.yml';
  }
  getBackupDirectory() {
    return '/home/user/.db-backup';
  }
}

test('1. Docker missing throws DockerNotInstalledError', async () => {
  const runner = new MockProcessRunner({
    'docker --version': { exitCode: 127, stdout: '', stderr: 'command not found', durationMs: 1 },
  });
  const runtime = new DockerRuntime(runner, new MockComposeAdapter());

  await assert.rejects(async () => {
    await runtime.checkPrerequisites();
  }, DockerNotInstalledError);
});

test('2. Docker daemon stopped throws DockerDaemonNotRunningError', async () => {
  const runner = new MockProcessRunner({
    'docker --version': { exitCode: 0, stdout: 'Docker version 27.0.0', stderr: '', durationMs: 1 },
    'docker info': { exitCode: 1, stdout: '', stderr: 'Is the docker daemon running?', durationMs: 1 },
  });
  const runtime = new DockerRuntime(runner, new MockComposeAdapter());

  await assert.rejects(async () => {
    await runtime.checkPrerequisites();
  }, DockerDaemonNotRunningError);
});

test('3. Docker socket permission denied throws DockerPermissionDeniedError', async () => {
  const runner = new MockProcessRunner({
    'docker --version': { exitCode: 0, stdout: 'Docker version 27.0.0', stderr: '', durationMs: 1 },
    'docker info': {
      exitCode: 1,
      stdout: '',
      stderr: 'Got permission denied while trying to connect to the Docker daemon socket',
      durationMs: 1,
    },
  });
  const runtime = new DockerRuntime(runner, new MockComposeAdapter());

  await assert.rejects(async () => {
    await runtime.checkPrerequisites();
  }, DockerPermissionDeniedError);
});

test('4. Configuration resolution respects environment overrides and defaults', () => {
  const prevImage = process.env.DB_BACKUP_IMAGE;
  const prevVersion = process.env.DB_BACKUP_VERSION;
  const prevContainer = process.env.DB_BACKUP_CONTAINER;
  const prevPort = process.env.DB_BACKUP_PORT;

  try {
    delete process.env.DB_BACKUP_IMAGE;
    delete process.env.DB_BACKUP_VERSION;
    delete process.env.DB_BACKUP_CONTAINER;
    delete process.env.DB_BACKUP_PORT;

    const runtime = new DockerRuntime(new MockProcessRunner(), new MockComposeAdapter());
    const defaultCfg = runtime.resolveConfig();

    assert.equal(defaultCfg.imageRepository, 'rithish2006/db-backup');
    assert.equal(defaultCfg.containerName, 'db-backup');
    assert.equal(defaultCfg.hostPort, 3000);

    // With env overrides
    process.env.DB_BACKUP_IMAGE = 'my-registry/custom-backup';
    process.env.DB_BACKUP_VERSION = '2.5.0';
    process.env.DB_BACKUP_CONTAINER = 'custom-db-backup';
    process.env.DB_BACKUP_PORT = '3005';

    const customCfg = runtime.resolveConfig();
    assert.equal(customCfg.imageRepository, 'my-registry/custom-backup');
    assert.equal(customCfg.imageVersion, '2.5.0');
    assert.equal(customCfg.imageTag, 'my-registry/custom-backup:2.5.0');
    assert.equal(customCfg.containerName, 'custom-db-backup');
    assert.equal(customCfg.hostPort, 3005);
  } finally {
    if (prevImage !== undefined) process.env.DB_BACKUP_IMAGE = prevImage;
    else delete process.env.DB_BACKUP_IMAGE;
    if (prevVersion !== undefined) process.env.DB_BACKUP_VERSION = prevVersion;
    else delete process.env.DB_BACKUP_VERSION;
    if (prevContainer !== undefined) process.env.DB_BACKUP_CONTAINER = prevContainer;
    else delete process.env.DB_BACKUP_CONTAINER;
    if (prevPort !== undefined) process.env.DB_BACKUP_PORT = prevPort;
    else delete process.env.DB_BACKUP_PORT;
  }
});

test('5. Container state detection identifies missing, running, and stopped states', async () => {
  const runner = new MockProcessRunner({
    'docker inspect --format {{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.Config.Image}}|{{.Id}}|{{.State.StartedAt}} missing-box': {
      exitCode: 1,
      stdout: '',
      stderr: 'Error: No such object: missing-box',
      durationMs: 1,
    },
    'docker inspect --format {{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.Config.Image}}|{{.Id}}|{{.State.StartedAt}} running-box': {
      exitCode: 0,
      stdout: 'running|healthy|rithish2006/db-backup:1.0.0|abc123def456|2026-09-09T12:00:00Z',
      stderr: '',
      durationMs: 1,
    },
    'docker inspect --format {{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.Config.Image}}|{{.Id}}|{{.State.StartedAt}} stopped-box': {
      exitCode: 0,
      stdout: 'exited|none|rithish2006/db-backup:1.0.0|abc123def456|2026-09-09T12:00:00Z',
      stderr: '',
      durationMs: 1,
    },
  });

  const runtime = new DockerRuntime(runner, new MockComposeAdapter());

  const missingState = await runtime.getContainerState('missing-box');
  assert.equal(missingState.exists, false);
  assert.equal(missingState.running, false);
  assert.equal(missingState.status, 'missing');

  const runningState = await runtime.getContainerState('running-box');
  assert.equal(runningState.exists, true);
  assert.equal(runningState.running, true);
  assert.equal(runningState.status, 'running');
  assert.equal(runningState.health, 'healthy');
  assert.equal(runningState.containerId, 'abc123def456');

  const stoppedState = await runtime.getContainerState('stopped-box');
  assert.equal(stoppedState.exists, true);
  assert.equal(stoppedState.running, false);
  assert.equal(stoppedState.status, 'stopped');
});

test('6. Image pull failure throws ImagePullError with troubleshooting guidance', async () => {
  const runner = new MockProcessRunner({
    'docker image inspect': { exitCode: 1, stdout: '', stderr: 'No such image', durationMs: 1 },
    'docker pull': { exitCode: 1, stdout: '', stderr: 'repository does not exist or may require docker login', durationMs: 1 },
  });

  const runtime = new DockerRuntime(runner, new MockComposeAdapter());

  await assert.rejects(async () => {
    await runtime.ensureImage('nonexistent/image:tag');
  }, (err) => {
    assert.ok(err instanceof ImagePullError);
    assert.equal(err.code, 'IMAGE_PULL_FAILED');
    assert.ok(err.message.includes('Troubleshooting'));
    return true;
  });
});

test('7. Start command reuses already-running healthy container without running compose', async () => {
  const runner = new MockProcessRunner({
    'docker --version': { exitCode: 0, stdout: 'Docker version 27.0.0', stderr: '', durationMs: 1 },
    'docker info': { exitCode: 0, stdout: '27.0.0', stderr: '', durationMs: 1 },
    'docker inspect': {
      exitCode: 0,
      stdout: 'running|healthy|rithish2006/db-backup:1.0.0|abc123def456|2026-09-09T12:00:00Z',
      stderr: '',
      durationMs: 1,
    },
  });

  const runtime = new DockerRuntime(runner, new MockComposeAdapter());

  // Stub probeGatewayHealth to return healthy
  runtime.probeGatewayHealth = async () => ({
    healthy: true,
    data: {
      service: 'api-gateway',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      dependencies: {
        gateway: { status: 'healthy' },
        metadataService: { status: 'healthy' },
        redis: { status: 'healthy' },
        orchestrator: { status: 'healthy' },
      },
    },
  });

  const result = await runtime.start();

  assert.equal(result.alreadyRunning, true);
  assert.equal(result.health.status, 'healthy');

  // Verify compose up was not called
  const upCalls = runner.calls.filter((c) => c.args.includes('up'));
  assert.equal(upCalls.length, 0);
});

test('8. Start command starts existing stopped container via docker start', async () => {
  let started = false;
  const runner = new MockProcessRunner({
    'docker --version': { exitCode: 0, stdout: 'Docker version 27.0.0', stderr: '', durationMs: 1 },
    'docker info': { exitCode: 0, stdout: '27.0.0', stderr: '', durationMs: 1 },
    'docker inspect': () => ({
      exitCode: 0,
      stdout: started
        ? 'running|healthy|rithish2006/db-backup:1.0.0|abc123def456|2026-09-09T12:00:00Z'
        : 'exited|none|rithish2006/db-backup:1.0.0|abc123def456|2026-09-09T12:00:00Z',
      stderr: '',
      durationMs: 1,
    }),
    'docker start': () => {
      started = true;
      return { exitCode: 0, stdout: 'db-backup', stderr: '', durationMs: 5 };
    },
  });

  const runtime = new DockerRuntime(runner, new MockComposeAdapter());
  runtime.checkPortAvailability = async () => {};
  runtime.waitForReady = async () => ({
    service: 'api-gateway',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    dependencies: {
      gateway: { status: 'healthy' },
      metadataService: { status: 'healthy' },
      redis: { status: 'healthy' },
      orchestrator: { status: 'healthy' },
    },
  });

  const result = await runtime.start();

  assert.equal(result.alreadyRunning, false);
  const startCalls = runner.calls.filter((c) => c.args[0] === 'start');
  assert.equal(startCalls.length, 1);
});

test('9. Stop command gracefully stops running container without volume deletion', async () => {
  const runner = new MockProcessRunner({
    'docker --version': { exitCode: 0, stdout: 'Docker version 27.0.0', stderr: '', durationMs: 1 },
    'docker info': { exitCode: 0, stdout: '27.0.0', stderr: '', durationMs: 1 },
    'docker inspect': {
      exitCode: 0,
      stdout: 'running|healthy|rithish2006/db-backup:1.0.0|abc123def456|2026-09-09T12:00:00Z',
      stderr: '',
      durationMs: 1,
    },
    'docker stop': { exitCode: 0, stdout: 'db-backup', stderr: '', durationMs: 10 },
  });

  const runtime = new DockerRuntime(runner, new MockComposeAdapter());
  const result = await runtime.stop();

  assert.equal(result.stopped, true);
  assert.equal(result.wasRunning, true);
  assert.ok(result.message.includes('stopped successfully'));

  // Ensure NO rm or down calls were made
  const rmCalls = runner.calls.filter((c) => c.args.includes('rm') || c.args.includes('down'));
  assert.equal(rmCalls.length, 0);
});

test('10. Stop command on stopped container reports already stopped', async () => {
  const runner = new MockProcessRunner({
    'docker --version': { exitCode: 0, stdout: 'Docker version 27.0.0', stderr: '', durationMs: 1 },
    'docker info': { exitCode: 0, stdout: '27.0.0', stderr: '', durationMs: 1 },
    'docker inspect': {
      exitCode: 0,
      stdout: 'exited|none|rithish2006/db-backup:1.0.0|abc123def456|2026-09-09T12:00:00Z',
      stderr: '',
      durationMs: 1,
    },
  });

  const runtime = new DockerRuntime(runner, new MockComposeAdapter());
  const result = await runtime.stop();

  assert.equal(result.stopped, false);
  assert.equal(result.wasRunning, false);
  assert.ok(result.message.includes('already stopped'));
});

test('11. Restart command invokes docker restart and verifies health', async () => {
  const runner = new MockProcessRunner({
    'docker --version': { exitCode: 0, stdout: 'Docker version 27.0.0', stderr: '', durationMs: 1 },
    'docker info': { exitCode: 0, stdout: '27.0.0', stderr: '', durationMs: 1 },
    'docker inspect': {
      exitCode: 0,
      stdout: 'running|healthy|rithish2006/db-backup:1.0.0|abc123def456|2026-09-09T12:00:00Z',
      stderr: '',
      durationMs: 1,
    },
    'docker restart': { exitCode: 0, stdout: 'db-backup', stderr: '', durationMs: 10 },
  });

  const runtime = new DockerRuntime(runner, new MockComposeAdapter());
  runtime.waitForReady = async () => ({
    service: 'api-gateway',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    dependencies: {
      gateway: { status: 'healthy' },
      metadataService: { status: 'healthy' },
      redis: { status: 'healthy' },
      orchestrator: { status: 'healthy' },
    },
  });

  const result = await runtime.restart();

  assert.equal(result.health.status, 'healthy');
  const restartCalls = runner.calls.filter((c) => c.args[0] === 'restart');
  assert.equal(restartCalls.length, 1);
});

test('12. Readiness timeout throws InfrastructureTimeoutError', async () => {
  const runtime = new DockerRuntime(new MockProcessRunner(), new MockComposeAdapter());
  runtime.probeGatewayHealth = async () => ({
    healthy: false,
    error: 'Connection refused',
  });

  await assert.rejects(async () => {
    await runtime.waitForReady(100, 20);
  }, (err) => {
    assert.ok(err instanceof InfrastructureTimeoutError);
    assert.equal(err.code, 'INFRASTRUCTURE_TIMEOUT');
    return true;
  });
});
