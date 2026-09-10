import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import { metadataClient } from '../lib/metadata-client';
import { createModuleLogger } from '../logger';
import { config } from '../config';
import httpClient from '../utils/http-client';

const log = createModuleLogger('schedule-command');

const SCHEDULER_URL = process.env.SCHEDULER_URL || process.env.GATEWAY_URL || 'http://localhost:3000';

// ==================== Types ====================

type NotificationProvider = 'email' | 'slack';

interface NotificationProviderConfig {
  type: NotificationProvider;
  details: Record<string, any>;
}

interface NotificationPayload {
  providers: NotificationProviderConfig[];
}

// ==================== Helper Functions ====================

function parseNotificationProviders(input: string): NotificationProvider[] {
  if (!input || input.trim() === '') {
    return [];
  }

  const providers = input
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(p => p.length > 0);

  // Remove duplicates
  const uniqueProviders = [...new Set(providers)] as NotificationProvider[];

  const validProviders: NotificationProvider[] = ['email', 'slack'];
  const invalidProviders = uniqueProviders.filter(p => !validProviders.includes(p as NotificationProvider));

  if (invalidProviders.length > 0) {
    console.error(chalk.red(`\n❌ Invalid notification provider(s): ${invalidProviders.join(', ')}\n`));
    console.error(chalk.yellow('Supported providers:'));
    console.error(chalk.dim('  • email'));
    console.error(chalk.dim('  • slack'));
    process.exit(1);
  }

  return uniqueProviders as NotificationProvider[];
}

function formatProviderName(provider: NotificationProvider): string {
  const names: Record<NotificationProvider, string> = {
    email: 'Email',
    slack: 'Slack'
  };
  return names[provider] || provider;
}

async function validateAndGetNotificationConfigs(
  providers: NotificationProvider[]
): Promise<NotificationProviderConfig[]> {
  const configs: NotificationProviderConfig[] = [];

  for (const provider of providers) {
    switch (provider) {
      case 'email': {
        const config = await metadataClient.getNotificationConfig('email');

        if (!config || !config.enabled) {
          console.error(chalk.red(`\n❌ Email notification is not configured.\n`));
          console.error(chalk.yellow('Configure it with:'));
          console.error(chalk.dim('  dbvault notification email configure \\'));
          console.error(chalk.dim('    --smtp-host smtp.gmail.com \\'));
          console.error(chalk.dim('    --smtp-port 587 \\'));
          console.error(chalk.dim('    --smtp-user your-email@gmail.com \\'));
          console.error(chalk.dim('    --smtp-password APP_PASSWORD \\'));
          console.error(chalk.dim('    --from your-email@gmail.com'));
          process.exit(1);
        }

        configs.push({
          type: 'email',
          details: {
            smtpHost: config.smtpHost,
            smtpPort: config.smtpPort,
            smtpUser: config.smtpUser,
            smtpPassword: config.smtpPassword,
            from: config.from
          }
        });
        break;
      }

      case 'slack': {
        const config = await metadataClient.getNotificationConfig('slack');

        if (!config || !config.enabled) {
          console.error(chalk.red(`\n❌ Slack notification is not configured.\n`));
          console.error(chalk.yellow('Configure it with:'));
          console.error(chalk.dim('  dbvault notification slack configure \\'));
          console.error(chalk.dim('    --webhook https://hooks.slack.com/services/...'));
          process.exit(1);
        }

        configs.push({
          type: 'slack',
          details: {
            webhookUrl: config.webhook
          }
        });
        break;
      }
    }
  }

  return configs;
}

function formatNotificationDisplay(providers: NotificationProvider[]): string {
  if (!providers || providers.length === 0) {
    return 'Disabled';
  }

  const formatted = providers.map(p => formatProviderName(p));
  return formatted.join(', ');
}

function getNotificationEmoji(providers: NotificationProvider[]): string {
  if (!providers || providers.length === 0) {
    return '❌';
  }
  return '✅';
}

// ==================== Main Command Registration ====================

export function registerScheduleCommand(program: Command): void {
  program
    .command('schedule')
    .description('Schedule automated backups')
    .option('-c, --cron <expression>', 'Cron expression (e.g., "0 2 * * *" for daily at 2am)')
    .option('-t, --type <type>', 'Backup type (full, incremental, differential)', 'full')
    .option('-n, --name <name>', 'Schedule name')
    .option('--storage <type>', 'Storage type (local, s3)', 'local')
    .option('--retention <days>', 'Retention period in days', '30')
    .option('--notify <providers>', 'Comma-separated list of notification providers (email, slack)')
    .action(async (options) => {
      const spinner = ora('Creating backup schedule...').start();
      
      try {
        // Get database configuration
        const dbConfig = config.get('database');
        if (!dbConfig) {
          spinner.fail('No database configuration found');
          console.error(chalk.red('\n✗ Please run "dbvault connect" first'));
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
        
        // ============================================================
        // Parse notification providers
        // ============================================================
        let notificationProviders: NotificationProvider[] = [];
        let notificationConfigs: NotificationProviderConfig[] = [];
        let notificationPayload: NotificationPayload | null = null;

        if (options.notify) {
          // Parse providers from comma-separated list
          notificationProviders = parseNotificationProviders(options.notify);
          
          if (notificationProviders.length > 0) {
            // Validate each provider has a configuration
            notificationConfigs = await validateAndGetNotificationConfigs(notificationProviders);
            
            // Build notification payload
            notificationPayload = {
              providers: notificationConfigs
            };
          }
        }
        
        // Build schedule configuration
        const scheduleConfig = {
          schedule: options.cron,
          dbConfig,
          backupType: options.type,
          options: {
            compress: true,
            storageType: options.storage,
            name: options.name || `${dbConfig.database}_backup`,
            retention: parseInt(options.retention)
          },
          storageType: options.storage,
          notification: notificationPayload,
          retention: parseInt(options.retention)
        };
        
        spinner.text = 'Sending schedule request...';
        
        const response = await httpClient.post(`${SCHEDULER_URL}/api/schedule`, scheduleConfig);
        
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
          
          // Display notifications
          if (notificationProviders.length > 0) {
            console.log(chalk.dim('\n  Notifications:'));
            notificationProviders.forEach(p => {
              console.log(chalk.dim(`    • ${formatProviderName(p)}`));
            });
          } else {
            console.log(chalk.dim(`  Notifications: Disabled`));
          }
          
          log.info('Schedule created', { 
            scheduleId: response.data.scheduleId,
            notifications: notificationProviders 
          });
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
          console.error(chalk.yellow('\n💡 Make sure the background container is running:'));
          console.error(chalk.cyan('  dbvault start'));
        } else {
          console.error(chalk.red(`\n✗ Error: ${error.message}`));
        }
        
        log.error('Schedule creation failed', { error: error.message });
        process.exit(1);
      }
    });
}

// ==================== Schedule List Command ====================

export function registerScheduleListCommand(program: Command): void {
  program
    .command('schedule:list')
    .description('List all scheduled backups')
    .action(async () => {
      try {
        const response = await httpClient.get(`${SCHEDULER_URL}/api/schedule`);
        
        if (!response.data.success || response.data.schedules.length === 0) {
          console.log(chalk.yellow('\n📭 No schedules found'));
          console.log(chalk.dim('\nCreate a schedule with: dbvault schedule --cron "0 2 * * *"'));
          return;
        }
        
        console.log(chalk.bold.cyan(`\n📋 ${response.data.schedules.length} Schedule(s):\n`));
        
        response.data.schedules.forEach((schedule: any, index: number) => {
          const statusColor = schedule.enabled ? chalk.green : chalk.red;
          const statusText = schedule.enabled ? 'Active' : 'Disabled';
          
          // Parse notification providers from metadata
          let notificationProviders: string[] = [];
          let notificationDisplay = 'Disabled';
          let notificationEmoji = '❌';
          
          try {
            if (schedule.metadata) {
              const metadata = typeof schedule.metadata === 'string' 
                ? JSON.parse(schedule.metadata) 
                : schedule.metadata;
              
              if (metadata?.notification?.providers) {
                notificationProviders = metadata.notification.providers.map((p: any) => p.type);
                notificationDisplay = notificationProviders.map((p: string) => 
                  p.charAt(0).toUpperCase() + p.slice(1)
                ).join(', ');
                notificationEmoji = '✅';
              }
            }
          } catch (e) {
            // Fallback to legacy notification detection
            if (schedule.slackWebhook || schedule.emailRecipients) {
              notificationDisplay = 'Legacy (Email/Slack)';
              notificationEmoji = '✅';
            }
          }
          
          console.log(`${chalk.bold.white(`${index + 1}.`)} ${chalk.bold(schedule.name)}`);
          console.log(`   ${chalk.dim('Status:')} ${statusColor(statusText)}`);
          console.log(`   ${chalk.dim('Schedule:')} ${schedule.schedule}`);
          console.log(`   ${chalk.dim('Type:')} ${schedule.backupType}`);
          console.log(`   ${chalk.dim('Database:')} ${schedule.dbType}/${schedule.dbName}`);
          console.log(`   ${chalk.dim('Storage:')} ${schedule.storageType}`);
          console.log(`   ${chalk.dim('Notifications:')} ${notificationEmoji} ${notificationDisplay}`);
          
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