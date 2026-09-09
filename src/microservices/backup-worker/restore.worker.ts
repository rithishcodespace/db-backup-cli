import { Job } from 'bullmq';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { metadataClient } from '../../lib/metadata-client';
import { createModuleLogger } from '../../logger';
import { S3StorageProvider } from '../storage-service/providers/s3';
import { AES256CryptoService } from '../../infrastructure/crypto/aes256-crypto.service';
import { GzipCompressionService } from '../../infrastructure/compression/gzip-compression.service';

const log = createModuleLogger('restore-worker');

const serviceRegistry: Record<string, string> = {
  postgresql: process.env.POSTGRES_SERVICE_URL || 'http://localhost:3010',
  mysql: process.env.MYSQL_SERVICE_URL || 'http://localhost:3011',
  mongodb: process.env.MONGODB_SERVICE_URL || 'http://localhost:3012',
  sqlite: process.env.SQLITE_SERVICE_URL || 'http://localhost:3013',
};

function getServiceUrl(dbType: string): string {
  const url = serviceRegistry[dbType];
  if (!url) {
    throw new Error(`Unsupported database type: ${dbType}`);
  }
  return url;
}

const cryptoService = new AES256CryptoService();
const compressionService = new GzipCompressionService();

export async function handleRestoreJob(job: Job): Promise<{ success: boolean; restoreId: string; duration: number }> {
  const { restoreId, backupId, filePath, dbConfig, options = {} } = job.data;
  const startTime = Date.now();

  log.info('Processing restore job', { restoreId, backupId, dbType: dbConfig?.type, database: dbConfig?.database });
  await metadataClient.addLog(backupId || restoreId, {
    level: 'INFO',
    message: `Restore operation started for ${dbConfig?.type}/${dbConfig?.database}`,
    details: `Restore ID: ${restoreId}`,
  });

  const temporaryFilesToClean: string[] = [];

  try {
    await job.updateProgress(10);

    let workingFilePath = filePath || '';
    let backupRecord: any = null;

    // 1. Resolve Backup Record from Metadata Service if backupId is provided
    if (backupId) {
      backupRecord = await metadataClient.getJob(backupId);
      if (!backupRecord) {
        throw new Error(`Backup with ID "${backupId}" not found in metadata service.`);
      }
      if (!workingFilePath) {
        workingFilePath = backupRecord.filePath || '';
      }
    }

    // 2. Download from S3 if storage is S3
    if (backupRecord && (backupRecord.storageType === 's3' || backupRecord.storageLocation?.type === 's3')) {
      const storageLocation = backupRecord.storageLocation;
      if (!storageLocation) {
        throw new Error('Backup storage location metadata is missing for S3 download.');
      }
      await job.updateProgress(20);
      await metadataClient.addLog(backupId, {
        level: 'INFO',
        message: 'Downloading backup artifact from cloud storage (S3)',
      });

      const s3Provider = new S3StorageProvider({
        type: 's3',
        bucket: storageLocation.bucket,
        region: storageLocation.region || 'us-east-1',
        accessKey: storageLocation.accessKey,
        secretKey: storageLocation.secretKey,
      });

      const tempDownloadPath = path.resolve(
        process.env.TEMP_DIR || './backups/temp',
        `restore_${restoreId}_${backupRecord.fileName || 'backup.dump'}`
      );
      fs.mkdirSync(path.dirname(tempDownloadPath), { recursive: true });

      await s3Provider.download(backupRecord.storagePath || backupRecord.fileName, tempDownloadPath);
      workingFilePath = tempDownloadPath;
      temporaryFilesToClean.push(tempDownloadPath);
    }

    if (!workingFilePath || !fs.existsSync(workingFilePath)) {
      throw new Error(`Backup file not found at path: ${workingFilePath}`);
    }

    await job.updateProgress(35);

    // 3. Verify Checksum
    if (backupRecord?.checksum && !options.skipChecksum) {
      log.info('Verifying backup checksum', { expectedChecksum: backupRecord.checksum });
      const hash = crypto.createHash('sha256');
      const fileStream = fs.createReadStream(workingFilePath);
      for await (const chunk of fileStream) {
        hash.update(chunk);
      }
      const actualChecksum = hash.digest('hex');

      if (actualChecksum !== backupRecord.checksum) {
        throw new Error(`Checksum mismatch. Expected ${backupRecord.checksum}, computed ${actualChecksum}.`);
      }
      await metadataClient.addLog(backupId, {
        level: 'INFO',
        message: 'Checksum verification passed',
      });
    }

    // 4. Decrypt if Encrypted
    const isEncrypted = Boolean(backupRecord?.encrypted || options.key);
    if (isEncrypted) {
      const key = options.key || process.env.BACKUP_ENCRYPTION_KEY;
      if (!key) {
        throw new Error('Backup is encrypted, but no decryption key was provided.');
      }

      const decryptedPath = path.resolve(
        path.dirname(workingFilePath),
        `decrypted_${path.basename(workingFilePath).replace(/\.enc$/, '')}`
      );

      const encMeta = backupRecord?.encryptionMetadata || {};
      await cryptoService.decryptFile(workingFilePath, decryptedPath, key, encMeta.iv, encMeta.tag);
      workingFilePath = decryptedPath;
      temporaryFilesToClean.push(decryptedPath);

      await metadataClient.addLog(backupId || restoreId, {
        level: 'INFO',
        message: 'Backup decrypted successfully',
      });
    }

    // 5. Decompress if Compressed (.gz)
    const isCompressed = compressionService.isCompressed(workingFilePath);
    if (isCompressed) {
      const decompressedPath = path.resolve(
        path.dirname(workingFilePath),
        `decompressed_${path.basename(workingFilePath).replace(/\.gz$/, '')}`
      );

      await compressionService.decompressFile(workingFilePath, decompressedPath);
      workingFilePath = decompressedPath;
      temporaryFilesToClean.push(decompressedPath);

      await metadataClient.addLog(backupId || restoreId, {
        level: 'INFO',
        message: 'Backup decompressed successfully',
      });
    }

    await job.updateProgress(50);

    // 6. Dispatch restore to database-specific microservice
    const serviceUrl = getServiceUrl(dbConfig.type);
    log.info(`Dispatching restore to ${dbConfig.type} service at ${serviceUrl}/restore`);
    await metadataClient.addLog(backupId || restoreId, {
      level: 'INFO',
      message: `Executing database restore via ${dbConfig.type} worker service`,
    });

    const response = await axios.post(
      `${serviceUrl}/restore`,
      {
        dbConfig,
        backupFilePath: workingFilePath,
        options,
      },
      {
        timeout: 3600000, // 1 hour timeout for large restores
      }
    );

    if (!response.data || !response.data.success) {
      throw new Error(response.data?.error || `${dbConfig.type} restore execution failed`);
    }

    const duration = (Date.now() - startTime) / 1000;
    await job.updateProgress(100);

    await metadataClient.addLog(backupId || restoreId, {
      level: 'INFO',
      message: `Restore completed successfully in ${duration.toFixed(2)}s`,
    });

    log.info('Restore job completed successfully', { restoreId, duration });
    return { success: true, restoreId, duration };
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('Restore job failed', { restoreId, error: errorMsg });

    await metadataClient.addLog(backupId || restoreId, {
      level: 'ERROR',
      message: `Restore failed: ${errorMsg}`,
    });

    throw error;
  } finally {
    // Clean up temporary working files
    for (const tempFile of temporaryFilesToClean) {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
          log.debug('Cleaned temporary restore file', { path: tempFile });
        }
      } catch (cleanupErr: any) {
        log.warn('Failed to delete temporary restore file', { path: tempFile, error: cleanupErr?.message });
      }
    }
  }
}
