import { spawn } from 'child_process';
import { IProcessRunner, ProcessRunnerOptions, ExecResult } from './types';

export class DefaultProcessRunner implements IProcessRunner {
  async exec(command: string, args: string[], options: ProcessRunnerOptions = {}): Promise<ExecResult> {
    const startTime = Date.now();
    const timeout = options.timeout ?? 120000; // 2 minutes default
    const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024; // 10MB

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // strictly shell: false for security
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: {
          ...process.env,
          ...(options.env || {}),
        },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let timeoutTimer: NodeJS.Timeout | null = null;
      if (timeout > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 3000);
        }, timeout);
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < maxBuffer) {
          stdout += chunk.toString('utf8');
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < maxBuffer) {
          stderr += chunk.toString('utf8');
        }
      });

      child.on('error', (err: any) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        const durationMs = Date.now() - startTime;
        if (err.code === 'ENOENT') {
          resolve({
            exitCode: 127,
            stdout,
            stderr: `Command not found: ${command}`,
            durationMs,
          });
          return;
        }
        reject(err);
      });

      child.on('close', (code, signal) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        const durationMs = Date.now() - startTime;

        if (timedOut) {
          resolve({
            exitCode: 124,
            stdout,
            stderr: `Process timed out after ${timeout}ms: ${command} ${args.join(' ')}`,
            durationMs,
          });
          return;
        }

        resolve({
          exitCode: code ?? (signal ? 1 : 0),
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          durationMs,
        });
      });
    });
  }
}

export const defaultProcessRunner = new DefaultProcessRunner();
