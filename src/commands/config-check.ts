import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { clientIdManager } from '../lib/client-id';
import { testConnection } from '../utils/db_connection';
import { metadataClient } from '../lib/metadata-client';
import { keyManager } from '../lib/key-manager';
import httpClient from '../utils/http-client';
import { createModuleLogger } from '../logger';

const log = createModuleLogger('config-check-command');

interface CheckResult {
  category: string;
  name: string;
  success: boolean;
  message: string;
  required: boolean;
}

export function registerConfigCheckCommand(program: Command): void {
  const configCmd = program.command('config').description('Manage and check db-backup CLI configuration');

  configCmd
    .command('check')
    .description('Validate db-backup configuration, databases, storage, and service reachability')
    .action(async () => {
      console.log(chalk.bold.cyan('\n◆ db-backup configuration check\n'));
      console.log(chalk.dim('─'.repeat(60)));

      const results: CheckResult[] = [];

      // ==================== 1. CLIENT IDENTITY ====================
      const clientId = clientIdManager.getClientId();
      if (clientId) {
        results.push({
          category: 'Client Identity',
          name: 'Device Identity',
          success: true,
          message: `Configured (${clientId.substring(0, 8)}...)`,
          required: true,
        });
      } else {
        results.push({
          category: 'Client Identity',
          name: 'Device Identity',
          success: false,
          message: 'Client ID missing. Run "db-backup init"',
          required: true,
        });
      }

      // ==================== 2. BACKEND API CONNECTIVITY ====================
      try {
        const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:3000';
        await httpClient.get(`${gatewayUrl}/health`, { timeout: 3000 });
        results.push({
          category: 'Backend',
          name: 'API Gateway',
          success: true,
          message: 'API reachable',
          required: false,
        });
      } catch (error: any) {
        results.push({
          category: 'Backend',
          name: 'API Gateway',
          success: false,
          message: 'API Gateway unreachable (local mode)',
          required: false,
        });
      }

      // ==================== 3. STORAGE ====================
      try {
        const defaultStorage = await metadataClient.getDefaultStorage();

        if (defaultStorage) {
          if (defaultStorage.type === 'local') {
            const conf = defaultStorage.config as any;
            const basePath = conf?.basePath || './backups';
            const resolvedPath = path.resolve(basePath);
            const exists = fs.existsSync(resolvedPath);

            results.push({
              category: 'Storage',
              name: `Local Storage (${resolvedPath})`,
              success: exists,
              message: exists ? 'Directory exists and accessible' : 'Directory missing',
              required: true,
            });
          } else if (defaultStorage.type === 's3') {
            const bucket = defaultStorage.bucket || 's3-bucket';
            results.push({
              category: 'Storage',
              name: `S3 Storage (${bucket})`,
              success: true,
              message: `Configured (Region: ${defaultStorage.region || 'us-east-1'})`,
              required: true,
            });
          }
        } else {
          results.push({
            category: 'Storage',
            name: 'Backup Storage',
            success: false,
            message: 'No default storage configured',
            required: true,
          });
        }
      } catch (err: any) {
        results.push({
          category: 'Storage',
          name: 'Backup Storage',
          success: false,
          message: `Storage check failed: ${err.message}`,
          required: true,
        });
      }

      // ==================== 4. DATABASE CONNECTIONS ====================
      const dbConfig = config.get('database');
      if (dbConfig && dbConfig.database) {
        const spinner = ora(`Testing ${dbConfig.type?.toUpperCase()} connection...`).start();
        const connRes = await testConnection(dbConfig);
        spinner.stop();

        results.push({
          category: 'Databases',
          name: `${dbConfig.type?.toUpperCase()} (${dbConfig.database})`,
          success: connRes.success,
          message: connRes.success ? 'Connection successful' : `Connection failed: ${connRes.error}`,
          required: true,
        });
      } else {
        results.push({
          category: 'Databases',
          name: 'Database Configuration',
          success: false,
          message: 'No database configured. Run "db-backup init"',
          required: true,
        });
      }

      // ==================== 5. ENCRYPTION ====================
      try {
        const keys = keyManager.getAllKeys();
        const hasKeys = keys.length > 0;
        results.push({
          category: 'Encryption',
          name: 'AES-256-GCM Keystore',
          success: true,
          message: hasKeys ? `${keys.length} key(s) available` : 'Disabled / No keys stored',
          required: false,
        });
      } catch (err) {
        results.push({
          category: 'Encryption',
          name: 'AES-256-GCM Keystore',
          success: true,
          message: 'Disabled',
          required: false,
        });
      }

      // ==================== 6. SCHEDULE ====================
      try {
        const schedules = await metadataClient.listSchedules(true);
        results.push({
          category: 'Schedule',
          name: 'Automated Schedules',
          success: true,
          message: schedules.length > 0 ? `${schedules.length} schedule(s) active` : 'None configured',
          required: false,
        });
      } catch (err) {
        results.push({
          category: 'Schedule',
          name: 'Automated Schedules',
          success: true,
          message: 'None configured',
          required: false,
        });
      }

      // ==================== 7. NOTIFICATIONS ====================
      try {
        const configs = await metadataClient.listNotificationConfigs();
        const notifications = configs.filter((c: any) => c.enabled);
        results.push({
          category: 'Notifications',
          name: 'Alert Providers',
          success: true,
          message: notifications.length > 0 ? notifications.map((n) => n.type.toUpperCase()).join(', ') : 'None configured',
          required: false,
        });
      } catch (err) {
        results.push({
          category: 'Notifications',
          name: 'Alert Providers',
          success: true,
          message: 'None configured',
          required: false,
        });
      }

      // ==================== DISPLAY RESULTS ====================
      let hasRequiredFailure = false;

      const categories = Array.from(new Set(results.map((r) => r.category)));

      for (const cat of categories) {
        console.log(`\n${chalk.bold.white(cat)}`);
        const catResults = results.filter((r) => r.category === cat);

        for (const res of catResults) {
          const icon = res.success ? chalk.green('  ✓') : res.required ? chalk.red('  ✗') : chalk.yellow('  ⚠️');
          const statusText = res.success
            ? chalk.green(res.message)
            : res.required
            ? chalk.red(res.message)
            : chalk.yellow(res.message);

          console.log(`${icon} ${res.name.padEnd(28)}: ${statusText}`);

          if (!res.success && res.required) {
            hasRequiredFailure = true;
          }
        }
      }

      console.log('\n' + chalk.dim('─'.repeat(60)));

      if (hasRequiredFailure) {
        console.log(chalk.bold.red('\n✗ Configuration check failed. Some required items need attention.'));
        console.log(chalk.yellow('💡 Run "db-backup init" to reconfigure.\n'));
        process.exit(1);
      } else {
        console.log(chalk.bold.green('\n◆ Configuration is valid.\n'));
        process.exit(0);
      }
    });
}
