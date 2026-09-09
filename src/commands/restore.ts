import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { createModuleLogger } from '../logger';
import { config } from '../config';
import { connection } from '../lib/queue-manager';
import { DistributedLock } from '../lib/distributed-lock';
import { infrastructureManager } from '../infrastructure';
import { keyManager } from '../lib/key-manager';
import { PrismaBackupRepository } from '../infrastructure/repositories/prisma-backup.repository';
import { AES256CryptoService } from '../infrastructure/crypto/aes256-crypto.service';
import { GzipCompressionService } from '../infrastructure/compression/gzip-compression.service';
import { DatabaseAdapterFactory } from '../infrastructure/database/database-adapter.factory';
import { RestoreUseCase } from '../application/use-cases/restore.use-case';

const log = createModuleLogger('restore-command');

// Lock TTL - configurable via environment variable only (default: 1 hour)
const LOCK_TTL = parseInt(process.env.RESTORE_LOCK_TTL || '3600', 10);

function getDatabaseIdentifier(dbConfig: any): string {
  return `${dbConfig.type}:${dbConfig.host}:${dbConfig.database}`;
}

export function registerRestoreCommand(program: Command): void {
  program
    .command('restore')
    .description('Restore a database from backup using full backup ID')
    .option('-i, --id <id>', 'Full backup ID to restore (copy from list command)')
    .option('-f, --file <path>', 'Local backup file path')
    .option('-t, --tables <tables>', 'Comma-separated tables to restore (if supported)')
    .option('--drop-existing', 'Drop existing tables before restore', false)
    .option('--dry-run', 'Perform a dry run without actual restore', false)
    .option('--force', 'Force restore (drop existing tables)', false)
    .option('--skip-checksum', 'Skip checksum verification (use with caution)', false)
    .option('--key <key>', 'Decryption key (64 hex characters) for encrypted backups')
    .action(async (options) => {
      const spinner = ora('Preparing restore...').start();
      let lock: DistributedLock | null = null;
      let lockAcquired = false;
      let dbConfig: any = null;

      try {
        dbConfig = config.get('database');
        if (!dbConfig) {
          spinner.fail('No database configuration found');
          console.error(chalk.red('\n✗ Please run "db-backup connect" first'));
          process.exit(1);
        }

        if (!options.id && !options.file) {
          spinner.fail('Please specify a backup ID or file path');
          console.error(chalk.dim('\n  Use --id <backup-id> or --file <path>'));
          console.error(chalk.dim('\n  List available backups: db-backup list'));
          process.exit(1);
        }

        // Ensure Redis infrastructure is available for distributed lock
        spinner.text = 'Checking infrastructure for restore...';
        await infrastructureManager.ensureInfrastructure({ requiredServices: ['redis'] });

        // Initialize distributed lock
        const lockKey = `restore:${getDatabaseIdentifier(dbConfig)}`;
        lock = new DistributedLock(connection as any, lockKey, { ttl: LOCK_TTL });

        // Try to acquire lock
        spinner.text = 'Acquiring restore lock...';
        lockAcquired = await lock.acquire();

        if (!lockAcquired) {
          spinner.fail(chalk.red(`A restore operation is already running for database '${dbConfig.database}'. Please wait until it completes.`));
          log.warn('Restore lock acquisition failed', {
            database: dbConfig.database,
            host: dbConfig.host,
          });
          process.exit(1);
        }

        console.log(chalk.green(`\n🔒 Restore lock acquired for ${dbConfig.database}`));

        // Warning prompt for drop-existing / force in interactive terminal
        if ((options.dropExisting || options.force) && !options.dryRun && process.stdin.isTTY) {
          spinner.stop();
          console.log(chalk.yellow('\n⚠ WARNING: --drop-existing will drop existing tables before restore.'));
          console.log(chalk.dim('   This will delete all data in the target database.'));

          const readline = require('readline');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          const answer = await new Promise<string>((resolve) => {
            rl.question(chalk.yellow('\nContinue? (y/N): '), resolve);
          });
          rl.close();

          if (typeof answer === 'string' && answer.toLowerCase() !== 'y') {
            console.log(chalk.yellow('\nRestore cancelled'));
            process.exit(0);
          }
          spinner.start('Continuing restore...');
        }

        const backupRepo = new PrismaBackupRepository();
        const cryptoService = new AES256CryptoService();
        const compressionService = new GzipCompressionService();
        const adapterFactory = new DatabaseAdapterFactory();
        const restoreUseCase = new RestoreUseCase(
          config as any,
          backupRepo,
          cryptoService,
          compressionService,
          adapterFactory,
          keyManager
        );

        spinner.text = 'Performing restore...';
        log.info('Starting restore execution via use case', { backupId: options.id, file: options.file });

        const result = await restoreUseCase.execute({
          backupId: options.id,
          filePath: options.file,
          tables: options.tables ? options.tables.split(',') : undefined,
          dryRun: options.dryRun,
          clean: options.dropExisting || options.force,
          ifExists: options.dropExisting || options.force,
          key: options.key,
          skipChecksum: options.skipChecksum,
        });

        if (options.dryRun) {
          spinner.succeed(chalk.green('Dry run completed'));
          console.log(chalk.yellow('\n⚠ This was a dry run. No changes were made.'));
          console.log(chalk.dim(`\n  Would restore from: ${options.file || options.id}`));
          if (options.tables) {
            console.log(chalk.dim(`  Tables: ${options.tables}`));
          }
          console.log(chalk.dim(`  Drop existing: ${options.dropExisting ? 'Yes' : 'No'}`));
          return;
        }

        spinner.succeed(chalk.green('Restore completed successfully!'));
        console.log(chalk.green('\n✓ Database restored'));
        console.log(chalk.dim(`  From: ${options.file || options.id}`));
        if (result.duration) {
          console.log(chalk.dim(`  Duration: ${result.duration.toFixed(2)}s`));
        }
        log.info('Restore completed', { backupId: options.id, duration: result.duration });
      } catch (error: any) {
        spinner.fail(chalk.red('Restore failed'));
        console.error(chalk.red(`\n✗ Error: ${error.message}`));
        log.error('Restore failed', { error: error.message });
        process.exit(1);
      } finally {
        if (lock && lockAcquired) {
          try {
            await lock.release();
            console.log(chalk.dim(`\n🔓 Restore lock released for ${dbConfig?.database || 'database'}`));
            log.debug('Lock released', { database: dbConfig?.database });
          } catch (releaseError: any) {
            log.error('Failed to release lock', { error: releaseError.message });
            console.error(chalk.red(`\n⚠️ Failed to release lock: ${releaseError.message}`));
          }
        }
      }
    });
}