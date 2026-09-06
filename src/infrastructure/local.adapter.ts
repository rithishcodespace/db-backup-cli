import fs from 'fs';
import path from 'path';
import { IProcessRunner } from './types';
import { defaultProcessRunner } from './process-runner';

export class LocalAdapter {
  constructor(private readonly runner: IProcessRunner = defaultProcessRunner) {}

  private resolveEcosystemPath(): string {
    let currentDir = __dirname;
    const root = path.parse(currentDir).root;

    while (currentDir !== root) {
      const candidate = path.join(currentDir, 'ecosystem.config.js');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      currentDir = path.dirname(currentDir);
    }

    const cwdCandidate = path.join(process.cwd(), 'ecosystem.config.js');
    if (fs.existsSync(cwdCandidate)) {
      return cwdCandidate;
    }

    return path.resolve(__dirname, '../../../ecosystem.config.js');
  }

  async isPm2Available(): Promise<boolean> {
    const result = await this.runner.exec('pm2', ['--version']);
    return result.exitCode === 0;
  }

  async start(): Promise<void> {
    const pm2Available = await this.isPm2Available();
    if (!pm2Available) {
      throw new Error(
        'PM2 is required for local execution engine.\nPlease install PM2 via: npm install -g pm2'
      );
    }

    const ecosystemPath = this.resolveEcosystemPath();
    const result = await this.runner.exec('pm2', ['start', ecosystemPath]);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to start local services with PM2: ${result.stderr || result.stdout}`);
    }
  }

  async stop(): Promise<void> {
    const pm2Available = await this.isPm2Available();
    if (!pm2Available) return;

    await this.runner.exec('pm2', ['stop', 'all']);
  }

  async isRunning(): Promise<boolean> {
    const pm2Available = await this.isPm2Available();
    if (!pm2Available) return false;

    const result = await this.runner.exec('pm2', ['jlist']);
    if (result.exitCode !== 0) return false;

    try {
      const list = JSON.parse(result.stdout);
      return Array.isArray(list) && list.some((p: any) => p.pm2_env?.status === 'online');
    } catch {
      return false;
    }
  }
}

export const localAdapter = new LocalAdapter();
