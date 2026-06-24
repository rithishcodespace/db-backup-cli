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
    .option('--force', 'Force restore (drop existing tables)', false)
    .action(async (options) => {
      const spinner = ora('Preparing restore...').start();
      
      try {
        const dbConfig = config.get('database');
        if (!dbConfig) {
          spinner.fail('No database configuration found');
          console.error(chalk.red('\n✗ Please run "db-backup connect" first'));
          process.exit(1);
        }
        
        let backupFile = options.file;
        let backupRecord = null;
        
        if (options.id) {
          backupRecord = await prisma.backupJob.findUnique({
            where: { id: options.id }
          });
          
          if (!backupRecord) {
            spinner.fail(`Backup with ID "${options.id}" not found`);
            console.error(chalk.yellow('\n💡 Use "db-backup list" to see all available backup IDs'));
            process.exit(1);
          }
          
          if (!backupRecord.filePath) {
            spinner.fail('Backup file path not found in record');
            process.exit(1);
          }
          
          backupFile = backupRecord.filePath;
          
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
          console.error(chalk.dim('\n  Use --id <backup-id> or --file <path>'));
          console.error(chalk.dim('\n  List available backups: db-backup list'));
          process.exit(1);
        }
        
        if (!existsSync(backupFile)) {
          spinner.fail(`Backup file not found: ${backupFile}`);
          process.exit(1);
        }
        
        // If drop-existing is set, warn user
        if (options.dropExisting || options.force) {
          spinner.stop();
          console.log(chalk.yellow('\n⚠ WARNING: --drop-existing will drop existing tables before restore.'));
          console.log(chalk.dim('   This will delete all data in the target database.'));
          
          const readline = require('readline');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          });
          
          const answer = await new Promise((resolve) => {
            rl.question(chalk.yellow('\nContinue? (y/N): '), resolve);
          });
          rl.close();
          
          if (typeof answer === 'string' && answer.toLowerCase() !== 'y') {
            console.log(chalk.yellow('\nRestore cancelled'));
            process.exit(0);
          }
          spinner.start('Continuing restore...');
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
          console.error(chalk.red(`\n✗ ${result.error}`));
          
          // Show helpful tips based on error
          if (result.error?.includes('already exists')) {
            console.log(chalk.yellow('\n💡 Tip: Use --drop-existing to drop existing tables before restore'));
            console.log(chalk.dim('   db-backup restore --id <backup-id> --drop-existing'));
          }
          if (result.error?.includes('duplicate key')) {
            console.log(chalk.yellow('\n💡 Tip: Use --drop-existing to clean the database before restore'));
            console.log(chalk.dim('   db-backup restore --id <backup-id> --drop-existing'));
          }
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
    let isGzipped = false;
    
    // Check if file is gzipped (.gz)
    // For custom format, pg_restore can read .gz directly, but we need to handle it properly
    if (backupFile.endsWith('.gz')) {
      // Check if it's a custom format dump (pg_dump -Fc) that was gzipped
      // Try to read the first few bytes to check if it's a valid gzip
      try {
        const fileBuffer = fs.readFileSync(backupFile, { encoding: null, length: 2 });
        // Gzip magic number is 0x1f 0x8b
        if (fileBuffer[0] === 0x1f && fileBuffer[1] === 0x8b) {
          isGzipped = true;
          const decompressedFile = backupFile.replace('.gz', '');
          
          if (!fs.existsSync(decompressedFile)) {
            console.log(chalk.dim(`\n🔄 Decompressing backup file...`));
            
            const readStream = createReadStream(backupFile);
            const gunzipStream = createGunzip();
            const writeStream = createWriteStream(decompressedFile);
            
            await streamPipeline(readStream, gunzipStream, writeStream);
            console.log(chalk.dim(`✅ Decompressed to: ${decompressedFile}`));
          }
          
          restoreFile = decompressedFile;
        } else {
          // It's a custom format dump with .gz extension but not actually gzipped
          console.log(chalk.dim(`\n📦 Using custom format dump directly (not actually gzipped)`));
          restoreFile = backupFile;
        }
      } catch (e) {
        // If can't read, assume it's a custom format dump
        restoreFile = backupFile;
      }
    }
    
    // Build pg_restore command
    let command = `pg_restore -h ${dbConfig.host} -p ${dbConfig.port || 5432} -U ${dbConfig.username} -d ${dbConfig.database}`;
    
    if (options.tables) {
      const tables = options.tables.split(',');
      tables.forEach((table: string) => { command += ` -t ${table}`; });
    }
    
    // Always use --clean and --if-exists when drop-existing is true
    if (options.dropExisting || options.force) {
      command += ' --clean --if-exists';
    }
    
    // Add verbose option for better error messages
    command += ' --verbose';
    
    command += ` "${restoreFile}"`;
    
    console.log(chalk.dim(`\n🔄 Restoring database...`));
    
    try {
      await execAsync(command, {
        env: { ...process.env, PGPASSWORD: dbConfig.password },
        maxBuffer: 50 * 1024 * 1024
      });
    } catch (pgError: any) {
      // Parse and format the error message
      let errorMessage = pgError.message;
      
      // Extract the most relevant error
      const errorLines = errorMessage.split('\n');
      let userFriendlyError = '';
      
      for (const line of errorLines) {
        if (line.includes('ERROR:')) {
          userFriendlyError = line.trim();
          break;
        }
        if (line.includes('already exists')) {
          userFriendlyError = 'Database objects already exist. Use --drop-existing to clean the database first.';
          break;
        }
        if (line.includes('duplicate key')) {
          userFriendlyError = 'Duplicate data found. Use --drop-existing to clean the database first.';
          break;
        }
        if (line.includes('permission denied')) {
          userFriendlyError = 'Permission denied. Check your database credentials.';
          break;
        }
      }
      
      if (!userFriendlyError) {
        // Get the last few lines of the error
        const lastLines = errorLines.slice(-5).join('\n');
        userFriendlyError = `Restore failed:\n${lastLines}`;
      }
      
      // Clean up decompressed file if it was created
      if (isGzipped && backupFile.endsWith('.gz')) {
        const decompressedFile = backupFile.replace('.gz', '');
        if (fs.existsSync(decompressedFile)) {
          try {
            fs.unlinkSync(decompressedFile);
          } catch (cleanupError) {
            // Ignore
          }
        }
      }
      
      return {
        success: false,
        error: userFriendlyError,
        duration: (Date.now() - startTime) / 1000
      };
    }
    
    // Clean up decompressed file if it was created
    if (isGzipped && backupFile.endsWith('.gz')) {
      const decompressedFile = backupFile.replace('.gz', '');
      if (fs.existsSync(decompressedFile)) {
        try {
          fs.unlinkSync(decompressedFile);
          console.log(chalk.dim(`\n🧹 Cleaned up temporary file: ${decompressedFile}`));
        } catch (cleanupError) {
          // Ignore
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
    let isGzipped = false;
    
    if (backupFile.endsWith('.gz')) {
      try {
        const fileBuffer = fs.readFileSync(backupFile, { encoding: null, length: 2 });
        if (fileBuffer[0] === 0x1f && fileBuffer[1] === 0x8b) {
          isGzipped = true;
          const decompressedFile = backupFile.replace('.gz', '');
          
          if (!fs.existsSync(decompressedFile)) {
            console.log(chalk.dim(`\n🔄 Decompressing backup file...`));
            
            const readStream = createReadStream(backupFile);
            const gunzipStream = createGunzip();
            const writeStream = createWriteStream(decompressedFile);
            
            await streamPipeline(readStream, gunzipStream, writeStream);
            console.log(chalk.dim(`✅ Decompressed to: ${decompressedFile}`));
          }
          
          restoreFile = decompressedFile;
        } else {
          restoreFile = backupFile;
        }
      } catch (e) {
        restoreFile = backupFile;
      }
    }
    
    let command = `mysql -h ${dbConfig.host} -P ${dbConfig.port || 3306} -u ${dbConfig.username}`;
    
    if (dbConfig.password) {
      command += ` -p${dbConfig.password}`;
    }
    
    command += ` ${dbConfig.database}`;
    
    if (options.dropExisting || options.force) {
      command += ' --force';
    }
    
    command += ` < "${restoreFile}"`;
    
    console.log(chalk.dim(`\n🔄 Restoring database...`));
    
    try {
      await execAsync(command, { maxBuffer: 50 * 1024 * 1024 });
    } catch (mysqlError: any) {
      let userFriendlyError = mysqlError.message;
      
      if (mysqlError.message.includes('Access denied')) {
        userFriendlyError = 'Access denied. Check your database credentials.';
      } else if (mysqlError.message.includes('Unknown database')) {
        userFriendlyError = `Database '${dbConfig.database}' does not exist. Please create it first.`;
      } else if (mysqlError.message.includes('already exists')) {
        userFriendlyError = 'Tables already exist. Use --drop-existing to clean the database first.';
      }
      
      return {
        success: false,
        error: userFriendlyError,
        duration: (Date.now() - startTime) / 1000
      };
    }
    
    if (isGzipped && backupFile.endsWith('.gz')) {
      const decompressedFile = backupFile.replace('.gz', '');
      if (fs.existsSync(decompressedFile)) {
        try {
          fs.unlinkSync(decompressedFile);
          console.log(chalk.dim(`\n🧹 Cleaned up temporary file: ${decompressedFile}`));
        } catch (cleanupError) {
          // Ignore
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