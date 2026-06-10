import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { config } from '../config';
import { createModuleLogger } from '../logger';
import { testConnection } from '../utils/db_connection';

const log = createModuleLogger('connect-command');

export function registerConnectCommand(program: Command): void {
  program
    .command('connect')
    .description('Connect to a database and test connection')
    .requiredOption('-t, --type <type>', 'Database type (postgresql, mysql, mongodb, sqlite)')
    .option('-H, --host <host>', 'Database host', 'localhost')
    .option('-p, --port <port>', 'Database port', (val) => parseInt(val))
    .option('-u, --user <username>', 'Database username')
    .option('-P, --password <password>', 'Database password')
    .option('-d, --database <database>', 'Database name')
    .option('--ssl', 'Enable SSL connection')
    .action(async (options) => {
      const spinner = ora('Testing database connection...').start();
      
      try {
        // Validate required options
        if (!options.database && options.type !== 'sqlite') {
          spinner.fail('Database name is required');
          console.error(chalk.red('Error: --database option is required for this database type'));
          log.error('Connection failed: missing database name');
          process.exit(1);
        }

        // Build connection config
        const dbConfig: any = {
          type: options.type,
          host: options.host,
          port: options.port,
          username: options.user,
          password: options.password,
          database: options.database,
          ssl: options.ssl,
        };

        // Remove undefined values
        Object.keys(dbConfig).forEach(key => 
          dbConfig[key] === undefined && delete dbConfig[key]
        );

        log.debug('Testing connection with config', { ...dbConfig, password: '***' });

        // Test connection
        const result = await testConnection(dbConfig);
        
        if (result.success) {
          spinner.succeed(chalk.green('Connection successful!'));
          console.log(chalk.green(`\n✓ Connected to ${options.type} database`));
          if (options.host) console.log(chalk.dim(`  Host: ${options.host}:${options.port || 'default'}`));
          if (options.database) console.log(chalk.dim(`  Database: ${options.database}`));
          if (result.version) console.log(chalk.dim(`  Version: ${result.version}`));
          
          // Save configuration
          config.setDatabase(dbConfig);
          console.log(chalk.blue('\n✓ Configuration saved to config.json'));
          
          log.info('Database connection successful', { 
            type: options.type, 
            host: options.host,
            database: options.database 
          });
        } else {
          spinner.fail(chalk.red('Connection failed'));
          console.error(chalk.red(`\n✗ Error: ${result.error}`));
          log.error('Database connection failed', { error: result.error });
          process.exit(1);
        }
      } catch (error) {
        spinner.fail(chalk.red('Connection error'));
        console.error(chalk.red(`\n✗ Unexpected error: ${error instanceof Error ? error.message : String(error)}`));
        log.error('Unexpected error during connection', { error });
        process.exit(1);
      }
    });
}