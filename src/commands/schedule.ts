import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import { createModuleLogger } from '../logger';
import { config } from '../config';

const log = createModuleLogger('schedule-command');

const SCHEDULER_URL = process.env.SCHEDULER_URL || 'http://localhost:3020';

export function registerScheduleCommand(program: Command): void {
  program
    .command('schedule')
    .description('Schedule automated backups')
    .option('-c, --cron <expression>', 'Cron expression (e.g., "0 2 * * *" for daily at 2am)')
    .option('-t, --type <type>', 'Backup type (full, incremental, differential)', 'full')
    .option('-n, --name <name>', 'Schedule name')
    .option('--storage <type>', 'Storage type (local, s3)', 'local')
    .option('--retention <days>', 'Retention period in days', '30')
    .option('--slack <url>', 'Slack webhook URL for notifications')
    .option('--email <emails>', 'Email addresses for notifications (comma-separated)')
    .action(async (options) => {
      const spinner = ora('Creating backup schedule...').start();
      
      try {
        // Get database configuration
        const dbConfig = config.get('database');
        if (!dbConfig) {
          spinner.fail('No database configuration found');
          console.error(chalk.red('\n✗ Please run "db-backup connect" first'));
          process.exit(1);
        }
        
        // Validate cron expression
        if (!options.cron) {
          spinner.fail('Cron expression is required');
          console.error(chalk.red('\n✗ Please provide a cron expression with --cron'));
          console.error(chalk.dim('\nExamples:'));
          console.error(chalk.dim('  "0 2 * * *"     - Daily at 2am'));
          console.error(chalk.dim('  "0 */6 * * *"   - Every 6 hours'));
          console.error(chalk.dim('  "0 0 * * 0"     - Weekly on Sunday'));
          process.exit(1);
        }
        
        const scheduleConfig = {
          schedule: options.cron,
          dbConfig,
          backupType: options.type,
          options: {
            compress: true,
            storageType: options.storage,
            name: options.name || `${dbConfig.database}_backup`
          },
          storageType: options.storage,
          notification: {
            type: options.slack ? 'slack' : options.email ? 'email' : null,
            details: {
              webhookUrl: options.slack,
              to: options.email,
              from: 'backup@system.local'
            }
          },
          retention: parseInt(options.retention)
        };
        
        spinner.text = 'Sending schedule request...';
        
        const response = await axios.post(`${SCHEDULER_URL}/api/schedule`, scheduleConfig);
        
        if (response.data.success) {
          spinner.succeed(chalk.green('Backup schedule created!'));
          
          console.log(chalk.green('\n✓ Schedule Details:'));
          console.log(chalk.dim(`  ID: ${response.data.scheduleId}`));
          console.log(chalk.dim(`  Name: ${scheduleConfig.options.name}`));
          console.log(chalk.dim(`  Schedule: ${options.cron}`));
          console.log(chalk.dim(`  Type: ${options.type}`));
          console.log(chalk.dim(`  Storage: ${options.storage}`));
          console.log(chalk.dim(`  Retention: ${options.retention} days`));
          console.log(chalk.dim(`  Next Run: ${response.data.nextRun || 'Calculating...'}`));
          
          log.info('Schedule created', { scheduleId: response.data.scheduleId });
        } else {
          spinner.fail(chalk.red('Failed to create schedule'));
          console.error(chalk.red(`\n✗ Error: ${response.data.error}`));
        }
        
      } catch (error: any) {
        spinner.fail(chalk.red('Failed to create schedule'));
        
        if (error.response?.data?.error) {
          console.error(chalk.red(`\n✗ ${error.response.data.error}`));
        } else if (error.code === 'ECONNREFUSED') {
          console.error(chalk.red('\n✗ Cannot connect to Scheduler Service.'));
          console.error(chalk.yellow('\n Make sure microservices are running:'));
          console.error(chalk.dim('  npm run services:start'));
        } else {
          console.error(chalk.red(`\n✗ Error: ${error.message}`));
        }
        
        log.error('Schedule creation failed', { error: error.message });
        process.exit(1);
      }
    });
}

export function registerScheduleListCommand(program: Command): void {
  program
    .command('schedule:list')
    .description('List all scheduled backups')
    .action(async () => {
      try {
        const response = await axios.get(`${SCHEDULER_URL}/api/schedule`);
        
        if (!response.data.success || response.data.schedules.length === 0) {
          console.log(chalk.yellow('\n📭 No schedules found'));
          console.log(chalk.dim('\nCreate a schedule with: db-backup schedule --cron "0 2 * * *"'));
          return;
        }
        
        console.log(chalk.bold.cyan(`\n📋 ${response.data.schedules.length} Schedule(s):\n`));
        
        response.data.schedules.forEach((schedule: any, index: number) => {
          const statusColor = schedule.enabled ? chalk.green : chalk.red;
          const statusText = schedule.enabled ? 'Active' : 'Disabled';
          
          console.log(`${chalk.bold.white(`${index + 1}.`)} ${chalk.bold(schedule.name)}`);
          console.log(`   ${chalk.dim('Status:')} ${statusColor(statusText)}`);
          console.log(`   ${chalk.dim('Schedule:')} ${schedule.schedule}`);
          console.log(`   ${chalk.dim('Type:')} ${schedule.backupType}`);
          console.log(`   ${chalk.dim('Database:')} ${schedule.dbType}/${schedule.dbName}`);
          console.log(`   ${chalk.dim('Storage:')} ${schedule.storageType}`);
          
          if (schedule.lastRunAt) {
            const lastRun = new Date(schedule.lastRunAt).toLocaleString();
            const status = schedule.lastRunStatus || 'unknown';
            console.log(`   ${chalk.dim('Last Run:')} ${lastRun} (${status})`);
          }
          
          if (schedule.error) {
            console.log(`   ${chalk.red('Error:')} ${schedule.error}`);
          }
          
          console.log('');
        });
        
        console.log(chalk.dim(`Active: ${response.data.activeCount} of ${response.data.schedules.length} schedules`));
      } catch (error: any) {
        console.error(chalk.red('\n✗ Failed to list schedules:'), error.message);
      }
    });
}