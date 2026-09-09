import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { config } from '../config';
import { metadataClient } from '../lib/metadata-client';
import { keyManager } from '../lib/key-manager';
import { testConnection } from '../utils/db_connection';
import { sanitizeErrorMessage } from '../utils/credential-scrubber';
import { infrastructureManager } from '../infrastructure';
import { createModuleLogger } from '../logger';

const log = createModuleLogger('doctor-command');

interface DiagnosticItem {
  name: string;
  status: string;
  success: boolean;
  hint?: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose environment, configuration, and runtime infrastructure health')
    .action(async () => {
      console.log(chalk.bold.cyan('\n◆ db-backup doctor\n'));

      let hasProblems = false;
      const suggestions: string[] = [];

      // ==================== 1. ENVIRONMENT ====================
      console.log(chalk.bold.white('Environment'));
      console.log(chalk.dim('─'.repeat(45)));

      const envItems: DiagnosticItem[] = [];

      // Node.js version
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.replace(/^v/, '').split('.')[0], 10);
      if (majorVersion >= 18) {
        envItems.push({
          name: 'Node.js',
          status: `${nodeVersion}`,
          success: true,
        });
      } else {
        envItems.push({
          name: 'Node.js',
          status: `${nodeVersion} (v18+ recommended)`,
          success: false,
          hint: 'Upgrade Node.js to v18 or higher.',
        });
        hasProblems = true;
        suggestions.push('Upgrade Node.js to version 18 or later.');
      }

      // Configuration
      const configPath = process.env.CONFIG_PATH || './config.json';
      let configValid = true;
      let configMessage = 'Valid';
      if (fs.existsSync(configPath)) {
        try {
          const content = fs.readFileSync(configPath, 'utf-8');
          JSON.parse(content);
          configMessage = `Valid (${configPath})`;
        } catch {
          configValid = false;
          configMessage = `Corrupted JSON (${configPath})`;
        }
      } else {
        configMessage = 'Defaults loaded';
      }

      if (configValid) {
        envItems.push({
          name: 'Configuration',
          status: configMessage,
          success: true,
        });
      } else {
        envItems.push({
          name: 'Configuration',
          status: configMessage,
          success: false,
          hint: `Fix syntax errors in ${configPath} or re-run "db-backup init".`,
        });
        hasProblems = true;
        suggestions.push(`Fix or recreate configuration file at ${configPath}.`);
      }

      // Backup directory (~/.db-backup)
      const backupDir = path.join(os.homedir(), '.db-backup');
      let backupDirOk = false;
      let backupDirStatus = '';
      try {
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
        }
        // Test write and delete
        const probeFile = path.join(backupDir, `.probe_${Date.now()}`);
        fs.writeFileSync(probeFile, 'test');
        fs.unlinkSync(probeFile);
        backupDirOk = true;
        backupDirStatus = backupDir;
      } catch (err: any) {
        backupDirOk = false;
        backupDirStatus = `Inaccessible / unwritable (${err.message})`;
      }

      if (backupDirOk) {
        envItems.push({
          name: 'Backup directory',
          status: backupDirStatus,
          success: true,
        });
      } else {
        envItems.push({
          name: 'Backup directory',
          status: backupDirStatus,
          success: false,
          hint: `Ensure write permissions for ${backupDir}`,
        });
        hasProblems = true;
        suggestions.push(`Ensure write permissions for ${backupDir}.`);
      }

      // Metadata Service health
      let dbAccessible = false;
      let dbStatus = '';
      try {
        const health = await metadataClient.health();
        dbAccessible = health.status === 'healthy';
        dbStatus = 'Accessible (Metadata Service)';
      } catch (err: any) {
        dbAccessible = false;
        dbStatus = `Inaccessible (${sanitizeErrorMessage(err.message)})`;
      }

      if (dbAccessible) {
        envItems.push({
          name: 'Metadata database',
          status: dbStatus,
          success: true,
        });
      } else {
        envItems.push({
          name: 'Metadata database',
          status: dbStatus,
          success: false,
          hint: 'Ensure metadata service is running (port 3005) or run "db-backup init".',
        });
        hasProblems = true;
        suggestions.push('Ensure metadata service is running or run "db-backup init".');
      }

      // Print Environment Items
      envItems.forEach((item) => {
        const icon = item.success ? chalk.green('✓') : chalk.red('✗');
        const text = item.success ? chalk.green(item.status) : chalk.red(item.status);
        console.log(`  ${icon} ${item.name.padEnd(22)} ${text}`);
        if (item.hint) {
          console.log(chalk.dim(`     → ${item.hint}`));
        }
      });

      // ==================== 2. INFRASTRUCTURE & ENGINE ====================
      let status;
      try {
        status = await infrastructureManager.status();
      } catch (err: any) {
        console.log(`\n${chalk.bold.white('Infrastructure')}`);
        console.log(chalk.dim('─'.repeat(45)));
        console.log(`  ${chalk.red('✗')} ${'Engine status'.padEnd(22)} ${chalk.red(err.message)}`);
        hasProblems = true;
        suggestions.push(`Infrastructure inspection error: ${err.message}`);
        finishReport(hasProblems, suggestions);
        return;
      }

      const engine = status.engine;

      if (engine === 'docker') {
        console.log(`\n${chalk.bold.white('Docker')}`);
        console.log(chalk.dim('─'.repeat(45)));

        const dockerItems: DiagnosticItem[] = [];

        // Docker installed
        if (status.dockerAvailable) {
          dockerItems.push({
            name: 'Docker installed',
            status: 'Available',
            success: true,
          });
        } else {
          dockerItems.push({
            name: 'Docker installed',
            status: 'Not found',
            success: false,
            hint: 'Install Docker from https://docs.docker.com/get-docker/',
          });
          hasProblems = true;
          suggestions.push('Install Docker or switch to ENGINE=local.');
        }

        // Docker daemon
        if (status.dockerAvailable) {
          if (status.daemonRunning) {
            dockerItems.push({
              name: 'Docker daemon',
              status: 'Running',
              success: true,
            });
          } else {
            dockerItems.push({
              name: 'Docker daemon',
              status: 'Not running',
              success: false,
              hint: 'Start Docker and run `db-backup doctor` again.',
            });
            hasProblems = true;
            suggestions.push('Start the Docker daemon and run `db-backup doctor` again.');
          }
        }

        // Docker Compose
        if (status.dockerAvailable) {
          if (status.composeAvailable) {
            dockerItems.push({
              name: 'Docker Compose',
              status: `Available (${status.composeVersion || 'v2'})`,
              success: true,
            });
          } else {
            dockerItems.push({
              name: 'Docker Compose',
              status: 'Unavailable',
              success: false,
              hint: 'Install Docker Compose (v2).',
            });
            hasProblems = true;
            suggestions.push('Ensure Docker Compose is installed and available in PATH.');
          }
        }

        // Compose file
        if (status.composeFile) {
          dockerItems.push({
            name: 'Compose file',
            status: 'Found',
            success: true,
          });
        } else {
          dockerItems.push({
            name: 'Compose file',
            status: 'Missing',
            success: false,
            hint: 'Ensure docker-compose.yaml is present in the package or project root.',
          });
          hasProblems = true;
          suggestions.push('Locate or restore docker-compose.yaml.');
        }

        // Print Docker Items
        dockerItems.forEach((item) => {
          const icon = item.success ? chalk.green('✓') : chalk.red('✗');
          const text = item.success ? chalk.green(item.status) : chalk.red(item.status);
          console.log(`  ${icon} ${item.name.padEnd(22)} ${text}`);
          if (item.hint) {
            console.log(chalk.dim(`     → ${item.hint}`));
          }
        });
      } else {
        // ENGINE = local
        console.log(`\n${chalk.bold.white('Local Engine (PM2)')}`);
        console.log(chalk.dim('─'.repeat(45)));
        console.log(`  ${chalk.green('✓')} ${'Execution engine'.padEnd(22)} ${chalk.green('local (PM2)')}`);
      }

      // ==================== 3. INFRASTRUCTURE SERVICES ====================
      console.log(`\n${chalk.bold.white('Infrastructure')}`);
      console.log(chalk.dim('─'.repeat(45)));

      const serviceItems: DiagnosticItem[] = [];
      let anyServiceOffline = false;

      status.services.forEach((svc) => {
        const isHealthy = svc.status === 'healthy';
        if (!isHealthy) {
          hasProblems = true;
          anyServiceOffline = true;
        }

        const portStr = svc.port ? ` (port ${svc.port})` : '';
        const statusStr = isHealthy
          ? 'Healthy'
          : svc.error
            ? `Unhealthy - ${sanitizeErrorMessage(svc.error)}`
            : 'Offline';

        serviceItems.push({
          name: svc.name,
          status: `${statusStr}${portStr}`,
          success: isHealthy,
          hint: isHealthy ? undefined : `Run "db-backup infra start" to start ${svc.name}.`,
        });
      });

      serviceItems.forEach((item) => {
        const icon = item.success ? chalk.green('✓') : chalk.red('✗');
        const text = item.success ? chalk.green(item.status) : chalk.red(item.status);
        console.log(`  ${icon} ${item.name.padEnd(22)} ${text}`);
      });

      if (anyServiceOffline) {
        suggestions.push('Start required services with `db-backup infra start`.');
      }

      // ==================== 4. CONFIGURATION & STORAGE ====================
      console.log(`\n${chalk.bold.white('Configuration & Storage')}`);
      console.log(chalk.dim('─'.repeat(45)));

      // Configured database
      const dbConfig = config.get('database');
      if (dbConfig && dbConfig.database) {
        try {
          const connRes = await testConnection(dbConfig);
          if (connRes.success) {
            const hostInfo = dbConfig.host ? ` on ${dbConfig.host}` : '';
            console.log(
              `  ${chalk.green('✓')} ${'Database'.padEnd(22)} ${chalk.green(`${dbConfig.type?.toUpperCase()} (${dbConfig.database}${hostInfo}) - Connected`)}`
            );
          } else {
            hasProblems = true;
            const sanitizedErr = sanitizeErrorMessage(connRes.error || 'Connection failed');
            console.log(
              `  ${chalk.red('✗')} ${'Database'.padEnd(22)} ${chalk.red(`${dbConfig.type?.toUpperCase()} - Connection failed (${sanitizedErr})`)}`
            );
            suggestions.push(`Verify ${dbConfig.type} connectivity using "db-backup connect".`);
          }
        } catch (err: any) {
          hasProblems = true;
          console.log(
            `  ${chalk.red('✗')} ${'Database'.padEnd(22)} ${chalk.red(`Check failed (${sanitizeErrorMessage(err.message)})`)}`
          );
        }
      } else {
        console.log(
          `  ${chalk.dim('ℹ')} ${'Database'.padEnd(22)} ${chalk.dim('Not configured (Run "db-backup connect" to set up)')}`
        );
      }

      // Storage
      try {
        const defaultStorage = await metadataClient.getDefaultStorage();

        if (defaultStorage) {
          if (defaultStorage.type === 'local') {
            const conf = defaultStorage.config as any;
            const basePath = conf?.basePath || './backups';
            const resolvedPath = path.resolve(basePath);
            const exists = fs.existsSync(resolvedPath);
            const icon = exists ? chalk.green('✓') : chalk.red('✗');
            const statusText = exists ? chalk.green(`Local (${resolvedPath})`) : chalk.red(`Missing (${resolvedPath})`);
            console.log(`  ${icon} ${'Storage location'.padEnd(22)} ${statusText}`);
            if (!exists) {
              hasProblems = true;
              suggestions.push(`Create storage directory at ${resolvedPath}.`);
            }
          } else {
            console.log(
              `  ${chalk.green('✓')} ${'Storage location'.padEnd(22)} ${chalk.green(`S3 (${defaultStorage.bucket || 'configured'})`)}`
            );
          }
        } else {
          console.log(
            `  ${chalk.dim('ℹ')} ${'Storage location'.padEnd(22)} ${chalk.dim('Default local storage (~/.db-backup/backups)')}`
          );
        }
      } catch {
        // Fallback gracefully
      }

      // Keystore
      try {
        const keys = keyManager.getAllKeys();
        console.log(
          `  ${chalk.green('✓')} ${'Encryption keystore'.padEnd(22)} ${chalk.green(`${keys.length} key(s) stored`)}`
        );
      } catch {
        console.log(
          `  ${chalk.dim('ℹ')} ${'Encryption keystore'.padEnd(22)} ${chalk.dim('No keys stored')}`
        );
      }

      // ==================== 5. FINAL RESULT ====================
      finishReport(hasProblems, suggestions);
    });
}

function finishReport(hasProblems: boolean, suggestions: string[]): void {
  console.log(`\n${chalk.bold.white('Result')}`);
  console.log(chalk.dim('─'.repeat(45)));

  if (!hasProblems) {
    console.log(`  ${chalk.bold.green('✓ db-backup environment is healthy')}\n`);
    log.info('Doctor diagnosis: healthy');
    process.exit(0);
  } else {
    console.log(`  ${chalk.bold.red('✗ Problems detected')}\n`);

    if (suggestions.length > 0) {
      console.log(chalk.bold.yellow('Suggested action(s):'));
      const unique = Array.from(new Set(suggestions));
      unique.forEach((s) => console.log(chalk.yellow(`  • ${s}`)));
      console.log('');
    }

    log.warn('Doctor diagnosis: problems detected', { suggestions });
    process.exit(1);
  }
}
