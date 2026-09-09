import express from 'express';
import { createModuleLogger } from '../../../logger';
import { MySQLIncrementalBackupManager } from './manager';
import routes from './routes';
import { APP_VERSION } from '../../../version';

const log = createModuleLogger('mysql-backup-service');

const app = express();
app.use(express.json());

const SERVICE_PORT = process.env.MYSQL_SERVICE_PORT || 3011;
const SERVICE_NAME = 'mysql-backup-service';
const startTime = Date.now();

app.get('/health', (req, res) => {
    res.json({
        service: SERVICE_NAME,
        status: 'healthy',
        version: APP_VERSION,
        uptime: (Date.now() - startTime) / 1000,
        timestamp: new Date()
    });
});

app.use('/', routes);

// Graceful Shutdown
let isShuttingDown = false;

async function shutdown(): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    log.info('Shutting down gracefully...');
    try {
        const manager = MySQLIncrementalBackupManager.getInstance();
        await manager.shutdown();
        log.info('Shutdown completed');
    } catch (error) {
        log.error('Error during shutdown', { error });
    }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (error) => {
    log.error('Uncaught exception', { error });
    shutdown();
});

process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection', { reason });
    shutdown();
});

app.listen(SERVICE_PORT, () => {
    log.info(`${SERVICE_NAME} listening on port ${SERVICE_PORT}`);
});

export default app;

// import express from 'express';
// import { spawn } from 'child_process';
// import { createGzip } from 'zlib';
// import { createHash, createCipheriv, randomBytes } from 'crypto';
// import { Readable, PassThrough, Transform } from 'stream';
// import { pipeline } from 'stream/promises';
// import { v4 as uuidv4 } from 'uuid';
// import { DatabaseConfig, BackupOptions, BackupResponse } from '../../shared/types';
// import { createModuleLogger } from '../../../logger';
// import { config as appConfig } from '../../../config';
// import { S3StorageProvider } from '../../storage-service/providers/s3';
// import { LocalStorageProvider } from '../../storage-service/providers/local';
// import path from 'path';
// import { createWriteStream } from 'fs';

// const log = createModuleLogger('mysql-backup-service');

// const app = express();
// app.use(express.json());

// const SERVICE_PORT = process.env.MYSQL_SERVICE_PORT || 3011;
// const SERVICE_NAME = 'mysql-backup-service';
// const startTime = Date.now();

// // ==================== Encryption Constants ====================
// const ALGORITHM = 'aes-256-gcm';
// const IV_LENGTH = 16;

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
//     private isFinalized: boolean = false;

//     constructor(key: string) {
//         super();
//         this.iv = randomBytes(IV_LENGTH);
//         this.keyBuffer = Buffer.from(key, 'hex');
//         this.cipher = createCipheriv(ALGORITHM, this.keyBuffer, this.iv);
        
//         this.cipher.on('error', (err: Error) => this.emit('error', err));
//     }

//     _transform(chunk: Buffer, encoding: string, callback: Function) {
//         try {
//             const encrypted = this.cipher.update(chunk);
//             callback(null, encrypted);
//         } catch (err) {
//             callback(err);
//         }
//     }

//     _flush(callback: Function) {
//         try {
//             if (!this.isFinalized) {
//                 const final = this.cipher.final();
//                 this.tag = this.cipher.getAuthTag();
//                 this.isFinalized = true;
//                 if (final.length > 0) {
//                     callback(null, final);
//                 } else {
//                     callback(null);
//                 }
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
//             algorithm: ALGORITHM
//         };
//     }
// }

// app.get('/health', (req, res) => {
//     res.json({
//         service: SERVICE_NAME,
//         status: 'healthy',
//         version: '1.0.0',
//         uptime: (Date.now() - startTime) / 1000,
//         timestamp: new Date()
//     });
// });

// app.post('/backup', async (req, res) => {
//     const { dbConfig, backupType, options } = req.body;
//     const backupId = options?.backupId || uuidv4();
    
//     log.info('Received MySQL backup request', { backupId, database: dbConfig.database });
    
//     try {
//         const result = await performBackup(backupId, dbConfig, backupType, options);
//         res.json(result);
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

// async function performBackup(
//     backupId: string,
//     dbConfig: DatabaseConfig,
//     backupType: string,
//     options: any
// ): Promise<BackupResponse> {
//     const startTime = Date.now();
    
//     // Build mysqldump command
//     let command = `mysqldump -h ${dbConfig.host} -P ${dbConfig.port || 3306} -u ${dbConfig.username}`;
//     if (dbConfig.password) command += ` -p${dbConfig.password}`;
//     command += ` ${dbConfig.database}`;
//     command += ' --single-transaction --routines --triggers --events --hex-blob --add-drop-table';
    
//     if (options.tables && options.tables.length > 0) {
//         command += ` ${options.tables.join(' ')}`;
//     }
    
//     if (options.excludeTables && options.excludeTables.length > 0) {
//         options.excludeTables.forEach((table: string) => {
//             command += ` --ignore-table=${dbConfig.database}.${table}`;
//         });
//     }
    
//     // Generate backup filename
//     const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
//     const baseFileName = `${dbConfig.database}_${timestamp}`;
//     const extension = options.compress ? 'gz' : 'sql';
//     let finalFileName = `${baseFileName}.${extension}`;
    
//     // Get storage config
//     const storageConfig = options.storage || { type: 'local', basePath: './backups' };
    
//     // Handle encryption
//     const isEncrypted = options.encrypt || false;
//     let encryptionKey: string | null = null;
//     let encryptionType: string | null = null;
//     let encryptionTransform: EncryptionTransform | null = null;
//     let encryptionMetadata: any = null;
    
//     if (isEncrypted) {
//         encryptionKey = options.encryptionKey || null;
//         if (!encryptionKey) {
//             throw new Error('Encryption enabled but no key provided');
//         }
//         if (encryptionKey.length !== 64) {
//             throw new Error('Encryption key must be 64 hexadecimal characters (32 bytes)');
//         }
//         encryptionType = ALGORITHM;
//         finalFileName = `${baseFileName}_encrypted.enc`;
//     }
    
//     log.debug('Executing mysqldump', { backupId, command: command.substring(0, 200) + '...' });
    
//     // ============================================================
//     // STREAMING PIPELINE: NO TEMPORARY FILES
//     // ============================================================
    
//     // Step 1: Spawn mysqldump process
//     const mysqldump = spawn(command, {
//         shell: true,
//         env: { ...process.env },
//         stdio: ['ignore', 'pipe', 'pipe']
//     });
    
//     // Create a PassThrough to capture errors
//     const errorPassthrough = new PassThrough();
//     let mysqldumpError: Error | null = null;
    
//     mysqldump.on('error', (err) => {
//         mysqldumpError = err;
//         errorPassthrough.destroy(err);
//     });
    
//     mysqldump.stderr.on('data', (data) => {
//         const msg = data.toString();
//         if (msg.includes('ERROR') || msg.includes('mysqldump:') || msg.includes('Got error')) {
//             const err = new Error(`mysqldump error: ${msg}`);
//             mysqldumpError = err;
//             errorPassthrough.destroy(err);
//         }
//         log.debug('mysqldump stderr', { backupId, msg: msg.substring(0, 200) });
//     });
    
//     // Pipe stdout to errorPassthrough
//     mysqldump.stdout.pipe(errorPassthrough, { end: true });
//     mysqldump.stdout.on('error', (err) => {
//         if (!mysqldumpError) {
//             mysqldumpError = err;
//             errorPassthrough.destroy(err);
//         }
//     });
    
//     // Step 2: Start building the pipeline
//     let currentStream: Readable = errorPassthrough;
    
//     // Step 3: Compression (if enabled)
//     let compressStream = null;
//     if (options.compress) {
//         compressStream = createGzip();
//         currentStream = currentStream.pipe(compressStream);
//     }
    
//     // Step 4: SHA-256 Checksum + Size Tracking
//     const checksumTransform = new ChecksumTransform();
//     currentStream = currentStream.pipe(checksumTransform);
    
//     // Step 5: Encryption (if enabled)
//     if (isEncrypted && encryptionKey) {
//         encryptionTransform = new EncryptionTransform(encryptionKey);
//         currentStream = currentStream.pipe(encryptionTransform);
//     }
    
//     // Step 6: Upload to Storage
//     try {
//         let uploadResult;
        
//         if (storageConfig.type === 's3') {
//             if (!storageConfig.bucket) {
//                 throw new Error('S3 bucket is required for s3 storage type');
//             }
//             if (!storageConfig.accessKey || !storageConfig.secretKey) {
//                 throw new Error('S3 accessKey and secretKey are required for s3 storage type');
//             }

//             log.info('Uploading stream to S3', { bucket: storageConfig.bucket, key: finalFileName });

//             const s3Provider = new S3StorageProvider({
//                 type: 's3',
//                 bucket: storageConfig.bucket,
//                 region: storageConfig.region || 'us-east-1',
//                 accessKey: storageConfig.accessKey,
//                 secretKey: storageConfig.secretKey
//             });

//             await s3Provider.initialize();
//             uploadResult = await s3Provider.uploadStream(currentStream, finalFileName);
//         } else {
//             const localPath = storageConfig.basePath || './backups';
//             const fs = require('fs');
            
//             if (!fs.existsSync(localPath)) {
//                 fs.mkdirSync(localPath, { recursive: true });
//             }

//             const destPath = path.join(localPath, finalFileName);
//             const writeStream = fs.createWriteStream(destPath);

//             await pipeline(currentStream, writeStream);

//             const stats = fs.statSync(destPath);
//             log.info('Stream uploaded to local storage', { path: destPath, size: stats.size });

//             uploadResult = {
//                 path: destPath,
//                 size: stats.size
//             };
//         }
        
//         // Get checksum and size from the transform
//         const checksum = checksumTransform.getChecksum();
//         const fileSize = checksumTransform.getSize();
        
//         // Get encryption metadata if applicable
//         if (isEncrypted && encryptionTransform) {
//             const encMeta = encryptionTransform.getEncryptionMetadata();
//             if (encMeta.tag) {
//                 encryptionMetadata = {
//                     iv: encMeta.iv,
//                     tag: encMeta.tag,
//                     algorithm: encMeta.algorithm
//                 };
//             }
//         }
        
//         // Build final path
//         let finalPath: string;
//         if (storageConfig.type === 's3') {
//             const prefix = storageConfig.prefix || '';
//             finalPath = `s3://${storageConfig.bucket}/${prefix ? prefix + '/' : ''}${finalFileName}`;
//         } else {
//             const localPath = storageConfig.basePath || './backups';
//             finalPath = path.join(localPath, finalFileName);
//         }
        
//         // Build metadata
//         const metadata: any = {
//             id: backupId,
//             dbType: 'mysql',
//             dbName: dbConfig.database,
//             backupType: backupType,
//             size: fileSize,
//             checksum: checksum,
//             createdAt: new Date(),
//             compression: options.compress ? 'gzip' : 'none',
//             encrypted: isEncrypted,
//             encryptionType: isEncrypted ? encryptionType : null,
//             encryptionMetadata: isEncrypted ? encryptionMetadata : null,
//             storage: {
//                 name: storageConfig.name || (storageConfig.type === 's3' ? 's3-storage' : 'local-storage'),
//                 type: storageConfig.type,
//                 ...(storageConfig.type === 's3' && {
//                     bucket: storageConfig.bucket,
//                     region: storageConfig.region || 'us-east-1',
//                     key: finalFileName,
//                     etag: uploadResult.etag,
//                     versionId: uploadResult.versionId
//                 }),
//                 ...(storageConfig.type === 'local' && {
//                     path: storageConfig.basePath || './backups'
//                 })
//             }
//         };
        
//         const duration = (Date.now() - startTime) / 1000;
        
//         log.info('MySQL backup completed', {
//             backupId,
//             size: fileSize,
//             duration,
//             storageType: storageConfig.type,
//             encrypted: isEncrypted,
//             checksum: checksum.substring(0, 16) + '...'
//         });
        
//         return {
//             success: true,
//             backupId,
//             filePath: finalPath,
//             fileSize: fileSize,
//             duration,
//             metadata,
//             fileName: finalFileName,
//             checksum,
//             encrypted: isEncrypted,
//             encryptionType,
//             encryptionMetadata
//         };
        
//     } catch (error) {
//         // Destroy the stream to clean up resources
//         if (!currentStream.destroyed) {
//             currentStream.destroy();
//         }
        
//         // Kill mysqldump if still running
//         try {
//             mysqldump.kill('SIGTERM');
//         } catch (e) {
//             // Ignore kill errors
//         }
        
//         const errorMessage = error instanceof Error ? error.message : String(error);
//         log.error('MySQL backup execution failed', { backupId, error: errorMessage });
//         throw new Error(`MySQL backup execution failed: ${errorMessage}`);
//     }
// }

// app.listen(SERVICE_PORT, () => {
//     log.info(`${SERVICE_NAME} listening on port ${SERVICE_PORT}`);
// });

// export default app;