import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { prisma } from "../lib/prisma";
import { createModuleLogger } from '../logger';
import nodemailer from 'nodemailer';
import axios from 'axios';

const log = createModuleLogger('notification-command');

// Types

interface EmailConfig {
  smtpHost: string; // gmail servers
  smtpPort: number; // gmail server port (tls)
  smtpUser: string; // username to login
  smtpPassword: string; // password to login
  from: string; // sender email
}

interface SlackConfig {
  webhook: string; // webhook created for specific channel
}

// Helper Functions

function maskString(str: string): string {
  if (!str) return 'Not Set';
  if (str.length <= 4) return '****';
  return str.substring(0, 2) + '*'.repeat(str.length - 4) + str.substring(str.length - 2);
}

async function getEmailConfig(): Promise<EmailConfig | null> {
  const config = await prisma.notificationConfig.findUnique({
    where: { type: 'email' }
  });
  
  if (!config || !config.enabled) return null;
  
  return {
    smtpHost: config.smtpHost!,
    smtpPort: config.smtpPort!,
    smtpUser: config.smtpUser!,
    smtpPassword: config.smtpPassword!,
    from: config.from!
  };
}

async function getSlackConfig(): Promise<SlackConfig | null> {
  const config = await prisma.notificationConfig.findUnique({
    where: { type: 'slack' }
  });
  
  if (!config || !config.enabled) return null;
  
  return {
    webhook: config.webhook!
  };
}

async function saveEmailConfig(config: EmailConfig): Promise<void> {
  await prisma.notificationConfig.upsert({
    where: { type: 'email' },
    update: {
      smtpHost: config.smtpHost,
      smtpPort: config.smtpPort,
      smtpUser: config.smtpUser,
      smtpPassword: config.smtpPassword,
      from: config.from,
      enabled: true,
      updatedAt: new Date()
    },
    create: {
      type: 'email',
      smtpHost: config.smtpHost,
      smtpPort: config.smtpPort,
      smtpUser: config.smtpUser,
      smtpPassword: config.smtpPassword,
      from: config.from,
      enabled: true
    }
  });
}

async function saveSlackConfig(config: SlackConfig): Promise<void> {
  await prisma.notificationConfig.upsert({
    where: { type: 'slack' },
    update: {
      webhook: config.webhook,
      enabled: true,
      updatedAt: new Date()
    },
    create: {
      type: 'slack',
      webhook: config.webhook,
      enabled: true
    }
  });
}

async function deleteEmailConfig(): Promise<void> {
  await prisma.notificationConfig.delete({
    where: { type: 'email' }
  });
}

async function deleteSlackConfig(): Promise<void> {
  await prisma.notificationConfig.delete({
    where: { type: 'slack' }
  });
}

// Notification Command Registration

export function registerNotificationCommand(program: Command): void {
  const notificationCmd = program
    .command('notification')
    .description('Configure notification providers for backup alerts');

  // email sub-commands
  const emailCmd = notificationCmd
    .command('email')
    .description('Configure email notifications');

  // Email Configure
  emailCmd
    .command('configure')
    .description('Configure SMTP email settings')
    .requiredOption('--smtp-host <host>', 'SMTP server hostname')
    .requiredOption('--smtp-port <port>', 'SMTP server port', parseInt)
    .requiredOption('--smtp-user <user>', 'SMTP username')
    .requiredOption('--smtp-password <password>', 'SMTP password or app password')
    .requiredOption('--from <email>', 'Sender email address')
    .action(async (options) => {
      const spinner = ora('Configuring email notification...').start();

      try {
        const config: EmailConfig = {
          smtpHost: options.smtpHost,
          smtpPort: options.smtpPort,
          smtpUser: options.smtpUser,
          smtpPassword: options.smtpPassword,
          from: options.from
        };

        spinner.text = 'Verifying SMTP connection...';

        // Create transporter and verify
        const transporter = nodemailer.createTransport({
          host: config.smtpHost,
          port: config.smtpPort,
          secure: config.smtpPort === 465,
          auth: {
            user: config.smtpUser,
            pass: config.smtpPassword
          }
        });

        await transporter.verify();

        // Save configuration
        await saveEmailConfig(config);

        spinner.succeed(chalk.green('Email configured successfully!'));

        console.log(chalk.dim('\n📧 Email Configuration:'));
        console.log(chalk.dim(`  SMTP Host: ${config.smtpHost}`));
        console.log(chalk.dim(`  SMTP Port: ${config.smtpPort}`));
        console.log(chalk.dim(`  Username: ${config.smtpUser}`));
        console.log(chalk.dim(`  Sender: ${config.from}`));

        log.info('Email configured successfully', { host: config.smtpHost, user: config.smtpUser });

      } catch (error: any) {
        spinner.fail(chalk.red('Email configuration failed'));

        if (error.message?.includes('ECONNREFUSED') || error.message?.includes('connect')) {
          console.error(chalk.red('\n✗ Cannot connect to SMTP server. Please check host and port.'));
        } else if (error.message?.includes('Authentication failed') || error.message?.includes('Invalid login')) {
          console.error(chalk.red('\n✗ SMTP authentication failed. Please check username and password.'));
        } else if (error.message?.includes('self-signed certificate')) {
          console.error(chalk.red('\n✗ SSL certificate error. Try using port 587 without SSL.'));
        } else {
          console.error(chalk.red(`\n✗ Error: ${error.message}`));
        }

        log.error('Email configuration failed', { error: error.message });
        process.exit(1);
      }
    });

  // Email Test
  emailCmd
    .command('test')
    .description('Send a test email')
    .requiredOption('--to <email>', 'Recipient email address')
    .action(async (options) => {
      const spinner = ora('Sending test email...').start();

      try {
        const config = await getEmailConfig();

        if (!config) {
          spinner.fail('Email configuration not found');
          console.error(chalk.yellow('\n💡 Configure email first:'));
          console.error(chalk.dim('  db-backup notification email configure --smtp-host ...'));
          process.exit(1);
        }

        const transporter = nodemailer.createTransport({
          host: config.smtpHost,
          port: config.smtpPort,
          secure: config.smtpPort === 465,
          auth: {
            user: config.smtpUser,
            pass: config.smtpPassword
          }
        });

        spinner.text = 'Sending test email...';

        const info = await transporter.sendMail({
          from: config.from,
          to: options.to,
          subject: 'DB Backup CLI - Test Email',
          text: `
            This is a test email from DB Backup CLI.

            If you received this message, your email notification configuration is working correctly.

            Sent at: ${new Date().toISOString()}
                    `,
                    html: `
            <h2>DB Backup CLI - Test Email</h2>
            <p>This is a test email from DB Backup CLI.</p>
            <p>If you received this message, your email notification configuration is working correctly.</p>
            <p><strong>Sent at:</strong> ${new Date().toISOString()}</p>
          `
        });

        spinner.succeed(chalk.green('Test email sent successfully!'));
        console.log(chalk.dim(`\n  To: ${options.to}`));
        console.log(chalk.dim(`  Message ID: ${info.messageId}`));

        log.info('Test email sent', { to: options.to, messageId: info.messageId });

      } catch (error: any) {
        spinner.fail(chalk.red('Failed to send test email'));

        if (error.message?.includes('ECONNREFUSED')) {
          console.error(chalk.red('\n✗ Cannot connect to SMTP server. Please check host and port.'));
        } else if (error.message?.includes('Authentication failed')) {
          console.error(chalk.red('\n✗ SMTP authentication failed. Please check username and password.'));
        } else {
          console.error(chalk.red(`\n✗ Error: ${error.message}`));
        }

        log.error('Test email failed', { error: error.message });
        process.exit(1);
      }
    });

  // Email Show
  emailCmd
    .command('show')
    .description('Show current email configuration')
    .action(async () => {
      try {
        const config = await getEmailConfig();

        if (!config) {
          console.log(chalk.yellow('\n📭 No email configuration found'));
          console.log(chalk.dim('\nConfigure email with:'));
          console.log(chalk.dim('  db-backup notification email configure --smtp-host ...'));
          return;
        }

        console.log(chalk.bold.cyan('\n📧 Email Configuration\n'));
        console.log(chalk.dim('─'.repeat(50)));
        console.log(`${chalk.bold('SMTP Host:')} ${config.smtpHost}`);
        console.log(`${chalk.bold('SMTP Port:')} ${config.smtpPort}`);
        console.log(`${chalk.bold('Username:')} ${config.smtpUser}`);
        console.log(`${chalk.bold('Password:')} ${maskString(config.smtpPassword)}`);
        console.log(`${chalk.bold('Sender:')} ${config.from}`);
        console.log(`${chalk.bold('Status:')} ${chalk.green('Configured')}`);
        console.log(chalk.dim('─'.repeat(50)));

      } catch (error: any) {
        console.error(chalk.red('\n✗ Failed to load email configuration:'), error.message);
        log.error('Failed to show email config', { error: error.message });
        process.exit(1);
      }
    });

  // Email Remove
  emailCmd
    .command('remove')
    .description('Remove email configuration')
    .action(async () => {
      try {
        const config = await getEmailConfig();

        if (!config) {
          console.log(chalk.yellow('\n📭 No email configuration found'));
          return;
        }

        console.log(chalk.yellow('\n⚠️  This will remove your email configuration:'));
        console.log(chalk.dim(`  SMTP Host: ${config.smtpHost}`));
        console.log(chalk.dim(`  Sender: ${config.from}`));

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
          console.log(chalk.yellow('\nOperation cancelled'));
          return;
        }

        await deleteEmailConfig();

        console.log(chalk.green('\n✓ Email configuration removed successfully'));

        log.info('Email configuration removed');

      } catch (error: any) {
        console.error(chalk.red('\n✗ Failed to remove email configuration:'), error.message);
        log.error('Failed to remove email config', { error: error.message });
        process.exit(1);
      }
    });

  // SLACK SUBCOMMANDS

  const slackCmd = notificationCmd
    .command('slack')
    .description('Configure Slack notifications');

  // Slack Configure
  slackCmd
    .command('configure')
    .description('Configure Slack webhook')
    .requiredOption('--webhook <url>', 'Slack webhook URL')
    .action(async (options) => {
      const spinner = ora('Configuring Slack notification...').start();

      try {
        const config: SlackConfig = {
          webhook: options.webhook
        };

        spinner.text = 'Testing Slack webhook...';

        // Send test message
        await axios.post(config.webhook, {
          text: '🔔 DB Backup CLI notification configured successfully.'
        });

        // Save configuration
        await saveSlackConfig(config);

        spinner.succeed(chalk.green('Slack configured successfully!'));

        console.log(chalk.dim('\n📢 Slack Configuration:'));
        console.log(chalk.dim(`  Webhook: ${maskString(config.webhook)}`));
        console.log(chalk.dim(`  Status: ${chalk.green('Connected')}`));

        log.info('Slack configured successfully');

      } catch (error: any) {
        spinner.fail(chalk.red('Slack configuration failed'));

        if (error.response?.status === 404) {
          console.error(chalk.red('\n✗ Invalid webhook URL. Please check the URL.'));
        } else if (error.response?.status === 403) {
          console.error(chalk.red('\n✗ Access denied. Please check webhook permissions.'));
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          console.error(chalk.red('\n✗ Cannot connect to Slack. Please check your network.'));
        } else {
          console.error(chalk.red(`\n✗ Error: ${error.message}`));
        }

        log.error('Slack configuration failed', { error: error.message });
        process.exit(1);
      }
    });

  // Slack Test
  slackCmd
    .command('test')
    .description('Send a test Slack notification')
    .action(async () => {
      const spinner = ora('Sending test Slack notification...').start();

      try {
        const config = await getSlackConfig();

        if (!config) {
          spinner.fail('Slack configuration not found');
          console.error(chalk.yellow('\n💡 Configure Slack first:'));
          console.error(chalk.dim('  db-backup notification slack configure --webhook ...'));
          process.exit(1);
        }

        spinner.text = 'Sending test notification...';

        await axios.post(config.webhook, {
          text: '📬 This is a test notification from DB Backup CLI.',
          attachments: [
            {
              color: '#36a64f',
              title: '✅ Test Notification',
              text: 'Your Slack integration is working correctly.',
              fields: [
                {
                  title: 'Time',
                  value: new Date().toISOString(),
                  short: true
                },
                {
                  title: 'Service',
                  value: 'DB Backup CLI',
                  short: true
                }
              ],
              footer: 'DB Backup CLI',
              ts: Math.floor(Date.now() / 1000)
            }
          ]
        });

        spinner.succeed(chalk.green('Test Slack notification sent!'));

        log.info('Test Slack notification sent');

      } catch (error: any) {
        spinner.fail(chalk.red('Failed to send Slack notification'));

        if (error.response?.status === 404) {
          console.error(chalk.red('\n✗ Invalid webhook URL. Please check the URL.'));
        } else if (error.response?.status === 403) {
          console.error(chalk.red('\n✗ Access denied. Please check webhook permissions.'));
        } else {
          console.error(chalk.red(`\n✗ Error: ${error.message}`));
        }

        log.error('Test Slack failed', { error: error.message });
        process.exit(1);
      }
    });

  // Slack Show
  slackCmd
    .command('show')
    .description('Show current Slack configuration')
    .action(async () => {
      try {
        const config = await getSlackConfig();

        if (!config) {
          console.log(chalk.yellow('\n📭 No Slack configuration found'));
          console.log(chalk.dim('\nConfigure Slack with:'));
          console.log(chalk.dim('  db-backup notification slack configure --webhook ...'));
          return;
        }

        console.log(chalk.bold.cyan('\n📢 Slack Configuration\n'));
        console.log(chalk.dim('─'.repeat(50)));
        console.log(`${chalk.bold('Webhook:')} ${maskString(config.webhook)}`);
        console.log(`${chalk.bold('Status:')} ${chalk.green('Connected')}`);
        console.log(chalk.dim('─'.repeat(50)));

      } catch (error: any) {
        console.error(chalk.red('\n✗ Failed to load Slack configuration:'), error.message);
        log.error('Failed to show Slack config', { error: error.message });
        process.exit(1);
      }
    });

  // Slack Remove
  slackCmd
    .command('remove')
    .description('Remove Slack configuration')
    .action(async () => {
      try {
        const config = await getSlackConfig();

        if (!config) {
          console.log(chalk.yellow('\n📭 No Slack configuration found'));
          return;
        }

        console.log(chalk.yellow('\n⚠️  This will remove your Slack configuration:'));

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
          console.log(chalk.yellow('\nOperation cancelled'));
          return;
        }

        await deleteSlackConfig();

        console.log(chalk.green('\n✓ Slack configuration removed successfully'));

        log.info('Slack configuration removed');

      } catch (error: any) {
        console.error(chalk.red('\n✗ Failed to remove Slack configuration:'), error.message);
        log.error('Failed to remove Slack config', { error: error.message });
        process.exit(1);
      }
    });
}