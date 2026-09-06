import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  IProcessRunner,
  DockerNotInstalledError,
  DockerDaemonNotRunningError,
  DockerComposeUnavailableError,
  ComposeFileNotFoundError,
} from './types';
import { defaultProcessRunner } from './process-runner';

export class DockerComposeAdapter {
  private composeCommand: string[] | null = null;
  private cachedComposeFilePath: string | null = null;

  constructor(private readonly runner: IProcessRunner = defaultProcessRunner) {}

  /**
   * Resolves the host backup directory portably across Linux, macOS, and Windows.
   * Ensures the directory exists.
   */
  getBackupDirectory(): string {
    const backupDir = path.join(os.homedir(), '.db-backup');
    if (!fs.existsSync(backupDir)) {
      try {
        fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      } catch {
        // Fallback if permission issues in home
      }
    }
    return backupDir;
  }

  /**
   * Resolves the packaged docker-compose.yaml relative to package root.
   * Works in development, built dist/, and globally installed npm package.
   */
  resolveComposeFilePath(customPath?: string): string {
    if (customPath) {
      if (fs.existsSync(customPath)) {
        this.cachedComposeFilePath = path.resolve(customPath);
        return this.cachedComposeFilePath;
      }
      throw new ComposeFileNotFoundError(customPath);
    }

    if (this.cachedComposeFilePath && fs.existsSync(this.cachedComposeFilePath)) {
      return this.cachedComposeFilePath;
    }

    // Traverse upward from __dirname to find the package root containing docker-compose.yaml
    let currentDir = __dirname;
    const root = path.parse(currentDir).root;

    while (currentDir !== root) {
      const candidateYaml = path.join(currentDir, 'docker-compose.yaml');
      if (fs.existsSync(candidateYaml)) {
        this.cachedComposeFilePath = candidateYaml;
        return candidateYaml;
      }

      const candidateYml = path.join(currentDir, 'docker-compose.yml');
      if (fs.existsSync(candidateYml)) {
        this.cachedComposeFilePath = candidateYml;
        return candidateYml;
      }

      currentDir = path.dirname(currentDir);
    }

    // Check cwd
    const cwdCandidate = path.join(process.cwd(), 'docker-compose.yaml');
    if (fs.existsSync(cwdCandidate)) {
      this.cachedComposeFilePath = cwdCandidate;
      return cwdCandidate;
    }

    throw new ComposeFileNotFoundError(path.join(__dirname, 'docker-compose.yaml'));
  }

  /**
   * Check whether Docker CLI binary is installed.
   */
  async isDockerInstalled(): Promise<boolean> {
    const result = await this.runner.exec('docker', ['--version']);
    return result.exitCode === 0;
  }

  /**
   * Check whether Docker daemon is active and responsive.
   */
  async isDockerDaemonRunning(): Promise<boolean> {
    const result = await this.runner.exec('docker', ['info', '--format', '{{.ServerVersion}}']);
    return result.exitCode === 0;
  }

  /**
   * Detect whether 'docker compose' (v2) or 'docker-compose' (v1) is available.
   */
  async getComposeCommand(): Promise<string[]> {
    if (this.composeCommand) {
      return this.composeCommand;
    }

    // Try Docker Compose V2 first ('docker compose')
    const v2Result = await this.runner.exec('docker', ['compose', 'version']);
    if (v2Result.exitCode === 0) {
      this.composeCommand = ['docker', 'compose'];
      return this.composeCommand;
    }

    // Try standalone Docker Compose V1 ('docker-compose')
    const v1Result = await this.runner.exec('docker-compose', ['version']);
    if (v1Result.exitCode === 0) {
      this.composeCommand = ['docker-compose'];
      return this.composeCommand;
    }

    throw new DockerComposeUnavailableError();
  }

  /**
   * Validates all Docker prerequisites before attempting operations.
   */
  async validatePrerequisites(): Promise<void> {
    const installed = await this.isDockerInstalled();
    if (!installed) {
      throw new DockerNotInstalledError();
    }

    const running = await this.isDockerDaemonRunning();
    if (!running) {
      throw new DockerDaemonNotRunningError();
    }

    await this.getComposeCommand();
  }

  /**
   * Executes a Docker Compose command safely with shell: false.
   */
  async runCompose(args: string[], options: { composeFile?: string; timeout?: number } = {}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const composeCmd = await this.getComposeCommand();
    const composeFile = this.resolveComposeFilePath(options.composeFile);
    const backupDir = this.getBackupDirectory();

    const [cmd, ...baseArgs] = composeCmd;
    const finalArgs = [...baseArgs, '-f', composeFile, ...args];

    return this.runner.exec(cmd, finalArgs, {
      env: {
        BACKUP_DIR: backupDir,
      },
      timeout: options.timeout ?? 180000, // 3 mins for pulls/builds
    });
  }

  /**
   * Starts Docker Compose services in detached mode.
   */
  async up(services: string[] = [], options: { composeFile?: string } = {}): Promise<void> {
    await this.validatePrerequisites();

    const args = ['up', '-d', ...services];
    const result = await this.runCompose(args, options);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to start Docker services: ${result.stderr || result.stdout}`);
    }
  }

  /**
   * Pulls prebuilt images if missing.
   */
  async pull(services: string[] = [], options: { composeFile?: string } = {}): Promise<void> {
    await this.validatePrerequisites();

    const args = ['pull', ...services];
    await this.runCompose(args, options);
  }

  /**
   * Stops running containers safely without deleting volumes or containers.
   */
  async stop(services: string[] = [], options: { composeFile?: string } = {}): Promise<void> {
    await this.validatePrerequisites();

    const args = ['stop', ...services];
    const result = await this.runCompose(args, options);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to stop Docker services: ${result.stderr || result.stdout}`);
    }
  }

  /**
   * Restarts specific services.
   */
  async restart(services: string[] = [], options: { composeFile?: string } = {}): Promise<void> {
    await this.validatePrerequisites();

    const args = ['restart', ...services];
    const result = await this.runCompose(args, options);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to restart Docker services: ${result.stderr || result.stdout}`);
    }
  }

  /**
   * Queries status of containers in the Compose stack.
   */
  async ps(options: { composeFile?: string } = {}): Promise<string> {
    const result = await this.runCompose(['ps'], options);
    return result.stdout;
  }
}

export const dockerComposeAdapter = new DockerComposeAdapter();
