import net from 'net';
import axios from 'axios';
import path from 'path';
import { spawn } from 'child_process';
import {
  IProcessRunner,
  DockerRuntimeConfig,
  ContainerState,
  DockerNotInstalledError,
  DockerDaemonNotRunningError,
  DockerPermissionDeniedError,
  DockerComposeUnavailableError,
  PortConflictError,
  ImagePullError,
  InfrastructureTimeoutError,
} from './types';
import { defaultProcessRunner } from './process-runner';
import { APP_VERSION } from '../version';
import { dockerComposeAdapter, DockerComposeAdapter } from './docker-compose.adapter';
import { createModuleLogger } from '../logger';
import { config } from '../config';

const log = createModuleLogger('docker-runtime');

export interface DeepHealthResponse {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  dependencies: {
    gateway: { status: string };
    metadataService: { status: string };
    redis: { status: string };
    orchestrator: { status: string };
  };
}

export interface DetailedRuntimeStatus {
  dockerAvailable: boolean;
  daemonRunning: boolean;
  container: ContainerState;
  config: DockerRuntimeConfig;
  gatewayHealthy: boolean;
  healthDetails?: DeepHealthResponse;
  message?: string;
}

export class DockerRuntime {
  constructor(
    private readonly runner: IProcessRunner = defaultProcessRunner,
    private readonly composeAdapter: DockerComposeAdapter = dockerComposeAdapter,
    private readonly healthUrl: string = 'http://127.0.0.1:3000/health'
  ) {}

  /**
   * Resolves centralized Docker runtime configuration from environment, config, and defaults.
   */
  resolveConfig(): DockerRuntimeConfig {
    const rawImage = process.env.DB_BACKUP_IMAGE || config.get('docker.image') || 'rithish2006/db-backup';
    const rawVersion = process.env.DB_BACKUP_VERSION || config.get('docker.version') || config.get('version') || APP_VERSION;
    const containerName = process.env.DB_BACKUP_CONTAINER || config.get('docker.containerName') || 'db-backup';
    const hostPort = parseInt(process.env.DB_BACKUP_PORT || process.env.PORT || '3000', 10);
    const composeFile = this.composeAdapter.resolveComposeFilePath();
    const backupDir = this.composeAdapter.getBackupDirectory();

    let imageTag = `${rawImage}:${rawVersion}`;
    if (rawImage.includes(':')) {
      imageTag = rawImage;
    }

    return {
      imageRepository: rawImage.split(':')[0],
      imageVersion: rawVersion,
      imageTag,
      containerName,
      hostPort,
      composeFile,
      backupDir,
    };
  }

  /**
   * Validates Docker installation, daemon responsiveness, and socket permissions.
   */
  async checkPrerequisites(): Promise<void> {
    const versionRes = await this.runner.exec('docker', ['--version']);
    if (versionRes.exitCode !== 0) {
      throw new DockerNotInstalledError();
    }

    const infoRes = await this.runner.exec('docker', ['info', '--format', '{{.ServerVersion}}']);
    if (infoRes.exitCode !== 0) {
      const errOutput = (infoRes.stderr || infoRes.stdout).toLowerCase();
      if (errOutput.includes('permission denied') || errOutput.includes('dial unix')) {
        throw new DockerPermissionDeniedError(infoRes.stderr || infoRes.stdout);
      }
      throw new DockerDaemonNotRunningError(infoRes.stderr || infoRes.stdout);
    }

    await this.composeAdapter.getComposeCommand();
  }

  /**
   * Inspects current state of the production container.
   */
  async getContainerState(containerName?: string): Promise<ContainerState> {
    const name = containerName || this.resolveConfig().containerName;
    const inspectRes = await this.runner.exec('docker', [
      'inspect',
      '--format',
      '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.Config.Image}}|{{.Id}}|{{.State.StartedAt}}',
      name,
    ]);

    if (inspectRes.exitCode !== 0 || !inspectRes.stdout.trim()) {
      return {
        exists: false,
        running: false,
        status: 'missing',
      };
    }

    const [statusStr, healthStr, imageStr, idStr, startedAtStr] = inspectRes.stdout.trim().split('|');
    const running = statusStr === 'running';

    let uptime: string | undefined;
    if (startedAtStr && startedAtStr !== '0001-01-01T00:00:00Z') {
      const startTime = new Date(startedAtStr).getTime();
      if (!isNaN(startTime)) {
        const diffSec = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
        const mins = Math.floor(diffSec / 60);
        const secs = diffSec % 60;
        uptime = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      }
    }

    return {
      exists: true,
      running,
      status: running ? 'running' : 'stopped',
      health: healthStr !== 'none' ? healthStr : undefined,
      image: imageStr,
      containerId: idStr ? idStr.substring(0, 12) : undefined,
      uptime,
    };
  }

  /**
   * Verifies whether host port 3000 is occupied by a foreign process.
   */
  async checkPortAvailability(port: number, containerName: string): Promise<void> {
    const portOpen = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(1000);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true); // Port is occupied
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, '127.0.0.1');
    });

    if (portOpen) {
      const state = await this.getContainerState(containerName);
      if (!state.running) {
        throw new PortConflictError(port);
      }
    }
  }

  /**
   * Ensures the target Docker image is present locally, pulling if missing.
   */
  async ensureImage(imageTag: string): Promise<void> {
    const inspectRes = await this.runner.exec('docker', ['image', 'inspect', imageTag]);
    if (inspectRes.exitCode === 0) {
      log.debug('Image is already available locally', { imageTag });
      return;
    }

    log.info('Pulling Docker image from registry...', { imageTag });
    const pullRes = await this.runner.exec('docker', ['pull', imageTag], { timeout: 300000 });
    if (pullRes.exitCode !== 0) {
      throw new ImagePullError(imageTag, pullRes.stderr || pullRes.stdout);
    }
  }

  /**
   * Probes the Gateway health endpoint directly on 127.0.0.1:3000.
   */
  async probeGatewayHealth(): Promise<{ healthy: boolean; data?: DeepHealthResponse; error?: string }> {
    try {
      const res = await axios.get(this.healthUrl, { timeout: 2000 });
      if (res.status === 200 && res.data) {
        const d = res.data as DeepHealthResponse;
        const deps = d.dependencies || {};
        const allDepsHealthy =
          deps.gateway?.status === 'healthy' &&
          deps.metadataService?.status === 'healthy' &&
          deps.redis?.status === 'healthy' &&
          deps.orchestrator?.status === 'healthy';

        return {
          healthy: allDepsHealthy,
          data: d,
        };
      }
      return { healthy: false, error: `HTTP ${res.status}` };
    } catch (err: any) {
      return { healthy: false, error: err.message || 'Connection refused' };
    }
  }

  /**
   * Polls Gateway readiness endpoint until all internal dependencies are healthy.
   */
  async waitForReady(
    timeoutMs = 45000,
    intervalMs = 1000,
    onProgress?: (msg: string) => void
  ): Promise<DeepHealthResponse> {
    const startTime = Date.now();
    let attempt = 0;

    while (Date.now() - startTime < timeoutMs) {
      attempt++;
      const probe = await this.probeGatewayHealth();

      if (probe.healthy && probe.data) {
        return probe.data;
      }

      if (onProgress) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        onProgress(`Waiting for services to become healthy (${elapsed}s elapsed)...`);
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new InfrastructureTimeoutError(
      [
        {
          name: 'All-in-One Container (db-backup)',
          serviceKey: 'db-backup',
          port: 3000,
          status: 'unhealthy',
          error: 'Readiness check timed out waiting for Gateway & internal microservices',
        },
      ],
      Math.round(timeoutMs / 1000)
    );
  }

  /**
   * Starts the production deployment reliably:
   * - Reuses container if already running
   * - Starts container if stopped
   * - Creates container via Compose if missing
   * - Awaits deep health readiness
   */
  async start(options: {
    timeoutMs?: number;
    onProgress?: (msg: string) => void;
  } = {}): Promise<{
    state: ContainerState;
    alreadyRunning: boolean;
    health: DeepHealthResponse;
  }> {
    await this.checkPrerequisites();
    const cfg = this.resolveConfig();

    const state = await this.getContainerState(cfg.containerName);

    // Case 1: Container already running
    if (state.running) {
      const probe = await this.probeGatewayHealth();
      if (probe.healthy && probe.data) {
        return {
          state,
          alreadyRunning: true,
          health: probe.data,
        };
      }
      // Running but still initializing, wait for readiness
      if (options.onProgress) options.onProgress('Container is running, awaiting readiness...');
      const health = await this.waitForReady(options.timeoutMs, 1000, options.onProgress);
      return {
        state,
        alreadyRunning: true,
        health,
      };
    }

    // Check port 3000 availability
    await this.checkPortAvailability(cfg.hostPort, cfg.containerName);

    // Case 2: Container exists but stopped -> start it
    if (state.exists && !state.running) {
      if (options.onProgress) options.onProgress(`Starting existing container "${cfg.containerName}"...`);
      const startRes = await this.runner.exec('docker', ['start', cfg.containerName]);
      if (startRes.exitCode !== 0) {
        throw new Error(`Failed to start container ${cfg.containerName}: ${startRes.stderr || startRes.stdout}`);
      }
    } else {
      // Case 3: Container does not exist -> create via Compose
      await this.ensureImage(cfg.imageTag);

      if (options.onProgress) options.onProgress('Launching production container...');
      const [cmd, ...baseArgs] = await this.composeAdapter.getComposeCommand();

      const prefix = cfg.imageRepository.includes('/') ? `${cfg.imageRepository.split('/')[0]}/` : '';
      const composeRes = await this.runner.exec(
        cmd,
        [...baseArgs, '-f', cfg.composeFile, 'up', '-d', 'db-backup'],
        {
          env: {
            ...process.env,
            IMAGE: cfg.imageTag,
            IMAGE_PREFIX: prefix,
            VERSION: cfg.imageVersion,
            PORT: String(cfg.hostPort),
            BACKUP_DIR: cfg.backupDir,
          },
        }
      );

      if (composeRes.exitCode !== 0) {
        throw new Error(`Failed to create container via Compose: ${composeRes.stderr || composeRes.stdout}`);
      }
    }

    // Wait for deep health
    if (options.onProgress) options.onProgress('Awaiting service health...');
    const health = await this.waitForReady(options.timeoutMs, 1000, options.onProgress);
    const finalState = await this.getContainerState(cfg.containerName);

    return {
      state: finalState,
      alreadyRunning: false,
      health,
    };
  }

  /**
   * Gracefully stops the production container without deleting user volumes or data.
   */
  async stop(): Promise<{
    stopped: boolean;
    wasRunning: boolean;
    message: string;
  }> {
    await this.checkPrerequisites();
    const cfg = this.resolveConfig();
    const state = await this.getContainerState(cfg.containerName);

    if (!state.exists) {
      return {
        stopped: false,
        wasRunning: false,
        message: `Container "${cfg.containerName}" does not exist.`,
      };
    }

    if (!state.running) {
      return {
        stopped: false,
        wasRunning: false,
        message: `Container "${cfg.containerName}" is already stopped.`,
      };
    }

    const stopRes = await this.runner.exec('docker', ['stop', cfg.containerName], { timeout: 30000 });
    if (stopRes.exitCode !== 0) {
      throw new Error(`Failed to stop container "${cfg.containerName}": ${stopRes.stderr || stopRes.stdout}`);
    }

    return {
      stopped: true,
      wasRunning: true,
      message: `Container "${cfg.containerName}" stopped successfully. User data and volumes preserved.`,
    };
  }

  /**
   * Restarts the production container and verifies health.
   */
  async restart(options: {
    timeoutMs?: number;
    onProgress?: (msg: string) => void;
  } = {}): Promise<{
    state: ContainerState;
    health: DeepHealthResponse;
  }> {
    await this.checkPrerequisites();
    const cfg = this.resolveConfig();
    const state = await this.getContainerState(cfg.containerName);

    if (state.running) {
      if (options.onProgress) options.onProgress(`Restarting container "${cfg.containerName}"...`);
      const restartRes = await this.runner.exec('docker', ['restart', cfg.containerName], { timeout: 30000 });
      if (restartRes.exitCode !== 0) {
        throw new Error(`Failed to restart container "${cfg.containerName}": ${restartRes.stderr || restartRes.stdout}`);
      }
    } else {
      await this.start(options);
    }

    if (options.onProgress) options.onProgress('Awaiting service health...');
    const health = await this.waitForReady(options.timeoutMs, 1000, options.onProgress);
    const finalState = await this.getContainerState(cfg.containerName);

    return {
      state: finalState,
      health,
    };
  }

  /**
   * Returns complete runtime status for CLI display and diagnostics.
   */
  async status(): Promise<DetailedRuntimeStatus> {
    const cfg = this.resolveConfig();
    let dockerAvailable = false;
    let daemonRunning = false;

    try {
      const vRes = await this.runner.exec('docker', ['--version']);
      dockerAvailable = vRes.exitCode === 0;
      if (dockerAvailable) {
        const infoRes = await this.runner.exec('docker', ['info', '--format', '{{.ServerVersion}}']);
        daemonRunning = infoRes.exitCode === 0;
      }
    } catch {
      // ignore
    }

    const containerState = await this.getContainerState(cfg.containerName);
    let gatewayHealthy = false;
    let healthDetails: DeepHealthResponse | undefined;

    if (containerState.running) {
      const probe = await this.probeGatewayHealth();
      gatewayHealthy = probe.healthy;
      healthDetails = probe.data;
    }

    return {
      dockerAvailable,
      daemonRunning,
      container: containerState,
      config: cfg,
      gatewayHealthy,
      healthDetails,
    };
  }

  /**
   * Streams or prints logs from the production container.
   */
  async logs(options: { follow?: boolean; tail?: number } = {}): Promise<void> {
    await this.checkPrerequisites();
    const cfg = this.resolveConfig();
    const state = await this.getContainerState(cfg.containerName);

    if (!state.exists) {
      throw new Error(`Container "${cfg.containerName}" does not exist. Run "dbvault start" first.`);
    }

    const args = ['logs'];
    if (options.tail) {
      args.push('--tail', String(options.tail));
    }
    if (options.follow) {
      args.push('-f');
    }
    args.push(cfg.containerName);

    if (options.follow) {
      const child = spawn('docker', args, { stdio: 'inherit' });
      await new Promise<void>((resolve, reject) => {
        child.on('close', (code) => {
          if (code === 0 || code === 130) resolve();
          else reject(new Error(`docker logs exited with code ${code}`));
        });
        child.on('error', reject);
      });
    } else {
      const res = await this.runner.exec('docker', args);
      if (res.stdout) console.log(res.stdout);
      if (res.stderr) console.error(res.stderr);
    }
  }
}

export const dockerRuntime = new DockerRuntime();
export default dockerRuntime;
