// src/microservices/database-services/postgres/service.ts

import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { statSync, existsSync, unlinkSync, mkdirSync, createReadStream, createWriteStream } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseConfig, BackupOptions, BackupResponse } from '../../shared/types';
import { createModuleLogger } from '../../../logger';
import { config as appConfig } from '../../../config';
import { S3StorageProvider } from '../../storage-service/providers/s3';
import { LocalStorageProvider } from '../../storage-service/providers/local';
import { createHash, createCipheriv, randomBytes } from 'crypto';
import { prisma } from '../../../lib/prisma';

const execAsync = promisify(exec);
const log = createModuleLogger('postgres-backup-service');

const app = express();
app.use(express.json());

const SERVICE_PORT = process.env.POSTGRES_SERVICE_PORT || 3010;
const SERVICE_NAME = 'postgres-backup-service';
const startTime = Date.now();

// ==================== Encryption Constants ====================
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

// ==================== Helper: Calculate Checksum ====================
async function calculateChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(filePath);
        
        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', (error) => reject(error));
    });
}

// ==================== Helper: Encrypt File ====================
async function encryptFile(inputPath: string, outputPath: string, key: string): Promise<{
    iv: string;
    tag: string;
}> {
    const iv = randomBytes(IV_LENGTH);
    const keyBuffer = Buffer.from(key, 'hex');
    const cipher = createCipheriv(ALGORITHM, keyBuffer, iv);
    
    const inputStream = createReadStream(inputPath);
    const outputStream = createWriteStream(outputPath);
    
    return new Promise((resolve, reject) => {
        // Write IV as header (16 bytes)
        outputStream.write(iv);
        
        inputStream.pipe(cipher).pipe(outputStream);
        
        outputStream.on('finish', () => {
            const tag = cipher.getAuthTag();
            resolve({
                iv: iv.toString('base64'),
                tag: tag.toString('base64')
            });
        });
        
        inputStream.on('error', reject);
        cipher.on('error', reject);
        outputStream.on('error', reject);
    });
}

app.get('/health', (req, res) => {
    res.json({
        service: SERVICE_NAME,
        status: 'healthy',
        version: '1.0.0',
        uptime: (Date.now() - startTime) / 1000,
        timestamp: new Date()
    });
});

app.post('/backup', async (req, res) => {
    const backupId = uuidv4();
    const { dbConfig, backupType, options } = req.body;
    
    log.info('Received backup request', { backupId, dbType: dbConfig.type, backupType });
    
    try {
        const result = await performBackup(backupId, dbConfig, backupType, options);
        res.json(result);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Backup failed', { backupId, error: errorMessage });
        res.status(500).json({
            success: false,
            backupId,
            error: errorMessage
        });
    }
});

async function performBackup(
    backupId: string,
    dbConfig: DatabaseConfig,
    backupType: string,
    options: any  // Extended with encryption options
): Promise<BackupResponse> {
    const startTime = Date.now();
    let localBackupPath: string | null = null;
    let encryptedPath: string | null = null;
    
    // Build pg_dump command
    let command = `pg_dump -h ${dbConfig.host} -p ${dbConfig.port || 5432} -U ${dbConfig.username} -d ${dbConfig.database}`;
    command += ' --format=custom --verbose --no-owner --no-privileges --blobs --clean --if-exists';
    
    if (options.tables && options.tables.length > 0) {
        options.tables.forEach((table: string) => { command += ` -t ${table}`; });
    }
    
    if (options.excludeTables && options.excludeTables.length > 0) {
        options.excludeTables.forEach((table: string) => { command += ` -T ${table}`; });
    }
    
    // Generate backup filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = options.compress ? 'gz' : 'dump';
    let backupFileName = `${dbConfig.database}_${timestamp}.${extension}`;
    
    // Get storage config from options
    const storageConfig = options.storage || { type: 'local', basePath: './backups' };
    
    // Determine local temp path
    const localTempPath = appConfig.get('storage.tempPath') || './tmp';
    localBackupPath = path.join(localTempPath, backupFileName);
    
    // Ensure temp directory exists
    if (!existsSync(localTempPath)) {
        mkdirSync(localTempPath, { recursive: true });
    }
    
    // Handle encryption
    const isEncrypted = options.encrypt || false;
    let encryptionKey: string | null = null;
    let encryptionMetadata: any = null;
    let finalBackupPath = localBackupPath;
    let finalFileName = backupFileName;
    let encryptionType: string | null = null;
    
    if (isEncrypted) {
        encryptionKey = options.encryptionKey || null;
        if (!encryptionKey) {
            throw new Error('Encryption enabled but no key provided');
        }
        // Validate key length (32 bytes = 64 hex characters)
        if (encryptionKey.length !== 64) {
            throw new Error('Encryption key must be 64 hexadecimal characters (32 bytes)');
        }
        
        encryptionType = ALGORITHM;
        
        // Update filename for encrypted output
        const encryptedFileName = `${dbConfig.database}_${timestamp}_encrypted.enc`;
        encryptedPath = path.join(localTempPath, encryptedFileName);
        finalFileName = encryptedFileName;
        finalBackupPath = encryptedPath;
    }
    
    // Execute backup to temp location
    const finalCommand = options.compress 
        ? `${command} | gzip > "${localBackupPath}"`
        : `${command} > "${localBackupPath}"`;
    
    log.debug('Executing backup command', { backupId });
    
    try {
        // Step 1: Create backup locally
        await execAsync(finalCommand, {
            maxBuffer: 50 * 1024 * 1024,
            env: { ...process.env, PGPASSWORD: dbConfig.password }
        });
        
        let stats = statSync(localBackupPath);
        let fileSize = stats.size;
        let checksum = await calculateChecksum(localBackupPath);
        
        // Step 2: Encrypt if enabled
        if (isEncrypted && encryptionKey) {
            log.info('Encrypting backup', { backupId });
            
            const result = await encryptFile(localBackupPath, encryptedPath!, encryptionKey);
            
            encryptionMetadata = {
                iv: result.iv,
                tag: result.tag,
                algorithm: ALGORITHM
            };
            
            // Update stats for encrypted file
            const encryptedStats = statSync(encryptedPath!);
            fileSize = encryptedStats.size;
            
            // Recalculate checksum for encrypted file
            checksum = await calculateChecksum(encryptedPath!);
            
            log.info('Encryption completed', { backupId });
        }
        
        // Step 3: Determine final storage path
        let finalPath: string;
        let storageType: string;
        let metadata: any = {
            id: backupId,
            dbType: 'postgresql',
            dbName: dbConfig.database,
            backupType: backupType,
            size: fileSize,
            checksum: checksum,
            createdAt: new Date(),
            compression: options.compress ? 'gzip' : 'none',
            encrypted: isEncrypted,
            encryptionType: isEncrypted ? encryptionType : null,
            encryptionMetadata: isEncrypted ? encryptionMetadata : null
        };
        
        // Step 4: Upload to storage
        if (storageConfig.type === 's3') {
            // Validate S3 config
            if (!storageConfig.bucket) {
                throw new Error('S3 bucket is required for s3 storage type');
            }
            if (!storageConfig.accessKey || !storageConfig.secretKey) {
                throw new Error('S3 accessKey and secretKey are required for s3 storage type');
            }
            
            log.info('Uploading backup to S3', { backupId, bucket: storageConfig.bucket });
            
            const s3Provider = new S3StorageProvider({
                type: 's3',
                bucket: storageConfig.bucket,
                region: storageConfig.region || 'us-east-1',
                accessKey: storageConfig.accessKey,
                secretKey: storageConfig.secretKey
            });
            
            await s3Provider.initialize();
            
            const prefix = storageConfig.prefix || '';
            const remotePath = prefix ? `${prefix}/${finalFileName}` : finalFileName;
            
            const uploadResult = await s3Provider.upload(finalBackupPath, remotePath);
            
            finalPath = `s3://${storageConfig.bucket}/${remotePath}`;
            storageType = 's3';
            
            metadata.storage = {
                name: storageConfig.name || 's3-storage',
                type: 's3',
                bucket: storageConfig.bucket,
                region: storageConfig.region || 'us-east-1',
                key: remotePath,
                etag: uploadResult.etag,
                versionId: uploadResult.versionId
            };
            
            log.info('Upload to S3 completed', { backupId, remotePath });
            
        } else {
            // Local storage
            const localPath = storageConfig.basePath || options.outputPath || appConfig.get('storage.localPath');
            if (!existsSync(localPath)) {
                mkdirSync(localPath, { recursive: true });
            }
            
            const destPath = path.join(localPath, finalFileName);
            
            // Copy file to final destination
            const fs = require('fs');
            fs.copyFileSync(finalBackupPath, destPath);
            
            finalPath = destPath;
            storageType = 'local';
            
            metadata.storage = {
                name: storageConfig.name || 'local-storage',
                type: 'local',
                path: localPath
            };
        }
        
        // Step 5: Save backup record to database
        await prisma.backupJob.update({
            where: { id: backupId },
            data: {
                status: 'success',
                filePath: finalPath,
                fileName: finalFileName,
                fileSize: fileSize,
                checksum: checksum,
                encrypted: isEncrypted,
                encryptionType: isEncrypted ? encryptionType : null,
                encryptionMetadata: isEncrypted ? encryptionMetadata : null,
                completedAt: new Date(),
                duration: (Date.now() - startTime) / 1000,
                storageType: storageType,
                compressionType: options.compress ? 'gzip' : 'none',
                metadata: metadata
            }
        });
        
        const duration = (Date.now() - startTime) / 1000;
        
        log.info('Backup completed', { 
            backupId, 
            size: fileSize, 
            duration, 
            storageType,
            encrypted: isEncrypted,
            checksum: checksum.substring(0, 16) + '...'
        });
        
        return {
            success: true,
            backupId,
            filePath: finalPath,
            fileSize: fileSize,
            duration,
            metadata,
            fileName: finalFileName
        };
        
    } catch (error) {
        // Step 6: Mark backup as failed in database
        log.error('Backup failed', { backupId, error });
        
        await prisma.backupJob.update({
            where: { id: backupId },
            data: {
                status: 'failed',
                error: error instanceof Error ? error.message : String(error),
                completedAt: new Date(),
                duration: (Date.now() - startTime) / 1000
            }
        });
        
        throw new Error(`Backup failed: ${error instanceof Error ? error.message : String(error)}`);
        
    } finally {
        // Step 7: Cleanup temp files
        if (localBackupPath && existsSync(localBackupPath)) {
            try {
                unlinkSync(localBackupPath);
                log.debug('Temporary file cleaned up', { path: localBackupPath });
            } catch (cleanupError) {
                log.warn('Failed to cleanup temp file', { path: localBackupPath, error: cleanupError });
            }
        }
        if (encryptedPath && existsSync(encryptedPath) && encryptedPath !== localBackupPath) {
            try {
                unlinkSync(encryptedPath);
                log.debug('Temporary encrypted file cleaned up', { path: encryptedPath });
            } catch (cleanupError) {
                log.warn('Failed to cleanup temp encrypted file', { path: encryptedPath, error: cleanupError });
            }
        }
    }
}

app.listen(SERVICE_PORT, () => {
    log.info(`${SERVICE_NAME} listening on port ${SERVICE_PORT}`);
});

export default app;