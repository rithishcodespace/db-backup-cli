import { Command } from 'commander';
import chalk from 'chalk';
import { prisma } from "../lib/prisma";
import httpClient from '../utils/http-client';
import { createModuleLogger } from '../logger';
import { ListBackupsUseCase } from '../application/use-cases/list-backups.use-case';
import { PrismaBackupRepository } from '../infrastructure/repositories/prisma-backup.repository';

const log = createModuleLogger('list-command');

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List available backups with full IDs for restore')
    .option('-d, --database <name>', 'Filter by database name')
    .option('-t, --type <type>', 'Filter by backup type (full, incremental, differential)')
    .option('-l, --limit <number>', 'Maximum number of backups to show', '20')
    .option('--status <status>', 'Filter by status (success, failed, running)', 'success')
    .option('--full-id', 'Show full backup IDs (default: true)', true)
    .action(async (options) => {
      try {
        const repo = new PrismaBackupRepository(prisma as any);
        const listUseCase = new ListBackupsUseCase(repo);

        const backups = await listUseCase.execute({
          database: options.database,
          type: options.type,
          limit: parseInt(options.limit, 10),
          status: options.status,
        });
        
        if (backups.length === 0) {
          console.log(chalk.yellow('\n📭 No backups found'));
          console.log(chalk.dim('\nRun "db-backup backup" to create your first backup'));
          process.exit(0);
        }
        
        console.log(chalk.bold.cyan(`\n📋 Found ${backups.length} Backup(s):\n`));
        console.log(chalk.dim('─'.repeat(80)));
        
        backups.forEach((backup, index) => {
          const statusColor = backup.status === 'success' ? chalk.green : 
                             backup.status === 'failed' ? chalk.red : chalk.yellow;
          
          const date = new Date(backup.startedAt).toLocaleString();
          const size = backup.fileSize ? (backup.fileSize / 1024 / 1024).toFixed(2) : 'N/A';
          
          // Show FULL backup ID - not truncated
          console.log(`${chalk.bold.white(`${index + 1}.`)} ${chalk.bold(backup.id)}`);
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
        
        console.log(chalk.dim('─'.repeat(80)));
        console.log(chalk.dim(`\n💡 To restore, use: db-backup restore --id <full-backup-id>`));
        
        log.info('Listed backups', { count: backups.length, filters: options });
        process.exit(0);
      } catch (error: any) {
        if (error?.message?.startsWith('process.exit')) {
          throw error;
        }
        console.error(chalk.red('\n✗ Failed to list backups:'), error);
        log.error('Failed to list backups', { error });
        process.exit(1);
      }
    });
}