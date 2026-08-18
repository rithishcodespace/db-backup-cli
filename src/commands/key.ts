// src/commands/key.ts

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { keyManager } from '../lib/key-manager';
import { createModuleLogger } from '../logger';

const log = createModuleLogger('key-command');

export function registerKeyCommand(program: Command): void {
    const keyCmd = program
        .command('key')
        .description('Manage local encryption keys');

    // LIST KEYS 
    keyCmd
        .command('list')
        .description('List all locally stored encryption keys')
        .action(async () => {
            try {
                const keys = keyManager.getAllKeys();
                
                if (keys.length === 0) {
                    console.log(chalk.yellow('\n📭 No encryption keys found locally'));
                    console.log(chalk.dim('\nCreate encrypted backups with:'));
                    console.log(chalk.dim('  db-backup backup --encrypt'));
                    return;
                }
                
                console.log(chalk.bold.cyan(`\n🔑 ${keys.length} Encryption Key(s) Stored Locally:\n`));
                console.log(chalk.dim('─'.repeat(80)));
                
                keys.forEach((key, index) => {
                    const maskedKey = key.key.substring(0, 8) + '...' + key.key.substring(key.key.length - 8);
                    
                    console.log(`${chalk.bold.white(`${index + 1}.`)} ${chalk.bold(key.backupId)}`);
                    console.log(`   ${chalk.dim('Database:')} ${key.dbType}/${key.dbName}`);
                    console.log(`   ${chalk.dim('Key:')} ${maskedKey}`);
                    console.log(`   ${chalk.dim('Algorithm:')} ${key.algorithm}`);
                    console.log(`   ${chalk.dim('Created:')} ${new Date(key.createdAt).toLocaleString()}`);
                    if (key.keyId) {
                        console.log(`   ${chalk.dim('Key ID:')} ${key.keyId}`);
                    }
                    console.log('');
                });
                
                console.log(chalk.dim('─'.repeat(80)));
                console.log(chalk.dim(`\n💡 Keystore location: ${keyManager.getKeystorePath()}`));
                process.exit(0);
                
            } catch (error: any) {
                console.error(chalk.red('\n✗ Failed to list keys:'), error.message);
                log.error('Failed to list keys', { error: error.message });
                process.exit(1);
            }
        });

    // ==================== EXPORT KEYS ====================
    keyCmd
        .command('export')
        .description('Export the local keystore')
        .argument('<path>', 'Export file path')
        .action(async (exportPath: string) => {
            const spinner = ora('Exporting keystore...').start();
            
            try {
                keyManager.exportKeystore(exportPath);
                spinner.succeed(chalk.green('Keystore exported successfully'));
                log.info('Keystore exported', { path: exportPath });
                process.exit(0);
            } catch (error: any) {
                spinner.fail(chalk.red('Failed to export keystore'));
                console.error(chalk.red(`\n✗ Error: ${error.message}`));
                log.error('Failed to export keystore', { error: error.message });
                process.exit(1);
            }
        });

    // ==================== IMPORT KEYS ====================
    keyCmd
        .command('import')
        .description('Import a keystore from a file')
        .argument('<path>', 'Import file path')
        .requiredOption('-p, --password <password>', 'Import password')
        .action(async (importPath: string, options: any) => {
            const spinner = ora('Importing keystore...').start();
            
            try {
                keyManager.importKeystore(importPath, options.password);
                spinner.succeed(chalk.green('Keystore imported successfully'));
                log.info('Keystore imported', { path: importPath });
                process.exit(0);
            } catch (error: any) {
                spinner.fail(chalk.red('Failed to import keystore'));
                console.error(chalk.red(`\n✗ Error: ${error.message}`));
                log.error('Failed to import keystore', { error: error.message });
                process.exit(1);
            }
        });

    // ==================== DELETE KEY ====================
    keyCmd
        .command('delete')
        .description('Delete a stored encryption key')
        .requiredOption('-i, --id <backupId>', 'Backup ID to delete key for')
        .option('-f, --force', 'Force deletion without confirmation')
        .action(async (options: any) => {
            try {
                const key = keyManager.getKey(options.id);
                
                if (!key) {
                    console.log(chalk.yellow(`\n⚠️  No key found for backup ID: ${options.id}`));
                    process.exit(0);
                }
                
                if (!options.force) {
                    console.log(chalk.yellow(`\n⚠️  This will delete the encryption key for backup: ${options.id}`));
                    console.log(chalk.dim(`   Database: ${key.dbType}/${key.dbName}`));
                    console.log(chalk.dim(`   Created: ${new Date(key.createdAt).toLocaleString()}`));
                    
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
                        console.log(chalk.yellow('\nDeletion cancelled'));
                        process.exit(0);
                    }
                }
                
                const deleted = keyManager.deleteKey(options.id);
                
                if (deleted) {
                    console.log(chalk.green(`\n✓ Encryption key deleted for backup: ${options.id}`));
                    log.info('Key deleted', { backupId: options.id });
                } else {
                    console.log(chalk.yellow(`\n⚠️  No key found for backup: ${options.id}`));
                }
                process.exit(0);
                
            } catch (error: any) {
                console.error(chalk.red('\n✗ Failed to delete key:'), error.message);
                log.error('Failed to delete key', { error: error.message });
                process.exit(1);
            }
        });

    // ==================== SHOW KEY ====================
    keyCmd
        .command('show')
        .description('Show details of a stored encryption key')
        .requiredOption('-i, --id <backupId>', 'Backup ID to show key for')
        .action(async (options: any) => {
            try {
                const key = keyManager.getKey(options.id);
                
                if (!key) {
                    console.log(chalk.yellow(`\n⚠️  No key found for backup ID: ${options.id}`));
                    process.exit(0);
                }
                
                console.log(chalk.bold.cyan(`\n🔑 Encryption Key Details\n`));
                console.log(chalk.dim('─'.repeat(50)));
                console.log(`${chalk.bold('Backup ID:')} ${key.backupId}`);
                console.log(`${chalk.bold('Database:')} ${key.dbType}/${key.dbName}`);
                console.log(`${chalk.bold('Algorithm:')} ${key.algorithm}`);
                console.log(`${chalk.bold('Created:')} ${new Date(key.createdAt).toLocaleString()}`);
                if (key.keyId) {
                    console.log(`${chalk.bold('Key ID:')} ${key.keyId}`);
                }
                console.log(`${chalk.bold('Key:')} ${key.key}`);
                console.log(chalk.dim('─'.repeat(50)));
                console.log(chalk.yellow('\n⚠️  Keep this key secure!'));
                console.log(chalk.dim('   Anyone with this key can decrypt your backup.'));
                process.exit(0);
                
            } catch (error: any) {
                console.error(chalk.red('\n✗ Failed to show key:'), error.message);
                log.error('Failed to show key', { error: error.message });
                process.exit(1);
            }
        });
}