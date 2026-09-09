import { IStorageProvider } from '../../domain/interfaces/storage-provider.interface';
import { LocalStorageProvider } from '../../microservices/storage-service/providers/local';
import { S3StorageProvider } from '../../microservices/storage-service/providers/s3';
import { StorageLocationModel } from '../../domain/models';
import { StorageError } from '../../domain/errors';

export class StorageProviderFactory {
  static create(storageConfig: Partial<StorageLocationModel>): IStorageProvider {
    const type = (storageConfig.type || 'local').toLowerCase();

    if (type === 's3') {
      const configJson = storageConfig.config || {};
      return new S3StorageProvider({
        type: 's3',
        bucket: storageConfig.bucket || '',
        region: storageConfig.region || 'us-east-1',
        accessKeyId: storageConfig.accessKey || process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: storageConfig.secretKey || process.env.AWS_SECRET_ACCESS_KEY || '',
        prefix: storageConfig.prefix || configJson.prefix || '',
      });
    }

    if (type === 'local') {
      const configJson = storageConfig.config || {};
      const basePath = storageConfig.basePath || configJson.basePath || './backups';
      return new LocalStorageProvider(basePath);
    }

    throw new StorageError(`Unsupported storage type: ${storageConfig.type}`);
  }
}
