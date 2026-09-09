import { spawn } from 'child_process';
import {
  IDatabaseAdapter,
  DatabaseBackupOptions,
  DatabaseBackupResult,
  DatabaseRestoreOptions,
  DatabaseRestoreResult,
} from '../../../domain/interfaces/database-adapter.interface';
import { DatabaseConfigModel, ConnectionTestResult } from '../../../domain/models';

export abstract class BaseDatabaseAdapter implements IDatabaseAdapter {
  abstract readonly supportedTypes: string[];

  abstract testConnection(config: DatabaseConfigModel): Promise<ConnectionTestResult>;
  abstract backup(config: DatabaseConfigModel, options: DatabaseBackupOptions): Promise<DatabaseBackupResult>;
  abstract restore(options: DatabaseRestoreOptions): Promise<DatabaseRestoreResult>;

  protected executeCommand(cmd: string, args: string[], envOverrides: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        shell: false,
        env: { ...process.env, ...envOverrides },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr, code: code || 0 });
        } else {
          reject(new Error(`Command ${cmd} exited with code ${code}: ${stderr || stdout}`));
        }
      });

      proc.on('error', (err) => reject(err));
    });
  }
}
