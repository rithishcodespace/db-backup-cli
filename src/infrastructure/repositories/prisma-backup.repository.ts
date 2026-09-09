import { metadataClient, MetadataClient } from '../../lib/metadata-client';
import { IBackupRepository } from '../../domain/interfaces/backup-repository.interface';
import { BackupJobModel, StorageLocationModel } from '../../domain/models';

export class PrismaBackupRepository implements IBackupRepository {
  constructor(private readonly client: MetadataClient = metadataClient) {}

  async findJobById(id: string): Promise<BackupJobModel | null> {
    const job = await this.client.getJob(id);
    return (job as unknown as BackupJobModel) || null;
  }

  async findManyJobs(params?: {
    where?: any;
    take?: number;
    skip?: number;
    orderBy?: any;
  }): Promise<BackupJobModel[]> {
    const res = await this.client.listJobs({
      status: params?.where?.status,
      dbType: params?.where?.dbType,
      dbName: params?.where?.dbName,
      take: params?.take,
      skip: params?.skip,
      orderBy: params?.orderBy?.startedAt === 'asc' ? 'asc' : 'desc',
    });
    return (res.jobs || []) as unknown as BackupJobModel[];
  }

  async createJob(data: any): Promise<BackupJobModel> {
    const job = await this.client.createJob(data);
    return job as unknown as BackupJobModel;
  }

  async updateJob(id: string, data: any): Promise<BackupJobModel> {
    const job = await this.client.updateJob(id, data);
    return job as unknown as BackupJobModel;
  }

  async findStorageByName(name: string): Promise<StorageLocationModel | null> {
    const storage = await this.client.getStorage(name);
    return (storage as unknown as StorageLocationModel) || null;
  }

  async findDefaultStorage(): Promise<StorageLocationModel | null> {
    const storage = await this.client.getDefaultStorage();
    return (storage as unknown as StorageLocationModel) || null;
  }

  async listStorages(enabledOnly = true): Promise<StorageLocationModel[]> {
    const storages = await this.client.listStorage(enabledOnly);
    return (storages || []) as unknown as StorageLocationModel[];
  }
}

export const prismaBackupRepository = new PrismaBackupRepository();
