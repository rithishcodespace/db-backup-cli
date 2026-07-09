// src/commands/backup.ts

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import { createModuleLogger } from '../logger';
import { config } from '../config';
import { prisma } from "../lib/prisma";
import { keyManager } from '../lib/key-manager';
import httpClient from '../utils/http-client';
import crypto from 'crypto';

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
    .option('--no-store-key', 'Do not store the encryption key in local keystore', false)
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

        // Handle encryption with local keystore

        let encryptionKey: string | null = null;
        let storeKey = true;
        
        if (options.encrypt) {
          // If user provided a key, use it
          if (options.key) {
            if (options.key.length !== 64) {
              spinner.fail('Encryption key must be 64 hexadecimal characters (32 bytes)');
              console.error(chalk.yellow('\n💡 Generate a key with: openssl rand -hex 32'));
              process.exit(1);
            }
            encryptionKey = options.key;
            console.log(chalk.dim('\n🔑 Using provided encryption key'));
            storeKey = !options.noStoreKey;
          } else {
            // Auto-generate a key
            encryptionKey = crypto.randomBytes(32).toString('hex');
            console.log(chalk.yellow('\n🔑 Auto-generated encryption key'));
            storeKey = !options.noStoreKey;
          }
          
          // Store key in local keystore (if not disabled)
          if (storeKey) {
            // Store key before backup so it's available if backup succeeds
            keyManager.addKey(
              'pending', // Will be updated after backup completes
              encryptionKey as any,
              dbConfig.database,
              dbConfig.type
            );
            console.log(chalk.dim('   🔐 Key stored in local keystore'));
          } else {
            console.log(chalk.yellow('\n⚠️  Key will NOT be stored in local keystore'));
            console.log(chalk.dim(`   Save this key securely: ${encryptionKey}`));
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
            encrypt: options.encrypt,
            encryptionKey: encryptionKey,
            storeKey: storeKey
          }
        };
        
        spinner.text = 'Sending backup request to orchestrator...';
        log.debug('Sending backup request', { 
          dbType: dbConfig.type, 
          storage: storageConfig?.type,
          storageLocationId,
          encrypt: options.encrypt,
          storeKey
        });
        
        const response = await httpClient.post(`${GATEWAY_URL}/api/backup`, backupRequest);
        
        if (response.data.success) {
          const backupId = response.data.backupId;
          
          // Update key store with actual backup ID
          if (options.encrypt && storeKey && encryptionKey) {
            // Remove pending entry and add with actual backup ID
            keyManager.deleteKey('pending');
            keyManager.addKey(
              backupId,
              encryptionKey,
              dbConfig.database,
              dbConfig.type
            );
          }
          
          spinner.succeed(chalk.green('Backup completed successfully!'));
          
          console.log(chalk.green('\n✓ Backup Details:'));
          console.log(chalk.dim(`  Backup ID: ${backupId}`));
          console.log(chalk.dim(`  Database: ${dbConfig.type}/${dbConfig.database}`));
          console.log(chalk.dim(`  Type: ${options.type}`));
          console.log(chalk.dim(`  Storage: ${storageConfig?.type || 'local'}`));
          if (storageConfig?.name) {
            console.log(chalk.dim(`  Storage Name: ${storageConfig.name}`));
          }
          
          if (options.encrypt) {
            console.log(chalk.dim(`  Encryption: AES-256-GCM ✅`));
            if (storeKey) {
              console.log(chalk.dim(`  🔐 Key stored locally for automatic decryption`));
            } else {
              console.log(chalk.yellow(`  ⚠️  Key not stored. Save it now: ${encryptionKey}`));
            }
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
          
          log.info('Backup completed via microservices', { backupId: backupId });
        } else {
          // Clean up pending key if backup failed
          if (options.encrypt && storeKey) {
            keyManager.deleteKey('pending');
          }
          spinner.fail(chalk.red('Backup failed'));
          console.error(chalk.red(`\n✗ Error: ${response.data.error}`));
          process.exit(1);
        }
        
      } catch (error: any) {
        // Clean up pending key on error
        if (options?.encrypt && options?.noStoreKey !== true) {
          keyManager.deleteKey('pending');
        }
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