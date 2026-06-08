import { Command } from 'commander';
import chalk from 'chalk';
import { config } from './config';
import { logger } from './logger';
import { showHelp } from './commands/help';
import { registerConnectCommand } from './commands/connect';
import { registerBackupCommand } from './commands/backup';

// Creates CLI object
const program = new Command();

// Configure CLI
program
  .name('db-backup') // executable name
  .description('Database Backup CLI Utility - Backup and restore databases with ease') // show in help output
  .version(config.get('version'), '-v, --version', 'Display current version') // gets version from config, to these commands
  .option('-c, --config <path>', 'Path to configuration file')
  .option('--verbose', 'Enable verbose logging')
  .option('--no-color', 'Disable colored output')
  .hook('preAction', (thisCommand) => { // runs before any command executes
    const opts = thisCommand.opts(); // returns CLI flags like --verbose, etc,.. as {verbose: true}
    
    // Set log level based on verbose flag
    if (opts.verbose) {
      logger.level = 'debug';
      logger.debug('Verbose logging enabled');
    }
    
    // Disable colors if requested
    if (opts.noColor) {
      chalk.level = 0;
    }
    
    // logger start information
    logger.debug('CLI started', { 
      version: config.get('version'),
      args: process.argv,
    });
  });

// Register commands - now cli knows connect, register command exits
registerConnectCommand(program);
registerBackupCommand(program);

// Default help - creates help command
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
  program.parse(process.argv); // commander executes these commands
}

// Graceful shutdown
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

export default program;