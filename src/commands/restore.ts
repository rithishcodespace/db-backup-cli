import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import {prisma} from "../lib/prisma"
import { createModuleLogger } from '../logger';
import { config } from '../config';

const log = createModuleLogger('restore-command');

export function registerRestoreCommand(program: Command): void {
  program
    .command('restore')
    .description('Restore a database from backup')
    .option('-i, --id <id>', 'Backup ID to restore')
    .option('-f, --file <path>', 'Local backup file path')
    .option('-t, --tables <tables>', 'Comma-separated tables to restore (if supported)')
    .option('--drop-existing', 'Drop existing tables before restore', false)
    .option('--dry-run', 'Perform a dry run without actual restore', false)
    .action(async (options) => {
      const spinner = ora('Preparing restore...').start();
      
      try {
        // Get database configuration
        const dbConfig = config.get('database');
        if (!dbConfig) {
          spinner.fail('No database configuration found');
          console.error(chalk.red('\n✗ Please run "db-backup connect" first'));
          process.exit(1);
        }
        
        let backupFile = options.file;
        let backupRecord = null;
        
        // If backup ID is provided, get backup details
        if (options.id) {
          backupRecord = await prisma.backupJob.findUnique({
            where: { id: options.id }
          });
          
          if (!backupRecord) {
            spinner.fail(`Backup with ID ${options.id} not found`);
            process.exit(1);
          }
          
          if (!backupRecord.filePath) {
            spinner.fail('Backup file path not found in record');
            process.exit(1);
          }
          
          backupFile = backupRecord.filePath;
        }
        
        if (!backupFile) {
          spinner.fail('Please specify a backup ID or file path');
          console.error(chalk.dim('\n  Use --id <backup-id> or --file <path>'));
          console.error(chalk.dim('\n  List available backups: db-backup list'));
          process.exit(1);
        }
        
        if (options.dryRun) {
          spinner.succeed(chalk.green('Dry run completed'));
          console.log(chalk.yellow('\n⚠ This was a dry run. No changes were made.'));
          console.log(chalk.dim(`\n  Would restore from: ${backupFile}`));
          if (options.tables) {
            console.log(chalk.dim(`  Tables: ${options.tables}`));
          }
          console.log(chalk.dim(`  Drop existing: ${options.dropExisting ? 'Yes' : 'No'}`));
          return;
        }
        
        spinner.text = 'Performing restore...';
        log.info('Starting restore', { backupFile, dbType: dbConfig.type });
        
        // Perform restore based on database type
        let result;
        
        switch (dbConfig.type) {
          case 'postgresql':
          case 'postgres':
            result = await restorePostgres(backupFile, dbConfig, options);
            break;
          case 'mysql':
            result = await restoreMySQL(backupFile, dbConfig, options);
            break;
          default:
            spinner.fail(`Restore not yet implemented for ${dbConfig.type}`);
            process.exit(1);
        }
        
        if (result.success) {
          spinner.succeed(chalk.green('Restore completed successfully!'));
          console.log(chalk.green('\n✓ Database restored'));
          console.log(chalk.dim(`  From: ${backupFile}`));
          console.log(chalk.dim(`  Duration: ${result.duration?.toFixed(2)}s`));
          
          log.info('Restore completed', { backupFile, duration: result.duration });
        } else {
          spinner.fail(chalk.red('Restore failed'));
          console.error(chalk.red(`\n✗ Error: ${result.error}`));
          process.exit(1);
        }
        
      } catch (error: any) {
        spinner.fail(chalk.red('Restore failed'));
        console.error(chalk.red(`\n✗ Error: ${error.message}`));
        log.error('Restore failed', { error: error.message });
        process.exit(1);
      }
    });
}

async function restorePostgres(backupFile: string, dbConfig: any, options: any): Promise<any> {
  // Implementation for PostgreSQL restore
  const { exec } = require('child_process'); // runs operating system commands from your Node.js application. eg: (ls -la -> like running it in terminal)
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  
  const startTime = Date.now();
  
  try {
    let command = `pg_restore -h ${dbConfig.host} -p ${dbConfig.port || 5432} -U ${dbConfig.username} -d ${dbConfig.database}`;
    
    if (options.tables) {
      const tables = options.tables.split(',');
      tables.forEach((table: string) => { command += ` -t ${table}`; });
    }
    
    if (options.dropExisting) {
      command += ' --clean --if-exists';
    }
    
    command += ` "${backupFile}"`;
    
    await execAsync(command, {
      env: { ...process.env, PGPASSWORD: dbConfig.password }
    });
    
    const duration = (Date.now() - startTime) / 1000;
    return { success: true, duration };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      duration: (Date.now() - startTime) / 1000
    };
  }
}

async function restoreMySQL(backupFile: string, dbConfig: any, options: any): Promise<any> {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  
  const startTime = Date.now();
  
  try {
    let command = `mysql -h ${dbConfig.host} -P ${dbConfig.port || 3306} -u ${dbConfig.username}`;
    
    if (dbConfig.password) {
      command += ` -p${dbConfig.password}`;
    }
    
    command += ` ${dbConfig.database}`;
    
    if (options.dropExisting) {
      // For MySQL, we need to handle this differently
      // Might need to drop tables first
    }
    
    command += ` < "${backupFile}"`;
    
    await execAsync(command);
    
    const duration = (Date.now() - startTime) / 1000;
    return { success: true, duration };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      duration: (Date.now() - startTime) / 1000
    };
  }
}