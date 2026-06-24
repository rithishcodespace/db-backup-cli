import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import { createModuleLogger } from '../logger';
import { config } from '../config';

const log = createModuleLogger('backup-command');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';

export function registerBackupCommand(program: Command): void {
  program
    .command('backup')
    .description('Perform a database backup using microservices')
    .option('-t, --type <type>', 'Backup type (full, incremental, differential)', 'full')
    .option('-c, --compress', 'Compress backup file', true)
    .option('-o, --output <path>', 'Output directory')
    .option('-n, --name <name>', 'Custom backup name')
    .option('--tables <tables>', 'Comma-separated list of tables to backup')
    .option('--exclude-tables <tables>', 'Comma-separated list of tables to exclude')
    .option('--async', 'Run backup asynchronously (return immediately)', false)
    .option('--no-compress', 'Disable compression')
    .action(async (options) => {
      const spinner = ora('Preparing backup request...').start();
      
      try {
        // Get database configuration
        const dbConfig = config.get('database'); // calls get() in config/index.ts, from this we get entire database config
        if (!dbConfig) {
          spinner.fail('No database configuration found');
          console.error(chalk.red('\n✗ Please run "db-backup connect" first'));
          process.exit(1);
        }
        
        // Parse tables options
        const tables = options.tables ? options.tables.split(',') : undefined;
        const excludeTables = options.excludeTables ? options.excludeTables.split(',') : undefined;
        
        // Prepare backup request
        const backupRequest = {
          dbConfig: {
            type: dbConfig.type,
            host: dbConfig.host,
            port: dbConfig.port,
            username: dbConfig.username,
            password: dbConfig.password,
            database: dbConfig.database,
            ssl: dbConfig.ssl
          },
          backupType: options.type,
          options: {
            compress: options.compress,
            tables,
            excludeTables,
            outputPath: options.output || config.get('storage.localPath'),
            backupName: options.name
          }
        };
        
        spinner.text = 'Sending backup request to orchestrator...';
        log.debug('Sending backup request', { dbType: dbConfig.type });
        
        // Send request to API Gateway
        const response = await axios.post(`${GATEWAY_URL}/api/backup`, backupRequest); // gateway -> orhestrator -> correct service
        
        if (response.data.success) {
          spinner.succeed(chalk.green('Backup completed successfully!'));
          
          console.log(chalk.green('\n✓ Backup Details:'));
          console.log(chalk.dim(`  Backup ID: ${response.data.backupId}`));
          console.log(chalk.dim(`  Database: ${dbConfig.type}/${dbConfig.database}`));
          console.log(chalk.dim(`  Type: ${options.type}`));
          
          if (response.data.fileSize) {
            const sizeMB = (response.data.fileSize / 1024 / 1024).toFixed(2);
            console.log(chalk.dim(`  Size: ${sizeMB} MB`));
          }
          
          if (response.data.duration) {
            console.log(chalk.dim(`  Duration: ${response.data.duration.toFixed(2)} seconds`));
          }
          
          if (response.data.filePath) {
            console.log(chalk.dim(`  Location: ${response.data.filePath}`));
          }
          
          log.info('Backup completed via microservices', { backupId: response.data.backupId });
        } else {
          spinner.fail(chalk.red('Backup failed'));
          console.error(chalk.red(`\n✗ Error: ${response.data.error}`));
          process.exit(1);
        }
        
      } catch (error: any) {
        spinner.fail(chalk.red('Backup request failed'));
        
        if (error.code === 'ECONNREFUSED') {
          console.error(chalk.red('\n✗ Cannot connect to API Gateway.'));
          console.error(chalk.yellow('\n💡 Make sure microservices are running:'));
          console.error(chalk.dim('  npm run services:start'));
          console.error(chalk.dim('  or'));
          console.error(chalk.dim('  docker-compose up'));
        } else {
          console.error(chalk.red(`\n✗ Error: ${error.response?.data?.error || error.message}`));
        }
        
        log.error('Backup request failed', { error: error.message });
        process.exit(1);
      }
    });
}