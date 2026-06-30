// src/commands/backup.ts

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import { createModuleLogger } from '../logger';
import { config } from '../config';
import { prisma } from "../lib/prisma";

const log = createModuleLogger('backup-command');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';

export function registerBackupCommand(program: Command): void {
  program
    .command('backup')
    .description('Perform a database backup using microservices')
    .option('-t, --type <type>', 'Backup type (full, incremental, differential)', 'full')
    .option('-c, --compress', 'Compress backup file', true)
    .option('-o, --output <path>', 'Output directory')
    .option('-n, --name <name>', 'Custom backup name')
    .option('--tables <tables>', 'Comma-separated list of tables to backup')
    .option('--exclude-tables <tables>', 'Comma-separated list of tables to exclude')
    .option('--async', 'Run backup asynchronously (return immediately)', false)
    .option('--no-compress', 'Disable compression')
    .option('--storage <name>', 'Storage name (from db-backup storage list)')
    // encryption options
    .option('--encrypt', 'Enable AES-256-GCM encryption for the backup', false)
    .option('--key <key>', '32-byte AES-256 encryption key (64 hex characters)')
    .action(async (options) => {
      const spinner = ora('Preparing backup request...').start();
      
      try {
        const dbConfig = config.get('database');
        if (!dbConfig) {
          spinner.fail('No database configuration found');
          console.error(chalk.red('\n✗ Please run "db-backup connect" first'));
          process.exit(1);
        }
        
        const tables = options.tables ? options.tables.split(',') : undefined;
        const excludeTables = options.excludeTables ? options.excludeTables.split(',') : undefined;

        // Get storage configurations
        let storageConfig = null;
        let storageName = options.storage || null;
        let storageLocationId: string | null = null;

        if (storageName) {
          const storage = await prisma.storageLocation.findUnique({
            where: { name: storageName }
          });

          if (!storage) {
            spinner.fail(`Storage location "${storageName}" not found`);
            console.error(chalk.yellow(`\n💡 Available storages:`));
            const storages = await prisma.storageLocation.findMany({
              where: { enabled: true }
            });
            if (storages.length === 0) {
              console.error(chalk.dim('  No storage locations configured.'));
              console.error(chalk.dim('  Run: db-backup storage add --type local --name my-storage'));
            } else {
              storages.forEach(s => console.log(chalk.dim(`  • ${s.name} (${s.type})`)));
            }
            process.exit(1);
          }

          storageLocationId = storage.id;
          const storageJson = storage.config as any;

          if (storage.type === 's3') {
            storageConfig = {
              type: 's3',
              name: storage.name,
              bucket: storage.bucket,
              region: storage.region,
              accessKey: storage.accessKey,
              secretKey: storage.secretKey,
              prefix: storageJson?.prefix || ''
            };
          } else {
            storageConfig = {
              type: 'local',
              name: storage.name,
              basePath: storageJson?.basePath || options.output || config.get('storage.localPath')
            };
          }

          console.log(chalk.dim(`\n📦 Using storage: ${storage.name} (${storage.type})`));
        } else {
          const defaultStorage = await prisma.storageLocation.findFirst({
            where: { default: true, enabled: true }
          });

          if (defaultStorage) {
            storageLocationId = defaultStorage.id;
            const storageJson = defaultStorage.config as any;

            if (defaultStorage.type === 's3') {
              storageConfig = {
                type: 's3',
                name: defaultStorage.name,
                bucket: defaultStorage.bucket,
                region: defaultStorage.region,
                accessKey: defaultStorage.accessKey,
                secretKey: defaultStorage.secretKey,
                prefix: storageJson?.prefix || ''
              };
            } else {
              storageConfig = {
                type: 'local',
                name: defaultStorage.name,
                basePath: storageJson?.basePath || options.output || config.get('storage.localPath')
              };
            }
            console.log(chalk.dim(`\n📦 Using default storage: ${defaultStorage.name} (${defaultStorage.type})`));
          } else {
            storageConfig = {
              type: 'local',
              name: 'local',
              basePath: options.output || config.get('storage.localPath')
            };
            console.log(chalk.dim(`\n📦 Using local storage (no default configured)`));
          }
        }
        
        // Handle encryption
        let encryptionKey: string | null = null;
        
        if (options.encrypt) {
          // If user provided a key, use it
          if (options.key) {
            // Validate key length (32 bytes = 64 hex characters)
            if (options.key.length !== 64) {
              spinner.fail('Encryption key must be 64 hexadecimal characters (32 bytes)');
              console.error(chalk.yellow('\n💡 Generate a key with: openssl rand -hex 32'));
              process.exit(1);
            }
            encryptionKey = options.key;
            console.log(chalk.dim('\n🔑 Using provided encryption key'));
          } else {
            // Auto-generate a key if none provided
            const crypto = require('crypto');
            encryptionKey = crypto.randomBytes(32).toString('hex');
            console.log(chalk.yellow('\n🔑 Auto-generated encryption key:'));
            console.log(chalk.dim(`   ${encryptionKey}`));
            console.log(chalk.yellow('⚠️  Save this key securely! You\'ll need it for decryption.'));
          }
        }
        
        const backupRequest = {
          dbConfig: {
            type: dbConfig.type,
            host: dbConfig.host,
            port: dbConfig.port,
            username: dbConfig.username,
            password: dbConfig.password,
            database: dbConfig.database,
            ssl: dbConfig.ssl
          },
          backupType: options.type,
          options: {
            compress: options.compress,
            tables,
            excludeTables,
            outputPath: options.output || config.get('storage.localPath'),
            backupName: options.name,
            storage: storageConfig,
            storageLocationId: storageLocationId,
            // Pass encryption
            encrypt: options.encrypt,
            encryptionKey: encryptionKey
          }
        };
        
        spinner.text = 'Sending backup request to orchestrator...';
        log.debug('Sending backup request', { 
          dbType: dbConfig.type, 
          storage: storageConfig?.type,
          storageLocationId,
          encrypt: options.encrypt
        });
        
        const response = await axios.post(`${GATEWAY_URL}/api/backup`, backupRequest);
        
        if (response.data.success) {
          spinner.succeed(chalk.green('Backup completed successfully!'));
          
          console.log(chalk.green('\n✓ Backup Details:'));
          console.log(chalk.dim(`  Backup ID: ${response.data.backupId}`));
          console.log(chalk.dim(`  Database: ${dbConfig.type}/${dbConfig.database}`));
          console.log(chalk.dim(`  Type: ${options.type}`));
          console.log(chalk.dim(`  Storage: ${storageConfig?.type || 'local'}`));
          if (storageConfig?.name) {
            console.log(chalk.dim(`  Storage Name: ${storageConfig.name}`));
          }
          
          if (options.encrypt) {
            console.log(chalk.dim(`  Encryption: AES-256-GCM ✅`));
          }
          
          if (response.data.fileSize) {
            const sizeMB = (response.data.fileSize / 1024 / 1024).toFixed(2);
            console.log(chalk.dim(`  Size: ${sizeMB} MB`));
          }
          
          if (response.data.duration) {
            console.log(chalk.dim(`  Duration: ${response.data.duration.toFixed(2)} seconds`));
          }
          
          if (response.data.filePath) {
            console.log(chalk.dim(`  Location: ${response.data.filePath}`));
          }
          
          // Show encryption key warning
          if (options.encrypt && !options.key) {
            console.log(chalk.yellow('\n⚠️  Remember to save your encryption key:'));
            console.log(chalk.dim(`   ${encryptionKey}`));
            console.log(chalk.dim('   Without this key, you cannot decrypt the backup!'));
          }
          
          log.info('Backup completed via microservices', { backupId: response.data.backupId });
        } else {
          spinner.fail(chalk.red('Backup failed'));
          console.error(chalk.red(`\n✗ Error: ${response.data.error}`));
          process.exit(1);
        }
        
      } catch (error: any) {
        spinner.fail(chalk.red('Backup request failed'));
        
        if (error.code === 'ECONNREFUSED') {
          console.error(chalk.red('\n✗ Cannot connect to API Gateway.'));
          console.error(chalk.yellow('\n💡 Make sure microservices are running:'));
          console.error(chalk.dim('  npm run services:start'));
        } else if (error.response?.data?.error) {
          console.error(chalk.red(`\n✗ ${error.response.data.error}`));
        } else {
          console.error(chalk.red(`\n✗ Error: ${error.message}`));
        }
        
        log.error('Backup request failed', { error: error.message });
        process.exit(1);
      }
    });
}