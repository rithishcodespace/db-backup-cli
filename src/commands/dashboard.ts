import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { exec } from 'child_process';
import http from 'http';
import { logger } from '../logger';

export function registerDashboardCommand(program: Command) {
  program
    .command('dashboard')
    .description('Open companion web monitoring dashboard')
    .option('-p, --port <number>', 'Dashboard web server port', '5173')
    .option('--url <url>', 'Dashboard URL')
    .action(async (options) => {
      const port = options.port || '5173';
      const dashboardUrl = options.url || `http://localhost:${port}`;

      console.log(chalk.bold.blue('\n◆ db-backup Web Dashboard Launcher\n'));
      const spinner = ora('Checking dashboard availability...').start();

      try {
        const isReachable = await checkDashboardReachable(dashboardUrl);

        if (isReachable) {
          spinner.succeed(chalk.green(`Dashboard available at ${chalk.bold(dashboardUrl)}`));
          console.log(chalk.dim(`\nOpening ${dashboardUrl} in your default browser...\n`));
          openBrowser(dashboardUrl);
        } else {
          spinner.fail(chalk.red(`Dashboard is not running at ${dashboardUrl}`));
          console.log(chalk.yellow('\nTo start the companion web dashboard, run:'));
          console.log(chalk.cyan('  cd dashboard && npm run dev\n'));
          process.exit(1);
        }
      } catch (err: any) {
        spinner.fail(chalk.red(`Failed to connect to dashboard: ${err.message}`));
        console.log(chalk.yellow('\nTo start the companion web dashboard, run:'));
        console.log(chalk.cyan('  cd dashboard && npm run dev\n'));
        process.exit(1);
      }
    });
}

function checkDashboardReachable(urlStr: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL(urlStr);
      const req = http.get({
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        timeout: 2000,
      }, (res) => {
        resolve(res.statusCode !== undefined && res.statusCode < 500);
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

function openBrowser(url: string) {
  const platform = process.platform;
  let command = '';
  if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }
  exec(command, (err) => {
    if (err) {
      logger.debug('Failed to launch browser automatically', { error: err.message });
    }
  });
}
