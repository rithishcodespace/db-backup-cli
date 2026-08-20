import { Command } from 'commander';
import chalk from 'chalk';
import { config } from './config';
import { logger } from './logger';
import { showHelp } from './commands/help';
import { registerConnectCommand } from './commands/connect';
import { registerBackupCommand } from './commands/backup';
import { registerListCommand } from './commands/list';
import { registerRestoreCommand } from "./commands/restore";
import { registerScheduleCommand, registerScheduleListCommand } from "./commands/schedule";
import { registerStorageCommand } from './commands/storage';
import { registerNotificationCommand } from './commands/notification';
import { registerKeyCommand } from './commands/key';
import { registerInitCommand } from './commands/init';
import { registerConfigCheckCommand } from './commands/config-check';

  // Creates CLI object
  const program = new Command();

// WORKER MODE: Start BullMQ workers
console.log(process.argv);
if (process.argv.includes('--worker')) {
  console.log(chalk.blue('\n Starting BullMQ workers...'));
  console.log(chalk.dim('  • Backup Worker (processing backup jobs)'));
  console.log(chalk.dim('  • Storage Worker (uploading to S3/local)'));
  console.log(chalk.dim('  • Notification Worker (sending Slack/Email)'));
  console.log(chalk.dim(`\n  Redis: ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}\n`));
  
  // Import workers - this starts them automatically
  require('./microservices/backup-worker');
  
  // Keep the process alive for workers
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n🛑 Shutting down workers...'));
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log(chalk.yellow('\n🛑 Shutting down workers...'));
    process.exit(0);
  });
  
  // Workers will keep the process running
  // Do NOT call process.exit() here - workers need to stay alive
} else {

  // CLI MODE: Only runs when NOT in worker mode  
  // Configure CLI
  program
    .name('db-backup')
    .description('Database Backup CLI Utility - Backup and restore databases with ease')
    .version(config.get('version'), '-v, --version', 'Display current version')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('--verbose', 'Enable verbose logging')
    .option('--no-color', 'Disable colored output')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts();
      
      if (opts.verbose) {
        logger.level = 'debug';
        logger.debug('Verbose logging enabled');
      }
      
      if (process.env.NO_COLOR || process.argv.includes('--no-color')) {
        chalk.level = 0;
      } else {
        chalk.level = 3;
      }
      
      logger.debug('CLI started', { 
        version: config.get('version'),
        args: process.argv,
      });
    });

  // Register commands
  registerInitCommand(program);
  registerConfigCheckCommand(program);
  registerConnectCommand(program);
  registerBackupCommand(program);
  registerListCommand(program);
  registerRestoreCommand(program);
  registerScheduleCommand(program);
  registerScheduleListCommand(program);
  registerStorageCommand(program);
  registerNotificationCommand(program);
  registerKeyCommand(program);

  // Default help
  program
    .command('help')
    .description('Show help information')
    .action(() => {
      showHelp();
    });

  // Handle unknown commands
  program.on('command:*', (operands) => {
    console.error(chalk.red(`\n✗ Error: Unknown command '${operands[0]}'\n`));
    showHelp();
    process.exit(1);
  });

  // Parse arguments
  if (process.argv.length <= 2) {
    showHelp();
  } else {
    program.parse(process.argv);
  }

  // Graceful shutdown for CLI mode
  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down gracefully');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down gracefully');
    process.exit(0);
  });

  // Error handling
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error });
    console.error(chalk.red('\n✗ Fatal error:'), error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
    console.error(chalk.red('\n✗ Unhandled promise rejection:'), reason);
    process.exit(1);
  });

}

export default program;