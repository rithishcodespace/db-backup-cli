// src/commands/lifecycle.ts

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { dockerRuntime } from '../infrastructure/docker-runtime';
import { createModuleLogger } from '../logger';

const log = createModuleLogger('lifecycle-commands');

export function registerLifecycleCommands(program: Command): void {
  // ==================== START ====================
  program
    .command('start')
    .description('Start the dbvault all-in-one production container and wait for readiness')
    .option('-t, --timeout <seconds>', 'Readiness timeout in seconds', '45')
    .action(async (options) => {
      const timeoutMs = parseInt(options.timeout, 10) * 1000;
      const spinner = ora('Checking and starting dbvault production runtime...').start();

      try {
        const result = await dockerRuntime.start({
          timeoutMs,
          onProgress: (msg) => {
            spinner.text = msg;
          },
        });

        if (result.alreadyRunning) {
          spinner.succeed(chalk.green('dbvault is already running and ready!'));
        } else {
          spinner.succeed(chalk.green('dbvault started successfully and is ready!'));
        }

        console.log(`\n  ${chalk.bold('Web Dashboard:')}  ${chalk.cyan('http://localhost:3000/dashboard')}`);
        console.log(`  ${chalk.bold('API Gateway:')}    ${chalk.white('http://localhost:3000')}`);
        console.log(`\nNext step: Run ${chalk.cyan('dbvault connect')} to connect a database, or ${chalk.cyan('dbvault backup')} to create a backup.`);
        console.log(chalk.dim('Tip: Run "dbvault infra status" to view detailed background infrastructure.\n'));
      } catch (err: any) {
        spinner.fail(chalk.red('Failed to start dbvault runtime'));
        console.error(chalk.red(`\n✗ Error: ${err.message}\n`));
        console.log(chalk.yellow('Troubleshooting suggestions:'));
        console.log(chalk.dim('  • Run "dbvault doctor" to inspect prerequisites & ports'));
        console.log(chalk.dim('  • Run "dbvault logs" to inspect container startup logs\n'));
        log.error('Start command failed', { error: err.message });
        process.exit(1);
      }
    });

  // ==================== STOP ====================
  program
    .command('stop')
    .description('Gracefully stop the dbvault container without deleting backup data')
    .action(async () => {
      const spinner = ora('Stopping dbvault production runtime...').start();

      try {
        const result = await dockerRuntime.stop();

        if (result.wasRunning) {
          spinner.succeed(chalk.green(result.message));
        } else {
          spinner.info(chalk.yellow(result.message));
        }
        console.log(chalk.dim('  (Metadata, backup files, and volumes were safely preserved)\n'));
      } catch (err: any) {
        spinner.fail(chalk.red('Failed to stop dbvault runtime'));
        console.error(chalk.red(`\n✗ Error: ${err.message}\n`));
        log.error('Stop command failed', { error: err.message });
        process.exit(1);
      }
    });

  // ==================== RESTART ====================
  program
    .command('restart')
    .description('Gracefully restart the dbvault container and wait for readiness')
    .option('-t, --timeout <seconds>', 'Readiness timeout in seconds', '45')
    .action(async (options) => {
      const timeoutMs = parseInt(options.timeout, 10) * 1000;
      const spinner = ora('Restarting dbvault production runtime...').start();

      try {
        const result = await dockerRuntime.restart({
          timeoutMs,
          onProgress: (msg) => {
            spinner.text = msg;
          },
        });

        spinner.succeed(chalk.green('dbvault restarted successfully and is ready!'));

        console.log(`\n  ${chalk.bold('Web Dashboard:')}  ${chalk.cyan('http://localhost:3000/dashboard')}`);
        console.log(`  ${chalk.bold('API Gateway:')}    ${chalk.white('http://localhost:3000')}\n`);
        console.log(`\nNext step: Run ${chalk.cyan('dbvault status')} to inspect runtime health.\n`);
      } catch (err: any) {
        spinner.fail(chalk.red('Failed to restart dbvault runtime'));
        console.error(chalk.red(`\n✗ Error: ${err.message}\n`));
        console.log(chalk.yellow('Troubleshooting suggestions:'));
        console.log(chalk.dim('  • Run "dbvault logs" to inspect container shutdown/boot logs'));
        console.log(chalk.dim('  • Run "dbvault doctor" to diagnose environment issues\n'));
        log.error('Restart command failed', { error: err.message });
        process.exit(1);
      }
    });

  // ==================== STATUS ====================
  program
    .command('status')
    .description('Display detailed status of the dbvault container and supervised services')
    .action(async () => {
      try {
        const status = await dockerRuntime.status();

        console.log(chalk.bold.cyan('\n◆ dbvault Production Runtime Status\n'));
        console.log(chalk.dim('─'.repeat(58)));

        console.log(`${chalk.bold('Docker Available:')}   ${status.dockerAvailable ? chalk.green('✓ Yes') : chalk.red('✗ Missing')}`);
        console.log(`${chalk.bold('Docker Daemon:')}      ${status.daemonRunning ? chalk.green('✓ Running') : chalk.red('✗ Stopped')}`);
        console.log(`${chalk.bold('Container:')}          ${status.container.exists ? chalk.cyan(status.config.containerName) : chalk.dim('missing')} (${status.container.running ? chalk.green('running') : chalk.red(status.container.status)})`);
        console.log(`${chalk.bold('Configured Image:')}   ${chalk.dim(status.config.imageTag)}`);

        if (status.container.uptime) {
          console.log(`${chalk.bold('Uptime:')}            ${chalk.dim(status.container.uptime)}`);
        }
        console.log(`${chalk.bold('Host Port:')}          ${chalk.dim(status.config.hostPort)}`);
        console.log(`${chalk.bold('Storage Dir:')}        ${chalk.dim(status.config.backupDir)}`);

        console.log(chalk.dim('\nServices & Internal Components:'));
        const deps = status.healthDetails?.dependencies;

        const printDep = (name: string, depStatus?: string, detail?: string) => {
          const isOk = depStatus === 'healthy';
          const icon = isOk ? chalk.green('✓') : chalk.red('✗');
          const colorText = isOk ? chalk.green('healthy') : chalk.red(depStatus || 'offline');
          const detailStr = detail ? chalk.dim(` (${detail})`) : '';
          console.log(`  ${icon} ${chalk.bold(name.padEnd(20))} ${colorText}${detailStr}`);
        };

        printDep('API Gateway', status.gatewayHealthy ? 'healthy' : 'offline', `http://localhost:${status.config.hostPort}`);
        printDep('Metadata Service', deps?.metadataService?.status, 'SQLite internal');
        printDep('Redis Message Broker', deps?.redis?.status, 'BullMQ internal');
        printDep('Backup Orchestrator', deps?.orchestrator?.status, 'internal');

        console.log(chalk.dim('─'.repeat(58)));

        if (status.gatewayHealthy) {
          console.log(chalk.green('\nStatus: All systems operational\n'));
          console.log(chalk.dim(`Web Dashboard: http://localhost:${status.config.hostPort}/dashboard\n`));
        } else if (status.container.running) {
          console.log(chalk.yellow('\nStatus: Container is running but services are initializing or degraded.\n'));
        } else {
          console.log(chalk.dim('\nStatus: dbvault is stopped. Run "dbvault start" to begin.\n'));
        }
      } catch (err: any) {
        console.error(chalk.red('\n✗ Failed to retrieve status:'), err.message);
        log.error('Status command failed', { error: err.message });
        process.exit(1);
      }
    });

  // ==================== LOGS ====================
  program
    .command('logs')
    .description('View or follow logs from the dbvault production container')
    .option('-f, --follow', 'Follow log stream', false)
    .option('-n, --tail <lines>', 'Number of lines to show from the end of the logs', '100')
    .action(async (options) => {
      try {
        const tail = options.tail ? parseInt(options.tail, 10) : 100;
        await dockerRuntime.logs({
          follow: !!options.follow,
          tail: isNaN(tail) ? 100 : tail,
        });
      } catch (err: any) {
        console.error(chalk.red(`\n✗ Error: ${err.message}\n`));
        log.error('Logs command failed', { error: err.message });
        process.exit(1);
      }
    });
}
