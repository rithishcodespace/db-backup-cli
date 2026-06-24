import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { prisma } from "../lib/prisma";
import { createModuleLogger } from '../logger';

const log = createModuleLogger('storage-command');

export function registerStorageCommand(program: Command): void {
  const storageCmd = program
    .command('storage')
    .description('Manage storage locations for backups');

  // ==================== ADD STORAGE ====================
  storageCmd
    .command('add')
    .description('Add a storage location')
    .requiredOption('-t, --type <type>', 'Storage type (local, s3)')
    .option('-n, --name <name>', 'Storage name', 'default')
    .option('-p, --path <path>', 'Local storage path (for local type)', './backups')
    .option('-b, --bucket <bucket>', 'S3 bucket name (for s3 type)')
    .option('-r, --region <region>', 'S3 region', 'us-east-1')
    .option('--access-key <key>', 'S3 access key')
    .option('--secret-key <key>', 'S3 secret key')
    .option('--prefix <prefix>', 'S3 prefix/folder path')
    .action(async (options) => {
      const spinner = ora('Adding storage location...').start();
      
      try {
        // Validate
        if (options.type === 's3' && !options.bucket) {
          spinner.fail('S3 bucket is required for s3 storage');
          console.error(chalk.red('\n✗ Please provide --bucket <bucket-name>'));
          process.exit(1);
        }
        
        // Check if name already exists
        const existing = await prisma.storageLocation.findUnique({
          where: { name: options.name }
        });
        
        if (existing) {
          spinner.fail(`Storage location "${options.name}" already exists`);
          console.error(chalk.yellow('\n💡 Use a different name or remove existing'));
          process.exit(1);
        }
        
        // Build config based on type
        const config = options.type === 'local' 
          ? { basePath: options.path || './backups' }
          : {
              bucket: options.bucket,
              region: options.region || 'us-east-1',
              accessKey: options.accessKey,
              secretKey: options.secretKey,
              prefix: options.prefix || ''
            };
        
        // Create storage location
        const storage = await prisma.storageLocation.create({
          data: {
            name: options.name,
            type: options.type,
            bucket: options.type === 's3' ? options.bucket : null,
            region: options.type === 's3' ? options.region : null,
            accessKey: options.type === 's3' ? options.accessKey : null,
            secretKey: options.type === 's3' ? options.secretKey : null,
            config: config,
            default: false,
            enabled: true
          }
        });
        
        spinner.succeed(chalk.green('Storage location added successfully!'));
        console.log(chalk.green('\n✓ Storage Details:'));
        console.log(chalk.dim(`  Name: ${storage.name}`));
        console.log(chalk.dim(`  Type: ${storage.type}`));
        if (options.type === 'local') {
          console.log(chalk.dim(`  Path: ${config.basePath}`));
        } else {
          console.log(chalk.dim(`  Bucket: ${config.bucket}`));
          console.log(chalk.dim(`  Region: ${config.region}`));
          if (config.prefix) {
            console.log(chalk.dim(`  Prefix: ${config.prefix}`));
          }
        }
        console.log(chalk.dim(`  Default: No`));
        console.log(chalk.dim(`\n💡 To set as default: db-backup storage set-default ${storage.name}`));
        
        log.info('Storage location added', { name: options.name, type: options.type });
        
      } catch (error: any) {
        spinner.fail(chalk.red('Failed to add storage location'));
        console.error(chalk.red(`\n✗ Error: ${error.message}`));
        log.error('Failed to add storage location', { error: error.message });
        process.exit(1);
      }
    });

  // ==================== LIST STORAGE ====================
  storageCmd
    .command('list')
    .description('List all storage locations')
    .action(async () => {
      try {
        const storages = await prisma.storageLocation.findMany({
          orderBy: { createdAt: 'desc' }
        });
        
        if (storages.length === 0) {
          console.log(chalk.yellow('\n📭 No storage locations configured'));
          console.log(chalk.dim('\nAdd one with: db-backup storage add --type local --name my-storage'));
          return;
        }
        
        console.log(chalk.bold.cyan(`\n📋 ${storages.length} Storage Location(s):\n`));
        console.log(chalk.dim('─'.repeat(80)));
        
        storages.forEach((storage, index) => {
          const defaultTag = storage.default ? chalk.green(' ★ DEFAULT') : '';
          const enabledTag = storage.enabled ? '' : chalk.red(' (disabled)');
          
          console.log(`${chalk.bold.white(`${index + 1}.`)} ${chalk.bold(storage.name)}${defaultTag}${enabledTag}`);
          console.log(`   ${chalk.dim('Type:')} ${storage.type}`);
          
          if (storage.type === 'local') {
            const config = storage.config as any;
            console.log(`   ${chalk.dim('Path:')} ${config?.basePath || 'N/A'}`);
          } else {
            const config = storage.config as any;
            console.log(`   ${chalk.dim('Bucket:')} ${storage.bucket || 'N/A'}`);
            console.log(`   ${chalk.dim('Region:')} ${storage.region || 'N/A'}`);
            if (config?.prefix) {
              console.log(`   ${chalk.dim('Prefix:')} ${config.prefix}`);
            }
          }
          console.log(`   ${chalk.dim('Created:')} ${new Date(storage.createdAt).toLocaleString()}`);
          console.log('');
        });
        
        console.log(chalk.dim('─'.repeat(80)));
        console.log(chalk.dim(`\n💡 Use: db-backup storage show <name> for details`));
        console.log(chalk.dim(`   db-backup storage set-default <name> to set as default`));
        
      } catch (error: any) {
        console.error(chalk.red('\n✗ Failed to list storage locations:'), error.message);
        process.exit(1);
      }
    });

  // ==================== SHOW STORAGE ====================
  storageCmd
    .command('show')
    .description('Show details of a storage location')
    .argument('<name>', 'Storage name to show')
    .action(async (name) => {
      try {
        const storage = await prisma.storageLocation.findUnique({
          where: { name }
        });
        
        if (!storage) {
          console.error(chalk.red(`\n✗ Storage location "${name}" not found`));
          console.log(chalk.yellow('\n💡 Available storages:'));
          const storages = await prisma.storageLocation.findMany();
          storages.forEach(s => console.log(chalk.dim(`  • ${s.name} (${s.type})`)));
          process.exit(1);
        }
        
        console.log(chalk.bold.cyan(`\n📋 Storage Details: ${storage.name}\n`));
        console.log(chalk.dim('─'.repeat(60)));
        console.log(`${chalk.bold('Name:')} ${storage.name}`);
        console.log(`${chalk.bold('Type:')} ${storage.type}`);
        console.log(`${chalk.bold('Default:')} ${storage.default ? chalk.green('Yes') : 'No'}`);
        console.log(`${chalk.bold('Enabled:')} ${storage.enabled ? 'Yes' : chalk.red('No')}`);
        console.log(`${chalk.bold('Created:')} ${new Date(storage.createdAt).toLocaleString()}`);
        console.log(`${chalk.bold('Updated:')} ${new Date(storage.updatedAt).toLocaleString()}`);
        
        if (storage.type === 'local') {
          const config = storage.config as any;
          console.log(`${chalk.bold('Path:')} ${config?.basePath || 'N/A'}`);
        } else {
          const config = storage.config as any;
          console.log(`${chalk.bold('Bucket:')} ${storage.bucket || 'N/A'}`);
          console.log(`${chalk.bold('Region:')} ${storage.region || 'N/A'}`);
          if (config?.prefix) {
            console.log(`${chalk.bold('Prefix:')} ${config.prefix}`);
          }
          console.log(`${chalk.bold('Access Key:')} ${storage.accessKey ? '***' : 'Not set'}`);
        }
        
        console.log(chalk.dim('─'.repeat(60)));
        
      } catch (error: any) {
        console.error(chalk.red('\n✗ Failed to show storage:'), error.message);
        process.exit(1);
      }
    });

  // ==================== REMOVE STORAGE ====================
  storageCmd
    .command('remove')
    .description('Remove a storage location')
    .argument('<name>', 'Storage name to remove')
    .option('-f, --force', 'Force removal without confirmation')
    .action(async (name, options) => {
      try {
        const storage = await prisma.storageLocation.findUnique({
          where: { name }
        });
        
        if (!storage) {
          console.error(chalk.red(`\n✗ Storage location "${name}" not found`));
          process.exit(1);
        }
        
        if (!options.force) {
          console.log(chalk.yellow(`\n⚠️  Remove storage location "${name}"?`));
          console.log(chalk.dim(`   Type: ${storage.type}`));
          
          const readline = require('readline');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          });
          
          const answer:string = await new Promise((resolve) => {
            rl.question(chalk.yellow('\nContinue? (y/N): '), resolve);
          });
          rl.close();
          
          if (answer.toLowerCase() !== 'y') {
            console.log(chalk.yellow('\nRemoval cancelled'));
            process.exit(0);
          }
        }
        
        await prisma.storageLocation.delete({
          where: { name }
        });
        
        console.log(chalk.green(`\n✓ Storage location "${name}" removed successfully`));
        
      } catch (error: any) {
        console.error(chalk.red('\n✗ Failed to remove storage location:'), error.message);
        process.exit(1);
      }
    });

  // ==================== SET DEFAULT STORAGE ====================
  storageCmd
    .command('set-default')
    .description('Set a storage location as default')
    .argument('<name>', 'Storage name to set as default')
    .action(async (name) => {
      const spinner = ora(`Setting "${name}" as default storage...`).start();
      
      try {
        const storage = await prisma.storageLocation.findUnique({
          where: { name }
        });
        
        if (!storage) {
          spinner.fail(`Storage location "${name}" not found`);
          console.log(chalk.yellow('\n💡 Available storages:'));
          const storages = await prisma.storageLocation.findMany();
          storages.forEach(s => console.log(chalk.dim(`  • ${s.name} (${s.type})`)));
          process.exit(1);
        }
        
        // Unset all defaults
        await prisma.storageLocation.updateMany({
          where: { default: true },
          data: { default: false }
        });
        
        // Set new default
        await prisma.storageLocation.update({
          where: { name },
          data: { default: true }
        });
        
        spinner.succeed(chalk.green(`✓ "${name}" set as default storage`));
        console.log(chalk.dim(`\n  Type: ${storage.type}`));
        if (storage.type === 'local') {
          const config = storage.config as any;
          console.log(chalk.dim(`  Path: ${config?.basePath || 'N/A'}`));
        } else {
          console.log(chalk.dim(`  Bucket: ${storage.bucket}`));
          console.log(chalk.dim(`  Region: ${storage.region}`));
        }
        console.log(chalk.dim(`\n💡 Now you can backup without specifying storage:`));
        console.log(chalk.dim(`  db-backup backup --type full`));
        
      } catch (error: any) {
        spinner.fail(chalk.red('Failed to set default storage'));
        console.error(chalk.red(`\n✗ Error: ${error.message}`));
        process.exit(1);
      }
    });
}