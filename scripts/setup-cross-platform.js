#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');

console.log(chalk.cyan('\n🔧 Setting up cross-platform compatibility...\n'));

const platform = os.platform();
console.log(chalk.dim(`Detected platform: ${platform}`));

// Create platform-specific scripts
const scripts = {
  win32: {
    start: 'scripts\\start-services.ps1',
    stop: 'scripts\\stop-services.ps1',
    kill: 'taskkill /F /IM node.exe'
  },
  linux: {
    start: './scripts/start-services.sh',
    stop: './scripts/stop-services.sh',
    kill: 'pkill -f "node.*microservices"'
  },
  darwin: { // mac
    start: './scripts/start-services.sh',
    stop: './scripts/stop-services.sh',
    kill: 'pkill -f "node.*microservices"'
  }
};

const currentScripts = scripts[platform] || scripts.linux;

// Create platform detection in main CLI
// else -> why not node ? (Assumes executable permission + shebang inside file) so it runs directly
const cliWrapper = `
#!/usr/bin/env node

const os = require('os');
const { spawn } = require('child_process');

const platform = os.platform();
let command;

if (platform === 'win32') {
  command = 'node';
  args = ['dist/src/index.js', ...process.argv.slice(2)];
} else { 
  command = './dist/src/index.js';
  args = process.argv.slice(1);
}

const child = spawn(command, args, { stdio: 'inherit' });
child.on('close', (code) => process.exit(code));
`;

fs.writeFileSync('bin/db-backup-wrapper.js', cliWrapper);
console.log(chalk.green('✓ Created cross-platform wrapper'));

console.log(chalk.green('\n✓ Cross-platform setup complete!'));
console.log(chalk.cyan('\nTo use:'));
console.log(chalk.dim(`  ${currentScripts.start}  - Start all services`));
console.log(chalk.dim(`  ${currentScripts.stop}   - Stop all services`));
console.log(chalk.dim(`  npm run backup          - Run backup (works on any platform)`));