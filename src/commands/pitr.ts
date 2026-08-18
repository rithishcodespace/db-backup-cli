import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import { config } from '../config';
import { PostgresPitrService } from '../services/postgres-pitr.service';
import { createModuleLogger } from '../logger';

const log = createModuleLogger('pitr-command');

export function registerPitrCommand(program: Command): void {
  const pitrCmd = program
    .command('pitr')
    .description('PostgreSQL Point-in-Time Recovery (PITR) management commands');

  pitrCmd
    .command('setup')
    .description('Configure and verify PostgreSQL PITR archiving settings')
    .option('-d, --database <name>', 'Database name')
    .option('--auto-configure', 'Attempt to automatically set wal_level and archive_mode via ALTER SYSTEM', false)
    .option('--storage <name>', 'Storage name')
    .action(async (options) => {
      const dbConfig = config.get('database');
      if (!dbConfig || dbConfig.type !== 'postgresql') {
        console.error(chalk.red('\n✗ Active database must be PostgreSQL for PITR commands.'));
        console.error(chalk.dim('  Run: db-backup connect --type postgresql ...'));
        process.exit(1);
      }

      if (options.database) {
        dbConfig.database = options.database;
      }

      const spinner = ora('Inspecting PostgreSQL server for PITR setup...').start();
      try {
        const pitrService = new PostgresPitrService(dbConfig);
        const res = await pitrService.setupPitr({
          autoConfigure: options.autoConfigure,
          storageName: options.storage,
        });

        if (res.activelyWorking) {
          spinner.succeed(chalk.green('PostgreSQL PITR is ACTIVELY WORKING!'));
        } else if (res.configured) {
          spinner.info(chalk.yellow('PostgreSQL PITR is CONFIGURED but requires restart to activate.'));
        } else {
          spinner.fail(chalk.red('PostgreSQL PITR is NOT CONFIGURED.'));
        }

        console.log(chalk.cyan('\n📋 PITR Setup Status:'));
        console.log(chalk.dim(`  Database: ${res.dbName}`));
        console.log(chalk.dim(`  System Identifier: ${res.systemIdentifier || 'unknown'}`));
        console.log(chalk.dim(`  wal_level: ${res.walLevel}`));
        console.log(chalk.dim(`  archive_mode: ${res.archiveMode}`));
        console.log(chalk.dim(`  archive_command: ${res.archiveCommand}`));

        if (res.restartRequired) {
          console.log(chalk.yellow('\n⚠️  A PostgreSQL server restart is REQUIRED for changes to take effect.'));
          console.log(chalk.dim('   Restart your PostgreSQL server and re-run: db-backup pitr setup'));
        } else if (!res.activelyWorking) {
          console.log(chalk.yellow('\n💡 Expected postgresql.conf settings:'));
          console.log(chalk.dim(`   wal_level = replica`));
          console.log(chalk.dim(`   archive_mode = on`));
          console.log(chalk.dim(`   archive_command = '${res.expectedCommand}'`));
          console.log(chalk.dim('\n   Or run with --auto-configure if database user has SUPERUSER privileges.'));
        }
      } catch (err: any) {
        spinner.fail(chalk.red('PITR setup check failed'));
        console.error(chalk.red(`\n✗ Error: ${err.message}`));
        process.exit(1);
      }
    });

  pitrCmd
    .command('status')
    .description('Show detailed PITR configuration, WAL archiving, and readiness status')
    .option('-d, --database <name>', 'Database name')
    .action(async (options) => {
      const dbConfig = config.get('database');
      if (!dbConfig || dbConfig.type !== 'postgresql') {
        console.error(chalk.red('\n✗ Active database must be PostgreSQL for PITR commands.'));
        process.exit(1);
      }

      if (options.database) {
        dbConfig.database = options.database;
      }

      const spinner = ora('Fetching PITR status...').start();
      try {
        const pitrService = new PostgresPitrService(dbConfig);
        const status = await pitrService.getPitrStatus();
        spinner.stop();

        console.log(chalk.cyan('\n📊 PITR Status Report:'));
        console.log(chalk.dim(`  Database: ${status.dbName}`));
        console.log(chalk.dim(`  Readiness: ${status.readiness === 'READY' ? chalk.green('READY ✅') : chalk.red('NOT READY ❌')}`));
        console.log(chalk.dim(`  wal_level: ${status.walLevel}`));
        console.log(chalk.dim(`  archive_mode: ${status.archiveMode}`));
        console.log(chalk.dim(`  Base Backups Available: ${status.baseBackupCount}`));
        console.log(chalk.dim(`  Last Archived WAL: ${status.lastArchivedWal || 'None'}`));
        console.log(chalk.dim(`  Last Archive Time: ${status.lastArchivedAt ? status.lastArchivedAt.toISOString() : 'None'}`));
        console.log(chalk.dim(`  Earliest Recoverable Point: ${status.earliestRecoverableTime || 'None'}`));
        console.log(chalk.dim(`  Latest Recoverable Point: ${status.latestRecoverableTime || 'None'}`));
      } catch (err: any) {
        spinner.fail(chalk.red('Failed to fetch PITR status'));
        console.error(chalk.red(`\n✗ Error: ${err.message}`));
        process.exit(1);
      }
    });

  pitrCmd
    .command('backup')
    .description('Create a physical base backup via pg_basebackup for PITR')
    .option('-d, --database <name>', 'Database name')
    .option('--storage <name>', 'Storage location name')
    .option('--key <key>', 'Encryption key')
    .action(async (options) => {
      const dbConfig = config.get('database');
      if (!dbConfig || dbConfig.type !== 'postgresql') {
        console.error(chalk.red('\n✗ Active database must be PostgreSQL for PITR commands.'));
        process.exit(1);
      }

      if (options.database) {
        dbConfig.database = options.database;
      }

      const spinner = ora('Creating physical base backup via pg_basebackup...').start();
      try {
        const pitrService = new PostgresPitrService(dbConfig);
        const res = await pitrService.createBaseBackup({
          storageName: options.storage,
          key: options.key,
        });

        spinner.succeed(chalk.green('PITR physical base backup created successfully!'));
        console.log(chalk.cyan('\n✓ Base Backup Details:'));
        console.log(chalk.dim(`  Backup ID: ${res.backupId}`));
        console.log(chalk.dim(`  Start WAL File: ${res.startWalFile}`));
        console.log(chalk.dim(`  Timeline: ${res.timeline}`));
        console.log(chalk.dim(`  Size: ${(res.fileSize / 1024 / 1024).toFixed(2)} MB`));
        console.log(chalk.dim(`  Duration: ${res.duration.toFixed(2)} seconds`));
        console.log(chalk.dim(`  Storage Path: ${res.storagePath}`));
      } catch (err: any) {
        spinner.fail(chalk.red('PITR base backup failed'));
        console.error(chalk.red(`\n✗ Error: ${err.message}`));
        process.exit(1);
      }
    });

  pitrCmd
    .command('list')
    .description('List available physical base backups and recovery points')
    .option('-d, --database <name>', 'Database name')
    .action(async (options) => {
      const dbConfig = config.get('database');
      if (!dbConfig || dbConfig.type !== 'postgresql') {
        console.error(chalk.red('\n✗ Active database must be PostgreSQL for PITR commands.'));
        process.exit(1);
      }

      if (options.database) {
        dbConfig.database = options.database;
      }

      try {
        const pitrService = new PostgresPitrService(dbConfig);
        const list = await pitrService.listRecoveryPoints();
        console.log(chalk.cyan(`\n📦 Available Base Backups for ${dbConfig.database}:`));
        if (list.length === 0) {
          console.log(chalk.dim('  No physical base backups found. Run: db-backup pitr backup'));
          return;
        }

        list.forEach((b) => {
          console.log(chalk.dim(`  • Backup ID: ${b.backupId}`));
          console.log(chalk.dim(`    Created: ${new Date(b.startedAt).toISOString()}`));
          console.log(chalk.dim(`    Start WAL: ${b.startWalFile || 'N/A'}`));
          console.log(chalk.dim(`    Timeline: ${b.timeline}`));
          console.log(chalk.dim(`    Size: ${(b.fileSize / 1024 / 1024).toFixed(2)} MB`));
          console.log(chalk.dim(`    Storage: ${b.storagePath}`));
          console.log('');
        });
      } catch (err: any) {
        console.error(chalk.red(`\n✗ Error listing recovery points: ${err.message}`));
        process.exit(1);
      }
    });

  pitrCmd
    .command('restore')
    .description('Restore a PostgreSQL database to a specific point-in-time timestamp')
    .requiredOption('-t, --time <timestamp>', 'Recovery target timestamp (ISO-8601 with explicit timezone offset, e.g. 2026-08-17T14:30:00Z)')
    .requiredOption('--target <directory>', 'Isolated directory path to restore cluster into')
    .option('-p, --port <number>', 'Isolated cluster port number', '5433')
    .option('-d, --database <name>', 'Database name')
    .option('--storage <name>', 'Storage location name')
    .option('--key <key>', 'Encryption key')
    .option('--force', 'Overwrite target directory if not empty', false)
    .action(async (options) => {
      const dbConfig = config.get('database');
      if (!dbConfig || dbConfig.type !== 'postgresql') {
        console.error(chalk.red('\n✗ Active database must be PostgreSQL for PITR commands.'));
        process.exit(1);
      }

      if (options.database) {
        dbConfig.database = options.database;
      }

      const portNumber = parseInt(options.port, 10);
      const spinner = ora(`Restoring PostgreSQL cluster to timestamp ${options.time}...`).start();

      try {
        const pitrService = new PostgresPitrService(dbConfig);
        const res = await pitrService.restorePitr({
          time: options.time,
          target: options.target,
          port: portNumber,
          storageName: options.storage,
          key: options.key,
          force: options.force,
        });

        spinner.succeed(chalk.green('Point-in-Time Recovery successfully completed!'));
        console.log(chalk.cyan('\n✓ Recovery Details:'));
        console.log(chalk.dim(`  Recovered Timestamp Target: ${res.recoveredTimestamp}`));
        console.log(chalk.dim(`  Base Backup ID Used: ${res.baseBackupId}`));
        console.log(chalk.dim(`  Isolated Data Directory: ${res.targetDirectory}`));
        console.log(chalk.dim(`  Isolated PostgreSQL Port: ${res.port}`));
        console.log(chalk.green(`\n✓ Isolated cluster is running on port ${res.port}. Original database remains untouched.`));
      } catch (err: any) {
        spinner.fail(chalk.red('PITR restore failed'));
        console.error(chalk.red(`\n✗ Error: ${err.message}`));
        process.exit(1);
      }
    });

  pitrCmd
    .command('archive-wal')
    .description('Internal helper command invoked by PostgreSQL archive_command')
    .requiredOption('-d, --database <name>', 'Database name')
    .requiredOption('-f, --file <filename>', 'WAL filename (%f)')
    .requiredOption('-p, --path <filepath>', 'WAL source path (%p)')
    .option('--storage <name>', 'Storage name')
    .option('--key <key>', 'Encryption key')
    .action(async (options) => {
      try {
        const dbConfig = config.get('database') || { database: options.database, type: 'postgresql' };
        dbConfig.database = options.database;
        const pitrService = new PostgresPitrService(dbConfig);
        const success = await pitrService.archiveWal(options.file, options.path, {
          storageName: options.storage,
          key: options.key,
        });
        if (success) {
          process.exit(0);
        } else {
          process.exit(1);
        }
      } catch (err: any) {
        log.error('archive-wal command failed', { error: err.message });
        process.exit(1);
      }
    });

  pitrCmd
    .command('fetch-wal')
    .description('Internal helper command invoked by PostgreSQL restore_command')
    .requiredOption('-d, --database <name>', 'Database name')
    .requiredOption('-f, --file <filename>', 'WAL filename (%f)')
    .requiredOption('-p, --path <filepath>', 'WAL destination path (%p)')
    .option('--storage <name>', 'Storage name')
    .option('--key <key>', 'Encryption key')
    .action(async (options) => {
      try {
        const dbConfig = config.get('database') || { database: options.database, type: 'postgresql' };
        dbConfig.database = options.database;
        const pitrService = new PostgresPitrService(dbConfig);
        const success = await pitrService.fetchWal(options.file, options.path, {
          storageName: options.storage,
          key: options.key,
        });
        if (success) {
          process.exit(0);
        } else {
          process.exit(1);
        }
      } catch (err: any) {
        log.error('fetch-wal command failed', { error: err.message });
        process.exit(1);
      }
    });
}
