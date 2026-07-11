import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { prisma } from "../lib/prisma";
import { createModuleLogger } from '../logger';
import { config } from '../config';
import { createReadStream, createWriteStream, existsSync, unlinkSync, mkdirSync, readFileSync, openSync, readSync, closeSync } from 'fs';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import { S3Client, GetObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { createHash, createDecipheriv } from 'crypto';
import httpClient from '../utils/http-client';
import { keyManager } from '../lib/key-manager';
import { connection } from '../lib/queue-manager';
import { DistributedLock } from '../lib/distributed-lock';

const streamPipeline = promisify(pipeline);
const log = createModuleLogger('restore-command');
const ALGORITHM = 'aes-256-gcm';

// Lock TTL - configurable via environment variable only
// Default: 1 hour (3600 seconds)
const LOCK_TTL = parseInt(process.env.RESTORE_LOCK_TTL || '3600', 10);

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

// Calculate Checksum 
async function calculateChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(filePath);
        
        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', (error) => reject(error));
    });
}

// Decrypt File 
async function decryptFile(inputPath: string, outputPath: string, key: string, ivBase64: string, tagBase64: string): Promise<void> {
    const keyBuffer = Buffer.from(key, 'hex');
    const iv = Buffer.from(ivBase64, 'base64');
    const tag = Buffer.from(tagBase64, 'base64');
    
    const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv);
    decipher.setAuthTag(tag);
    
    const inputStream = createReadStream(inputPath);
    const outputStream = createWriteStream(outputPath);
    
    return new Promise((resolve, reject) => {
        inputStream.pipe(decipher).pipe(outputStream);
        
        outputStream.on('finish', () => resolve());
        inputStream.on('error', reject);
        decipher.on('error', reject);
        outputStream.on('error', reject);
    });
}

// Detect Gzip by Magic Bytes
function isGzipFile(filePath: string): boolean {
    try {
        const fd = openSync(filePath, 'r');
        const header = Buffer.alloc(2);
        readSync(fd, header, 0, 2, 0);
        closeSync(fd);
        return header[0] === 0x1f && header[1] === 0x8b;
    } catch {
        return false;
    }
}

// Prepare Restore File 
interface PrepareRestoreResult {
    restoreFile: string;
    tempDecompressedFile: string | null;
}

async function prepareRestoreFile(filePath: string): Promise<PrepareRestoreResult> {
    let restoreFile = filePath;
    let tempDecompressedFile: string | null = null;
    
    // Check if the file is gzipped by magic bytes
    if (isGzipFile(filePath)) {
        console.log(chalk.dim(`\n🔄 Detected gzip compressed file (magic: 1F 8B)`));
        
        const tempDir = path.dirname(filePath);
        const decompressedFile = path.join(
            tempDir,
            `decompressed_${path.basename(filePath)}`
        );
        tempDecompressedFile = decompressedFile;
        
        if (!existsSync(decompressedFile)) {
            console.log(chalk.dim(`   Decompressing...`));
            const readStream = createReadStream(filePath);
            const gunzipStream = createGunzip();
            const writeStream = createWriteStream(decompressedFile);
            await streamPipeline(readStream, gunzipStream, writeStream);
            console.log(chalk.dim(`✅ Decompressed to: ${decompressedFile}`));
        } else {
            console.log(chalk.dim(`✅ Using existing decompressed file: ${decompressedFile}`));
        }
        
        restoreFile = decompressedFile;
    } else {
        console.log(chalk.dim(`\n📦 File is not gzipped (no magic header)`));
    }
    
    return {
        restoreFile,
        tempDecompressedFile
    };
}

// S3 Helper Functions 
function isS3Path(filePath: string): boolean {
    return filePath.startsWith('s3://');
}

function parseS3Uri(uri: string): { bucket: string; key: string } {
    const withoutProtocol = uri.replace(/^s3:\/\//, '');
    const firstSlashIndex = withoutProtocol.indexOf('/');
    
    if (firstSlashIndex === -1) {
        throw new Error(`Invalid S3 URI: ${uri}. Expected format: s3://bucket-name/path/to/file`);
    }
    
    const bucket = withoutProtocol.substring(0, firstSlashIndex);
    let key = withoutProtocol.substring(firstSlashIndex + 1);
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
    
    if (!storage.region) {
        throw new Error(`Storage location "${storage.name}" has no region configured.`);
    }
    if (!storage.bucket) {
        throw new Error(`Storage location "${storage.name}" has no bucket configured.`);
    }
    if (!storage.accessKey) {
        throw new Error(`Storage location "${storage.name}" has no access key configured.`);
    }
    if (!storage.secretKey) {
        throw new Error(`Storage location "${storage.name}" has no secret key configured.`);
    }
    
    const tempDir = path.join(os.tmpdir(), 'db-backup');
    if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
    }
    
    const fileName = path.basename(key);
    const tempFilePath = path.join(tempDir, fileName);
    
    console.log(chalk.dim(`\n📥 Downloading from S3:`));
    console.log(chalk.dim(`   Bucket: ${bucket}`));
    console.log(chalk.dim(`   Key: ${key}`));
    console.log(chalk.dim(`   Region: ${storage.region}`));
    console.log(chalk.dim(`   Storage: ${storage.name}`));
    
    let s3Client = new S3Client({
        region: storage.region,
        credentials: {
            accessKeyId: storage.accessKey,
            secretAccessKey: storage.secretKey,
        },
    });
    
    let headBucketError: any = null;
    let correctRegion: string | null = null;
    
    try {
        const headCommand = new HeadBucketCommand({ Bucket: bucket });
        await s3Client.send(headCommand);
    } catch (error: any) {
        if (error.name === 'InvalidRegion' || 
            error.message?.includes('InvalidRegion') ||
            error.message?.includes('permanent redirect')) {
            
            console.log(chalk.dim(`\n🔄 Region mismatch detected. Determining correct region...`));
            
            try {
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
                
                const retryClient = new S3Client({
                    region: correctRegion,
                    credentials: {
                        accessKeyId: storage.accessKey,
                        secretAccessKey: storage.secretKey,
                    },
                });
                
                const retryHeadCommand = new HeadBucketCommand({ Bucket: bucket });
                await retryClient.send(retryHeadCommand);
                
                await prisma.storageLocation.update({
                    where: { id: storage.id },
                    data: { region: correctRegion }
                });
                
                console.log(chalk.dim(`✅ Updated storage region to: ${correctRegion}`));
                s3Client = retryClient;
            } catch (retryError: any) {
                headBucketError = retryError;
            }
        } else {
            headBucketError = error;
        }
    }
    
    if (headBucketError) {
        const error = headBucketError;
        if (error.name === 'NotFound' || error.name === 'NoSuchBucket') {
            throw new Error(`Bucket "${bucket}" does not exist.`);
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
        throw new Error(`Failed to access bucket "${bucket}": ${error.message}`);
    }
    
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
        if (error.name === 'NoSuchKey') {
            throw new Error(`Backup object not found in S3: s3://${bucket}/${key}.`);
        }
        if (error.name === 'AccessDenied') {
            throw new Error(`Invalid AWS credentials or insufficient permissions for object s3://${bucket}/${key}.`);
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

// Helper to get database identifier for lock
function getDatabaseIdentifier(dbConfig: any): string {
    return `${dbConfig.type}:${dbConfig.host}:${dbConfig.database}`;
}

// Main Restore Command 
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
        .option('--skip-checksum', 'Skip checksum verification (use with caution)', false)
        .option('--key <key>', 'Decryption key (64 hex characters) for encrypted backups')
        .action(async (options) => {
            const spinner = ora('Preparing restore...').start();
            let tempDownloadedFile: string | null = null;
            let decryptedFile: string | null = null;
            let decompressedFile: string | null = null;
            let lock: DistributedLock | null = null;
            let lockAcquired = false;
            let dbConfig: any = null;
            
            try {
                dbConfig = config.get('database');
                if (!dbConfig) {
                    spinner.fail('No database configuration found');
                    console.error(chalk.red('\n✗ Please run "db-backup connect" first'));
                    process.exit(1);
                }
                
                // Initialize distributed lock
                const lockKey = `restore:${getDatabaseIdentifier(dbConfig)}`;
                lock = new DistributedLock(connection as any, lockKey, { ttl: LOCK_TTL });
                
                // Try to acquire lock
                spinner.text = 'Acquiring restore lock...';
                lockAcquired = await lock.acquire();
                
                if (!lockAcquired) {
                    spinner.fail(chalk.red(`A restore operation is already running for database '${dbConfig.database}'. Please wait until it completes.`));
                    log.warn('Restore lock acquisition failed', { 
                        database: dbConfig.database,
                        host: dbConfig.host
                    });
                    process.exit(1);
                }
                
                console.log(chalk.green(`\n🔒 Restore lock acquired for ${dbConfig.database}`));
                
                let backupFile = options.file;
                let backupRecord = null;
                let storageLocation: StorageLocation | null = null;
                let decryptionKey: string | null = null;
                
                if (options.id) {
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
                    storageLocation = backupRecord.storageLocation as StorageLocation | null;
                    
                    // Check if backup is encrypted
                    const isEncrypted = backupRecord.encrypted || false;
                    const encryptionMetadata = backupRecord.encryptionMetadata as any;
                    
                    spinner.stop();
                    console.log(chalk.dim('\n📋 Found backup:'));
                    console.log(chalk.dim(`   ID: ${backupRecord.id}`));
                    console.log(chalk.dim(`   Type: ${backupRecord.backupType}`));
                    console.log(chalk.dim(`   Database: ${backupRecord.dbType}/${backupRecord.dbName}`));
                    console.log(chalk.dim(`   Size: ${backupRecord.fileSize ? (backupRecord.fileSize / 1024 / 1024).toFixed(2) : 'N/A'} MB`));
                    console.log(chalk.dim(`   Created: ${new Date(backupRecord.startedAt).toLocaleString()}`));
                    
                    if (backupRecord.checksum) {
                        console.log(chalk.dim(`   Checksum: ${backupRecord.checksum.substring(0, 16)}...`));
                    }
                    
                    if (isEncrypted) {
                        console.log(chalk.dim(`   🔐 Encrypted: Yes (${backupRecord.encryptionType || 'AES-256-GCM'})`));
                        
                        // Try to get key from local keystore first
                        if (!options.key) {
                            const storedKey = keyManager.getKey(backupRecord.id);
                            if (storedKey) {
                                decryptionKey = storedKey.key;
                                console.log(chalk.green(`   🔑 Found decryption key in local keystore`));
                            } else {
                                console.log(chalk.yellow(`\n⚠️  No decryption key found in local keystore`));
                                console.log(chalk.dim('   Provide the key manually with:'));
                                console.log(chalk.dim('   db-backup restore --id <backup-id> --key <64-hex-key>'));
                                spinner.fail('Encryption key not found');
                                process.exit(1);
                            }
                        } else {
                            // User provided key manually
                            if (options.key.length !== 64) {
                                spinner.fail('Decryption key must be 64 hexadecimal characters (32 bytes)');
                                process.exit(1);
                            }
                            decryptionKey = options.key;
                            console.log(chalk.dim(`   🔑 Using provided decryption key`));
                        }
                    }
                    
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
                
                // STEP 1: Check if backup is local or S3
                let restoreFile = backupFile;
                
                if (isS3Path(backupFile)) {
                    spinner.text = 'Downloading backup from S3...';
                    log.info('Downloading from S3', { s3Path: backupFile });
                    
                    try {
                        if (!storageLocation) {
                            throw new Error('Storage location not found for this backup.');
                        }
                        if (storageLocation.type !== 's3') {
                            throw new Error(`Storage location "${storageLocation.name}" is type "${storageLocation.type}", but the backup path indicates S3.`);
                        }
                        
                        tempDownloadedFile = await downloadS3Backup(backupFile, storageLocation);
                        restoreFile = tempDownloadedFile;
                        spinner.text = 'Restore preparation complete...';
                    } catch (error: any) {
                        spinner.fail(chalk.red('Failed to download backup from S3'));
                        console.error(chalk.red(`\n✗ Error: ${error.message}`));
                        if (tempDownloadedFile) {
                            cleanupTempFile(tempDownloadedFile);
                        }
                        process.exit(1);
                    }
                } else {
                    if (!existsSync(backupFile)) {
                        spinner.fail(`Backup file not found: ${backupFile}`);
                        process.exit(1);
                    }
                }
                
                // STEP 2: Decrypt if needed
                const isEncrypted = backupRecord?.encrypted || false;
                const encryptionMetadata = backupRecord?.encryptionMetadata as any;
                let decryptedFilePath: string | null = null;
                
                if (isEncrypted && decryptionKey) {
                    spinner.text = 'Decrypting backup...';
                    log.info('Decrypting backup', { backupId: backupRecord?.id });
                    
                    try {
                        if (!encryptionMetadata) {
                            throw new Error('Encryption metadata not found in backup record');
                        }
                        
                        if (!encryptionMetadata.iv || !encryptionMetadata.tag) {
                            throw new Error('Missing IV or authentication tag in encryption metadata');
                        }
                        
                        const tempDir = path.join(os.tmpdir(), 'db-backup');
                        if (!existsSync(tempDir)) {
                            mkdirSync(tempDir, { recursive: true });
                        }
                        
                        const decryptedFileName = `decrypted_${path.basename(restoreFile)}`;
                        decryptedFilePath = path.join(tempDir, decryptedFileName);
                        
                        await decryptFile(
                            restoreFile,
                            decryptedFilePath,
                            decryptionKey,
                            encryptionMetadata.iv,
                            encryptionMetadata.tag
                        );
                        
                        console.log(chalk.green(`\n✅ Backup decrypted successfully`));
                        
                        restoreFile = decryptedFilePath;
                        decryptedFile = decryptedFilePath;
                        
                        log.info('Decryption completed', { backupId: backupRecord?.id });
                    } catch (error: any) {
                        spinner.fail(chalk.red('Failed to decrypt backup'));
                        console.error(chalk.red(`\n✗ Error: ${error.message}`));
                        if (tempDownloadedFile) {
                            cleanupTempFile(tempDownloadedFile);
                        }
                        if (decryptedFilePath && existsSync(decryptedFilePath)) {
                            cleanupTempFile(decryptedFilePath);
                        }
                        process.exit(1);
                    }
                }
                
                // STEP 3: Prepare restore file (detect gzip by magic bytes)
                const prepareResult = await prepareRestoreFile(restoreFile);
                restoreFile = prepareResult.restoreFile;
                decompressedFile = prepareResult.tempDecompressedFile;
                
                // STEP 4: Verify checksum (skip for encrypted files)
                if (!options.skipChecksum && backupRecord?.checksum && !isEncrypted) {
                    spinner.text = 'Verifying backup integrity...';
                    log.info('Verifying checksum', { backupId: backupRecord.id });
                    
                    try {
                        const calculatedChecksum = await calculateChecksum(restoreFile);
                        
                        if (calculatedChecksum !== backupRecord.checksum) {
                            spinner.fail(chalk.red('Backup integrity verification failed!'));
                            console.error(chalk.red('\n✗ The backup file is corrupted or has been modified.'));
                            console.log(chalk.dim(`\n  Expected: ${backupRecord.checksum}`));
                            console.log(chalk.dim(`  Actual:   ${calculatedChecksum}`));
                            console.log(chalk.yellow('\n💡 To bypass this check (use with caution):'));
                            console.log(chalk.dim('  db-backup restore --id <backup-id> --skip-checksum'));
                            if (tempDownloadedFile) {
                                cleanupTempFile(tempDownloadedFile);
                            }
                            if (decryptedFile && existsSync(decryptedFile)) {
                                cleanupTempFile(decryptedFile);
                            }
                            if (decompressedFile && existsSync(decompressedFile)) {
                                cleanupTempFile(decompressedFile);
                            }
                            process.exit(1);
                        }
                        
                        console.log(chalk.green(`\n✅ Backup integrity verified`));
                        log.info('Checksum verification passed', { backupId: backupRecord.id });
                    } catch (error: any) {
                        spinner.fail(chalk.red('Failed to verify backup integrity'));
                        console.error(chalk.red(`\n✗ Error: ${error.message}`));
                        if (tempDownloadedFile) {
                            cleanupTempFile(tempDownloadedFile);
                        }
                        if (decryptedFile && existsSync(decryptedFile)) {
                            cleanupTempFile(decryptedFile);
                        }
                        if (decompressedFile && existsSync(decompressedFile)) {
                            cleanupTempFile(decompressedFile);
                        }
                        process.exit(1);
                    }
                } else if (backupRecord?.checksum && isEncrypted) {
                    console.log(chalk.dim('\n🔐 Skipping checksum verification for encrypted backup (checksum is for encrypted file)'));
                } else if (backupRecord?.checksum) {
                    console.log(chalk.yellow('\n⚠️  Skipping checksum verification (--skip-checksum used)'));
                } else if (!backupRecord?.checksum) {
                    console.log(chalk.yellow('\n⚠️  No checksum found in backup record. Skipping verification.'));
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
                        if (tempDownloadedFile) {
                            cleanupTempFile(tempDownloadedFile);
                        }
                        if (decryptedFile && existsSync(decryptedFile)) {
                            cleanupTempFile(decryptedFile);
                        }
                        if (decompressedFile && existsSync(decompressedFile)) {
                            cleanupTempFile(decompressedFile);
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
                    if (tempDownloadedFile) {
                        cleanupTempFile(tempDownloadedFile);
                    }
                    if (decryptedFile && existsSync(decryptedFile)) {
                        cleanupTempFile(decryptedFile);
                    }
                    if (decompressedFile && existsSync(decompressedFile)) {
                        cleanupTempFile(decompressedFile);
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
                        if (tempDownloadedFile) {
                            cleanupTempFile(tempDownloadedFile);
                        }
                        if (decryptedFile && existsSync(decryptedFile)) {
                            cleanupTempFile(decryptedFile);
                        }
                        if (decompressedFile && existsSync(decompressedFile)) {
                            cleanupTempFile(decompressedFile);
                        }
                        process.exit(1);
                }
                
                // Cleanup temp files
                if (tempDownloadedFile) {
                    cleanupTempFile(tempDownloadedFile);
                }
                if (decryptedFile && existsSync(decryptedFile)) {
                    cleanupTempFile(decryptedFile);
                }
                if (decompressedFile && existsSync(decompressedFile)) {
                    cleanupTempFile(decompressedFile);
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
                    if (result.error?.includes('already exists')) {
                        console.log(chalk.yellow('\n💡 Tip: Use --drop-existing to drop existing tables before restore'));
                        console.log(chalk.dim('   db-backup restore --id <backup-id> --drop-existing'));
                    }
                    process.exit(1);
                }
                
            } catch (error: any) {
                if (tempDownloadedFile) {
                    cleanupTempFile(tempDownloadedFile);
                }
                if (decryptedFile && existsSync(decryptedFile)) {
                    cleanupTempFile(decryptedFile);
                }
                if (decompressedFile && existsSync(decompressedFile)) {
                    cleanupTempFile(decompressedFile);
                }
                spinner.fail(chalk.red('Restore failed'));
                console.error(chalk.red(`\n✗ Error: ${error.message}`));
                log.error('Restore failed', { error: error.message });
                process.exit(1);
            } finally {
                // ALWAYS release the lock in finally block
                if (lock && lockAcquired) {
                    try {
                        await lock.release();
                        console.log(chalk.dim(`\n🔓 Restore lock released for ${dbConfig?.database || 'database'}`));
                        log.debug('Lock released', { database: dbConfig?.database });
                    } catch (releaseError: any) {
                        log.error('Failed to release lock', { error: releaseError.message });
                        console.error(chalk.red(`\n⚠️ Failed to release lock: ${releaseError.message}`));
                    }
                }
            }
        });
}

// PostgreSQL Restore
async function restorePostgres(backupFile: string, dbConfig: any, options: any): Promise<any> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const fs = require('fs');
    
    const startTime = Date.now();
    let tempDecompressedFile: string | null = null;
    
    try {
        // Use the prepareRestoreFile helper
        const restoreFile = backupFile;
        
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
            
            if (tempDecompressedFile && fs.existsSync(tempDecompressedFile)) {
                try {
                    fs.unlinkSync(tempDecompressedFile);
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
        
        if (tempDecompressedFile && fs.existsSync(tempDecompressedFile)) {
            try {
                fs.unlinkSync(tempDecompressedFile);
                console.log(chalk.dim(`\n🧹 Cleaned up temporary file: ${tempDecompressedFile}`));
            } catch (cleanupError) {
                // Ignore
            }
        }
        
        const duration = (Date.now() - startTime) / 1000;
        return { success: true, duration };
    } catch (error: any) {
        if (tempDecompressedFile) {
            try {
                if (fs.existsSync(tempDecompressedFile)) {
                    fs.unlinkSync(tempDecompressedFile);
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

// MySQL Restore 
async function restoreMySQL(backupFile: string, dbConfig: any, options: any): Promise<any> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const fs = require('fs');
    
    const startTime = Date.now();
    let tempDecompressedFile: string | null = null;
    
    try {
        // Use the prepareRestoreFile helper
        const prepareResult = await prepareRestoreFile(backupFile);
        const restoreFile = prepareResult.restoreFile;
        tempDecompressedFile = prepareResult.tempDecompressedFile;
        
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
            
            if (tempDecompressedFile && fs.existsSync(tempDecompressedFile)) {
                try {
                    fs.unlinkSync(tempDecompressedFile);
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
        
        if (tempDecompressedFile && fs.existsSync(tempDecompressedFile)) {
            try {
                fs.unlinkSync(tempDecompressedFile);
                console.log(chalk.dim(`\n🧹 Cleaned up temporary file: ${tempDecompressedFile}`));
            } catch (cleanupError) {
                // Ignore
            }
        }
        
        const duration = (Date.now() - startTime) / 1000;
        return { success: true, duration };
    } catch (error: any) {
        if (tempDecompressedFile) {
            try {
                if (fs.existsSync(tempDecompressedFile)) {
                    fs.unlinkSync(tempDecompressedFile);
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