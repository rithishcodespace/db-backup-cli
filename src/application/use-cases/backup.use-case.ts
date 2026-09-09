import { BackupRequestInputDTO, BackupExecutionResultDTO } from '../dto';
import { IBackupRepository } from '../../domain/interfaces/backup-repository.interface';
import { ICryptoService } from '../../domain/interfaces/crypto-service.interface';
import { IConfigStore } from './connect.use-case';
import { ConfigurationError, StorageNotFoundError, BackupExecutionError } from '../../domain/errors';
import { createModuleLogger } from '../../logger';

const log = createModuleLogger('backup-use-case');

export interface IHttpClient {
  post(url: string, data?: any, config?: any): Promise<any>;
  get(url: string, config?: any): Promise<any>;
}

export interface IKeystoreService {
  addKey(name: string, key: string, database?: string, dbType?: string): void;
  deleteKey(name: string): boolean;
  getKey(name: string): any;
}

export class BackupUseCase {
  constructor(
    private readonly configStore: IConfigStore,
    private readonly backupRepo: IBackupRepository,
    private readonly cryptoService: ICryptoService,
    private readonly keystore: IKeystoreService,
    private readonly httpClient: IHttpClient,
    private readonly gatewayUrl: string = process.env.GATEWAY_URL || 'http://localhost:3000'
  ) {}

  async execute(input: BackupRequestInputDTO): Promise<BackupExecutionResultDTO> {
    const dbConfig = this.configStore.get('database');
    if (!dbConfig) {
      throw new ConfigurationError('No database configuration found. Please run connect first.');
    }

    // Resolve storage configuration
    let storageConfig: any = null;
    let storageLocationId: string | null = null;

    if (input.storage) {
      const storage = await this.backupRepo.findStorageByName(input.storage);
      if (!storage) {
        throw new StorageNotFoundError(input.storage);
      }
      storageLocationId = storage.id;
      const cfg = storage.config || {};
      if (storage.type === 's3') {
        storageConfig = {
          type: 's3',
          name: storage.name,
          bucket: storage.bucket,
          region: storage.region,
          accessKey: storage.accessKey,
          secretKey: storage.secretKey,
          prefix: cfg.prefix || '',
        };
      } else {
        storageConfig = {
          type: 'local',
          name: storage.name,
          basePath: cfg.basePath || input.output || this.configStore.get('storage.localPath'),
        };
      }
    } else {
      const defaultStorage = await this.backupRepo.findDefaultStorage();
      if (defaultStorage) {
        storageLocationId = defaultStorage.id;
        const cfg = defaultStorage.config || {};
        if (defaultStorage.type === 's3') {
          storageConfig = {
            type: 's3',
            name: defaultStorage.name,
            bucket: defaultStorage.bucket,
            region: defaultStorage.region,
            accessKey: defaultStorage.accessKey,
            secretKey: defaultStorage.secretKey,
            prefix: cfg.prefix || '',
          };
        } else {
          storageConfig = {
            type: 'local',
            name: defaultStorage.name,
            basePath: cfg.basePath || input.output || this.configStore.get('storage.localPath'),
          };
        }
      } else {
        storageConfig = {
          type: 'local',
          name: 'local',
          basePath: input.output || this.configStore.get('storage.localPath') || './backups/local',
        };
      }
    }

    // Handle Encryption Key
    let encryptionKey: string | null = null;
    const storeKey = !input.noStoreKey;

    if (input.encrypt) {
      if (input.key) {
        if (!this.cryptoService.validateKey(input.key)) {
          throw new ConfigurationError('Encryption key must be 64 hexadecimal characters (32 bytes)');
        }
        encryptionKey = input.key;
      } else {
        encryptionKey = this.cryptoService.generateKey();
      }

      if (storeKey) {
        this.keystore.addKey('pending', encryptionKey, dbConfig.database, dbConfig.type);
      }
    }

    const effectiveType = input.incremental ? 'incremental' : input.type || 'full';
    const backupRequest = {
      dbConfig,
      backupType: effectiveType,
      options: {
        compress: input.compress !== false,
        tables: input.tables,
        excludeTables: input.excludeTables,
        outputPath: input.output || this.configStore.get('storage.localPath'),
        backupName: input.name,
        storage: storageConfig,
        storageLocationId,
        encrypt: input.encrypt || false,
        encryptionKey,
        storeKey,
        parentBackupId: input.parentId,
        physical: input.physical || false,
      },
    };

    log.debug('Dispatching backup request to API gateway', {
      gatewayUrl: this.gatewayUrl,
      dbType: dbConfig.type,
      storage: storageConfig.type,
    });

    const response = await this.httpClient.post(`${this.gatewayUrl}/api/backup`, backupRequest);

    if (!response.data || !response.data.success) {
      throw new BackupExecutionError(response.data?.error || 'Backup request rejected by gateway');
    }

    const backupId = response.data.backupId;
    let jobData = response.data;

    if (response.data.queued && !input.async) {
      const maxAttempts = 60;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const statusRes = await this.httpClient.get(`${this.gatewayUrl}/api/backup/${backupId}/status`);
          if (statusRes.data && statusRes.data.status && !['running', 'queued'].includes(statusRes.data.status)) {
            jobData = statusRes.data;
            break;
          }
        } catch {
          // ignore status polling transient errors
        }
      }
    }

    if (jobData.status === 'failed' || jobData.error) {
      if (input.encrypt && storeKey) {
        this.keystore.deleteKey('pending');
      }
      throw new BackupExecutionError(jobData.error || 'Backup job failed during execution');
    }

    if (input.encrypt && storeKey && encryptionKey) {
      this.keystore.addKey(backupId, encryptionKey, dbConfig.database, dbConfig.type);
      this.keystore.deleteKey('pending');
    }

    return {
      success: true,
      backupId,
      filePath: jobData.filePath,
      fileName: jobData.fileName,
      fileSize: jobData.fileSize,
      duration: jobData.duration,
      status: jobData.status || (response.data.queued ? 'queued' : 'success'),
      queued: response.data.queued,
    };
  }
}
