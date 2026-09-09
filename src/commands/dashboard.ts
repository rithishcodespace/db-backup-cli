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
      const customUrl = options.url;
      const devUrl = `http://localhost:${options.port || '5173'}`;
      const gatewayUrl = 'http://localhost:3000/dashboard';

      console.log(chalk.bold.blue('\n◆ dbvault Web Dashboard Launcher\n'));
      const spinner = ora('Checking dashboard availability...').start();

      let targetUrl = '';

      if (customUrl) {
        if (await checkDashboardReachable(customUrl)) {
          targetUrl = customUrl;
        }
      } else if (await checkDashboardReachable(devUrl)) {
        targetUrl = devUrl;
      } else if (await checkDashboardReachable(gatewayUrl)) {
        targetUrl = gatewayUrl;
      }

      if (targetUrl) {
        spinner.succeed(chalk.green(`Dashboard available at ${chalk.bold(targetUrl)}`));
        console.log(chalk.dim(`\nOpening ${targetUrl} in your default browser...\n`));
        openBrowser(targetUrl);
      } else {
        spinner.fail(chalk.red('Dashboard is not reachable.'));
        console.log(chalk.yellow('\nEnsure background microservices are running via:'));
        console.log(chalk.cyan('  npm run services:start\n'));
        process.exit(1);
      }
    });
}

function checkDashboardReachable(urlStr: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL(urlStr);
      const req = http.get(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname,
          timeout: 2000,
        },
        (res) => {
          resolve(res.statusCode !== undefined && res.statusCode < 500);
        }
      );

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
