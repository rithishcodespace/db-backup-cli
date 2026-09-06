// src/commands/infra.ts

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { infrastructureManager } from '../infrastructure';
import { createModuleLogger } from '../logger';

const log = createModuleLogger('infra-command');

export function registerInfraCommand(program: Command): void {
  const infraCmd = program
    .command('infra')
    .description('Inspect and manage db-backup runtime infrastructure');

  // ==================== STATUS ====================
  infraCmd
    .command('status')
    .description('Display detailed status of Docker and background services')
    .action(async () => {
      try {
        console.log(chalk.bold.cyan('\n◆ Infrastructure Status\n'));
        console.log(chalk.dim('─'.repeat(60)));

        const status = await infrastructureManager.status();

        console.log(`${chalk.bold('Execution Engine:')}  ${chalk.cyan(status.engine)}`);
        console.log(
          `${chalk.bold('Docker Available:')}  ${status.dockerAvailable ? chalk.green('✓ Yes') : chalk.red('✗ No')}`
        );
        console.log(
          `${chalk.bold('Daemon Running:')}    ${status.daemonRunning ? chalk.green('✓ Running') : chalk.red('✗ Stopped')}`
        );
        console.log(
          `${chalk.bold('Docker Compose:')}    ${status.composeAvailable ? chalk.green(`✓ Available (${status.composeVersion || 'v2'})`) : chalk.red('✗ Unavailable')}`
        );
        if (status.composeFile) {
          console.log(`${chalk.bold('Compose File:')}      ${chalk.dim(status.composeFile)}`);
        }
        console.log(`${chalk.bold('Host Backup Dir:')}   ${chalk.dim(status.backupDir)}`);

        console.log(chalk.dim('\nServices:'));
        status.services.forEach((s) => {
          const icon = s.status === 'healthy' ? chalk.green('✓') : chalk.red('✗');
          const portStr = s.port ? chalk.dim(`(port ${s.port})`) : '';
          const statusStr =
            s.status === 'healthy'
              ? chalk.green('healthy')
              : s.error
                ? chalk.red(`unhealthy - ${s.error}`)
                : chalk.red('offline');
          console.log(`  ${icon} ${chalk.bold(s.name)} ${portStr}: ${statusStr}`);
        });

        console.log(chalk.dim('─'.repeat(60)));
        const summary = status.healthy
          ? chalk.green('All required services are healthy.')
          : status.running
            ? chalk.yellow('Some services are offline or degraded.')
            : chalk.dim('Infrastructure is currently stopped.');
        console.log(`\nStatus: ${summary}\n`);
      } catch (err: any) {
        console.error(chalk.red('\n✗ Failed to retrieve infrastructure status:'), err.message);
        log.error('Failed to get status', { error: err.message });
        process.exit(1);
      }
    });

  // ==================== START ====================
  infraCmd
    .command('start')
    .description('Start the runtime infrastructure')
    .action(async () => {
      const spinner = ora('Starting infrastructure...').start();
      try {
        await infrastructureManager.start();
        spinner.succeed(chalk.green('Infrastructure started and healthy!'));
      } catch (err: any) {
        spinner.fail(chalk.red('Failed to start infrastructure'));
        console.error(chalk.red(`\n✗ Error: ${err.message}\n`));
        log.error('Start command failed', { error: err.message });
        process.exit(1);
      }
    });

  // ==================== STOP ====================
  infraCmd
    .command('stop')
    .description('Stop the runtime infrastructure without deleting backup data')
    .action(async () => {
      const spinner = ora('Stopping infrastructure...').start();
      try {
        await infrastructureManager.stop();
        spinner.succeed(chalk.green('Infrastructure stopped successfully. (Backups preserved)'));
      } catch (err: any) {
        spinner.fail(chalk.red('Failed to stop infrastructure'));
        console.error(chalk.red(`\n✗ Error: ${err.message}\n`));
        log.error('Stop command failed', { error: err.message });
        process.exit(1);
      }
    });

  // ==================== RESTART ====================
  infraCmd
    .command('restart')
    .description('Restart the runtime infrastructure')
    .action(async () => {
      const spinner = ora('Restarting infrastructure...').start();
      try {
        await infrastructureManager.restart();
        spinner.succeed(chalk.green('Infrastructure restarted and healthy!'));
      } catch (err: any) {
        spinner.fail(chalk.red('Failed to restart infrastructure'));
        console.error(chalk.red(`\n✗ Error: ${err.message}\n`));
        log.error('Restart command failed', { error: err.message });
        process.exit(1);
      }
    });
}
