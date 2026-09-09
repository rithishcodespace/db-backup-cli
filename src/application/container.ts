import { config } from '../config';
import { prismaBackupRepository } from '../infrastructure/repositories/prisma-backup.repository';
import { cryptoService } from '../infrastructure/crypto/aes256-crypto.service';
import { compressionService } from '../infrastructure/compression/gzip-compression.service';
import { databaseAdapterFactory } from '../infrastructure/database/database-adapter.factory';
import { keyManager } from '../lib/key-manager';
import httpClient from '../utils/http-client';

import { ConnectUseCase } from './use-cases/connect.use-case';
import { BackupUseCase } from './use-cases/backup.use-case';
import { RestoreUseCase } from './use-cases/restore.use-case';
import { ListBackupsUseCase } from './use-cases/list-backups.use-case';

export interface AppContainer {
  connectUseCase: ConnectUseCase;
  backupUseCase: BackupUseCase;
  restoreUseCase: RestoreUseCase;
  listBackupsUseCase: ListBackupsUseCase;
  cryptoService: typeof cryptoService;
  compressionService: typeof compressionService;
  adapterFactory: typeof databaseAdapterFactory;
  backupRepo: typeof prismaBackupRepository;
}

export function createContainer(): AppContainer {
  return {
    connectUseCase: new ConnectUseCase(databaseAdapterFactory, config),
    backupUseCase: new BackupUseCase(config, prismaBackupRepository, cryptoService, keyManager, httpClient),
    restoreUseCase: new RestoreUseCase(config, prismaBackupRepository, cryptoService, compressionService, databaseAdapterFactory, keyManager),
    listBackupsUseCase: new ListBackupsUseCase(prismaBackupRepository),
    cryptoService,
    compressionService,
    adapterFactory: databaseAdapterFactory,
    backupRepo: prismaBackupRepository,
  };
}

export const container = createContainer();
