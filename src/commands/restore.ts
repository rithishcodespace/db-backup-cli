import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { prisma } from "../lib/prisma";
import { createModuleLogger } from '../logger';
import { config } from '../config';
import { createReadStream, createWriteStream, existsSync, unlinkSync, mkdirSync } from 'fs';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import { S3Client, GetObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

const streamPipeline = promisify(pipeline);
const log = createModuleLogger('restore-command');

// ==================== Types ====================

interface StorageLocation {
    id: string;
    name: string;
    type: string;
    bucket: string | null;
    region: string | null;
    accessKey: string | null;
    secretKey: string | null;
    prefix: string | null;
    config: any;
}

// ==================== S3 Helper Functions ====================

function isS3Path(filePath: string): boolean {
    return filePath.startsWith('s3://');
}

function parseS3Uri(uri: string): { bucket: string; key: string } {
    // Remove s3:// prefix
    const withoutProtocol = uri.replace(/^s3:\/\//, '');
    
    // Split by first slash to separate bucket and key
    const firstSlashIndex = withoutProtocol.indexOf('/');
    
    if (firstSlashIndex === -1) {
        throw new Error(`Invalid S3 URI: ${uri}. Expected format: s3://bucket-name/path/to/file`);
    }
    
    const bucket = withoutProtocol.substring(0, firstSlashIndex);
    let key = withoutProtocol.substring(firstSlashIndex + 1);
    
    // Normalize key: remove duplicate slashes and trim leading/trailing slashes
    key = key.replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    
    if (!bucket) {
        throw new Error(`Invalid S3 URI: ${uri}. Bucket name is missing.`);
    }
    
    if (!key) {
        throw new Error(`Invalid S3 URI: ${uri}. Key is missing.`);
    }
    
    return { bucket, key };
}

async function downloadS3Backup(
    s3Uri: string,
    storage: StorageLocation
): Promise<string> {
    const { bucket, key } = parseS3Uri(s3Uri);
    
    // PATCH 5: Validate StorageLocation before downloading
    if (!storage.region) {
        throw new Error(`Storage location "${storage.name}" has no region configured. Please update the storage configuration.`);
    }
    if (!storage.bucket) {
        throw new Error(`Storage location "${storage.name}" has no bucket configured. Please update the storage configuration.`);
    }
    if (!storage.accessKey) {
        throw new Error(`Storage location "${storage.name}" has no access key configured. Please update the storage configuration.`);
    }
    if (!storage.secretKey) {
        throw new Error(`Storage location "${storage.name}" has no secret key configured. Please update the storage configuration.`);
    }
    
    // Create temp directory
    const tempDir = path.join(os.tmpdir(), 'db-backup');
    if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
    }
    
    // Generate temp file path
    const fileName = path.basename(key);
    const tempFilePath = path.join(tempDir, fileName);
    
    console.log(chalk.dim(`\n📥 Downloading from S3:`));
    console.log(chalk.dim(`   Bucket: ${bucket}`));
    console.log(chalk.dim(`   Key: ${key}`));
    console.log(chalk.dim(`   Region: ${storage.region}`));
    console.log(chalk.dim(`   Storage: ${storage.name}`));
    
    // Initialize S3 client with storage credentials (PATCH 4: No process.env)
    let s3Client = new S3Client({
        region: storage.region,
        credentials: {
            accessKeyId: storage.accessKey,
            secretAccessKey: storage.secretKey,
        },
    });
    
    // PATCH 1: Validate bucket with HeadBucketCommand and region retry
    let headBucketError: any = null;
    let correctRegion: string | null = null;
    
    try {
        const headCommand = new HeadBucketCommand({ Bucket: bucket });
        await s3Client.send(headCommand);
    } catch (error: any) {
        // PATCH 1 & 3: Detect region mismatch and get correct region from AWS
        if (error.name === 'InvalidRegion' || 
            error.message?.includes('InvalidRegion') ||
            error.message?.includes('permanent redirect')) {
            
            console.log(chalk.dim(`\n🔄 Region mismatch detected. Determining correct region...`));
            
            try {
                // Get bucket location using the current region
                const locationClient = new S3Client({
                    region: storage.region || 'us-east-1',
                    credentials: {
                        accessKeyId: storage.accessKey,
                        secretAccessKey: storage.secretKey,
                    },
                });
                
                const { GetBucketLocationCommand } = await import('@aws-sdk/client-s3');
                const locationCommand = new GetBucketLocationCommand({ Bucket: bucket });
                const locationResponse = await locationClient.send(locationCommand);
                
                correctRegion = locationResponse.LocationConstraint || 'us-east-1';
                
                console.log(chalk.dim(`   Correct region: ${correctRegion}`));
                
                // Retry HeadBucket with correct region
                const retryClient = new S3Client({
                    region: correctRegion,
                    credentials: {
                        accessKeyId: storage.accessKey,
                        secretAccessKey: storage.secretKey,
                    },
                });
                
                const retryHeadCommand = new HeadBucketCommand({ Bucket: bucket });
                await retryClient.send(retryHeadCommand);
                
                // PATCH 2: Update StorageLocation with correct region
                await prisma.storageLocation.update({
                    where: { id: storage.id },
                    data: { region: correctRegion }
                });
                
                console.log(chalk.dim(`✅ Updated storage region to: ${correctRegion}`));
                
                // Update the client for subsequent operations
                s3Client = retryClient;
                
            } catch (retryError: any) {
                headBucketError = retryError;
            }
        } else {
            headBucketError = error;
        }
    }
    
    // PATCH 3: Handle HeadBucket errors with user-friendly messages
    if (headBucketError) {
        const error = headBucketError;
        
        if (error.name === 'NotFound' || error.name === 'NoSuchBucket') {
            throw new Error(`Bucket "${bucket}" does not exist. Please verify the bucket name.`);
        }
        if (error.name === 'AccessDenied') {
            throw new Error(`Invalid AWS credentials or insufficient permissions for bucket "${bucket}".`);
        }
        if (error.name === 'InvalidAccessKeyId') {
            throw new Error(`Invalid Access Key configured for storage "${storage.name}".`);
        }
        if (error.name === 'SignatureDoesNotMatch') {
            throw new Error(`Invalid Secret Key configured for storage "${storage.name}".`);
        }
        if (error.name === 'NetworkingError' || error.name === 'TimeoutError') {
            throw new Error(`Unable to connect to AWS S3. Please check your network connection.`);
        }
        if (error.message?.includes('InvalidRegion') || error.message?.includes('permanent redirect')) {
            throw new Error(`Invalid region "${storage.region}" for bucket "${bucket}". Please update the storage configuration.`);
        }
        throw new Error(`Failed to access bucket "${bucket}": ${error.message}`);
    }
    
    // Download the object
    const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
    });
    
    try {
        const response = await s3Client.send(command);
        
        if (!response.Body) {
            throw new Error('No data received from S3');
        }
        
        const writeStream = createWriteStream(tempFilePath);
        await streamPipeline(response.Body as any, writeStream);
        
        console.log(chalk.dim(`✅ Downloaded to: ${tempFilePath}`));
        console.log(chalk.dim(`   Size: ${(response.ContentLength || 0).toLocaleString()} bytes`));
        
        return tempFilePath;
    } catch (error: any) {
        // PATCH 3: Handle GetObject errors with user-friendly messages
        if (error.name === 'NoSuchKey') {
            throw new Error(`Backup object not found in S3: s3://${bucket}/${key}. The backup file may have been deleted.`);
        }
        if (error.name === 'AccessDenied') {
            throw new Error(`Invalid AWS credentials or insufficient permissions for object s3://${bucket}/${key}.`);
        }
        if (error.name === 'InvalidAccessKeyId') {
            throw new Error(`Invalid Access Key configured for storage "${storage.name}".`);
        }
        if (error.name === 'SignatureDoesNotMatch') {
            throw new Error(`Invalid Secret Key configured for storage "${storage.name}".`);
        }
        if (error.name === 'NetworkingError' || error.name === 'TimeoutError') {
            throw new Error(`Unable to connect to AWS S3. Please check your network connection.`);
        }
        throw new Error(`Failed to download from S3: ${error.message}`);
    }
}

function cleanupTempFile(filePath: string): void {
    try {
        if (filePath && existsSync(filePath)) {
            unlinkSync(filePath);
            log.debug('Temporary file cleaned up', { path: filePath });
        }
    } catch (error) {
        log.warn('Failed to cleanup temp file', { path: filePath, error });
    }
}

// ==================== Main Restore Command ====================

export function registerRestoreCommand(program: Command): void {
    program
        .command('restore')
        .description('Restore a database from backup using full backup ID')
        .option('-i, --id <id>', 'Full backup ID to restore (copy from list command)')
        .option('-f, --file <path>', 'Local backup file path')
        .option('-t, --tables <tables>', 'Comma-separated tables to restore (if supported)')
        .option('--drop-existing', 'Drop existing tables before restore', false)
        .option('--dry-run', 'Perform a dry run without actual restore', false)
        .option('--force', 'Force restore (drop existing tables)', false)
        .action(async (options) => {
            const spinner = ora('Preparing restore...').start();
            let tempDownloadedFile: string | null = null;
            
            try {
                const dbConfig = config.get('database');
                if (!dbConfig) {
                    spinner.fail('No database configuration found');
                    console.error(chalk.red('\n✗ Please run "db-backup connect" first'));
                    process.exit(1);
                }
                
                let backupFile = options.file;
                let backupRecord = null;
                let storageLocation: StorageLocation | null = null;
                
                if (options.id) {
                    // Load backup record with storage location relation
                    backupRecord = await prisma.backupJob.findUnique({
                        where: { id: options.id },
                        include: {
                            storageLocation: true
                        }
                    });
                    
                    if (!backupRecord) {
                        spinner.fail(`Backup with ID "${options.id}" not found`);
                        console.error(chalk.yellow('\n💡 Use "db-backup list" to see all available backup IDs'));
                        process.exit(1);
                    }
                    
                    if (!backupRecord.filePath) {
                        spinner.fail('Backup file path not found in record');
                        process.exit(1);
                    }
                    
                    backupFile = backupRecord.filePath;
                    
                    // Store storage location reference
                    storageLocation = backupRecord.storageLocation as StorageLocation | null;
                    
                    spinner.stop();
                    console.log(chalk.dim('\n📋 Found backup:'));
                    console.log(chalk.dim(`   ID: ${backupRecord.id}`));
                    console.log(chalk.dim(`   Type: ${backupRecord.backupType}`));
                    console.log(chalk.dim(`   Database: ${backupRecord.dbType}/${backupRecord.dbName}`));
                    console.log(chalk.dim(`   Size: ${backupRecord.fileSize ? (backupRecord.fileSize / 1024 / 1024).toFixed(2) : 'N/A'} MB`));
                    console.log(chalk.dim(`   Created: ${new Date(backupRecord.startedAt).toLocaleString()}`));
                    if (storageLocation) {
                        console.log(chalk.dim(`   Storage: ${storageLocation.name} (${storageLocation.type})`));
                    }
                    spinner.start('Continuing restore...');
                }
                
                if (!backupFile) {
                    spinner.fail('Please specify a backup ID or file path');
                    console.error(chalk.dim('\n  Use --id <backup-id> or --file <path>'));
                    console.error(chalk.dim('\n  List available backups: db-backup list'));
                    process.exit(1);
                }
                
                // ============================================================
                // STEP 1: Check if backup is local or S3
                // ============================================================
                let restoreFile = backupFile;
                
                if (isS3Path(backupFile)) {
                    // S3 backup - download first
                    spinner.text = 'Downloading backup from S3...';
                    log.info('Downloading from S3', { s3Path: backupFile });
                    
                    try {
                        // PATCH 9: Check if storageLocation exists
                        if (!storageLocation) {
                            throw new Error(
                                'Storage location not found for this backup. ' +
                                'The backup was created without a storage location reference. ' +
                                'Please ensure the backup has a valid storage location association.'
                            );
                        }
                        
                        if (storageLocation.type !== 's3') {
                            throw new Error(
                                `Storage location "${storageLocation.name}" is type "${storageLocation.type}", ` +
                                'but the backup path indicates S3. Please check your configuration.'
                            );
                        }
                        
                        tempDownloadedFile = await downloadS3Backup(backupFile, storageLocation);
                        restoreFile = tempDownloadedFile;
                        spinner.text = 'Restore preparation complete...';
                    } catch (error: any) {
                        spinner.fail(chalk.red('Failed to download backup from S3'));
                        console.error(chalk.red(`\n✗ Error: ${error.message}`));
                        // PATCH 7: Cleanup on error
                        if (tempDownloadedFile) {
                            cleanupTempFile(tempDownloadedFile);
                        }
                        process.exit(1);
                    }
                } else {
                    // Local backup - verify file exists
                    if (!existsSync(backupFile)) {
                        spinner.fail(`Backup file not found: ${backupFile}`);
                        process.exit(1);
                    }
                }
                
                // If drop-existing is set, warn user
                if (options.dropExisting || options.force) {
                    spinner.stop();
                    console.log(chalk.yellow('\n⚠ WARNING: --drop-existing will drop existing tables before restore.'));
                    console.log(chalk.dim('   This will delete all data in the target database.'));
                    
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
                        console.log(chalk.yellow('\nRestore cancelled'));
                        // PATCH 7: Cleanup on cancellation
                        if (tempDownloadedFile) {
                            cleanupTempFile(tempDownloadedFile);
                        }
                        process.exit(0);
                    }
                    spinner.start('Continuing restore...');
                }
                
                if (options.dryRun) {
                    spinner.succeed(chalk.green('Dry run completed'));
                    console.log(chalk.yellow('\n⚠ This was a dry run. No changes were made.'));
                    console.log(chalk.dim(`\n  Would restore from: ${backupFile}`));
                    if (options.tables) {
                        console.log(chalk.dim(`  Tables: ${options.tables}`));
                    }
                    console.log(chalk.dim(`  Drop existing: ${options.dropExisting ? 'Yes' : 'No'}`));
                    // PATCH 7: Cleanup on dry run
                    if (tempDownloadedFile) {
                        cleanupTempFile(tempDownloadedFile);
                    }
                    return;
                }
                
                spinner.text = 'Performing restore...';
                log.info('Starting restore', { backupFile, dbType: dbConfig.type });
                
                let result;
                
                switch (dbConfig.type) {
                    case 'postgresql':
                    case 'postgres':
                        result = await restorePostgres(restoreFile, dbConfig, options);
                        break;
                    case 'mysql':
                        result = await restoreMySQL(restoreFile, dbConfig, options);
                        break;
                    default:
                        spinner.fail(`Restore not yet implemented for ${dbConfig.type}`);
                        // PATCH 7: Cleanup on error
                        if (tempDownloadedFile) {
                            cleanupTempFile(tempDownloadedFile);
                        }
                        process.exit(1);
                }
                
                // PATCH 7: Cleanup temporary downloaded file (always runs)
                if (tempDownloadedFile) {
                    cleanupTempFile(tempDownloadedFile);
                }
                
                if (result.success) {
                    spinner.succeed(chalk.green('Restore completed successfully!'));
                    console.log(chalk.green('\n✓ Database restored'));
                    console.log(chalk.dim(`  From: ${backupFile}`));
                    console.log(chalk.dim(`  Duration: ${result.duration?.toFixed(2)}s`));
                    
                    log.info('Restore completed', { backupFile, duration: result.duration });
                } else {
                    spinner.fail(chalk.red('Restore failed'));
                    console.error(chalk.red(`\n✗ ${result.error}`));
                    
                    // Show helpful tips based on error
                    if (result.error?.includes('already exists')) {
                        console.log(chalk.yellow('\n💡 Tip: Use --drop-existing to drop existing tables before restore'));
                        console.log(chalk.dim('   db-backup restore --id <backup-id> --drop-existing'));
                    }
                    if (result.error?.includes('duplicate key')) {
                        console.log(chalk.yellow('\n💡 Tip: Use --drop-existing to clean the database before restore'));
                        console.log(chalk.dim('   db-backup restore --id <backup-id> --drop-existing'));
                    }
                    process.exit(1);
                }
                
            } catch (error: any) {
                // PATCH 7: Cleanup temporary downloaded file on error
                if (tempDownloadedFile) {
                    cleanupTempFile(tempDownloadedFile);
                }
                spinner.fail(chalk.red('Restore failed'));
                console.error(chalk.red(`\n✗ Error: ${error.message}`));
                log.error('Restore failed', { error: error.message });
                process.exit(1);
            }
        });
}

// ==================== PostgreSQL Restore ====================

async function restorePostgres(backupFile: string, dbConfig: any, options: any): Promise<any> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const fs = require('fs');
    
    const startTime = Date.now();
    let decompressedFile: string | null = null;
    
    try {
        let restoreFile = backupFile;
        let isGzipped = false;
        
        // Check if file is gzipped (.gz)
        if (backupFile.endsWith('.gz')) {
            try {
                const fileBuffer = fs.readFileSync(backupFile, { encoding: null, length: 2 });
                if (fileBuffer[0] === 0x1f && fileBuffer[1] === 0x8b) {
                    isGzipped = true;
                    decompressedFile = backupFile.replace('.gz', '');
                    
                    if (!fs.existsSync(decompressedFile)) {
                        console.log(chalk.dim(`\n🔄 Decompressing backup file...`));
                        
                        const readStream = createReadStream(backupFile);
                        const gunzipStream = createGunzip();
                        const writeStream = createWriteStream(decompressedFile);
                        
                        await streamPipeline(readStream, gunzipStream, writeStream);
                        console.log(chalk.dim(`✅ Decompressed to: ${decompressedFile}`));
                    }
                    
                    restoreFile = decompressedFile;
                } else {
                    console.log(chalk.dim(`\n📦 Using custom format dump directly (not actually gzipped)`));
                    restoreFile = backupFile;
                }
            } catch (e) {
                restoreFile = backupFile;
            }
        }
        
        // Build pg_restore command
        let command = `pg_restore -h ${dbConfig.host} -p ${dbConfig.port || 5432} -U ${dbConfig.username} -d ${dbConfig.database}`;
        
        if (options.tables) {
            const tables = options.tables.split(',');
            tables.forEach((table: string) => { command += ` -t ${table}`; });
        }
        
        if (options.dropExisting || options.force) {
            command += ' --clean --if-exists';
        }
        
        command += ' --verbose';
        command += ` "${restoreFile}"`;
        
        console.log(chalk.dim(`\n🔄 Restoring database...`));
        
        try {
            await execAsync(command, {
                env: { ...process.env, PGPASSWORD: dbConfig.password },
                maxBuffer: 50 * 1024 * 1024
            });
        } catch (pgError: any) {
            let errorMessage = pgError.message;
            const errorLines = errorMessage.split('\n');
            let userFriendlyError = '';
            
            for (const line of errorLines) {
                if (line.includes('ERROR:')) {
                    userFriendlyError = line.trim();
                    break;
                }
                if (line.includes('already exists')) {
                    userFriendlyError = 'Database objects already exist. Use --drop-existing to clean the database first.';
                    break;
                }
                if (line.includes('duplicate key')) {
                    userFriendlyError = 'Duplicate data found. Use --drop-existing to clean the database first.';
                    break;
                }
                if (line.includes('permission denied')) {
                    userFriendlyError = 'Permission denied. Check your database credentials.';
                    break;
                }
            }
            
            if (!userFriendlyError) {
                const lastLines = errorLines.slice(-5).join('\n');
                userFriendlyError = `Restore failed:\n${lastLines}`;
            }
            
            // PATCH 7: Cleanup decompressed file on error
            if (decompressedFile && fs.existsSync(decompressedFile)) {
                try {
                    fs.unlinkSync(decompressedFile);
                } catch (cleanupError) {
                    // Ignore
                }
            }
            
            return {
                success: false,
                error: userFriendlyError,
                duration: (Date.now() - startTime) / 1000
            };
        }
        
        // PATCH 7: Clean up decompressed file
        if (decompressedFile && fs.existsSync(decompressedFile)) {
            try {
                fs.unlinkSync(decompressedFile);
                console.log(chalk.dim(`\n🧹 Cleaned up temporary file: ${decompressedFile}`));
            } catch (cleanupError) {
                // Ignore
            }
        }
        
        const duration = (Date.now() - startTime) / 1000;
        return { success: true, duration };
    } catch (error: any) {
        // PATCH 7: Cleanup decompressed file on error
        if (decompressedFile) {
            try {
                if (fs.existsSync(decompressedFile)) {
                    fs.unlinkSync(decompressedFile);
                }
            } catch (e) { /* ignore */ }
        }
        return {
            success: false,
            error: error.message,
            duration: (Date.now() - startTime) / 1000
        };
    }
}

// ==================== MySQL Restore ====================

async function restoreMySQL(backupFile: string, dbConfig: any, options: any): Promise<any> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const fs = require('fs');
    
    const startTime = Date.now();
    let decompressedFile: string | null = null;
    
    try {
        let restoreFile = backupFile;
        let isGzipped = false;
        
        if (backupFile.endsWith('.gz')) {
            try {
                const fileBuffer = fs.readFileSync(backupFile, { encoding: null, length: 2 });
                if (fileBuffer[0] === 0x1f && fileBuffer[1] === 0x8b) {
                    isGzipped = true;
                    decompressedFile = backupFile.replace('.gz', '');
                    
                    if (!fs.existsSync(decompressedFile)) {
                        console.log(chalk.dim(`\n🔄 Decompressing backup file...`));
                        
                        const readStream = createReadStream(backupFile);
                        const gunzipStream = createGunzip();
                        const writeStream = createWriteStream(decompressedFile);
                        
                        await streamPipeline(readStream, gunzipStream, writeStream);
                        console.log(chalk.dim(`✅ Decompressed to: ${decompressedFile}`));
                    }
                    
                    restoreFile = decompressedFile;
                } else {
                    restoreFile = backupFile;
                }
            } catch (e) {
                restoreFile = backupFile;
            }
        }
        
        let command = `mysql -h ${dbConfig.host} -P ${dbConfig.port || 3306} -u ${dbConfig.username}`;
        
        if (dbConfig.password) {
            command += ` -p${dbConfig.password}`;
        }
        
        command += ` ${dbConfig.database}`;
        
        if (options.dropExisting || options.force) {
            command += ' --force';
        }
        
        command += ` < "${restoreFile}"`;
        
        console.log(chalk.dim(`\n🔄 Restoring database...`));
        
        try {
            await execAsync(command, { maxBuffer: 50 * 1024 * 1024 });
        } catch (mysqlError: any) {
            let userFriendlyError = mysqlError.message;
            
            if (mysqlError.message.includes('Access denied')) {
                userFriendlyError = 'Access denied. Check your database credentials.';
            } else if (mysqlError.message.includes('Unknown database')) {
                userFriendlyError = `Database '${dbConfig.database}' does not exist. Please create it first.`;
            } else if (mysqlError.message.includes('already exists')) {
                userFriendlyError = 'Tables already exist. Use --drop-existing to clean the database first.';
            }
            
            // PATCH 7: Cleanup decompressed file on error
            if (decompressedFile && fs.existsSync(decompressedFile)) {
                try {
                    fs.unlinkSync(decompressedFile);
                } catch (cleanupError) {
                    // Ignore
                }
            }
            
            return {
                success: false,
                error: userFriendlyError,
                duration: (Date.now() - startTime) / 1000
            };
        }
        
        // PATCH 7: Clean up decompressed file
        if (decompressedFile && fs.existsSync(decompressedFile)) {
            try {
                fs.unlinkSync(decompressedFile);
                console.log(chalk.dim(`\n🧹 Cleaned up temporary file: ${decompressedFile}`));
            } catch (cleanupError) {
                // Ignore
            }
        }
        
        const duration = (Date.now() - startTime) / 1000;
        return { success: true, duration };
    } catch (error: any) {
        // PATCH 7: Cleanup decompressed file on error
        if (decompressedFile) {
            try {
                if (fs.existsSync(decompressedFile)) {
                    fs.unlinkSync(decompressedFile);
                }
            } catch (e) { /* ignore */ }
        }
        return {
            success: false,
            error: error.message,
            duration: (Date.now() - startTime) / 1000
        };
    }
}