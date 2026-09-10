export type EngineType = 'docker' | 'local';

export type ServiceHealthStatus = 'healthy' | 'unhealthy' | 'starting' | 'stopped';

export interface ServiceHealth {
  name: string;
  serviceKey: string;
  port?: number;
  url?: string;
  status: ServiceHealthStatus;
  error?: string;
  responseTimeMs?: number;
  details?: any;
}

export interface InfrastructureStatus {
  engine: EngineType;
  dockerAvailable: boolean;
  daemonRunning: boolean;
  composeAvailable: boolean;
  composeVersion?: string;
  composeFile?: string;
  backupDir: string;
  running: boolean;
  healthy: boolean;
  services: ServiceHealth[];
  message?: string;
}

export interface EnsureInfrastructureOptions {
  dbType?: string;
  requiredServices?: string[];
  timeoutMs?: number;
  silent?: boolean;
}

export interface ProcessRunnerOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
  maxBuffer?: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface IProcessRunner {
  exec(command: string, args: string[], options?: ProcessRunnerOptions): Promise<ExecResult>;
}

// ==================== Custom Typed Errors ====================

export class InfrastructureError extends Error {
  constructor(message: string, public readonly code: string, public readonly action?: string) {
    super(message);
    this.name = 'InfrastructureError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DockerNotInstalledError extends InfrastructureError {
  constructor(message = 'Docker is not installed on this system.') {
    const installUrl = process.platform === 'win32'
      ? 'https://docs.docker.com/desktop/setup/install/windows-install/'
      : process.platform === 'darwin'
        ? 'https://docs.docker.com/desktop/setup/install/mac-install/'
        : 'https://docs.docker.com/get-docker/';
    super(
      `${message}\nPlease install Docker from ${installUrl}`,
      'DOCKER_NOT_INSTALLED',
      'Install Docker'
    );
    this.name = 'DockerNotInstalledError';
  }
}

export class DockerDaemonNotRunningError extends InfrastructureError {
  constructor(message = 'Docker is installed, but the Docker daemon is not running.') {
    const startHint = process.platform === 'win32' || process.platform === 'darwin'
      ? 'Please start Docker Desktop and retry.'
      : "Please start Docker Desktop or the Docker system service (e.g., 'sudo systemctl start docker') and retry.";
    super(
      `${message}\n${startHint}`,
      'DOCKER_DAEMON_NOT_RUNNING',
      'Start Docker service'
    );
    this.name = 'DockerDaemonNotRunningError';
  }
}

export class DockerComposeUnavailableError extends InfrastructureError {
  constructor(message = 'Docker Compose is unavailable.') {
    super(
      `${message}\nPlease install or enable the Docker Compose plugin (e.g., 'docker compose') and retry.`,
      'DOCKER_COMPOSE_UNAVAILABLE',
      'Install Docker Compose'
    );
    this.name = 'DockerComposeUnavailableError';
  }
}

export class ComposeFileNotFoundError extends InfrastructureError {
  constructor(searchedPath: string) {
    super(
      `Docker Compose file could not be located.\nSearched location: ${searchedPath}\nPlease reinstall the package or verify the repository structure.`,
      'COMPOSE_FILE_NOT_FOUND',
      'Reinstall db-backup-cli or verify docker-compose.yaml'
    );
    this.name = 'ComposeFileNotFoundError';
  }
}

export class InfrastructureTimeoutError extends InfrastructureError {
  constructor(
    public readonly failedServices: ServiceHealth[],
    timeoutSeconds: number
  ) {
    const list = failedServices
      .map((s) => `  ✗ ${s.name}${s.port ? ` (port ${s.port})` : ''}: ${s.error || 'Unresponsive'}`)
      .join('\n');
    super(
      `Infrastructure startup timed out after ${timeoutSeconds}s.\n\nFailing service(s):\n${list}\n\nTroubleshooting:\n  Inspect service logs: docker compose logs <service-name>`,
      'INFRASTRUCTURE_TIMEOUT',
      'Check docker compose logs'
    );
    this.name = 'InfrastructureTimeoutError';
  }
}

export class InvalidEngineError extends InfrastructureError {
  constructor(engine: string) {
    super(
      `Invalid execution engine: "${engine}".\n\nSupported engines:\n  • docker (default)\n  • local`,
      'INVALID_ENGINE',
      'Set ENGINE=docker or ENGINE=local'
    );
    this.name = 'InvalidEngineError';
  }
}

export class DockerPermissionDeniedError extends InfrastructureError {
  constructor(details = '') {
    super(
      `Docker permission denied.\n${details}\nPlease ensure your user has permissions to access the Docker daemon socket (e.g. add user to 'docker' group: 'sudo usermod -aG docker $USER').`,
      'DOCKER_PERMISSION_DENIED',
      'Add user to docker group or check docker socket permissions'
    );
    this.name = 'DockerPermissionDeniedError';
  }
}

export class PortConflictError extends InfrastructureError {
  constructor(port: number, occupant?: string) {
    const occStr = occupant ? ` (occupied by: ${occupant})` : '';
    super(
      `Host port ${port} is already in use by another process${occStr}.\nPlease stop the conflicting process or configure a different port using DB_BACKUP_PORT.`,
      'PORT_CONFLICT',
      `Free port ${port} or configure DB_BACKUP_PORT`
    );
    this.name = 'PortConflictError';
  }
}

export class ImagePullError extends InfrastructureError {
  constructor(image: string, reason?: string) {
    super(
      `Unable to obtain DB Backup image: "${image}".\n${reason ? `Reason: ${reason}\n` : ''}\nTroubleshooting:\n  • Check internet connectivity\n  • Verify Docker registry authentication (docker login)\n  • Verify the configured image and version\n  • You can build the image locally via: docker build -t ${image} .`,
      'IMAGE_PULL_FAILED',
      'Check network/registry or build image locally'
    );
    this.name = 'ImagePullError';
  }
}

export interface ContainerState {
  exists: boolean;
  running: boolean;
  status: 'running' | 'stopped' | 'missing' | 'unknown';
  health?: string;
  image?: string;
  containerId?: string;
  ports?: string;
  uptime?: string;
}

export interface DockerRuntimeConfig {
  imageRepository: string;
  imageVersion: string;
  imageTag: string;
  containerName: string;
  hostPort: number;
  composeFile: string;
  backupDir: string;
}

