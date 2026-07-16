// src/microservices/database-services/mysql/service.ts

import express from 'express';
import { spawn } from 'child_process';
import { createGzip } from 'zlib';
import { createHash, createCipheriv, randomBytes } from 'crypto';
import { Readable, PassThrough, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseConfig, BackupOptions, BackupResponse } from '../../shared/types';
import { createModuleLogger } from '../../../logger';
import { config as appConfig } from '../../../config';
import { S3StorageProvider } from '../../storage-service/providers/s3';
import { LocalStorageProvider } from '../../storage-service/providers/local';
import path from 'path';
import { createWriteStream } from 'fs';

const log = createModuleLogger('mysql-backup-service');

const app = express();
app.use(express.json());

const SERVICE_PORT = process.env.MYSQL_SERVICE_PORT || 3011;
const SERVICE_NAME = 'mysql-backup-service';
const startTime = Date.now();

// ==================== Encryption Constants ====================
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

// ==================== Custom Transform: SHA-256 Checksum ====================
class ChecksumTransform extends Transform {
    private hash = createHash('sha256');
    private size = 0;

    _transform(chunk: Buffer, encoding: string, callback: Function) {
        this.hash.update(chunk);
        this.size += chunk.length;
        callback(null, chunk);
    }

    getChecksum(): string {
        return this.hash.digest('hex');
    }

    getSize(): number {
        return this.size;
    }
}

// ==================== Custom Transform: AES-256-GCM Encryption ====================
class EncryptionTransform extends Transform {
    private cipher: any;
    private iv: Buffer;
    private keyBuffer: Buffer;
    private tag: Buffer | null = null;
    private isFinalized: boolean = false;

    constructor(key: string) {
        super();
        this.iv = randomBytes(IV_LENGTH);
        this.keyBuffer = Buffer.from(key, 'hex');
        this.cipher = createCipheriv(ALGORITHM, this.keyBuffer, this.iv);
        
        this.cipher.on('error', (err: Error) => this.emit('error', err));
    }

    _transform(chunk: Buffer, encoding: string, callback: Function) {
        try {
            const encrypted = this.cipher.update(chunk);
            callback(null, encrypted);
        } catch (err) {
            callback(err);
        }
    }

    _flush(callback: Function) {
        try {
            if (!this.isFinalized) {
                const final = this.cipher.final();
                this.tag = this.cipher.getAuthTag();
                this.isFinalized = true;
                if (final.length > 0) {
                    callback(null, final);
                } else {
                    callback(null);
                }
            } else {
                callback(null);
            }
        } catch (err) {
            callback(err);
        }
    }

    getEncryptionMetadata() {
        return {
            iv: this.iv.toString('base64'),
            tag: this.tag ? this.tag.toString('base64') : null,
            algorithm: ALGORITHM
        };
    }
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
    
    log.info('Received MySQL backup request', { backupId, database: dbConfig.database });
    
    try {
        const result = await performBackup(backupId, dbConfig, backupType, options);
        res.json(result);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('MySQL backup failed', { backupId, error: errorMessage });
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
    
    // Build mysqldump command
    let command = `mysqldump -h ${dbConfig.host} -P ${dbConfig.port || 3306} -u ${dbConfig.username}`;
    if (dbConfig.password) command += ` -p${dbConfig.password}`;
    command += ` ${dbConfig.database}`;
    command += ' --single-transaction --routines --triggers --events --hex-blob --add-drop-table';
    
    if (options.tables && options.tables.length > 0) {
        command += ` ${options.tables.join(' ')}`;
    }
    
    if (options.excludeTables && options.excludeTables.length > 0) {
        options.excludeTables.forEach((table: string) => {
            command += ` --ignore-table=${dbConfig.database}.${table}`;
        });
    }
    
    // Generate backup filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseFileName = `${dbConfig.database}_${timestamp}`;
    const extension = options.compress ? 'gz' : 'sql';
    let finalFileName = `${baseFileName}.${extension}`;
    
    // Get storage config
    const storageConfig = options.storage || { type: 'local', basePath: './backups' };
    
    // Handle encryption
    const isEncrypted = options.encrypt || false;
    let encryptionKey: string | null = null;
    let encryptionType: string | null = null;
    let encryptionTransform: EncryptionTransform | null = null;
    let encryptionMetadata: any = null;
    
    if (isEncrypted) {
        encryptionKey = options.encryptionKey || null;
        if (!encryptionKey) {
            throw new Error('Encryption enabled but no key provided');
        }
        if (encryptionKey.length !== 64) {
            throw new Error('Encryption key must be 64 hexadecimal characters (32 bytes)');
        }
        encryptionType = ALGORITHM;
        finalFileName = `${baseFileName}_encrypted.enc`;
    }
    
    log.debug('Executing mysqldump', { backupId, command: command.substring(0, 200) + '...' });
    
    // ============================================================
    // STREAMING PIPELINE: NO TEMPORARY FILES
    // ============================================================
    
    // Step 1: Spawn mysqldump process
    const mysqldump = spawn(command, {
        shell: true,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    
    // Create a PassThrough to capture errors
    const errorPassthrough = new PassThrough();
    let mysqldumpError: Error | null = null;
    
    mysqldump.on('error', (err) => {
        mysqldumpError = err;
        errorPassthrough.destroy(err);
    });
    
    mysqldump.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('ERROR') || msg.includes('mysqldump:') || msg.includes('Got error')) {
            const err = new Error(`mysqldump error: ${msg}`);
            mysqldumpError = err;
            errorPassthrough.destroy(err);
        }
        log.debug('mysqldump stderr', { backupId, msg: msg.substring(0, 200) });
    });
    
    // Pipe stdout to errorPassthrough
    mysqldump.stdout.pipe(errorPassthrough, { end: true });
    mysqldump.stdout.on('error', (err) => {
        if (!mysqldumpError) {
            mysqldumpError = err;
            errorPassthrough.destroy(err);
        }
    });
    
    // Step 2: Start building the pipeline
    let currentStream: Readable = errorPassthrough;
    
    // Step 3: Compression (if enabled)
    let compressStream = null;
    if (options.compress) {
        compressStream = createGzip();
        currentStream = currentStream.pipe(compressStream);
    }
    
    // Step 4: SHA-256 Checksum + Size Tracking
    const checksumTransform = new ChecksumTransform();
    currentStream = currentStream.pipe(checksumTransform);
    
    // Step 5: Encryption (if enabled)
    if (isEncrypted && encryptionKey) {
        encryptionTransform = new EncryptionTransform(encryptionKey);
        currentStream = currentStream.pipe(encryptionTransform);
    }
    
    // Step 6: Upload to Storage
    try {
        let uploadResult;
        
        if (storageConfig.type === 's3') {
            if (!storageConfig.bucket) {
                throw new Error('S3 bucket is required for s3 storage type');
            }
            if (!storageConfig.accessKey || !storageConfig.secretKey) {
                throw new Error('S3 accessKey and secretKey are required for s3 storage type');
            }

            log.info('Uploading stream to S3', { bucket: storageConfig.bucket, key: finalFileName });

            const s3Provider = new S3StorageProvider({
                type: 's3',
                bucket: storageConfig.bucket,
                region: storageConfig.region || 'us-east-1',
                accessKey: storageConfig.accessKey,
                secretKey: storageConfig.secretKey
            });

            await s3Provider.initialize();
            uploadResult = await s3Provider.uploadStream(currentStream, finalFileName);
        } else {
            const localPath = storageConfig.basePath || './backups';
            const fs = require('fs');
            
            if (!fs.existsSync(localPath)) {
                fs.mkdirSync(localPath, { recursive: true });
            }

            const destPath = path.join(localPath, finalFileName);
            const writeStream = fs.createWriteStream(destPath);

            await pipeline(currentStream, writeStream);

            const stats = fs.statSync(destPath);
            log.info('Stream uploaded to local storage', { path: destPath, size: stats.size });

            uploadResult = {
                path: destPath,
                size: stats.size
            };
        }
        
        // Get checksum and size from the transform
        const checksum = checksumTransform.getChecksum();
        const fileSize = checksumTransform.getSize();
        
        // Get encryption metadata if applicable
        if (isEncrypted && encryptionTransform) {
            const encMeta = encryptionTransform.getEncryptionMetadata();
            if (encMeta.tag) {
                encryptionMetadata = {
                    iv: encMeta.iv,
                    tag: encMeta.tag,
                    algorithm: encMeta.algorithm
                };
            }
        }
        
        // Build final path
        let finalPath: string;
        if (storageConfig.type === 's3') {
            const prefix = storageConfig.prefix || '';
            finalPath = `s3://${storageConfig.bucket}/${prefix ? prefix + '/' : ''}${finalFileName}`;
        } else {
            const localPath = storageConfig.basePath || './backups';
            finalPath = path.join(localPath, finalFileName);
        }
        
        // Build metadata
        const metadata: any = {
            id: backupId,
            dbType: 'mysql',
            dbName: dbConfig.database,
            backupType: backupType,
            size: fileSize,
            checksum: checksum,
            createdAt: new Date(),
            compression: options.compress ? 'gzip' : 'none',
            encrypted: isEncrypted,
            encryptionType: isEncrypted ? encryptionType : null,
            encryptionMetadata: isEncrypted ? encryptionMetadata : null,
            storage: {
                name: storageConfig.name || (storageConfig.type === 's3' ? 's3-storage' : 'local-storage'),
                type: storageConfig.type,
                ...(storageConfig.type === 's3' && {
                    bucket: storageConfig.bucket,
                    region: storageConfig.region || 'us-east-1',
                    key: finalFileName,
                    etag: uploadResult.etag,
                    versionId: uploadResult.versionId
                }),
                ...(storageConfig.type === 'local' && {
                    path: storageConfig.basePath || './backups'
                })
            }
        };
        
        const duration = (Date.now() - startTime) / 1000;
        
        log.info('MySQL backup completed', {
            backupId,
            size: fileSize,
            duration,
            storageType: storageConfig.type,
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
            fileName: finalFileName,
            checksum,
            encrypted: isEncrypted,
            encryptionType,
            encryptionMetadata
        };
        
    } catch (error) {
        // Destroy the stream to clean up resources
        if (!currentStream.destroyed) {
            currentStream.destroy();
        }
        
        // Kill mysqldump if still running
        try {
            mysqldump.kill('SIGTERM');
        } catch (e) {
            // Ignore kill errors
        }
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('MySQL backup execution failed', { backupId, error: errorMessage });
        throw new Error(`MySQL backup execution failed: ${errorMessage}`);
    }
}

app.listen(SERVICE_PORT, () => {
    log.info(`${SERVICE_NAME} listening on port ${SERVICE_PORT}`);
});

export default app;

// // src/microservices/database-services/mysql/service.ts

// import express from 'express';
// import { spawn, ChildProcess } from 'child_process';
// import { createGzip, createGunzip } from 'zlib';
// import { createHash, createCipheriv, randomBytes, createDecipheriv } from 'crypto';
// import { Readable, PassThrough, Transform } from 'stream';
// import { pipeline } from 'stream/promises';
// import { v4 as uuidv4 } from 'uuid';
// import { DatabaseConfig, BackupOptions, BackupResponse } from '../../shared/types';
// import { createModuleLogger } from '../../../logger';
// import { config as appConfig } from '../../../config';
// import { S3StorageProvider } from '../../storage-service/providers/s3';
// import { LocalStorageProvider } from '../../storage-service/providers/local';
// import path from 'path';
// import { createWriteStream, createReadStream, existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'fs';
// import { promises as fs } from 'fs';
// import mysql from 'mysql2/promise';

// const log = createModuleLogger('mysql-backup-service');

// const app = express();
// app.use(express.json());

// const SERVICE_PORT = process.env.MYSQL_SERVICE_PORT || 3011;
// const SERVICE_NAME = 'mysql-backup-service';
// const startTime = Date.now();

// // ==================== Constants ====================
// const ALGORITHM = 'aes-256-gcm';
// const IV_LENGTH = 16;
// const TAG_LENGTH = 16;
// const DEFAULT_TIMEOUT = 3600000; // 1 hour
// const MAGIC_BYTES = Buffer.from('MYSQLBACKUP', 'utf-8');
// const ENCRYPTION_VERSION = 1;
// const MAX_RETRIES = 3;
// const RETRY_DELAY = 1000;

// // ==================== Types ====================
// interface IncrementalBackupMetadata {
//     id: string;
//     type: 'full' | 'incremental';
//     database: string;
//     fullBackupId?: string;
//     startBinlogFile: string;
//     startBinlogPosition: number;
//     endBinlogFile?: string;
//     endBinlogPosition?: number;
//     binlogFiles?: string[];
//     timestamp: Date;
//     size: number;
//     file: string;
//     checksum?: string;
//     encrypted: boolean;
// }

// interface BackupChain {
//     fullBackup: IncrementalBackupMetadata;
//     increments: IncrementalBackupMetadata[];
// }

// interface EncryptedBackupHeader {
//     magic: string;
//     version: number;
//     ivLength: number;
//     iv: string;
//     tagLength: number;
//     tag: string;
//     originalFileName: string;
//     timestamp: string;
//     algorithm: string;
//     dataLength: number;
// }

// // ==================== Reentrant File Lock ====================
// class ReentrantFileLock {
//     private lockFile: string;
//     private lockFd: number | null = null;
//     private readonly maxRetries: number = 5;
//     private readonly retryDelay: number = 100;
//     private owner: string | null = null;
//     private refCount: number = 0;

//     constructor(metadataFile: string) {
//         this.lockFile = `${metadataFile}.lock`;
//         this.owner = `${process.pid}-${Date.now()}`;
//     }

//     async acquire(): Promise<void> {
//         // Reentrant: if we already hold the lock, just increment ref count
//         if (this.lockFd !== null) {
//             this.refCount++;
//             return;
//         }

//         let attempts = 0;
//         while (attempts < this.maxRetries) {
//             try {
//                 this.lockFd = openSync(this.lockFile, 'wx');
//                 this.refCount = 1;
//                 return;
//             } catch (error) {
//                 if ((error as any).code === 'EEXIST') {
//                     attempts++;
//                     if (attempts < this.maxRetries) {
//                         await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempts));
//                         continue;
//                     }
//                     throw new Error(`Failed to acquire lock after ${this.maxRetries} attempts`);
//                 }
//                 throw error;
//             }
//         }
//     }

//     release(): void {
//         if (this.lockFd === null) {
//             return;
//         }

//         this.refCount--;
//         if (this.refCount > 0) {
//             return;
//         }

//         try {
//             closeSync(this.lockFd);
//             if (existsSync(this.lockFile)) {
//                 unlinkSync(this.lockFile);
//             }
//         } catch (error) {
//             log.warn('Failed to release file lock', { error });
//         } finally {
//             this.lockFd = null;
//             this.refCount = 0;
//         }
//     }

//     isHeld(): boolean {
//         return this.lockFd !== null;
//     }
// }

// // ==================== Custom Transform: SHA-256 Checksum ====================
// class ChecksumTransform extends Transform {
//     private hash = createHash('sha256');
//     private size = 0;

//     _transform(chunk: Buffer, encoding: string, callback: Function) {
//         this.hash.update(chunk);
//         this.size += chunk.length;
//         callback(null, chunk);
//     }

//     getChecksum(): string {
//         return this.hash.digest('hex');
//     }

//     getSize(): number {
//         return this.size;
//     }
// }

// // ==================== Custom Transform: AES-256-GCM Encryption ====================
// class EncryptionTransform extends Transform {
//     private cipher: any;
//     private iv: Buffer;
//     private keyBuffer: Buffer;
//     private tag: Buffer | null = null;
//     private headerWritten: boolean = false;
//     private originalFileName: string;
//     private dataLength: number = 0;

//     constructor(key: string, originalFileName: string = 'backup.sql.gz') {
//         super();
//         this.iv = randomBytes(IV_LENGTH);
//         this.keyBuffer = Buffer.from(key, 'hex');
//         this.cipher = createCipheriv(ALGORITHM, this.keyBuffer, this.iv);
//         this.originalFileName = originalFileName;
        
//         this.cipher.on('error', (err: Error) => this.emit('error', err));
//     }

//     _transform(chunk: Buffer, encoding: string, callback: Function) {
//         try {
//             if (!this.headerWritten) {
//                 // Write header with placeholder for tag and data length
//                 const header: EncryptedBackupHeader = {
//                     magic: MAGIC_BYTES.toString('utf-8'),
//                     version: ENCRYPTION_VERSION,
//                     ivLength: this.iv.length,
//                     iv: this.iv.toString('base64'),
//                     tagLength: TAG_LENGTH,
//                     tag: '', // Placeholder
//                     originalFileName: this.originalFileName,
//                     timestamp: new Date().toISOString(),
//                     algorithm: ALGORITHM,
//                     dataLength: 0 // Will be updated
//                 };
                
//                 const headerJson = JSON.stringify(header);
//                 const headerBuffer = Buffer.from(headerJson);
//                 const headerLengthBuffer = Buffer.alloc(4);
//                 headerLengthBuffer.writeUInt32BE(headerBuffer.length);
                
//                 // Write: [header length (4 bytes)][header JSON]
//                 this.push(headerLengthBuffer);
//                 this.push(headerBuffer);
//                 this.headerWritten = true;
//             }
            
//             const encrypted = this.cipher.update(chunk);
//             this.dataLength += chunk.length;
//             callback(null, encrypted);
//         } catch (err) {
//             callback(err);
//         }
//     }

//     _flush(callback: Function) {
//         try {
//             const final = this.cipher.final();
//             this.tag = this.cipher.getAuthTag();
            
//             // Write: [tag length (4 bytes)][tag]
//             if (this.tag) {
//                 const tagLengthBuffer = Buffer.alloc(4);
//                 tagLengthBuffer.writeUInt32BE(this.tag.length);
//                 this.push(tagLengthBuffer);
//                 this.push(this.tag);
//             }
            
//             if (final.length > 0) {
//                 callback(null, final);
//             } else {
//                 callback(null);
//             }
//         } catch (err) {
//             callback(err);
//         }
//     }

//     getEncryptionMetadata() {
//         return {
//             iv: this.iv.toString('base64'),
//             tag: this.tag ? this.tag.toString('base64') : null,
//             algorithm: ALGORITHM,
//             version: ENCRYPTION_VERSION
//         };
//     }
// }

// // ==================== Decryption Transform ====================
// class DecryptionTransform extends Transform {
//     private keyBuffer: Buffer;
//     private state: 'header' | 'data' | 'tag' = 'header';
//     private headerLength: number = 0;
//     private headerBuffer: Buffer = Buffer.alloc(0);
//     private header: EncryptedBackupHeader | null = null;
//     private iv: Buffer | null = null;
//     private tag: Buffer | null = null;
//     private decipher: any = null;
//     private dataBuffer: Buffer = Buffer.alloc(0);
//     private expectedDataLength: number = 0;
//     private processedDataLength: number = 0;

//     constructor(key: string) {
//         super();
//         this.keyBuffer = Buffer.from(key, 'hex');
//     }

//     _transform(chunk: Buffer, encoding: string, callback: Function) {
//         try {
//             this.dataBuffer = Buffer.concat([this.dataBuffer, chunk]);
            
//             while (this.dataBuffer.length > 0) {
//                 if (this.state === 'header') {
//                     if (this.headerLength === 0 && this.dataBuffer.length >= 4) {
//                         this.headerLength = this.dataBuffer.readUInt32BE(0);
//                         this.dataBuffer = this.dataBuffer.slice(4);
//                     }
                    
//                     if (this.headerLength > 0 && this.dataBuffer.length >= this.headerLength) {
//                         const headerJson = this.dataBuffer.slice(0, this.headerLength).toString('utf-8');
//                         this.header = JSON.parse(headerJson);
//                         this.dataBuffer = this.dataBuffer.slice(this.headerLength);
                        
//                         // Validate magic bytes
//                         if (this.header.magic !== MAGIC_BYTES.toString('utf-8')) {
//                             throw new Error('Invalid encrypted backup format: magic bytes mismatch');
//                         }
                        
//                         // Validate version
//                         if (this.header.version !== ENCRYPTION_VERSION) {
//                             throw new Error(`Unsupported encryption version: ${this.header.version}`);
//                         }
                        
//                         // Parse IV
//                         this.iv = Buffer.from(this.header.iv, 'base64');
//                         if (this.iv.length !== IV_LENGTH) {
//                             throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${this.iv.length}`);
//                         }
                        
//                         this.expectedDataLength = this.header.dataLength || 0;
//                         this.decipher = createDecipheriv(ALGORITHM, this.keyBuffer, this.iv);
//                         this.state = 'data';
//                     } else {
//                         break; // Wait for more data
//                     }
//                 }
                
//                 if (this.state === 'data') {
//                     // We need to leave room for the tag at the end
//                     const tagDataSize = 4 + TAG_LENGTH; // tag length (4 bytes) + tag (16 bytes)
                    
//                     if (this.dataBuffer.length <= tagDataSize) {
//                         break; // Wait for more data
//                     }
                    
//                     // Find tag length
//                     const tagLengthStart = this.dataBuffer.length - tagDataSize;
//                     const tagLength = this.dataBuffer.readUInt32BE(tagLengthStart);
                    
//                     if (tagLength !== TAG_LENGTH) {
//                         throw new Error(`Invalid tag length: expected ${TAG_LENGTH}, got ${tagLength}`);
//                     }
                    
//                     // Check if we have the full tag
//                     const totalTagData = 4 + tagLength;
//                     if (this.dataBuffer.length < totalTagData) {
//                         break; // Wait for more data
//                     }
                    
//                     // Extract data (everything before the tag)
//                     const dataEnd = this.dataBuffer.length - totalTagData;
//                     const encryptedData = this.dataBuffer.slice(0, dataEnd);
//                     this.dataBuffer = this.dataBuffer.slice(dataEnd);
                    
//                     // Extract tag
//                     const tagStart = 4; // Skip tag length
//                     this.tag = this.dataBuffer.slice(tagStart);
//                     this.dataBuffer = Buffer.alloc(0);
                    
//                     // Decrypt data
//                     if (encryptedData.length > 0) {
//                         const decrypted = this.decipher.update(encryptedData);
//                         this.processedDataLength += decrypted.length;
//                         this.push(decrypted);
//                     }
                    
//                     // Finalize and verify tag
//                     if (this.tag) {
//                         this.decipher.setAuthTag(this.tag);
//                         try {
//                             const final = this.decipher.final();
//                             if (final.length > 0) {
//                                 this.processedDataLength += final.length;
//                                 this.push(final);
//                             }
//                         } catch (error) {
//                             throw new Error('Authentication failed: backup file may be corrupted or tampered with');
//                         }
//                     }
                    
//                     // Verify data length
//                     if (this.expectedDataLength > 0 && this.processedDataLength !== this.expectedDataLength) {
//                         throw new Error(
//                             `Data length mismatch: expected ${this.expectedDataLength}, got ${this.processedDataLength}`
//                         );
//                     }
                    
//                     this.state = 'tag';
//                 }
                
//                 if (this.state === 'tag') {
//                     // All done
//                     break;
//                 }
//             }
            
//             callback(null);
//         } catch (err) {
//             callback(err);
//         }
//     }

//     _flush(callback: Function) {
//         try {
//             if (this.decipher && this.state === 'data') {
//                 // If we have leftover data, try to finalize
//                 if (this.dataBuffer.length > 0) {
//                     // Check if this is the tag
//                     if (this.dataBuffer.length >= 4) {
//                         const tagLength = this.dataBuffer.readUInt32BE(0);
//                         if (this.dataBuffer.length === tagLength + 4) {
//                             this.tag = this.dataBuffer.slice(4);
//                             if (this.tag) {
//                                 this.decipher.setAuthTag(this.tag);
//                                 try {
//                                     const final = this.decipher.final();
//                                     if (final.length > 0) {
//                                         this.push(final);
//                                     }
//                                 } catch (error) {
//                                     throw new Error('Authentication failed: backup file may be corrupted or tampered with');
//                                 }
//                             }
//                         }
//                     }
//                 }
//             }
//             callback(null);
//         } catch (err) {
//             callback(err);
//         }
//     }

//     getTag(): Buffer | null {
//         return this.tag;
//     }
// }

// // ==================== MySQL Incremental Backup Manager ====================
// class MySQLIncrementalBackupManager {
//     private connection: mysql.Connection | null = null;
//     private backupDir: string;
//     private metadataFile: string;
//     private fileLock: ReentrantFileLock;
//     private isRestoring: boolean = false;
//     private restoreLockFile: string;
//     private activeProcesses: ChildProcess[] = [];
//     private connectionPromise: Promise<mysql.Connection> | null = null;
//     private timeout: number;
//     private static instance: MySQLIncrementalBackupManager | null = null;

//     constructor(baseDir?: string, timeout?: number) {
//         this.backupDir = baseDir || path.join(process.cwd(), 'backups', 'mysql');
//         this.metadataFile = path.join(this.backupDir, 'metadata.json');
//         this.restoreLockFile = path.join(this.backupDir, '.restore.lock');
//         this.fileLock = new ReentrantFileLock(this.metadataFile);
//         this.timeout = timeout || DEFAULT_TIMEOUT;
        
//         if (!existsSync(this.backupDir)) {
//             mkdirSync(this.backupDir, { recursive: true });
//         }
//     }

//     static getInstance(baseDir?: string, timeout?: number): MySQLIncrementalBackupManager {
//         if (!MySQLIncrementalBackupManager.instance) {
//             MySQLIncrementalBackupManager.instance = new MySQLIncrementalBackupManager(baseDir, timeout);
//         }
//         return MySQLIncrementalBackupManager.instance;
//     }

//     // ==================== Connection Management ====================
//     private async getConnection(dbConfig: DatabaseConfig): Promise<mysql.Connection> {
//         if (this.connection) {
//             try {
//                 await this.connection.query('SELECT 1');
//                 return this.connection;
//             } catch {
//                 this.connection = null;
//                 this.connectionPromise = null;
//             }
//         }

//         if (!this.connectionPromise) {
//             this.connectionPromise = mysql.createConnection({
//                 host: dbConfig.host,
//                 port: dbConfig.port || 3306,
//                 user: dbConfig.username,
//                 password: dbConfig.password,
//                 database: dbConfig.database,
//                 multipleStatements: true,
//                 connectTimeout: 30000,
//             });
//         }

//         this.connection = await this.connectionPromise;
//         this.connectionPromise = null;
//         return this.connection;
//     }

//     private async closeConnection(): Promise<void> {
//         if (this.connection) {
//             try {
//                 await this.connection.end();
//             } catch (error) {
//                 log.warn('Error closing MySQL connection', { error });
//             }
//             this.connection = null;
//             this.connectionPromise = null;
//         }
//     }

//     // ==================== Process Management ====================
//     private trackProcess(proc: ChildProcess): void {
//         this.activeProcesses.push(proc);
//         proc.on('exit', () => {
//             const index = this.activeProcesses.indexOf(proc);
//             if (index > -1) {
//                 this.activeProcesses.splice(index, 1);
//             }
//         });
//     }

//     private killAllProcesses(): void {
//         for (const proc of this.activeProcesses) {
//             try {
//                 if (!proc.killed) {
//                     proc.kill('SIGTERM');
//                     setTimeout(() => {
//                         if (!proc.killed) {
//                             proc.kill('SIGKILL');
//                         }
//                     }, 5000);
//                 }
//             } catch (error) {
//                 log.warn('Failed to kill process', { error });
//             }
//         }
//         this.activeProcesses = [];
//     }

//     private async executeWithTimeout<T>(
//         proc: ChildProcess,
//         operation: () => Promise<T>,
//         timeoutMs: number = this.timeout
//     ): Promise<T> {
//         this.trackProcess(proc);
        
//         let timeoutId: NodeJS.Timeout;
//         const timeoutPromise = new Promise<never>((_, reject) => {
//             timeoutId = setTimeout(() => {
//                 try {
//                     if (!proc.killed) {
//                         proc.kill('SIGTERM');
//                         setTimeout(() => {
//                             if (!proc.killed) {
//                                 proc.kill('SIGKILL');
//                             }
//                         }, 5000);
//                     }
//                 } catch (error) {
//                     // Ignore
//                 }
//                 reject(new Error(`Operation timed out after ${timeoutMs}ms`));
//             }, timeoutMs);
//         });

//         try {
//             return await Promise.race([operation(), timeoutPromise]);
//         } finally {
//             clearTimeout(timeoutId!);
//         }
//     }

//     private async executeWithRetry<T>(
//         operation: () => Promise<T>,
//         maxRetries: number = MAX_RETRIES
//     ): Promise<T> {
//         let lastError: Error | null = null;
//         for (let attempt = 1; attempt <= maxRetries; attempt++) {
//             try {
//                 return await operation();
//             } catch (error) {
//                 lastError = error instanceof Error ? error : new Error(String(error));
//                 log.warn(`Operation failed (attempt ${attempt}/${maxRetries})`, { error: lastError.message });
//                 if (attempt < maxRetries) {
//                     await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * Math.pow(2, attempt - 1)));
//                 }
//             }
//         }
//         throw lastError || new Error('Operation failed after retries');
//     }

//     // ==================== Privilege Validation ====================
//     async validatePrivileges(dbConfig: DatabaseConfig): Promise<{ valid: boolean; missing: string[] }> {
//         const requiredPrivileges = [
//             'SELECT',
//             'RELOAD',
//             'LOCK TABLES',
//             'REPLICATION CLIENT',
//             'REPLICATION SLAVE',
//             'PROCESS'
//         ];

//         const missing: string[] = [];

//         try {
//             const conn = await this.getConnection(dbConfig);
//             const [rows] = await conn.query("SHOW GRANTS FOR CURRENT_USER()") as any;
            
//             const grants = rows.map((row: any) => Object.values(row)[0] as string).join(' ');
            
//             for (const priv of requiredPrivileges) {
//                 if (!grants.includes(priv) && !grants.includes('ALL PRIVILEGES') && !grants.includes('ALL')) {
//                     missing.push(priv);
//                 }
//             }
//         } catch (error) {
//             log.error('Failed to validate privileges', { error });
//             return { valid: false, missing: ['Unable to validate privileges'] };
//         }

//         return { valid: missing.length === 0, missing };
//     }

//     // ==================== Binlog Status Check ====================
//     async checkBinlogStatus(dbConfig: DatabaseConfig): Promise<{
//         enabled: boolean;
//         format: string;
//         retention?: number;
//         error?: string;
//     }> {
//         try {
//             const conn = await this.getConnection(dbConfig);
            
//             const [rows] = await conn.query("SHOW VARIABLES LIKE 'log_bin'") as any;
//             const enabled = rows[0]?.Value === 'ON';
            
//             if (!enabled) {
//                 return {
//                     enabled: false,
//                     format: 'N/A',
//                     error: 'Binary logging is not enabled. Please enable log_bin in MySQL config.'
//                 };
//             }

//             const [formatRows] = await conn.query("SHOW VARIABLES LIKE 'binlog_format'") as any;
//             const format = formatRows[0]?.Value || 'STATEMENT';

//             let retention: number | undefined;
//             try {
//                 const [retentionRows] = await conn.query(
//                     "SHOW VARIABLES LIKE 'binlog_expire_logs_seconds'"
//                 ) as any;
//                 if (retentionRows[0]?.Value) {
//                     retention = parseInt(retentionRows[0].Value) / 86400;
//                 }
//             } catch {
//                 // Older MySQL versions might not have this variable
//             }

//             return {
//                 enabled: true,
//                 format,
//                 retention
//             };
//         } catch (error: any) {
//             log.error('Failed to check binlog status', { error: error.message });
//             return {
//                 enabled: false,
//                 format: 'N/A',
//                 error: error.message
//             };
//         }
//     }

//     // ==================== Get Current Binlog Position ====================
//     async getCurrentBinlogPosition(dbConfig: DatabaseConfig): Promise<{ file: string; position: number }> {
//         const conn = await this.getConnection(dbConfig);
//         const [rows] = await conn.query("SHOW MASTER STATUS") as any;
        
//         if (!rows || rows.length === 0) {
//             throw new Error('Failed to get binlog position. Ensure REPLICATION CLIENT privilege.');
//         }

//         return {
//             file: rows[0].File,
//             position: rows[0].Position
//         };
//     }

//     // ==================== List Binlog Files ====================
//     async listBinlogFiles(dbConfig: DatabaseConfig): Promise<string[]> {
//         const conn = await this.getConnection(dbConfig);
//         const [rows] = await conn.query("SHOW BINARY LOGS") as any;
//         return rows.map((row: any) => row.Log_name);
//     }

//     // ==================== Check if Binlog File Has Data After Position ====================
//     private async hasBinlogDataAfterPosition(
//         dbConfig: DatabaseConfig,
//         binlogFile: string,
//         position: number
//     ): Promise<boolean> {
//         try {
//             const conn = await this.getConnection(dbConfig);
//             const [rows] = await conn.query(
//                 "SHOW BINLOG EVENTS IN ? LIMIT 1",
//                 [binlogFile]
//             ) as any;
            
//             // If there are events, check if any event has position > given position
//             if (rows && rows.length > 0) {
//                 for (const row of rows) {
//                     if (row.Pos > position) {
//                         return true;
//                     }
//                 }
//             }
//             return false;
//         } catch (error) {
//             log.warn('Failed to check binlog events', { error });
//             return false;
//         }
//     }

//     // ==================== Create Full Backup ====================
//     async createFullBackup(
//         dbConfig: DatabaseConfig,
//         options: any = {}
//     ): Promise<{
//         success: boolean;
//         backupId: string;
//         file: string;
//         binlogFile: string;
//         binlogPosition: number;
//         size: number;
//         metadata: any;
//         checksum: string;
//         encryptionMetadata?: any;
//     }> {
//         const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
//         const backupId = `full_${timestamp}_${uuidv4().slice(0, 8)}`;
//         const fileName = `${backupId}.sql.gz`;
//         const filePath = path.join(this.backupDir, fileName);

//         log.info('Creating full backup', { backupId, database: dbConfig.database });

//         // Get binlog position BEFORE backup
//         const binlogStatus = await this.getCurrentBinlogPosition(dbConfig);
        
//         // Build mysqldump args (no shell injection)
//         const args = [
//             `--host=${dbConfig.host}`,
//             `--port=${String(dbConfig.port || 3306)}`,
//             `--user=${dbConfig.username}`,
//             `--single-transaction`,
//             `--routines`,
//             `--triggers`,
//             `--events`,
//             `--hex-blob`,
//             `--add-drop-table`,
//             `--flush-logs`,
//             `--master-data=2`,
//             dbConfig.database
//         ];

//         if (options.tables && options.tables.length > 0) {
//             args.push(...options.tables);
//         }

//         if (options.excludeTables && options.excludeTables.length > 0) {
//             options.excludeTables.forEach((table: string) => {
//                 args.push(`--ignore-table=${dbConfig.database}.${table}`);
//             });
//         }

//         // Use MYSQL_PWD for secure password handling
//         const env = {
//             ...process.env,
//             MYSQL_PWD: dbConfig.password
//         };

//         const mysqldump = spawn('mysqldump', args, {
//             env,
//             stdio: ['ignore', 'pipe', 'pipe']
//         });

//         // Create gzip stream and write to file
//         const writeStream = createWriteStream(filePath);
//         const gzip = createGzip();
//         const checksumTransform = new ChecksumTransform();

//         let dumpError: Error | null = null;
//         let stderrOutput = '';

//         mysqldump.stderr.on('data', (data) => {
//             const msg = data.toString();
//             stderrOutput += msg;
//             if (msg.includes('ERROR') || msg.includes('mysqldump:')) {
//                 dumpError = new Error(`mysqldump error: ${msg}`);
//             }
//             log.debug('mysqldump stderr', { backupId, msg: msg.substring(0, 200) });
//         });

//         // Pipeline: mysqldump -> gzip -> checksum -> file
//         await this.executeWithRetry(async () => {
//             await this.executeWithTimeout(mysqldump, async () => {
//                 await pipeline(
//                     mysqldump.stdout,
//                     gzip,
//                     checksumTransform,
//                     writeStream
//                 );
//             });
//         });

//         // Wait for process to exit and check exit code
//         await new Promise<void>((resolve, reject) => {
//             mysqldump.on('close', (code) => {
//                 if (code === 0) {
//                     resolve();
//                 } else {
//                     reject(new Error(`mysqldump exited with code ${code}: ${stderrOutput}`));
//                 }
//             });
//             mysqldump.on('error', reject);
//         });

//         if (dumpError) {
//             throw dumpError;
//         }

//         // Get file size
//         const stats = await fs.stat(filePath);
//         const checksum = checksumTransform.getChecksum();

//         // Handle encryption
//         let encryptionMetadata = null;
//         let finalFilePath = filePath;
//         let finalFileName = fileName;

//         if (options.encrypt && options.encryptionKey) {
//             const encryptionResult = await this.encryptBackupFile(filePath, options.encryptionKey, fileName);
//             finalFilePath = encryptionResult.filePath;
//             finalFileName = encryptionResult.fileName;
//             encryptionMetadata = encryptionResult.metadata;
//         }

//         // Save metadata
//         const metadata: IncrementalBackupMetadata = {
//             id: backupId,
//             type: 'full',
//             database: dbConfig.database,
//             startBinlogFile: binlogStatus.file,
//             startBinlogPosition: binlogStatus.position,
//             timestamp: new Date(),
//             file: finalFileName,
//             size: stats.size,
//             checksum: checksum,
//             encrypted: !!encryptionMetadata
//         };

//         await this.saveMetadata(metadata);

//         log.info('Full backup completed', { 
//             backupId, 
//             size: stats.size,
//             binlogFile: binlogStatus.file,
//             binlogPosition: binlogStatus.position,
//             encrypted: !!encryptionMetadata
//         });

//         return {
//             success: true,
//             backupId,
//             file: finalFilePath,
//             binlogFile: binlogStatus.file,
//             binlogPosition: binlogStatus.position,
//             size: stats.size,
//             metadata,
//             checksum,
//             encryptionMetadata: encryptionMetadata || undefined
//         };
//     }

//     // ==================== Encrypt Backup File ====================
//     private async encryptBackupFile(
//         filePath: string,
//         encryptionKey: string,
//         originalFileName: string
//     ): Promise<{
//         filePath: string;
//         fileName: string;
//         metadata: { iv: string; tag: string; algorithm: string; version: number };
//     }> {
//         const encryptedFileName = `${path.basename(filePath, '.sql.gz')}_encrypted.enc`;
//         const encryptedFilePath = path.join(path.dirname(filePath), encryptedFileName);
        
//         const readStream = createReadStream(filePath);
//         const writeStream = createWriteStream(encryptedFilePath);
//         const encryptTransform = new EncryptionTransform(encryptionKey, originalFileName);
        
//         await pipeline(readStream, encryptTransform, writeStream);
        
//         const metadata = encryptTransform.getEncryptionMetadata();
//         if (!metadata.tag) {
//             throw new Error('Encryption failed: no authentication tag generated');
//         }
        
//         // Remove original unencrypted file
//         await fs.unlink(filePath);
        
//         return {
//             filePath: encryptedFilePath,
//             fileName: encryptedFileName,
//             metadata: metadata as { iv: string; tag: string; algorithm: string; version: number }
//         };
//     }

//     // ==================== Decrypt Backup File ====================
//     private async decryptBackupFile(
//         filePath: string,
//         encryptionKey: string
//     ): Promise<string> {
//         const decryptedPath = filePath.replace('_encrypted.enc', '_decrypted.sql.gz');
        
//         const readStream = createReadStream(filePath);
//         const writeStream = createWriteStream(decryptedPath);
//         const decryptTransform = new DecryptionTransform(encryptionKey);
        
//         await pipeline(readStream, decryptTransform, writeStream);
        
//         return decryptedPath;
//     }

//     // ==================== Create Incremental Backup ====================
//     async createIncrementalBackup(
//         dbConfig: DatabaseConfig,
//         fullBackupId: string,
//         options: any = {}
//     ): Promise<{
//         success: boolean;
//         backupId: string;
//         file: string;
//         binlogFiles: string[];
//         size: number;
//         metadata: any;
//     }> {
//         // Get the latest backup in the chain (could be full or incremental)
//         const chain = await this.getBackupChain(fullBackupId);
//         if (!chain) {
//             throw new Error(`Backup chain not found for ID: ${fullBackupId}`);
//         }

//         let lastBackup: IncrementalBackupMetadata;
//         if (chain.increments.length > 0) {
//             // Use the last incremental as the starting point
//             lastBackup = chain.increments[chain.increments.length - 1];
//         } else {
//             // Use the full backup
//             lastBackup = chain.fullBackup;
//         }

//         // Validate binlog retention
//         const binlogFiles = await this.listBinlogFiles(dbConfig);
//         const startFileIndex = binlogFiles.indexOf(lastBackup.startBinlogFile);
//         if (startFileIndex === -1) {
//             throw new Error(
//                 `Binlog file ${lastBackup.startBinlogFile} not found. It may have been purged. ` +
//                 `Please create a new full backup.`
//             );
//         }

//         // Check if there are any new transactions
//         const hasNewData = await this.hasBinlogDataAfterPosition(
//             dbConfig,
//             binlogFiles[startFileIndex],
//             lastBackup.startBinlogPosition
//         );

//         if (!hasNewData && startFileIndex === binlogFiles.length - 1) {
//             throw new Error('No new binlog data to backup. No changes since last backup.');
//         }

//         const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
//         const backupId = `inc_${timestamp}_${uuidv4().slice(0, 8)}`;
//         const backupDir = path.join(this.backupDir, backupId);
        
//         // Create incremental backup directory
//         if (!existsSync(backupDir)) {
//             mkdirSync(backupDir, { recursive: true });
//         }

//         log.info('Creating incremental backup', { 
//             backupId, 
//             from: lastBackup.startBinlogFile,
//             position: lastBackup.startBinlogPosition
//         });

//         // Determine which files to backup
//         let filesToBackup: string[] = [];
//         let currentPosition = lastBackup.startBinlogPosition;

//         // Start from the file where we left off
//         for (let i = startFileIndex; i < binlogFiles.length; i++) {
//             const file = binlogFiles[i];
            
//             if (i === startFileIndex) {
//                 // Check if this file has data after our position
//                 const hasData = await this.hasBinlogDataAfterPosition(dbConfig, file, currentPosition);
//                 if (hasData) {
//                     filesToBackup.push(file);
//                 }
//             } else {
//                 // New files always have data
//                 filesToBackup.push(file);
//             }
//         }

//         if (filesToBackup.length === 0) {
//             throw new Error('No new binlog data to backup. No changes since last backup.');
//         }

//         log.info(`Found ${filesToBackup.length} binlog files to backup`, { files: filesToBackup });

//         // Download each binlog file using mysqlbinlog
//         let totalSize = 0;
//         const downloadedFiles: string[] = [];
//         let lastEndFile = lastBackup.startBinlogFile;
//         let lastEndPosition = lastBackup.startBinlogPosition;

//         for (let i = 0; i < filesToBackup.length; i++) {
//             const binlogFile = filesToBackup[i];
//             const outputFile = path.join(backupDir, `${binlogFile}.sql.gz`);
            
//             // Determine start position for this file
//             let startPosition = 4; // Default to beginning of file
//             if (i === 0 && lastBackup.startBinlogFile === binlogFile) {
//                 startPosition = lastBackup.startBinlogPosition;
//             }

//             // Use mysqlbinlog to read remote binlog
//             const env = {
//                 ...process.env,
//                 MYSQL_PWD: dbConfig.password
//             };

//             const mysqlbinlogArgs = [
//                 `--host=${dbConfig.host}`,
//                 `--port=${String(dbConfig.port || 3306)}`,
//                 `--user=${dbConfig.username}`,
//                 `--read-from-remote-server`,
//                 `--start-position=${String(startPosition)}`,
//                 `--result-file=-`,
//                 binlogFile
//             ];

//             const mysqlbinlog = spawn('mysqlbinlog', mysqlbinlogArgs, {
//                 env,
//                 stdio: ['ignore', 'pipe', 'pipe']
//             });

//             // Create gzip stream and write to file
//             const writeStream = createWriteStream(outputFile);
//             const gzip = createGzip();

//             let stderrOutput = '';

//             mysqlbinlog.stderr.on('data', (data) => {
//                 stderrOutput += data.toString();
//                 log.debug('mysqlbinlog stderr', { backupId, msg: data.toString().substring(0, 200) });
//             });

//             // Pipeline: mysqlbinlog -> gzip -> file
//             await this.executeWithRetry(async () => {
//                 await this.executeWithTimeout(mysqlbinlog, async () => {
//                     await pipeline(
//                         mysqlbinlog.stdout,
//                         gzip,
//                         writeStream
//                     );
//                 });
//             });

//             // Wait for process to exit and check exit code
//             await new Promise<void>((resolve, reject) => {
//                 mysqlbinlog.on('close', (code) => {
//                     if (code === 0) {
//                         resolve();
//                     } else {
//                         reject(new Error(`mysqlbinlog exited with code ${code}: ${stderrOutput}`));
//                     }
//                 });
//                 mysqlbinlog.on('error', reject);
//             });

//             const stats = await fs.stat(outputFile);
//             if (stats.size > 0) {
//                 totalSize += stats.size;
//                 downloadedFiles.push(binlogFile);
//                 lastEndFile = binlogFile;
//                 // We need to get the end position from the file
//                 // For now, we'll use the current master position after all files
//             } else {
//                 // Empty file, skip it
//                 await fs.unlink(outputFile);
//                 log.debug('Empty binlog file skipped', { file: binlogFile });
//             }
//         }

//         // Get current binlog position after backup
//         const currentStatus = await this.getCurrentBinlogPosition(dbConfig);
//         lastEndFile = currentStatus.file;
//         lastEndPosition = currentStatus.position;

//         if (downloadedFiles.length === 0) {
//             throw new Error('No binlog data was downloaded. The backup may be empty.');
//         }

//         // Save metadata
//         const metadata: IncrementalBackupMetadata = {
//             id: backupId,
//             type: 'incremental',
//             database: dbConfig.database,
//             fullBackupId: fullBackupId,
//             startBinlogFile: lastBackup.startBinlogFile,
//             startBinlogPosition: lastBackup.startBinlogPosition,
//             endBinlogFile: lastEndFile,
//             endBinlogPosition: lastEndPosition,
//             binlogFiles: downloadedFiles,
//             timestamp: new Date(),
//             file: backupId,
//             size: totalSize,
//             encrypted: false
//         };

//         await this.saveMetadata(metadata);

//         log.info('Incremental backup completed', {
//             backupId,
//             files: downloadedFiles.length,
//             size: totalSize,
//             endBinlogFile: lastEndFile,
//             endPosition: lastEndPosition
//         });

//         return {
//             success: true,
//             backupId,
//             file: backupDir,
//             binlogFiles: downloadedFiles,
//             size: totalSize,
//             metadata
//         };
//     }

//     // ==================== Get Backup Chain ====================
//     async getBackupChain(fullBackupId: string): Promise<BackupChain | null> {
//         await this.fileLock.acquire();
//         try {
//             const allMetadata = await this.listMetadata();
//             const fullBackup = allMetadata.find((m: any) => m.id === fullBackupId && m.type === 'full');
//             if (!fullBackup) {
//                 return null;
//             }

//             const increments = allMetadata
//                 .filter((m: any) => m.type === 'incremental' && m.fullBackupId === fullBackupId)
//                 .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

//             return {
//                 fullBackup: fullBackup,
//                 increments: increments
//             };
//         } finally {
//             this.fileLock.release();
//         }
//     }

//     // ==================== Get Backup Chain from Incremental ====================
//     async getFullChainFromIncremental(backupId: string): Promise<BackupChain | null> {
//         await this.fileLock.acquire();
//         try {
//             const allMetadata = await this.listMetadata();
//             const backup = allMetadata.find((m: any) => m.id === backupId);
//             if (!backup) {
//                 return null;
//             }

//             let fullBackupId: string;
//             if (backup.type === 'full') {
//                 fullBackupId = backup.id;
//             } else if (backup.type === 'incremental' && backup.fullBackupId) {
//                 fullBackupId = backup.fullBackupId;
//             } else {
//                 return null;
//             }

//             return this.getBackupChain(fullBackupId);
//         } finally {
//             this.fileLock.release();
//         }
//     }

//     // ==================== Restore to Point-in-Time ====================
//     async restoreToPointInTime(
//         dbConfig: DatabaseConfig,
//         backupId: string,
//         targetTime?: Date
//     ): Promise<void> {
//         // Acquire restore lock atomically
//         let lockFd: number | null = null;
//         try {
//             lockFd = openSync(this.restoreLockFile, 'wx');
//         } catch (error) {
//             throw new Error('A restore operation is already in progress. Please wait.');
//         }

//         try {
//             writeFileSync(this.restoreLockFile, JSON.stringify({
//                 pid: process.pid,
//                 startTime: new Date().toISOString(),
//                 backupId: backupId
//             }));

//             this.isRestoring = true;

//             // Get the full chain
//             const chain = await this.getFullChainFromIncremental(backupId);
//             if (!chain) {
//                 throw new Error('Backup chain not found');
//             }

//             log.info('Starting restore', { 
//                 backupId,
//                 targetTime: targetTime?.toISOString() || 'latest',
//                 increments: chain.increments.length 
//             });

//             // 1. Verify checksum of full backup
//             await this.verifyBackupChecksum(chain.fullBackup);

//             // 2. Restore full backup
//             await this.restoreFullBackup(dbConfig, chain.fullBackup);

//             // 3. Apply incremental backups in order
//             let appliedCount = 0;
//             for (const inc of chain.increments) {
//                 // Check if this incremental is before target time
//                 if (targetTime && new Date(inc.timestamp) > targetTime) {
//                     log.info('Stopping at target time', { 
//                         targetTime: targetTime.toISOString(),
//                         lastApplied: inc.timestamp 
//                     });
//                     break;
//                 }

//                 // Verify incremental checksum
//                 await this.verifyBackupChecksum(inc);

//                 // Apply incremental backup
//                 await this.applyIncrementalBackup(dbConfig, inc);
//                 appliedCount++;
//             }

//             log.info('Restore completed', { 
//                 backupId,
//                 targetTime: targetTime?.toISOString() || 'latest',
//                 incrementsApplied: appliedCount,
//                 totalIncrements: chain.increments.length
//             });
//         } finally {
//             this.isRestoring = false;
//             if (lockFd !== null) {
//                 try {
//                     closeSync(lockFd);
//                     if (existsSync(this.restoreLockFile)) {
//                         unlinkSync(this.restoreLockFile);
//                     }
//                 } catch (error) {
//                     log.warn('Failed to release restore lock', { error });
//                 }
//             }
//         }
//     }

//     // ==================== Verify Backup Checksum ====================
//     private async verifyBackupChecksum(backup: IncrementalBackupMetadata): Promise<void> {
//         if (!backup.checksum) {
//             log.warn('No checksum found for backup, skipping verification', { id: backup.id });
//             return;
//         }

//         const filePath = path.join(this.backupDir, backup.file);
//         if (!existsSync(filePath)) {
//             throw new Error(`Backup file not found: ${filePath}`);
//         }

//         // Decrypt if encrypted
//         let fileToVerify = filePath;
//         if (backup.encrypted) {
//             const key = process.env.BACKUP_ENCRYPTION_KEY;
//             if (!key) {
//                 throw new Error('Encryption key not found in environment');
//             }
//             fileToVerify = await this.decryptBackupFile(filePath, key);
//         }

//         const calculatedChecksum = await this.calculateFileChecksum(fileToVerify);
        
//         // Clean up decrypted file if it was created
//         if (fileToVerify !== filePath && existsSync(fileToVerify)) {
//             await fs.unlink(fileToVerify);
//         }

//         if (calculatedChecksum !== backup.checksum) {
//             throw new Error(
//                 `Checksum verification failed for ${backup.id}. Expected: ${backup.checksum}, Got: ${calculatedChecksum}`
//             );
//         }

//         log.info('Checksum verification passed', { id: backup.id });
//     }

//     // ==================== Calculate File Checksum ====================
//     private async calculateFileChecksum(filePath: string): Promise<string> {
//         const hash = createHash('sha256');
//         const stream = createReadStream(filePath);
        
//         return new Promise((resolve, reject) => {
//             stream.on('data', (data) => hash.update(data));
//             stream.on('end', () => resolve(hash.digest('hex')));
//             stream.on('error', reject);
//         });
//     }

//     // ==================== Restore Full Backup ====================
//     private async restoreFullBackup(dbConfig: DatabaseConfig, fullBackup: IncrementalBackupMetadata): Promise<void> {
//         let filePath = path.join(this.backupDir, fullBackup.file);
        
//         log.info('Restoring full backup', { file: fullBackup.file });

//         if (!existsSync(filePath)) {
//             throw new Error(`Full backup file not found: ${filePath}`);
//         }

//         // Decrypt if encrypted
//         let restoreFile = filePath;
//         if (fullBackup.encrypted) {
//             const key = process.env.BACKUP_ENCRYPTION_KEY;
//             if (!key) {
//                 throw new Error('Encryption key not found in environment');
//             }
//             restoreFile = await this.decryptBackupFile(filePath, key);
//         }

//         const env = {
//             ...process.env,
//             MYSQL_PWD: dbConfig.password
//         };

//         // Use gunzip to decompress and pipe to mysql
//         const gunzip = spawn('gunzip', ['-c', restoreFile]);
//         this.trackProcess(gunzip);
        
//         const mysqlArgs = [
//             `--host=${dbConfig.host}`,
//             `--port=${String(dbConfig.port || 3306)}`,
//             `--user=${dbConfig.username}`,
//             dbConfig.database
//         ];

//         const mysqlProcess = spawn('mysql', mysqlArgs, {
//             env,
//             stdio: ['pipe', 'pipe', 'pipe']
//         });
//         this.trackProcess(mysqlProcess);

//         let stderrOutput = '';

//         mysqlProcess.stderr.on('data', (data) => {
//             stderrOutput += data.toString();
//         });

//         // Pipeline: gunzip -> mysql
//         await this.executeWithRetry(async () => {
//             await this.executeWithTimeout(mysqlProcess, async () => {
//                 await pipeline(
//                     gunzip.stdout,
//                     mysqlProcess.stdin
//                 );
//             });
//         });

//         // Wait for mysql to finish
//         await new Promise<void>((resolve, reject) => {
//             mysqlProcess.on('close', (code) => {
//                 if (code === 0) {
//                     resolve();
//                 } else {
//                     reject(new Error(`mysql restore failed with code ${code}: ${stderrOutput}`));
//                 }
//             });
//             mysqlProcess.on('error', reject);
//             gunzip.on('error', reject);
//         });

//         // Clean up decrypted file
//         if (restoreFile !== filePath && existsSync(restoreFile)) {
//             await fs.unlink(restoreFile);
//         }

//         log.info('Full backup restored', { file: fullBackup.file });
//     }

//     // ==================== Apply Incremental Backup ====================
//     private async applyIncrementalBackup(dbConfig: DatabaseConfig, inc: IncrementalBackupMetadata): Promise<void> {
//         log.info('Applying incremental backup', { id: inc.id });

//         const incDir = path.join(this.backupDir, inc.file);
        
//         if (!existsSync(incDir)) {
//             throw new Error(`Incremental backup directory not found: ${incDir}`);
//         }

//         const env = {
//             ...process.env,
//             MYSQL_PWD: dbConfig.password
//         };

//         // Apply each binlog file in order
//         for (const binlogFile of inc.binlogFiles || []) {
//             const sqlFile = path.join(incDir, `${binlogFile}.sql.gz`);
            
//             if (!existsSync(sqlFile)) {
//                 log.warn(`Binlog file not found: ${sqlFile}, skipping`);
//                 continue;
//             }

//             // Decompress and pipe to mysql
//             const gunzip = spawn('gunzip', ['-c', sqlFile]);
//             this.trackProcess(gunzip);
            
//             const mysqlArgs = [
//                 `--host=${dbConfig.host}`,
//                 `--port=${String(dbConfig.port || 3306)}`,
//                 `--user=${dbConfig.username}`,
//                 dbConfig.database
//             ];

//             const mysqlProcess = spawn('mysql', mysqlArgs, {
//                 env,
//                 stdio: ['pipe', 'pipe', 'pipe']
//             });
//             this.trackProcess(mysqlProcess);

//             let stderrOutput = '';

//             mysqlProcess.stderr.on('data', (data) => {
//                 stderrOutput += data.toString();
//             });

//             // Pipeline: gunzip -> mysql
//             await this.executeWithRetry(async () => {
//                 await this.executeWithTimeout(mysqlProcess, async () => {
//                     await pipeline(
//                         gunzip.stdout,
//                         mysqlProcess.stdin
//                     );
//                 });
//             });

//             // Wait for mysql to finish
//             await new Promise<void>((resolve, reject) => {
//                 mysqlProcess.on('close', (code) => {
//                     if (code === 0) {
//                         resolve();
//                     } else {
//                         reject(new Error(`mysql restore failed with code ${code}: ${stderrOutput}`));
//                     }
//                 });
//                 mysqlProcess.on('error', reject);
//                 gunzip.on('error', reject);
//             });

//             log.debug('Applied binlog file', { file: binlogFile });
//         }

//         log.info('Incremental backup applied', { id: inc.id });
//     }

//     // ==================== List Backup Chains ====================
//     async listBackupChains(): Promise<BackupChain[]> {
//         await this.fileLock.acquire();
//         try {
//             const allMetadata = await this.listMetadata();
//             const fullBackups = allMetadata.filter((m: any) => m.type === 'full');
            
//             const chains: BackupChain[] = [];
//             for (const full of fullBackups) {
//                 const increments = allMetadata
//                     .filter((m: any) => m.type === 'incremental' && m.fullBackupId === full.id)
//                     .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                
//                 chains.push({
//                     fullBackup: full,
//                     increments: increments
//                 });
//             }
            
//             return chains;
//         } finally {
//             this.fileLock.release();
//         }
//     }

//     // ==================== Cleanup Old Backups ====================
//     async cleanup(retentionDays: number = 7): Promise<void> {
//         await this.fileLock.acquire();
//         try {
//             const allMetadata = await this.listMetadata();
//             const cutoff = new Date();
//             cutoff.setDate(cutoff.getDate() - retentionDays);

//             // Build dependency graph
//             const fullBackupDependencies = new Map<string, Set<string>>();
//             const incrementalDependencies = new Map<string, Set<string>>();

//             // Find all full backups and their dependent increments
//             for (const meta of allMetadata) {
//                 if (meta.type === 'full') {
//                     fullBackupDependencies.set(meta.id, new Set());
//                 }
//             }

//             for (const meta of allMetadata) {
//                 if (meta.type === 'incremental' && meta.fullBackupId) {
//                     const deps = fullBackupDependencies.get(meta.fullBackupId);
//                     if (deps) {
//                         deps.add(meta.id);
//                     }
//                 }
//             }

//             // Also track dependencies between increments
//             const sortedIncrements = allMetadata
//                 .filter((m: any) => m.type === 'incremental')
//                 .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

//             for (let i = 0; i < sortedIncrements.length; i++) {
//                 const current = sortedIncrements[i];
//                 const deps = new Set<string>();
//                 for (let j = i + 1; j < sortedIncrements.length; j++) {
//                     deps.add(sortedIncrements[j].id);
//                 }
//                 incrementalDependencies.set(current.id, deps);
//             }

//             const toDelete: any[] = [];
//             const toKeep: any[] = [];

//             for (const meta of allMetadata) {
//                 const isOld = new Date(meta.timestamp) < cutoff;
//                 let hasDependents = false;

//                 if (meta.type === 'full') {
//                     const deps = fullBackupDependencies.get(meta.id);
//                     hasDependents = deps !== undefined && deps.size > 0;
//                 } else if (meta.type === 'incremental') {
//                     const deps = incrementalDependencies.get(meta.id);
//                     hasDependents = deps !== undefined && deps.size > 0;
//                 }

//                 if (isOld && !hasDependents) {
//                     toDelete.push(meta);
//                 } else {
//                     toKeep.push(meta);
//                 }
//             }

//             // Delete files
//             for (const meta of toDelete) {
//                 try {
//                     const filePath = path.join(this.backupDir, meta.file);
//                     if (existsSync(filePath)) {
//                         await fs.rm(filePath, { recursive: true, force: true });
//                     }
//                     log.info('Deleted old backup', { id: meta.id, file: meta.file });
//                 } catch (error) {
//                     log.warn('Failed to delete old backup', { id: meta.id, error });
//                 }
//             }

//             // Update metadata
//             await fs.writeFile(this.metadataFile, JSON.stringify(toKeep, null, 2));
//             log.info('Cleanup completed', { 
//                 deleted: toDelete.length, 
//                 kept: toKeep.length,
//                 retentionDays 
//             });
//         } finally {
//             this.fileLock.release();
//         }
//     }

//     // ==================== Metadata Management ====================

//     private async saveMetadata(metadata: any): Promise<void> {
//         await this.fileLock.acquire();
//         try {
//             let allMetadata: any[] = [];
//             if (existsSync(this.metadataFile)) {
//                 const content = await fs.readFile(this.metadataFile, 'utf-8');
//                 try {
//                     allMetadata = JSON.parse(content);
//                 } catch {
//                     allMetadata = [];
//                 }
//             }

//             allMetadata = allMetadata.filter((m: any) => m.id !== metadata.id);
//             allMetadata.push(metadata);

//             await fs.writeFile(this.metadataFile, JSON.stringify(allMetadata, null, 2));
//         } finally {
//             this.fileLock.release();
//         }
//     }

//     private async listMetadata(): Promise<any[]> {
//         // This is called with lock already held by caller
//         if (!existsSync(this.metadataFile)) {
//             return [];
//         }

//         const content = await fs.readFile(this.metadataFile, 'utf-8');
//         try {
//             return JSON.parse(content);
//         } catch {
//             return [];
//         }
//     }

//     // ==================== Shutdown ====================
//     async shutdown(): Promise<void> {
//         log.info('Shutting down manager...');
        
//         // Kill all child processes
//         this.killAllProcesses();
        
//         // Close MySQL connection
//         await this.closeConnection();
        
//         // Release any held locks
//         if (this.fileLock.isHeld()) {
//             this.fileLock.release();
//         }
        
//         // Clear singleton instance
//         MySQLIncrementalBackupManager.instance = null;
        
//         log.info('Manager shutdown complete');
//     }

//     // ==================== Get Binary Log Content ====================
//     async getBinlogContent(
//         dbConfig: DatabaseConfig,
//         binlogFile: string,
//         startPosition: number,
//         endPosition?: number
//     ): Promise<string> {
//         const env = {
//             ...process.env,
//             MYSQL_PWD: dbConfig.password
//         };

//         const args = [
//             `--host=${dbConfig.host}`,
//             `--port=${String(dbConfig.port || 3306)}`,
//             `--user=${dbConfig.username}`,
//             `--read-from-remote-server`,
//             `--start-position=${String(startPosition)}`,
//         ];

//         if (endPosition) {
//             args.push(`--stop-position=${String(endPosition)}`);
//         }

//         args.push(`--result-file=-`);
//         args.push(binlogFile);

//         const mysqlbinlog = spawn('mysqlbinlog', args, {
//             env,
//             stdio: ['ignore', 'pipe', 'pipe']
//         });

//         let output = '';
//         let stderrOutput = '';

//         mysqlbinlog.stdout.on('data', (data) => {
//             output += data.toString();
//         });

//         mysqlbinlog.stderr.on('data', (data) => {
//             stderrOutput += data.toString();
//         });

//         await new Promise<void>((resolve, reject) => {
//             mysqlbinlog.on('close', (code) => {
//                 if (code === 0) {
//                     resolve();
//                 } else {
//                     reject(new Error(`mysqlbinlog exited with code ${code}: ${stderrOutput}`));
//                 }
//             });
//             mysqlbinlog.on('error', reject);
//         });

//         return output;
//     }
// }

// // ==================== Routes ====================

// app.get('/health', (req, res) => {
//     res.json({
//         service: SERVICE_NAME,
//         status: 'healthy',
//         version: '1.0.0',
//         uptime: (Date.now() - startTime) / 1000,
//         timestamp: new Date()
//     });
// });

// // ==================== Full Backup ====================
// app.post('/backup', async (req, res) => {
//     const { dbConfig, backupType, options } = req.body;
//     const backupId = options?.backupId || uuidv4();
    
//     log.info('Received MySQL backup request', { backupId, database: dbConfig.database, type: backupType });
    
//     try {
//         const backupManager = MySQLIncrementalBackupManager.getInstance(
//             options?.backupDir,
//             options?.timeout
//         );
        
//         // Validate privileges
//         const privilegeCheck = await backupManager.validatePrivileges(dbConfig);
//         if (!privilegeCheck.valid) {
//             throw new Error(
//                 `Missing required MySQL privileges: ${privilegeCheck.missing.join(', ')}. ` +
//                 `Please grant these privileges to the backup user.`
//             );
//         }

//         // Check binlog status for incremental backups
//         if (backupType === 'incremental') {
//             const status = await backupManager.checkBinlogStatus(dbConfig);
//             if (!status.enabled) {
//                 throw new Error(`Binlog is not enabled. ${status.error || 'Please enable log_bin in MySQL config.'}`);
//             }
//             log.info('Binlog status checked', { format: status.format, retention: status.retention });
//         }

//         let result;
//         if (backupType === 'full' || backupType === 'full-backup') {
//             result = await backupManager.createFullBackup(dbConfig, options);
//         } else if (backupType === 'incremental') {
//             // Get the last full backup ID
//             const chains = await backupManager.listBackupChains();
//             if (chains.length === 0) {
//                 throw new Error('No full backup found. Please create a full backup first.');
//             }
            
//             // Use the latest full backup
//             const latestFull = chains[chains.length - 1];
//             result = await backupManager.createIncrementalBackup(dbConfig, latestFull.fullBackup.id, options);
//         } else {
//             throw new Error(`Unsupported backup type: ${backupType}`);
//         }
        
//         res.json({
//             success: true,
//             backupId,
//             ...result
//         });
        
//     } catch (error) {
//         const errorMessage = error instanceof Error ? error.message : String(error);
//         log.error('MySQL backup failed', { backupId, error: errorMessage });
//         res.status(500).json({
//             success: false,
//             backupId,
//             error: errorMessage
//         });
//     }
// });

// // ==================== List Backups ====================
// app.get('/backups', async (req, res) => {
//     try {
//         const { backupDir } = req.query;
//         const backupManager = new MySQLIncrementalBackupManager(backupDir as string);
//         const chains = await backupManager.listBackupChains();
        
//         res.json({
//             success: true,
//             chains,
//             total: chains.length
//         });
//     } catch (error) {
//         const errorMessage = error instanceof Error ? error.message : String(error);
//         res.status(500).json({
//             success: false,
//             error: errorMessage
//         });
//     }
// });

// // ==================== Restore ====================
// app.post('/restore', async (req, res) => {
//     const { dbConfig, backupId, targetTime, options } = req.body;
    
//     log.info('Received MySQL restore request', { backupId, targetTime });
    
//     try {
//         const backupManager = MySQLIncrementalBackupManager.getInstance(
//             options?.backupDir,
//             options?.timeout
//         );
        
//         // Check if backup exists
//         const chain = await backupManager.getBackupChain(backupId);
//         if (!chain) {
//             throw new Error(`Backup chain not found for ID: ${backupId}`);
//         }

//         // Perform restore
//         const targetDate = targetTime ? new Date(targetTime) : undefined;
//         await backupManager.restoreToPointInTime(dbConfig, backupId, targetDate);
        
//         res.json({
//             success: true,
//             backupId,
//             targetTime: targetDate?.toISOString() || 'latest',
//             message: 'Restore completed successfully'
//         });
        
//     } catch (error) {
//         const errorMessage = error instanceof Error ? error.message : String(error);
//         log.error('MySQL restore failed', { backupId, error: errorMessage });
//         res.status(500).json({
//             success: false,
//             backupId,
//             error: errorMessage
//         });
//     }
// });

// // ==================== Check Binlog Status ====================
// app.post('/check-binlog', async (req, res) => {
//     const { dbConfig } = req.body;
    
//     try {
//         const backupManager = new MySQLIncrementalBackupManager();
//         const status = await backupManager.checkBinlogStatus(dbConfig);
        
//         res.json({
//             success: true,
//             ...status
//         });
//     } catch (error) {
//         const errorMessage = error instanceof Error ? error.message : String(error);
//         res.status(500).json({
//             success: false,
//             error: errorMessage
//         });
//     }
// });

// // ==================== Cleanup Old Backups ====================
// app.post('/cleanup', async (req, res) => {
//     const { retentionDays, backupDir } = req.body;
    
//     try {
//         const backupManager = new MySQLIncrementalBackupManager(backupDir);
//         await backupManager.cleanup(retentionDays || 7);
        
//         res.json({
//             success: true,
//             retentionDays: retentionDays || 7,
//             message: 'Cleanup completed successfully'
//         });
//     } catch (error) {
//         const errorMessage = error instanceof Error ? error.message : String(error);
//         res.status(500).json({
//             success: false,
//             error: errorMessage
//         });
//     }
// });

// // ==================== Graceful Shutdown ====================
// let isShuttingDown = false;

// async function shutdown(): Promise<void> {
//     if (isShuttingDown) return;
//     isShuttingDown = true;
    
//     log.info('Shutting down gracefully...');
//     try {
//         // Shutdown the manager instance
//         const manager = MySQLIncrementalBackupManager.getInstance();
//         await manager.shutdown();
//         log.info('Shutdown completed');
//     } catch (error) {
//         log.error('Error during shutdown', { error });
//     }
//     process.exit(0);
// }

// process.on('SIGINT', shutdown);
// process.on('SIGTERM', shutdown);
// process.on('uncaughtException', (error) => {
//     log.error('Uncaught exception', { error });
//     shutdown();
// });

// process.on('unhandledRejection', (reason) => {
//     log.error('Unhandled rejection', { reason });
//     shutdown();
// });

// // ==================== Start Server ====================
// app.listen(SERVICE_PORT, () => {
//     log.info(`${SERVICE_NAME} listening on port ${SERVICE_PORT}`);
// });

// export default app;