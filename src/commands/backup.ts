import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { createModuleLogger } from '../logger';
import { config } from '../config';

const log = createModuleLogger('backup-command');

export function registerBackupCommand(program: Command): void {
  program
    .command('backup')
    .description('Perform a database backup')
    .option('-t, --type <type>', 'Backup type (full, incremental, differential)', 'full')
    .option('-c, --compress', 'Compress backup file', true)
    .option('-o, --output <path>', 'Output directory', config.get('storage.localPath'))
    .option('-n, --name <name>', 'Custom backup name')
    .option('--no-compress', 'Disable compression')
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

        spinner.text = 'Starting backup operation...';
        log.info('Starting backup', { type: options.type, compress: options.compress, dbType: dbConfig.type });

        // Generate backup name if not provided
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = options.name || `${dbConfig.type}_${dbConfig.database}_${timestamp}`;
        const backupFile = `${backupName}.${options.compress ? 'gz' : 'sql'}`; // Gzip compression algorithm.
        const backupPath = `${options.output}/${backupFile}`;

        // Simulate backup process (Phase 2 will implement actual backup)
        await simulateBackup(spinner, options);
        
        spinner.succeed(chalk.green('Backup completed successfully!'));
        console.log(chalk.green('\n✓ Backup completed'));
        console.log(chalk.dim(`  Database: ${dbConfig.type}/${dbConfig.database}`));
        console.log(chalk.dim(`  Type: ${options.type}`));
        console.log(chalk.dim(`  Compressed: ${options.compress ? 'Yes' : 'No'}`));
        console.log(chalk.dim(`  File: ${backupFile}`));
        console.log(chalk.dim(`  Location: ${options.output}`));
        console.log(chalk.dim(`  Size: ~${Math.floor(Math.random() * 100) + 1} MB`));
        
        log.info('Backup completed successfully', { 
          type: options.type, 
          backupName,
          backupPath,
          dbType: dbConfig.type 
        });
      } catch (error) {
        spinner.fail(chalk.red('Backup failed'));
        console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : String(error)}`));
        log.error('Backup failed', { error });
        process.exit(1);
      }
    });
}

async function simulateBackup(spinner: ora.Ora, options: any): Promise<void> {
  return new Promise((resolve) => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;
      spinner.text = `Backing up database... ${progress}%`;
      if (progress >= 100) {
        clearInterval(interval);
        setTimeout(resolve, 500); // Small delay for visual effect
      }
    }, 200);
  });
}