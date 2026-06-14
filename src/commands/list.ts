// for backup list command

import { Command } from 'commander';
import chalk from 'chalk';
import { PrismaClient } from "@prisma/client";
import { createModuleLogger } from '../logger';
import { config } from '../config';

const prisma = new PrismaClient();
const log = createModuleLogger('list-command');

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List available backups')
    .option('-d, --database <name>', 'Filter by database name')
    .option('-t, --type <type>', 'Filter by backup type (full, incremental, differential)')
    .option('-l, --limit <number>', 'Maximum number of backups to show', '20') // defalult 20
    .option('--status <status>', 'Filter by status (success, failed, running)', 'success') // defalut success
    .action(async (options) => {
      try {
        const where: any = {
          status: options.status,
        };
        
        if (options.database) {
          where.dbName = options.database;
        }
        
        if (options.type) {
          where.backupType = options.type;
        }
        
        const backups = await prisma.backupJob.findMany({
          where,
          orderBy: {
            startedAt: 'desc',
          },
          take: parseInt(options.limit),
        });
        
        if (backups.length === 0) {
          console.log(chalk.yellow('\n📭 No backups found'));
          console.log(chalk.dim('\nRun "db-backup backup" to create your first backup'));
          return;
        }
        
        console.log(chalk.bold.cyan(`\n📋 Found ${backups.length} Backup(s):\n`));
        
        backups.forEach((backup, index) => {
          const statusColor = backup.status === 'success' ? chalk.green : 
                             backup.status === 'failed' ? chalk.red : chalk.yellow;
          
          const date = new Date(backup.startedAt).toLocaleString();
          const size = backup.fileSize ? (backup.fileSize / 1024 / 1024).toFixed(2) : 'N/A';
          
          console.log(`${chalk.bold.white(`${index + 1}.`)} ${chalk.bold(backup.id.substring(0, 16))}...`);
          console.log(`   ${chalk.dim('Date:')} ${date}`);
          console.log(`   ${chalk.dim('Type:')} ${backup.backupType} | ${chalk.dim('Status:')} ${statusColor(backup.status)}`);
          console.log(`   ${chalk.dim('Database:')} ${backup.dbType}/${backup.dbName}`);
          console.log(`   ${chalk.dim('Size:')} ${size} MB`);
          
          if (backup.duration) {
            console.log(`   ${chalk.dim('Duration:')} ${backup.duration.toFixed(2)}s`);
          }
          
          if (backup.filePath) {
            console.log(`   ${chalk.dim('Path:')} ${backup.filePath}`);
          }
          
          if (backup.error) {
            console.log(`   ${chalk.red('Error:')} ${backup.error.substring(0, 100)}`);
          }
          
          console.log('');
        });
        
        log.info('Listed backups', { count: backups.length, filters: options });
        
      } catch (error) {
        console.error(chalk.red('\n✗ Failed to list backups:'), error);
        log.error('Failed to list backups', { error });
      }
    });
}