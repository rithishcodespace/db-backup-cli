import net from 'net';
import axios from 'axios';
import chalk from 'chalk';
import ora from 'ora';

type Spinner = ReturnType<typeof ora>;

import {
  EngineType,
  ServiceHealth,
  InfrastructureStatus,
  EnsureInfrastructureOptions,
  InfrastructureTimeoutError,
  InvalidEngineError,
} from './types';
import { DockerComposeAdapter, dockerComposeAdapter } from './docker-compose.adapter';
import { LocalAdapter, localAdapter } from './local.adapter';
import { createModuleLogger } from '../logger';
import { config } from '../config';

const log = createModuleLogger('infrastructure-manager');

export interface ServiceDefinition {
  name: string;
  serviceKey: string;
  port: number;
  healthUrl?: string;
  isHttp?: boolean;
}

export const KNOWN_SERVICES: Record<string, ServiceDefinition> = {
  redis: {
    name: 'Redis',
    serviceKey: 'redis',
    port: 6379,
    isHttp: false,
  },
  'api-gateway': {
    name: 'API Gateway',
    serviceKey: 'api-gateway',
    port: 3000,
    healthUrl: 'http://localhost:3000/health',
    isHttp: true,
  },
  'backup-orchestrator': {
    name: 'Backup Orchestrator',
    serviceKey: 'backup-orchestrator',
    port: 3001,
    healthUrl: 'http://localhost:3001/health',
    isHttp: true,
  },
  'postgres-backup': {
    name: 'PostgreSQL Worker',
    serviceKey: 'postgres-backup',
    port: 3010,
    healthUrl: 'http://localhost:3010/health',
    isHttp: true,
  },
  'mysql-backup': {
    name: 'MySQL Worker',
    serviceKey: 'mysql-backup',
    port: 3011,
    healthUrl: 'http://localhost:3011/health',
    isHttp: true,
  },
  'mongodb-backup': {
    name: 'MongoDB Worker',
    serviceKey: 'mongodb-backup',
    port: 3012,
    healthUrl: 'http://localhost:3012/health',
    isHttp: true,
  },
  'sqlite-backup': {
    name: 'SQLite Worker',
    serviceKey: 'sqlite-backup',
    port: 3013,
    healthUrl: 'http://localhost:3013/health',
    isHttp: true,
  },
};

export class InfrastructureManager {
  private activeStartupPromise: Promise<void> | null = null;

  constructor(
    private readonly dockerAdapter: DockerComposeAdapter = dockerComposeAdapter,
    private readonly localRunner: LocalAdapter = localAdapter,
    private readonly healthProber?: (svc: ServiceDefinition) => Promise<ServiceHealth>
  ) {}

  /**
   * Resolves the configured execution engine.
   * Priority: process.env.ENGINE -> config.get('engine') -> 'docker'
   */
  getEngine(): EngineType {
    const rawEngine = (process.env.ENGINE || config.get('engine') || 'docker').toLowerCase().trim();

    if (rawEngine === 'docker') {
      return 'docker';
    }
    if (rawEngine === 'local') {
      return 'local';
    }

    throw new InvalidEngineError(rawEngine);
  }

  /**
   * Maps a database type (or explicit list) to the required Compose service keys.
   */
  resolveRequiredServiceKeys(options: EnsureInfrastructureOptions = {}): string[] {
    if (options.requiredServices && options.requiredServices.length > 0) {
      return options.requiredServices;
    }

    // Default core dependencies
    const services = ['redis', 'api-gateway', 'backup-orchestrator'];

    const dbType = options.dbType?.toLowerCase().trim();
    if (dbType) {
      switch (dbType) {
        case 'postgresql':
        case 'postgres':
          services.push('postgres-backup');
          break;
        case 'mysql':
        case 'mariadb':
          services.push('mysql-backup');
          break;
        case 'mongodb':
        case 'mongo':
          services.push('mongodb-backup');
          break;
        case 'sqlite':
          services.push('sqlite-backup');
          break;
      }
    }

    return services;
  }

  /**
   * Probes health of a single service via TCP socket (Redis) or HTTP GET.
   */
  async checkServiceHealth(svc: ServiceDefinition): Promise<ServiceHealth> {
    if (this.healthProber) {
      return this.healthProber(svc);
    }

    const start = Date.now();

    // Check through API Gateway deep health endpoint if running
    try {
      const res = await axios.get('http://127.0.0.1:3000/health', { timeout: 1500 });
      if (res.status === 200 && res.data) {
        const deps = res.data.dependencies || {};
        let isHealthy = false;

        if (svc.serviceKey === 'api-gateway') {
          isHealthy = deps.gateway?.status === 'healthy' || res.data.status === 'healthy';
        } else if (svc.serviceKey === 'redis') {
          isHealthy = deps.redis?.status === 'healthy';
        } else if (svc.serviceKey === 'backup-orchestrator') {
          isHealthy = deps.orchestrator?.status === 'healthy';
        } else if (svc.serviceKey === 'metadata-service') {
          isHealthy = deps.metadataService?.status === 'healthy';
        } else {
          // Database services supervised under PM2 within all-in-one container
          isHealthy = deps.orchestrator?.status === 'healthy';
        }

        if (isHealthy) {
          return {
            name: svc.name,
            serviceKey: svc.serviceKey,
            port: svc.port,
            status: 'healthy',
            responseTimeMs: Date.now() - start,
            details: res.data,
          };
        }
      }
    } catch {
      // Gateway unreachable, fall back to direct local probe below
    }

    if (!svc.isHttp) {
      // TCP probe for local standalone Redis
      return new Promise<ServiceHealth>((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(1500);

        socket.on('connect', () => {
          socket.destroy();
          resolve({
            name: svc.name,
            serviceKey: svc.serviceKey,
            port: svc.port,
            status: 'healthy',
            responseTimeMs: Date.now() - start,
          });
        });

        socket.on('timeout', () => {
          socket.destroy();
          resolve({
            name: svc.name,
            serviceKey: svc.serviceKey,
            port: svc.port,
            status: 'unhealthy',
            error: 'Connection timed out',
            responseTimeMs: Date.now() - start,
          });
        });

        socket.on('error', (err) => {
          socket.destroy();
          resolve({
            name: svc.name,
            serviceKey: svc.serviceKey,
            port: svc.port,
            status: 'unhealthy',
            error: err.message,
            responseTimeMs: Date.now() - start,
          });
        });

        socket.connect(svc.port, '127.0.0.1');
      });
    }

    // HTTP probe for local microservices
    try {
      const res = await axios.get(svc.healthUrl!, { timeout: 1500 });
      const isHealthy = res.status === 200 && (res.data?.status === 'healthy' || !res.data?.status);
      return {
        name: svc.name,
        serviceKey: svc.serviceKey,
        port: svc.port,
        url: svc.healthUrl,
        status: isHealthy ? 'healthy' : 'unhealthy',
        responseTimeMs: Date.now() - start,
        details: res.data,
      };
    } catch (err: any) {
      return {
        name: svc.name,
        serviceKey: svc.serviceKey,
        port: svc.port,
        url: svc.healthUrl,
        status: 'unhealthy',
        error: err.message || 'Connection refused',
        responseTimeMs: Date.now() - start,
      };
    }
  }

  /**
   * Fast probe across an array of service keys.
   */
  async checkServices(serviceKeys: string[]): Promise<ServiceHealth[]> {
    const promises = serviceKeys.map((key) => {
      const def = KNOWN_SERVICES[key] || {
        name: key,
        serviceKey: key,
        port: 0,
        isHttp: false,
      };
      return this.checkServiceHealth(def);
    });

    return Promise.all(promises);
  }

  /**
   * Ensure infrastructure is running and ready for the requested operation.
   * Fully idempotent: returns in <20ms if services are already healthy.
   */
  async ensureInfrastructure(options: EnsureInfrastructureOptions = {}): Promise<void> {
    // In-process concurrency protection
    if (this.activeStartupPromise) {
      log.debug('Awaiting concurrent infrastructure startup');
      return this.activeStartupPromise;
    }

    this.activeStartupPromise = this.performEnsureInfrastructure(options);
    try {
      await this.activeStartupPromise;
    } finally {
      this.activeStartupPromise = null;
    }
  }

  private async performEnsureInfrastructure(options: EnsureInfrastructureOptions): Promise<void> {
    const engine = this.getEngine();
    const requiredKeys = this.resolveRequiredServiceKeys(options);
    const timeoutMs = options.timeoutMs ?? parseInt(process.env.INFRA_STARTUP_TIMEOUT || '45000', 10);
    const silent = options.silent ?? false;

    log.debug('Checking infrastructure', { engine, requiredKeys });

    // Step 1: Idempotency Check
    const initialHealth = await this.checkServices(requiredKeys);
    const allHealthy = initialHealth.every((s) => s.status === 'healthy');

    if (allHealthy) {
      log.debug('Required infrastructure is already running and healthy');
      return;
    }

    // Step 2: Start / Reconcile Infrastructure
    let spinner: Spinner | null = null;
    if (!silent) {
      spinner = ora('Checking and starting backup infrastructure...').start();
    }

    try {
      if (engine === 'docker') {
        const { dockerRuntime } = await import('./docker-runtime');
        await dockerRuntime.start({
          timeoutMs,
          onProgress: (msg) => {
            if (spinner) spinner.text = msg;
          },
        });
      } else {
        if (spinner) spinner.text = 'Starting local microservices...';
        await this.localRunner.start();

        // Step 3: Wait for actual service readiness
        if (spinner) spinner.text = 'Waiting for services to become ready...';
        await this.waitForReady(requiredKeys, timeoutMs, 1000, spinner);
      }

      if (spinner) {
        spinner.succeed(chalk.green('Infrastructure ready'));
      }
    } catch (err: any) {
      if (spinner) {
        spinner.fail(chalk.red('Infrastructure preparation failed'));
      }
      log.error('Infrastructure startup failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Polls required services until all are healthy or timeout expires.
   */
  async waitForReady(
    serviceKeys: string[],
    timeoutMs = 45000,
    intervalMs = 1000,
    spinner?: Spinner | null
  ): Promise<ServiceHealth[]> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const results = await this.checkServices(serviceKeys);
      const ready = results.every((s) => s.status === 'healthy');

      if (ready) {
        return results;
      }

      if (spinner) {
        const readyCount = results.filter((s) => s.status === 'healthy').length;
        spinner.text = `Waiting for services... (${readyCount}/${serviceKeys.length} ready)`;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    // Timeout exceeded: diagnose which services failed
    const finalResults = await this.checkServices(serviceKeys);
    const failed = finalResults.filter((s) => s.status !== 'healthy');

    throw new InfrastructureTimeoutError(failed, Math.round(timeoutMs / 1000));
  }

  /**
   * Returns comprehensive infrastructure status.
   * Does not start or modify infrastructure.
   */
  async status(): Promise<InfrastructureStatus> {
    const engine = this.getEngine();
    const backupDir = this.dockerAdapter.getBackupDirectory();

    let dockerAvailable = false;
    let daemonRunning = false;
    let composeAvailable = false;
    let composeVersion: string | undefined;
    let composeFile: string | undefined;

    try {
      composeFile = this.dockerAdapter.resolveComposeFilePath();
    } catch {
      // Ignore if file missing
    }

    if (engine === 'docker') {
      try {
        dockerAvailable = await this.dockerAdapter.isDockerInstalled();
        if (dockerAvailable) {
          daemonRunning = await this.dockerAdapter.isDockerDaemonRunning();
          const cmd = await this.dockerAdapter.getComposeCommand();
          composeAvailable = true;
          composeVersion = cmd.join(' ');
        }
      } catch {
        // Handled gracefully in status object
      }
    }

    // Check all known microservices
    const serviceKeys = Object.keys(KNOWN_SERVICES);
    const services = await this.checkServices(serviceKeys);

    const running = services.some((s) => s.status === 'healthy');
    const healthy = services.every((s) => s.status === 'healthy');

    return {
      engine,
      dockerAvailable,
      daemonRunning,
      composeAvailable,
      composeVersion,
      composeFile,
      backupDir,
      running,
      healthy,
      services,
    };
  }

  /**
   * Explicitly starts the infrastructure.
   */
  async start(services?: string[]): Promise<void> {
    const engine = this.getEngine();
    if (engine === 'docker') {
      await this.dockerAdapter.up(services);
      await this.waitForReady(services || Object.keys(KNOWN_SERVICES));
    } else {
      await this.localRunner.start();
      await this.waitForReady(services || Object.keys(KNOWN_SERVICES));
    }
  }

  /**
   * Explicitly stops the infrastructure safely.
   * Never removes containers or backup volumes.
   */
  async stop(services?: string[]): Promise<void> {
    const engine = this.getEngine();
    if (engine === 'docker') {
      await this.dockerAdapter.stop(services);
    } else {
      await this.localRunner.stop();
    }
  }

  /**
   * Explicitly restarts the infrastructure.
   */
  async restart(services?: string[]): Promise<void> {
    const engine = this.getEngine();
    if (engine === 'docker') {
      await this.dockerAdapter.restart(services);
      await this.waitForReady(services || Object.keys(KNOWN_SERVICES));
    } else {
      await this.localRunner.stop();
      await this.localRunner.start();
      await this.waitForReady(services || Object.keys(KNOWN_SERVICES));
    }
  }
}

export const infrastructureManager = new InfrastructureManager();
