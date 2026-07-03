// src/microservices/database-services/sqlite/service.ts

import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { statSync, existsSync, unlinkSync, mkdirSync, createReadStream, createWriteStream } from 'fs';
import { createGzip } from 'zlib';
import { pipeline } from 'stream';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseConfig, BackupOptions, BackupResponse } from '../../shared/types';
import { createModuleLogger } from '../../../logger';
import { config as appConfig } from '../../../config';
import { S3StorageProvider } from '../../storage-service/providers/s3';
import { LocalStorageProvider } from '../../storage-service/providers/local';
import { createHash, createCipheriv, randomBytes } from 'crypto';

const execAsync = promisify(exec);
const streamPipeline = promisify(pipeline);
const log = createModuleLogger('sqlite-backup-service');

const app = express();
app.use(express.json());

const SERVICE_PORT = process.env.SQLITE_SERVICE_PORT || 3013;
const SERVICE_NAME = 'sqlite-backup-service';
const startTime = Date.now();

// Encryption Constants 
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

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

// Encrypt File 
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
    const { dbConfig, backupType, options } = req.body;
    const backupId = options?.backupId || uuidv4();
    
    log.info('Received SQLite backup request', { backupId, database: dbConfig.database });
    
    try {
        const result = await performBackup(backupId, dbConfig, backupType, options);
        res.json(result);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('SQLite backup failed', { backupId, error: errorMessage });
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
    options: any
): Promise<BackupResponse> {
    const startTime = Date.now();
    let localBackupPath: string | null = null;
    let encryptedPath: string | null = null;
    
    const sourceDb = dbConfig.database;
    
    if (!existsSync(sourceDb)) {
        throw new Error(`SQLite database file not found: ${sourceDb}`);
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dbName = path.basename(sourceDb, '.db');
    const extension = options.compress ? 'db.gz' : 'db';
    let backupFileName = `${dbName}_${timestamp}.${extension}`;
    
    const storageConfig = options.storage || { type: 'local', basePath: './backups' };
    const localTempPath = appConfig.get('storage.tempPath') || './tmp';
    localBackupPath = path.join(localTempPath, backupFileName);
    
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
        if (encryptionKey.length !== 64) {
            throw new Error('Encryption key must be 64 hexadecimal characters (32 bytes)');
        }
        
        encryptionType = ALGORITHM;
        const encryptedFileName = `${dbName}_${timestamp}_encrypted.enc`;
        encryptedPath = path.join(localTempPath, encryptedFileName);
        finalFileName = encryptedFileName;
        finalBackupPath = encryptedPath;
    }
    
    log.debug('Copying SQLite database', { backupId, source: sourceDb, dest: localBackupPath });
    
    try {
        if (options.compress) {
            const sourceStream = createReadStream(sourceDb);
            const gzipStream = createGzip();
            const destStream = createWriteStream(localBackupPath);
            await streamPipeline(sourceStream, gzipStream, destStream);
        } else {
            const fs = require('fs');
            fs.copyFileSync(sourceDb, localBackupPath);
        }
        
        let stats = statSync(localBackupPath);
        let fileSize = stats.size;
        let checksum = await calculateChecksum(localBackupPath);
        
        if (isEncrypted && encryptionKey) {
            log.info('Encrypting backup', { backupId });
            
            const result = await encryptFile(localBackupPath, encryptedPath!, encryptionKey);
            
            encryptionMetadata = {
                iv: result.iv,
                tag: result.tag,
                algorithm: ALGORITHM
            };
            
            const encryptedStats = statSync(encryptedPath!);
            fileSize = encryptedStats.size;
            checksum = await calculateChecksum(encryptedPath!);
            
            log.info('Encryption completed', { backupId });
        }
        
        let finalPath: string;
        let storageType: string;
        let metadata: any = {
            id: backupId,
            dbType: 'sqlite',
            dbName: dbName,
            backupType: backupType,
            size: fileSize,
            checksum: checksum,
            createdAt: new Date(),
            compression: options.compress ? 'gzip' : 'none',
            encrypted: isEncrypted,
            encryptionType: isEncrypted ? encryptionType : null,
            encryptionMetadata: isEncrypted ? encryptionMetadata : null
        };
        
        if (storageConfig.type === 's3') {
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
            const localPath = storageConfig.basePath || options.outputPath || appConfig.get('storage.localPath');
            if (!existsSync(localPath)) {
                mkdirSync(localPath, { recursive: true });
            }
            
            const destPath = path.join(localPath, finalFileName);
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
        
        const duration = (Date.now() - startTime) / 1000;
        
        log.info('SQLite backup completed', { 
            backupId, 
            size: fileSize, 
            duration, 
            storageType,
            encrypted: isEncrypted,
            checksum: checksum.substring(0, 16) + '...'
        });
        
        // RETURN RESPONSE WITHOUT UPDATING DATABASE
        // The orchestrator handles all BackupJob updates

        return {
            success: true,
            backupId,
            filePath: finalPath,
            fileSize: fileSize,
            duration,
            metadata,
            fileName: finalFileName,
            checksum,
            encrypted: isEncrypted,
            encryptionType,
            encryptionMetadata
        };
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('SQLite backup execution failed', { backupId, error: errorMessage });
        throw new Error(`SQLite backup execution failed: ${errorMessage}`);
        
    } finally {
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