import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { createModuleLogger } from '../logger';
import { config } from '../config';
import { PostgresBackupService } from '../services/postgres-backup.service';
import { getDatabaseSize } from '../utils/db_connection';

const log = createModuleLogger('backup-command');

export function registerBackupCommand(program: Command): void {
  program
    .command('backup')
    .description('Perform a database backup')
    .option('-t, --type <type>', 'Backup type (full, incremental, differential)', 'full')
    .option('-c, --compress', 'Compress backup file', true)
    .option('-o, --output <path>', 'Output directory', config.get('storage.localPath'))
    .option('-n, --name <name>', 'Custom backup name')
    .option('--tables <tables>', 'Comma-separated list of tables to backup')
    .option('--exclude-tables <tables>', 'Comma-separated list of tables to exclude')
    .option('--no-compress', 'Disable compression')
    .option('--show-progress', 'Show detailed progress', true)
    .action(async (options) => {
      const spinner = ora('Initializing backup...').start();
      
      try {
        // Check if database is configured
        const dbConfig = config.get('database');
        if (!dbConfig) {
          spinner.fail('No database configuration found');
          console.error(chalk.red('\n✗ Please run "db-backup connect" first to configure database connection'));
          console.error(chalk.dim('\nExample: db-backup connect --type postgresql --host localhost --database mydb'));
          log.error('Backup attempted without database configuration');
          process.exit(1);
        }
        
        // Check if pg_dump is available
        if (dbConfig.type === 'postgresql' || dbConfig.type === 'postgres') {
          spinner.text = 'Checking PostgreSQL tools...';
          await checkPgDump();
        }
        
        // Get database size for estimation
        spinner.text = 'Analyzing database size...';
        let dbSize = 0;
        try {
          dbSize = await getDatabaseSize(dbConfig);
          const sizeMB = (dbSize / 1024 / 1024).toFixed(2);
          spinner.text = `Database size: ${sizeMB} MB. Preparing backup...`;
          console.log(chalk.dim(`\n📊 Database size: ${sizeMB} MB`));
        } catch (error) {
          console.log(chalk.yellow('⚠ Could not determine database size, proceeding anyway'));
        }
        
        // Parse tables options
        const tables = options.tables ? options.tables.split(',') : undefined;
        const excludeTables = options.excludeTables ? options.excludeTables.split(',') : undefined;
        
        // Generate backup name
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = options.name || `${dbConfig.database}_${timestamp}`;
        
        spinner.text = 'Starting backup operation...';
        log.info('Starting backup', { 
          type: options.type, 
          compress: options.compress, 
          dbType: dbConfig.type,
          tables,
          excludeTables
        });
        
        // Perform backup based on database type
        let result;
        
        switch (dbConfig.type) {
          case 'postgresql':
          case 'postgres':
            const backupService = new PostgresBackupService(dbConfig);
            result = await backupService.createBackup({
              type: options.type,
              compress: options.compress,
              output: options.output,
              name: backupName,
              tables,
              excludeTables,
            });
            break;
            
          default:
            spinner.fail(`Database type ${dbConfig.type} not yet supported in Phase 2`);
            console.error(chalk.yellow('\n⚠ Phase 2 currently supports PostgreSQL only'));
            console.error(chalk.dim('MySQL, MongoDB, and SQLite coming in Phase 3!'));
            process.exit(1);
        }
        
        if (result.success) {
          spinner.succeed(chalk.green('Backup completed successfully!'));
          
          console.log(chalk.green('\n✓ Backup Details:'));
          console.log(chalk.dim(`  ID: ${result.backupId}`));
          console.log(chalk.dim(`  Database: ${dbConfig.type}/${dbConfig.database}`));
          console.log(chalk.dim(`  Type: ${options.type}`));
          console.log(chalk.dim(`  Compressed: ${options.compress ? 'Yes' : 'No'}`));
          console.log(chalk.dim(`  File: ${path.basename(result.filePath!)}`));
          console.log(chalk.dim(`  Location: ${path.dirname(result.filePath!)}`));
          
          // Show file sizes
          if (result.fileSize) {
            const sizeMB = (result.fileSize / 1024 / 1024).toFixed(2);
            console.log(chalk.dim(`  Size: ${sizeMB} MB`));
          }
          
          if (result.compressedSize && result.compressedSize !== result.fileSize) {
            const compressionRatio = ((1 - result.compressedSize / result.fileSize!) * 100).toFixed(1);
            console.log(chalk.dim(`  Compression ratio: ${compressionRatio}%`));
          }
          
          if (result.duration) {
            console.log(chalk.dim(`  Duration: ${result.duration.toFixed(2)} seconds`));
          }
          
          if (result.checksum) {
            console.log(chalk.dim(`  Checksum: ${result.checksum.substring(0, 16)}...`));
          }
          
          console.log(chalk.blue('\n💡 Tip: Use "db-backup restore" to restore this backup (coming in Phase 6)'));
          
          log.info('Backup completed successfully', { 
            backupId: result.backupId,
            duration: result.duration,
            size: result.fileSize
          });
        } else {
          spinner.fail(chalk.red('Backup failed'));
          console.error(chalk.red(`\n✗ Error: ${result.error}`));
          
          if (result.error?.includes('pg_dump: not found')) {
            console.error(chalk.yellow('\n💡 Tip: PostgreSQL client tools are not installed.'));
            console.error(chalk.dim('  On Ubuntu/Debian: sudo apt-get install postgresql-client'));
            console.error(chalk.dim('  On macOS: brew install postgresql'));
            console.error(chalk.dim('  On Windows: Install PostgreSQL from https://www.postgresql.org/download/'));
          }
          
          log.error('Backup failed', { error: result.error, backupId: result.backupId });
          process.exit(1);
        }
      } catch (error) {
        spinner.fail(chalk.red('Backup failed'));
        console.error(chalk.red(`\n✗ Unexpected error: ${error instanceof Error ? error.message : String(error)}`));
        log.error('Unexpected error during backup', { error });
        process.exit(1);
      }
    });
}

async function checkPgDump(): Promise<void> {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  
  try {
    await execAsync('pg_dump --version');
  } catch (error) {
    throw new Error('pg_dump: not found. Please install PostgreSQL client tools.');
  }
}

// Helper to import path module
import path from 'path';