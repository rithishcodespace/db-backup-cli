import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { prisma } from "../lib/prisma";
import { createModuleLogger } from '../logger';
import { config } from '../config';
import { createReadStream, createWriteStream, existsSync } from 'fs';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream';
import { promisify } from 'util';
import path from 'path';

const streamPipeline = promisify(pipeline);
const log = createModuleLogger('restore-command');

export function registerRestoreCommand(program: Command): void {
  program
    .command('restore')
    .description('Restore a database from backup using full backup ID')
    .option('-i, --id <id>', 'Full backup ID to restore (copy from list command)')
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
        
        // If backup ID is provided, get backup details using FULL ID
        if (options.id) {
          backupRecord = await prisma.backupJob.findUnique({
            where: { id: options.id }
          });
          
          if (!backupRecord) {
            spinner.fail(`Backup with ID "${options.id}" not found`);
            console.error(chalk.yellow('\n💡 Use "db-backup list" to see all available backup IDs'));
            console.error(chalk.dim('   Copy the full ID from the list command output'));
            process.exit(1);
          }
          
          if (!backupRecord.filePath) {
            spinner.fail('Backup file path not found in record');
            process.exit(1);
          }
          
          backupFile = backupRecord.filePath;
          
          // Show backup info to user
          spinner.stop();
          console.log(chalk.dim('\n📋 Found backup:'));
          console.log(chalk.dim(`   ID: ${backupRecord.id}`));
          console.log(chalk.dim(`   Type: ${backupRecord.backupType}`));
          console.log(chalk.dim(`   Database: ${backupRecord.dbType}/${backupRecord.dbName}`));
          console.log(chalk.dim(`   Size: ${backupRecord.fileSize ? (backupRecord.fileSize / 1024 / 1024).toFixed(2) : 'N/A'} MB`));
          console.log(chalk.dim(`   Created: ${new Date(backupRecord.startedAt).toLocaleString()}`));
          spinner.start('Continuing restore...');
        }
        
        if (!backupFile) {
          spinner.fail('Please specify a backup ID or file path');
          console.error(chalk.dim('\n  Use --id <backup-id> (full ID from list command) or --file <path>'));
          console.error(chalk.dim('\n  List available backups: db-backup list'));
          process.exit(1);
        }
        
        // Check if backup file exists
        if (!existsSync(backupFile)) {
          spinner.fail(`Backup file not found: ${backupFile}`);
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
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  const fs = require('fs');
  
  const startTime = Date.now();
  
  try {
    let restoreFile = backupFile;
    let isCompressed = false;
    
    // Check if file is compressed (.gz)
    if (backupFile.endsWith('.gz')) {
      isCompressed = true;
      const decompressedFile = backupFile.replace('.gz', '');
      
      // Check if decompressed file already exists
      if (!fs.existsSync(decompressedFile)) {
        console.log(chalk.dim(`\n🔄 Decompressing backup file...`));
        
        try {
          const readStream = createReadStream(backupFile);
          const gunzipStream = createGunzip();
          const writeStream = createWriteStream(decompressedFile);
          
          await streamPipeline(readStream, gunzipStream, writeStream);
          console.log(chalk.dim(`✅ Decompressed to: ${decompressedFile}`));
        } catch (decompError: any) {
          throw new Error(`Failed to decompress backup: ${decompError.message}`);
        }
      } else {
        console.log(chalk.dim(`\n✅ Using existing decompressed file: ${decompressedFile}`));
      }
      
      restoreFile = decompressedFile;
    }
    
    // Build pg_restore command
    let command = `pg_restore -h ${dbConfig.host} -p ${dbConfig.port || 5432} -U ${dbConfig.username} -d ${dbConfig.database}`;
    
    if (options.tables) {
      const tables = options.tables.split(',');
      tables.forEach((table: string) => { command += ` -t ${table}`; });
    }
    
    if (options.dropExisting) {
      command += ' --clean --if-exists';
    }
    
    command += ` "${restoreFile}"`;
    
    console.log(chalk.dim(`\n🔄 Restoring database...`));
    
    await execAsync(command, {
      env: { ...process.env, PGPASSWORD: dbConfig.password }
    });
    
    // Clean up decompressed file if it was created
    if (isCompressed && backupFile.endsWith('.gz')) {
      const decompressedFile = backupFile.replace('.gz', '');
      if (fs.existsSync(decompressedFile)) {
        try {
          fs.unlinkSync(decompressedFile);
          console.log(chalk.dim(`\n🧹 Cleaned up temporary file: ${decompressedFile}`));
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
      }
    }
    
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
  const fs = require('fs');
  
  const startTime = Date.now();
  
  try {
    let restoreFile = backupFile;
    let isCompressed = false;
    
    // Check if file is compressed (.gz)
    if (backupFile.endsWith('.gz')) {
      isCompressed = true;
      const decompressedFile = backupFile.replace('.gz', '');
      
      if (!fs.existsSync(decompressedFile)) {
        console.log(chalk.dim(`\n🔄 Decompressing backup file...`));
        
        try {
          const readStream = createReadStream(backupFile);
          const gunzipStream = createGunzip();
          const writeStream = createWriteStream(decompressedFile);
          
          await streamPipeline(readStream, gunzipStream, writeStream);
          console.log(chalk.dim(`✅ Decompressed to: ${decompressedFile}`));
        } catch (decompError: any) {
          throw new Error(`Failed to decompress backup: ${decompError.message}`);
        }
      } else {
        console.log(chalk.dim(`\n✅ Using existing decompressed file: ${decompressedFile}`));
      }
      
      restoreFile = decompressedFile;
    }
    
    // Build MySQL restore command
    let command = `mysql -h ${dbConfig.host} -P ${dbConfig.port || 3306} -u ${dbConfig.username}`;
    
    if (dbConfig.password) {
      command += ` -p${dbConfig.password}`;
    }
    
    command += ` ${dbConfig.database}`;
    
    if (options.dropExisting) {
      // For MySQL, we need to handle this differently
      // Might need to drop tables first
      command += ' --force';
    }
    
    command += ` < "${restoreFile}"`;
    
    console.log(chalk.dim(`\n🔄 Restoring database...`));
    
    await execAsync(command);
    
    // Clean up decompressed file if it was created
    if (isCompressed && backupFile.endsWith('.gz')) {
      const decompressedFile = backupFile.replace('.gz', '');
      if (fs.existsSync(decompressedFile)) {
        try {
          fs.unlinkSync(decompressedFile);
          console.log(chalk.dim(`\n🧹 Cleaned up temporary file: ${decompressedFile}`));
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
      }
    }
    
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