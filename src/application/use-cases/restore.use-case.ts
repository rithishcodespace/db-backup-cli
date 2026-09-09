import path from 'path';
import os from 'os';
import { existsSync, unlinkSync } from 'fs';
import { RestoreRequestInputDTO, RestoreExecutionResultDTO } from '../dto';
import { IBackupRepository } from '../../domain/interfaces/backup-repository.interface';
import { ICryptoService } from '../../domain/interfaces/crypto-service.interface';
import { ICompressionService } from '../../domain/interfaces/compression-service.interface';
import { DatabaseAdapterFactory } from '../../infrastructure/database/database-adapter.factory';
import { StorageProviderFactory } from '../../infrastructure/storage/storage-provider.factory';
import { IConfigStore } from './connect.use-case';
import {
  RestoreExecutionError,
  ChecksumMismatchError,
  ConfigurationError,
} from '../../domain/errors';
import { createModuleLogger } from '../../logger';

const log = createModuleLogger('restore-use-case');

export interface IKeyManagerReadonly {
  getKey(name: string): { key: string } | null;
}

export class RestoreUseCase {
  constructor(
    private readonly configStore: IConfigStore,
    private readonly backupRepo: IBackupRepository,
    private readonly cryptoService: ICryptoService,
    private readonly compressionService: ICompressionService,
    private readonly adapterFactory: DatabaseAdapterFactory,
    private readonly keyManager: IKeyManagerReadonly,
    private readonly httpClient?: any,
    private readonly gatewayUrl?: string
  ) {}

  async execute(input: RestoreRequestInputDTO): Promise<RestoreExecutionResultDTO> {
    const startTime = Date.now();
    const tempFilesToClean: string[] = [];

    if (!input.backupId && !input.filePath) {
      throw new RestoreExecutionError('Either --id <backupId> or direct file path is required for restore.');
    }

    try {
      let backupRecord: any = null;
      let workingFilePath: string = input.filePath || '';

      // 1. Resolve Backup Record if ID is provided
      if (input.backupId) {
        backupRecord = await this.backupRepo.findJobById(input.backupId);
        if (!backupRecord) {
          throw new RestoreExecutionError(`Backup with ID "${input.backupId}" not found.`);
        }

        // 2. Download from S3 if needed
        if (backupRecord.storageType === 's3' || backupRecord.storageLocation?.type === 's3') {
          const storageLocation = backupRecord.storageLocation;
          if (!storageLocation) {
            throw new RestoreExecutionError('Backup storage location metadata is missing for S3 download.');
          }

          const storageProvider = StorageProviderFactory.create(storageLocation);
          await storageProvider.initialize();

          const tempDownloadPath = path.join(
            os.tmpdir(),
            `db-backup-download-${Date.now()}-${backupRecord.fileName || 'backup.bin'}`
          );
          tempFilesToClean.push(tempDownloadPath);

          const remotePath = backupRecord.storagePath || backupRecord.fileName;
          log.info('Downloading backup artifact from cloud storage', { remotePath });

          await storageProvider.download(remotePath, tempDownloadPath);
          workingFilePath = tempDownloadPath;
        } else {
          // Local storage resolution
          if (!workingFilePath) {
            workingFilePath = backupRecord.filePath || '';
            if (!workingFilePath && backupRecord.fileName) {
              const localBase = this.configStore.get('storage.localPath') || './backups/local';
              workingFilePath = path.join(localBase, backupRecord.fileName);
            }
          }
        }
      }

      if (!workingFilePath || !existsSync(workingFilePath)) {
        throw new RestoreExecutionError(`Backup file not found at path: ${workingFilePath}`);
      }

      // 3. Handle Encryption Check
      const isEncrypted =
        backupRecord?.encrypted ||
        workingFilePath.endsWith('.enc') ||
        Boolean(input.key);

      // 4. Verify Checksum (if recorded, not skipped, and not encrypted)
      if (!input.skipChecksum && backupRecord?.checksum && !isEncrypted) {
        log.debug('Verifying artifact SHA-256 checksum');
        const calculatedChecksum = await this.cryptoService.calculateChecksum(workingFilePath);
        if (calculatedChecksum !== backupRecord.checksum) {
          throw new ChecksumMismatchError(backupRecord.checksum, calculatedChecksum);
        }
        log.info('Checksum verification passed', { checksum: calculatedChecksum });
      }

      // 5. Handle Decryption
      if (isEncrypted) {
        let decKey = input.key;
        if (!decKey && input.backupId) {
          const keyEntry = this.keyManager.getKey(input.backupId);
          if (keyEntry) {
            decKey = keyEntry.key;
          }
        }

        if (!decKey) {
          throw new ConfigurationError('This backup is encrypted. Please provide an encryption key via --key <hex>.');
        }

        const iv = backupRecord?.encryptionIv || '';
        const tag = backupRecord?.encryptionTag || '';

        const decryptedPath = path.join(
          os.tmpdir(),
          `db-backup-decrypted-${Date.now()}-${path.basename(workingFilePath, '.enc')}`
        );
        tempFilesToClean.push(decryptedPath);

        log.info('Decrypting backup artifact');
        await this.cryptoService.decryptFile(workingFilePath, decryptedPath, decKey, iv, tag);
        workingFilePath = decryptedPath;
      }

      // 5. Handle Decompression
      if (this.compressionService.isCompressed(workingFilePath)) {
        const decompressedPath = path.join(
          os.tmpdir(),
          `db-backup-decompressed-${Date.now()}-${path.basename(workingFilePath).replace(/\.gz$/, '')}`
        );
        tempFilesToClean.push(decompressedPath);

        log.info('Decompressing backup archive');
        await this.compressionService.decompressFile(workingFilePath, decompressedPath);
        workingFilePath = decompressedPath;
      }

      // 6. Dry Run Check
      if (input.dryRun) {
        return {
          success: true,
          backupId: input.backupId,
          message: 'Dry run completed successfully. Verification, decryption, and decompression passed.',
          duration: (Date.now() - startTime) / 1000,
        };
      }

      // 7. Resolve Target Database Configuration
      const activeDbConfig = this.configStore.get('database');
      if (!activeDbConfig) {
        throw new ConfigurationError('No active database configuration found. Please run connect first.');
      }

      const targetDbConfig = {
        ...activeDbConfig,
        database: input.database || activeDbConfig.database,
      };

      const dbType = backupRecord?.dbType || targetDbConfig.type;

      // When running via Gateway (CLI mode), delegate execution to asynchronous queue worker
      if (this.httpClient && this.gatewayUrl) {
        log.info('Dispatching restore request to API gateway', {
          gatewayUrl: this.gatewayUrl,
          backupId: input.backupId,
          filePath: workingFilePath,
          dbType,
        });

        const restoreResponse = await this.httpClient.post(`${this.gatewayUrl}/api/restore`, {
          dbConfig: targetDbConfig,
          backupId: input.backupId,
          filePath: workingFilePath,
          options: {
            clean: input.clean !== false,
            ifExists: input.ifExists !== false,
            dryRun: false,
            key: input.key,
            skipChecksum: input.skipChecksum,
            tables: input.tables,
          },
        });

        if (!restoreResponse.data || !restoreResponse.data.success) {
          throw new RestoreExecutionError(restoreResponse.data?.error || 'Restore request rejected by gateway');
        }

        const restoreId = restoreResponse.data.restoreId;
        let jobData = restoreResponse.data;

        // Poll restore status until finished
        const maxAttempts = 120;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise((r) => setTimeout(r, 1000));
          try {
            const statusRes = await this.httpClient.get(`${this.gatewayUrl}/api/restore/${encodeURIComponent(restoreId)}/status`);
            if (statusRes.data && statusRes.data.status && !['waiting', 'active', 'delayed', 'queued'].includes(statusRes.data.status)) {
              jobData = statusRes.data;
              break;
            }
          } catch {
            // Ignore transient status polling errors
          }
        }

        if (jobData.status === 'failed' || jobData.error) {
          throw new RestoreExecutionError(jobData.error || 'Restore job failed during queue execution');
        }

        return {
          success: true,
          backupId: input.backupId,
          message: 'Database restore completed successfully via queue worker.',
          duration: (Date.now() - startTime) / 1000,
        };
      }

      const adapter = this.adapterFactory.getAdapter(dbType);

      log.info('Executing database restore via adapter', {
        dbType,
        database: targetDbConfig.database,
      });

      const restoreResult = await adapter.restore({
        backupFilePath: workingFilePath,
        dbConfig: targetDbConfig,
        tables: input.tables,
        clean: input.clean !== false,
        ifExists: input.ifExists !== false,
        singleTransaction: input.singleTransaction,
        targetDir: input.target,
        backupRecord,
      });

      return {
        success: true,
        backupId: input.backupId,
        message: restoreResult.message || 'Database restore completed successfully.',
        duration: (Date.now() - startTime) / 1000,
        details: restoreResult.details,
      };
    } finally {
      // 8. Safely Clean Up All Temporary Staging Files
      for (const f of tempFilesToClean) {
        try {
          if (existsSync(f)) {
            unlinkSync(f);
          }
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }
}
