// src/commands/backup.ts

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { createModuleLogger } from '../logger';
import { config } from '../config';
import { keyManager } from '../lib/key-manager';
import httpClient from '../utils/http-client';
import { infrastructureManager } from '../infrastructure';
import { BackupUseCase } from '../application/use-cases/backup.use-case';
import { PrismaBackupRepository } from '../infrastructure/repositories/prisma-backup.repository';
import { cryptoService } from '../infrastructure/crypto/aes256-crypto.service';
import { StorageNotFoundError } from '../domain/errors';

const log = createModuleLogger('backup-command');
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';

export function registerBackupCommand(program: Command): void {
  program
    .command('backup')
    .description('Perform a database backup using microservices')
    .option('-t, --type <type>', 'Backup type (full, incremental, differential)', 'full')
    .option('--incremental', 'Perform an incremental backup', false)
    .option('--parent-id <id>', 'Parent backup ID for incremental backup')
    .option('--physical', 'Perform physical base backup (pg_basebackup with manifest for incremental backups)', false)
    .option('-c, --compress', 'Compress backup file', true)
    .option('-o, --output <path>', 'Output directory')
    .option('-n, --name <name>', 'Custom backup name')
    .option('--tables <tables>', 'Comma-separated list of tables to backup')
    .option('--exclude-tables <tables>', 'Comma-separated list of tables to exclude')
    .option('--async', 'Run backup asynchronously (return immediately)', false)
    .option('--no-compress', 'Disable compression')
    .option('--storage <name>', 'Storage name (from dbvault storage list)')
    .option('--encrypt', 'Enable AES-256-GCM encryption for the backup', false)
    .option('--key <key>', '32-byte AES-256 encryption key (64 hex characters)')
    .option('--no-store-key', 'Do not store the encryption key in local keystore', false)
    .action(async (options) => {
      const spinner = ora('Preparing backup request...').start();
      const backupRepo = new PrismaBackupRepository();

      try {
        const dbConfig = config.get('database');
        if (!dbConfig) {
          spinner.fail('No database configuration found');
          console.error(chalk.red('\n✗ Please run "dbvault connect" first'));
          process.exit(1);
        }

        const tables = options.tables ? options.tables.split(',') : undefined;
        const excludeTables = options.excludeTables ? options.excludeTables.split(',') : undefined;

        // Ensure runtime infrastructure is running
        spinner.text = 'Checking backup infrastructure...';
        await infrastructureManager.ensureInfrastructure({ dbType: dbConfig.type });

        spinner.text = 'Sending backup request to orchestrator...';

        const backupUseCase = new BackupUseCase(
          config,
          backupRepo,
          cryptoService,
          keyManager,
          httpClient,
          GATEWAY_URL
        );

        const result = await backupUseCase.execute({
          type: options.type,
          incremental: options.incremental,
          parentId: options.parentId,
          physical: options.physical,
          compress: options.compress,
          output: options.output,
          name: options.name,
          tables,
          excludeTables,
          async: options.async,
          storage: options.storage,
          encrypt: options.encrypt,
          key: options.key,
          noStoreKey: options.noStoreKey,
        });

        if (result.queued) {
          spinner.succeed(chalk.green('Backup job queued successfully!'));
          console.log(chalk.cyan('\n📋 Backup Job Details:'));
          console.log(chalk.dim(`  Backup ID: ${result.backupId}`));
          console.log(chalk.dim(`  Status: queued`));
          console.log(chalk.dim(`\n💡 Track progress with: dbvault dashboard or check logs`));
          process.exit(0);
        }

        spinner.succeed(chalk.green('Backup completed successfully!'));
        console.log(chalk.green('\n✓ Backup Details:'));
        console.log(chalk.dim(`  Backup ID: ${result.backupId}`));
        console.log(chalk.dim(`  Database: ${dbConfig.type}/${dbConfig.database}`));
        console.log(chalk.dim(`  Type: ${options.incremental ? 'incremental' : options.type || 'full'}`));
        if (result.fileSize !== undefined) {
          console.log(chalk.dim(`  Size: ${(result.fileSize / 1024 / 1024).toFixed(2)} MB`));
        }
        if (result.duration !== undefined) {
          console.log(chalk.dim(`  Duration: ${result.duration.toFixed(2)} seconds`));
        }
        if (result.filePath) {
          console.log(chalk.dim(`  Location: ${result.filePath}`));
        }
        process.exit(0);
      } catch (error: any) {
        if (error instanceof StorageNotFoundError) {
          spinner.fail(`Storage location "${options.storage}" not found`);
          console.error(chalk.yellow(`\n💡 Available storages:`));
          const storages = await backupRepo.listStorages(true);
          if (storages.length === 0) {
            console.error(chalk.dim('  No storage locations configured.'));
            console.error(chalk.dim('  Run: dbvault storage add --type local --name my-storage'));
          } else {
            storages.forEach((s: any) => console.log(chalk.dim(`  • ${s.name} (${s.type})`)));
          }
          process.exit(1);
        }

        spinner.fail(chalk.red('Backup failed'));
        const detailedMsg = error.response?.data?.message || error.response?.data?.error || error.message;
        console.error(chalk.red(`\n✗ Error: ${detailedMsg}`));
        if (error.response?.data?.issues) {
          error.response.data.issues.forEach((issue: any) => {
            console.error(chalk.dim(`  • ${issue.field}: ${issue.message}`));
          });
        }
        log.error('Backup command execution failed', { error: detailedMsg });
        process.exit(1);
      }
    });
}