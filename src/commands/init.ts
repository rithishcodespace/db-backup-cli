import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as clack from '@clack/prompts';
import { config } from '../config';
import { clientIdManager } from '../lib/client-id';
import { testConnection } from '../utils/db_connection';
import { prisma } from '../lib/prisma';
import { keyManager } from '../lib/key-manager';
import { S3StorageProvider } from '../microservices/storage-service/providers/s3';
import httpClient from '../utils/http-client';
import { createModuleLogger } from '../logger';

const log = createModuleLogger('init-command');

function handleCancel(value: any) {
  if (clack.isCancel(value)) {
    clack.cancel('└ Setup cancelled.');
    process.exit(0);
  }
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize and configure db-backup environment step-by-step')
    .action(async () => {
      console.log('');
      clack.intro(chalk.bold.cyan('◆ Welcome to db-backup-cli!'));
      clack.note('Let\'s configure your backup environment.', 'Initialization');

      // ==================== 1. IDEMPOTENCY CHECK ====================
      const existingDbConfig = config.get('database');
      const existingStorageCount = await prisma.storageLocation.count().catch(() => 0);
      const existingNotificationCount = await prisma.notificationConfig.count().catch(() => 0);

      const hasExistingConfig = existingDbConfig || existingStorageCount > 0 || existingNotificationCount > 0;

      if (hasExistingConfig) {
        const action = await clack.select({
          message: 'Existing configuration detected. What would you like to do?',
          options: [
            { value: 'update', label: 'Update configuration', hint: 'Modify existing settings' },
            { value: 'reconfigure', label: 'Reconfigure everything', hint: 'Start fresh configuration' },
            { value: 'keep', label: 'Keep existing configuration', hint: 'Exit onboarding' },
          ],
        });
        handleCancel(action);

        if (action === 'keep') {
          clack.outro(chalk.green('Existing configuration retained. Run "db-backup config check" to verify.'));
          process.exit(0);
        }
      }

      const summaryDetails: Record<string, string> = {};

      // ==================== 2. CLIENT IDENTITY & BACKEND CHECK ====================
      const identitySpinner = ora('Initializing client identity...').start();
      const clientId = clientIdManager.getClientId();
      const maskedClientId = clientId ? `${clientId.substring(0, 8)}...` : 'Generated';
      identitySpinner.succeed(chalk.green(`Client identity configured (Client: ${maskedClientId})`));
      summaryDetails['Client Identity'] = `✓ Configured (${maskedClientId})`;

      const apiSpinner = ora('Checking db-backup API connection...').start();
      try {
        const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:3000';
        await httpClient.get(`${gatewayUrl}/health`, { timeout: 3000 });
        apiSpinner.succeed(chalk.green('Connected to db-backup API Gateway'));
        summaryDetails['API Gateway'] = '✓ Connected';
      } catch (err) {
        apiSpinner.info(chalk.yellow('API Gateway currently unreachable (running in local offline mode)'));
        summaryDetails['API Gateway'] = '⚠️ Offline mode';
      }

      // ==================== 3. DATABASE CONNECTIONS ====================
      clack.note('Configure the databases you want to back up.', 'Database Configuration');

      const selectedDbs = await clack.multiselect({
        message: 'Select database types to configure:',
        options: [
          { value: 'postgresql', label: 'PostgreSQL', hint: 'Full Backup' },
          { value: 'mysql', label: 'MySQL', hint: 'Full Backup' },
          { value: 'mongodb', label: 'MongoDB', hint: 'Full Backup' },
          { value: 'sqlite', label: 'SQLite', hint: 'Full Backup' },
        ],
        required: true,
      });
      handleCancel(selectedDbs);

      const configuredDbNames: string[] = [];

      for (const dbType of selectedDbs as string[]) {
        let success = false;

        while (!success) {
          let dbConnConfig: any = { type: dbType };

          if (dbType === 'postgresql' || dbType === 'mysql') {
            const host = await clack.text({
              message: `${dbType.toUpperCase()} Host:`,
              placeholder: dbType === 'postgresql' ? 'localhost' : '127.0.0.1',
              defaultValue: dbType === 'postgresql' ? 'localhost' : '127.0.0.1',
            });
            handleCancel(host);

            const port = await clack.text({
              message: `${dbType.toUpperCase()} Port:`,
              placeholder: dbType === 'postgresql' ? '5432' : '3306',
              defaultValue: dbType === 'postgresql' ? '5432' : '3306',
            });
            handleCancel(port);

            const username = await clack.text({
              message: `${dbType.toUpperCase()} Username:`,
              placeholder: dbType === 'postgresql' ? 'postgres' : 'root',
              defaultValue: dbType === 'postgresql' ? 'postgres' : 'root',
            });
            handleCancel(username);

            const password = await clack.password({
              message: `${dbType.toUpperCase()} Password:`,
              mask: '*',
            });
            handleCancel(password);

            const database = await clack.text({
              message: `${dbType.toUpperCase()} Database Name:`,
              placeholder: 'mydb',
              validate: (val) => (!val ? 'Database name is required' : undefined),
            });
            handleCancel(database);

            dbConnConfig = {
              type: dbType,
              host: String(host),
              port: parseInt(String(port), 10),
              username: String(username),
              password: String(password),
              database: String(database),
            };
          } else if (dbType === 'mongodb') {
            const mode = await clack.select({
              message: 'MongoDB Connection Method:',
              options: [
                { value: 'host', label: 'Host & Port' },
                { value: 'uri', label: 'Connection URI' },
              ],
            });
            handleCancel(mode);

            if (mode === 'uri') {
              const uri = await clack.password({
                message: 'MongoDB Connection URI:',
                mask: '*',
                validate: (val) => (!val ? 'URI is required' : undefined),
              });
              handleCancel(uri);

              dbConnConfig = {
                type: 'mongodb',
                database: String(uri),
              };
            } else {
              const host = await clack.text({
                message: 'MongoDB Host:',
                placeholder: 'localhost',
                defaultValue: 'localhost',
              });
              handleCancel(host);

              const port = await clack.text({
                message: 'MongoDB Port:',
                placeholder: '27017',
                defaultValue: '27017',
              });
              handleCancel(port);

              const username = await clack.text({
                message: 'MongoDB Username (optional):',
              });
              handleCancel(username);

              const password = await clack.password({
                message: 'MongoDB Password (optional):',
                mask: '*',
              });
              handleCancel(password);

              const database = await clack.text({
                message: 'MongoDB Database Name:',
                placeholder: 'mydb',
                validate: (val) => (!val ? 'Database name is required' : undefined),
              });
              handleCancel(database);

              dbConnConfig = {
                type: 'mongodb',
                host: String(host),
                port: parseInt(String(port), 10),
                username: String(username) || undefined,
                password: String(password) || undefined,
                database: String(database),
              };
            }
          } else if (dbType === 'sqlite') {
            const dbPath = await clack.text({
              message: 'SQLite Database File Path:',
              placeholder: './data.db',
              validate: (val) => (!val ? 'File path is required' : undefined),
            });
            handleCancel(dbPath);

            dbConnConfig = {
              type: 'sqlite',
              database: String(dbPath),
            };
          }

          const dbSpinner = ora(`Testing ${dbType.toUpperCase()} connection...`).start();
          const testRes = await testConnection(dbConnConfig);

          if (testRes.success) {
            dbSpinner.succeed(chalk.green(`${dbType.toUpperCase()} connection successful!`));
            config.setDatabase(dbConnConfig);
            configuredDbNames.push(dbType);
            success = true;
          } else {
            dbSpinner.fail(chalk.red(`${dbType.toUpperCase()} connection failed`));
            clack.log.error(`Error: ${testRes.error}`);

            const failChoice = await clack.select({
              message: `What would you like to do for ${dbType.toUpperCase()}?`,
              options: [
                { value: 'retry', label: 'Retry / Edit configuration' },
                { value: 'skip', label: 'Skip this database' },
                { value: 'cancel', label: 'Cancel onboarding' },
              ],
            });
            handleCancel(failChoice);

            if (failChoice === 'skip') {
              break;
            } else if (failChoice === 'cancel') {
              clack.cancel('└ Setup cancelled.');
              process.exit(0);
            }
          }
        }
      }

      summaryDetails['Databases'] = configuredDbNames.length > 0
        ? `✓ ${configuredDbNames.map((d) => d.toUpperCase()).join(', ')}`
        : '⚠️ None configured';

      // ==================== 4. STORAGE ====================
      clack.note('Configure where your backups will be stored.', 'Storage Setup');

      const storageType = await clack.select({
        message: 'Where should backups be stored?',
        options: [
          { value: 'local', label: 'Local Directory', hint: 'Store backups on local filesystem' },
          { value: 's3', label: 'Amazon S3', hint: 'Upload backups to S3 bucket' },
        ],
      });
      handleCancel(storageType);

      if (storageType === 'local') {
        const localPath = await clack.text({
          message: 'Backup directory path:',
          placeholder: './backups',
          defaultValue: './backups',
        });
        handleCancel(localPath);

        const storageSpinner = ora('Checking storage directory write permissions...').start();
        const resolvedPath = path.resolve(String(localPath));

        try {
          if (!fs.existsSync(resolvedPath)) {
            fs.mkdirSync(resolvedPath, { recursive: true });
          }
          const testFile = path.join(resolvedPath, `.write_test_${Date.now()}`);
          fs.writeFileSync(testFile, 'test');
          fs.unlinkSync(testFile);

          await prisma.storageLocation.updateMany({ where: { default: true }, data: { default: false } });
          await prisma.storageLocation.upsert({
            where: { name: 'default-local' },
            update: { type: 'local', config: { basePath: resolvedPath }, default: true, enabled: true },
            create: { name: 'default-local', type: 'local', config: { basePath: resolvedPath }, default: true, enabled: true },
          });

          storageSpinner.succeed(chalk.green('Storage is writable and configured'));
          summaryDetails['Storage'] = `✓ Local (${resolvedPath})`;
        } catch (err: any) {
          storageSpinner.fail(chalk.red(`Storage directory error: ${err.message}`));
          summaryDetails['Storage'] = '⚠️ Local storage setup failed';
        }
      } else {
        const bucket = await clack.text({
          message: 'S3 Bucket Name:',
          validate: (val) => (!val ? 'Bucket name is required' : undefined),
        });
        handleCancel(bucket);

        const region = await clack.text({
          message: 'S3 Region:',
          placeholder: 'us-east-1',
          defaultValue: 'us-east-1',
        });
        handleCancel(region);

        const accessKey = await clack.password({
          message: 'AWS Access Key ID:',
          mask: '*',
          validate: (val) => (!val ? 'Access Key is required' : undefined),
        });
        handleCancel(accessKey);

        const secretKey = await clack.password({
          message: 'AWS Secret Access Key:',
          mask: '*',
          validate: (val) => (!val ? 'Secret Key is required' : undefined),
        });
        handleCancel(secretKey);

        const prefix = await clack.text({
          message: 'S3 Folder Prefix (optional):',
          placeholder: 'db-backups',
        });
        handleCancel(prefix);

        const s3Spinner = ora('Testing S3 bucket connection...').start();
        try {
          const s3Provider = new S3StorageProvider({
            type: 's3',
            bucket: String(bucket),
            region: String(region),
            accessKey: String(accessKey),
            secretKey: String(secretKey),
          });
          await s3Provider.initialize();

          await prisma.storageLocation.updateMany({ where: { default: true }, data: { default: false } });
          await prisma.storageLocation.upsert({
            where: { name: 'default-s3' },
            update: {
              type: 's3',
              bucket: String(bucket),
              region: String(region),
              accessKey: String(accessKey),
              secretKey: String(secretKey),
              config: { prefix: String(prefix || '') },
              default: true,
              enabled: true,
            },
            create: {
              name: 'default-s3',
              type: 's3',
              bucket: String(bucket),
              region: String(region),
              accessKey: String(accessKey),
              secretKey: String(secretKey),
              config: { prefix: String(prefix || '') },
              default: true,
              enabled: true,
            },
          });

          s3Spinner.succeed(chalk.green('S3 storage connection verified and saved'));
          summaryDetails['Storage'] = `✓ S3 (${String(bucket)})`;
        } catch (err: any) {
          s3Spinner.fail(chalk.red(`S3 connection failed: ${err.message}`));
          summaryDetails['Storage'] = '⚠️ S3 setup failed';
        }
      }

      // ==================== 5. ENCRYPTION ====================
      clack.note('Protect your backups with zero-knowledge AES-256-GCM encryption.', 'Security Setup');

      const enableEncryption = await clack.select({
        message: 'Do you want to encrypt your backups?',
        options: [
          { value: 'yes', label: 'Yes', hint: 'Enable AES-256-GCM encryption' },
          { value: 'no', label: 'No', hint: 'Store unencrypted backups' },
        ],
      });
      handleCancel(enableEncryption);

      if (enableEncryption === 'yes') {
        const keyOption = await clack.select({
          message: 'How should the encryption key be configured?',
          options: [
            { value: 'generate', label: 'Generate a new AES-256 key', hint: 'Recommended' },
            { value: 'existing', label: 'Use an existing key', hint: 'Provide 64-char hex key' },
          ],
        });
        handleCancel(keyOption);

        if (keyOption === 'generate') {
          const keySpinner = ora('Generating encryption key...').start();
          const newKey = crypto.randomBytes(32).toString('hex');
          keyManager.addKey('default', newKey, 'all', 'all');
          keySpinner.succeed(chalk.green('Encryption key generated and stored securely in keystore'));
          summaryDetails['Encryption'] = '✓ AES-256-GCM (Generated)';
        } else {
          const customKey = await clack.password({
            message: 'Enter your 64-character hex encryption key:',
            mask: '*',
            validate: (val) => (!val || String(val).length !== 64 ? 'Key must be exactly 64 hexadecimal characters' : undefined),
          });
          handleCancel(customKey);

          keyManager.addKey('default', String(customKey), 'all', 'all');
          clack.log.success(chalk.green('Encryption key saved to keystore'));
          summaryDetails['Encryption'] = '✓ AES-256-GCM (Custom Key)';
        }
      } else {
        summaryDetails['Encryption'] = 'Disabled';
      }

      // ==================== 6. BACKUP SCHEDULE ====================
      clack.note('Set up automated full backup schedules.', 'Schedule Setup');

      const enableSchedule = await clack.select({
        message: 'Do you want to configure automated backups?',
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ],
      });
      handleCancel(enableSchedule);

      if (enableSchedule === 'yes') {
        const preset = await clack.select({
          message: 'Select backup schedule frequency:',
          options: [
            { value: '0 0 * * *', label: 'Daily at midnight (0 0 * * *)' },
            { value: '0 2 * * *', label: 'Daily at 2 AM (0 2 * * *)' },
            { value: '0 0 * * 0', label: 'Weekly on Sunday (0 0 * * 0)' },
            { value: 'custom', label: 'Custom Cron Expression' },
          ],
        });
        handleCancel(preset);

        let cronExpr = String(preset);
        if (preset === 'custom') {
          const customCron = await clack.text({
            message: 'Enter custom cron expression (5 fields):',
            placeholder: '0 */6 * * *',
            validate: (val) => (!val ? 'Cron expression is required' : undefined),
          });
          handleCancel(customCron);
          cronExpr = String(customCron);
        }

        const primaryDb = configuredDbNames[0] || 'postgresql';
        await prisma.backupSchedule.create({
          data: {
            name: `${primaryDb}_auto_backup`,
            dbType: primaryDb,
            dbName: config.get('database')?.database || 'default_db',
            schedule: cronExpr,
            backupType: 'full',
            storageType: storageType === 's3' ? 's3' : 'local',
            compress: true,
            enabled: true,
          },
        });

        clack.log.success(chalk.green(`Automated schedule created (${cronExpr})`));
        summaryDetails['Schedule'] = `✓ Automated (${cronExpr})`;
      } else {
        summaryDetails['Schedule'] = 'Disabled';
      }

      // ==================== 7. NOTIFICATIONS ====================
      clack.note('Configure Slack or Email alerts for backup jobs.', 'Notification Setup');

      const enableNotifications = await clack.select({
        message: 'Do you want backup notifications?',
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ],
      });
      handleCancel(enableNotifications);

      if (enableNotifications === 'yes') {
        const providers = await clack.multiselect({
          message: 'Select notification providers:',
          options: [
            { value: 'slack', label: 'Slack Webhook' },
            { value: 'email', label: 'Email (SMTP)' },
          ],
          required: true,
        });
        handleCancel(providers);

        const configuredProviders: string[] = [];

        for (const provider of providers as string[]) {
          if (provider === 'slack') {
            const webhook = await clack.password({
              message: 'Slack Webhook URL:',
              mask: '*',
              validate: (val) => (!val || !String(val).startsWith('http') ? 'Valid URL is required' : undefined),
            });
            handleCancel(webhook);

            await prisma.notificationConfig.upsert({
              where: { type: 'slack' },
              update: { webhook: String(webhook), enabled: true },
              create: { type: 'slack', webhook: String(webhook), enabled: true },
            });
            configuredProviders.push('Slack');
          } else if (provider === 'email') {
            const smtpHost = await clack.text({
              message: 'SMTP Host:',
              placeholder: 'smtp.gmail.com',
              validate: (val) => (!val ? 'SMTP Host is required' : undefined),
            });
            handleCancel(smtpHost);

            const smtpPort = await clack.text({
              message: 'SMTP Port:',
              placeholder: '587',
              defaultValue: '587',
            });
            handleCancel(smtpPort);

            const smtpUser = await clack.text({
              message: 'SMTP Username:',
              validate: (val) => (!val ? 'SMTP User is required' : undefined),
            });
            handleCancel(smtpUser);

            const smtpPassword = await clack.password({
              message: 'SMTP Password:',
              mask: '*',
              validate: (val) => (!val ? 'Password is required' : undefined),
            });
            handleCancel(smtpPassword);

            const from = await clack.text({
              message: 'From Email Address:',
              placeholder: 'backup@example.com',
              validate: (val) => (!val ? 'Sender email is required' : undefined),
            });
            handleCancel(from);

            const to = await clack.text({
              message: 'Recipient Email Address:',
              placeholder: 'alerts@example.com',
              validate: (val) => (!val ? 'Recipient email is required' : undefined),
            });
            handleCancel(to);

            await prisma.notificationConfig.upsert({
              where: { type: 'email' },
              update: {
                smtpHost: String(smtpHost),
                smtpPort: parseInt(String(smtpPort), 10),
                smtpUser: String(smtpUser),
                smtpPassword: String(smtpPassword),
                from: String(from),
                to: String(to),
                enabled: true,
              },
              create: {
                type: 'email',
                smtpHost: String(smtpHost),
                smtpPort: parseInt(String(smtpPort), 10),
                smtpUser: String(smtpUser),
                smtpPassword: String(smtpPassword),
                from: String(from),
                to: String(to),
                enabled: true,
              },
            });
            configuredProviders.push('Email');
          }
        }

        clack.log.success(chalk.green(`Notifications configured (${configuredProviders.join(', ')})`));
        summaryDetails['Notifications'] = `✓ ${configuredProviders.join(', ')}`;
      } else {
        summaryDetails['Notifications'] = 'Disabled';
      }

      // ==================== 8. CONFIGURATION SUMMARY ====================
      console.log('');
      clack.intro(chalk.bold.green('◆ Setup complete!'));

      console.log(chalk.bold('\nConfiguration Summary:'));
      Object.entries(summaryDetails).forEach(([key, val]) => {
        console.log(`  ${chalk.bold(key.padEnd(18))}: ${val}`);
      });

      console.log('\n' + chalk.bold.cyan('Next steps:'));
      console.log(chalk.dim('  Run: ') + chalk.bold('db-backup config check') + chalk.dim('  to verify your configuration health.'));
      console.log(chalk.dim('  Run: ') + chalk.bold('db-backup backup') + chalk.dim('        to create your first backup.\n'));

      clack.outro(chalk.bold.green('Initialization finished successfully!'));
    });
}
