import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { statSync, existsSync, unlinkSync, mkdirSync, createReadStream } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseConfig, BackupOptions, BackupResponse } from '../../shared/types';
import { createModuleLogger } from '../../../logger';
import { config as appConfig } from '../../../config';
import { S3StorageProvider } from '../../storage-service/providers/s3';
import { LocalStorageProvider } from '../../storage-service/providers/local';
import { createHash } from 'crypto';
import { prisma } from '../../../lib/prisma';

const execAsync = promisify(exec);
const log = createModuleLogger('mysql-backup-service');

const app = express();
app.use(express.json());

const SERVICE_PORT = process.env.MYSQL_SERVICE_PORT || 3011;
const SERVICE_NAME = 'mysql-backup-service';
const startTime = Date.now();

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
    options: BackupOptions
): Promise<BackupResponse> {
    const startTime = Date.now();
    let localBackupPath: string | null = null;
    
    // Build mysqldump command
    let command = `mysqldump -h ${dbConfig.host} -P ${dbConfig.port || 3306} -u ${dbConfig.username}`;
    if (dbConfig.password) command += ` -p${dbConfig.password}`;
    command += ` ${dbConfig.database}`;
    command += ' --single-transaction --routines --triggers --events --hex-blob --add-drop-table';
    
    if (options.tables && options.tables.length > 0) {
        command += ` ${options.tables.join(' ')}`;
    }
    
    if (options.excludeTables && options.excludeTables.length > 0) {
        options.excludeTables.forEach(table => {
            command += ` --ignore-table=${dbConfig.database}.${table}`;
        });
    }
    
    // Generate backup filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `${dbConfig.database}_${timestamp}.${options.compress ? 'gz' : 'sql'}`;
    
    // Get storage config from options
    const storageConfig = options.storage || { type: 'local', basePath: './backups' };
    
    // Determine local temp path
    const localTempPath = appConfig.get('storage.tempPath') || './tmp';
    localBackupPath = path.join(localTempPath, backupFileName);
    
    // Ensure temp directory exists
    if (!existsSync(localTempPath)) {
        mkdirSync(localTempPath, { recursive: true });
    }
    
    // Execute backup to temp location
    const finalCommand = options.compress 
        ? `${command} | gzip > "${localBackupPath}"`
        : `${command} > "${localBackupPath}"`;
    
    log.debug('Executing mysqldump', { backupId });
    
    try {
        // Step 1: Create backup locally
        await execAsync(finalCommand, {
            maxBuffer: 50 * 1024 * 1024,
            env: { ...process.env }
        });
        
        const stats = statSync(localBackupPath);
        const fileSize = stats.size;
        
        // Step 2: Calculate checksum
        const checksum = await calculateChecksum(localBackupPath);
        log.info('Checksum calculated', { backupId, checksum: checksum.substring(0, 16) + '...' });
        
        // Step 3: Determine final storage path and upload
        let finalPath: string;
        let storageType: string;
        let metadata: any = {
            id: backupId,
            dbType: 'mysql',
            dbName: dbConfig.database,
            backupType: backupType,
            size: fileSize,
            checksum: checksum,
            createdAt: new Date(),
            compression: options.compress ? 'gzip' : 'none'
        };
        
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
            const remotePath = prefix ? `${prefix}/${backupFileName}` : backupFileName;
            
            const uploadResult = await s3Provider.upload(localBackupPath, remotePath);
            
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
            
            const destPath = path.join(localPath, backupFileName);
            
            // Copy file to final destination
            const fs = require('fs');
            fs.copyFileSync(localBackupPath, destPath);
            
            finalPath = destPath;
            storageType = 'local';
            
            metadata.storage = {
                name: storageConfig.name || 'local-storage',
                type: 'local',
                path: localPath
            };
        }
        
        // ✅ Step 4: Save backup record to database with checksum
        await prisma.backupJob.update({
            where: { id: backupId },
            data: {
                status: 'success',
                filePath: finalPath,
                fileName: backupFileName,
                fileSize: fileSize,
                checksum: checksum, // ✅ Persist checksum to database
                completedAt: new Date(),
                duration: (Date.now() - startTime) / 1000,
                storageType: storageType,
                metadata: metadata
            }
        });
        
        const duration = (Date.now() - startTime) / 1000;
        
        log.info('MySQL backup completed', { 
            backupId, 
            size: fileSize, 
            duration, 
            storageType,
            checksum: checksum.substring(0, 16) + '...'
        });
        
        return {
            success: true,
            backupId,
            filePath: finalPath,
            fileSize: fileSize,
            duration,
            metadata
        };
        
    } catch (error) {
        // ✅ Step 5: Mark backup as failed in database
        log.error('MySQL backup failed', { backupId, error });
        
        await prisma.backupJob.update({
            where: { id: backupId },
            data: {
                status: 'failed',
                error: error instanceof Error ? error.message : String(error),
                completedAt: new Date(),
                duration: (Date.now() - startTime) / 1000
            }
        });
        
        throw new Error(`MySQL backup failed: ${error instanceof Error ? error.message : String(error)}`);
        
    } finally {
        // Step 6: Cleanup temp file (always runs)
        if (localBackupPath && existsSync(localBackupPath)) {
            try {
                unlinkSync(localBackupPath);
                log.debug('Temporary file cleaned up', { path: localBackupPath });
            } catch (cleanupError) {
                log.warn('Failed to cleanup temp file', { path: localBackupPath, error: cleanupError });
            }
        }
    }
}

app.listen(SERVICE_PORT, () => {
    log.info(`${SERVICE_NAME} listening on port ${SERVICE_PORT}`);
});

export default app;