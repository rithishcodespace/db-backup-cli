import { prisma } from '../../lib/prisma';
import { IBackupRepository } from '../../domain/interfaces/backup-repository.interface';
import { BackupJobModel, StorageLocationModel } from '../../domain/models';

export class PrismaBackupRepository implements IBackupRepository {
  constructor(private readonly prismaClient: any = prisma) {}

  async findJobById(id: string): Promise<BackupJobModel | null> {
    const job = await this.prismaClient.backupJob.findUnique({
      where: { id },
      include: { storageLocation: true },
    });
    return (job as unknown as BackupJobModel) || null;
  }

  async findManyJobs(params?: {
    where?: any;
    take?: number;
    skip?: number;
    orderBy?: any;
  }): Promise<BackupJobModel[]> {
    const jobs = await this.prismaClient.backupJob.findMany({
      where: params?.where,
      take: params?.take,
      skip: params?.skip,
      orderBy: params?.orderBy || { startedAt: 'desc' },
      include: { storageLocation: true },
    });
    return jobs as unknown as BackupJobModel[];
  }

  async createJob(data: any): Promise<BackupJobModel> {
    const job = await this.prismaClient.backupJob.create({ data });
    return job as unknown as BackupJobModel;
  }

  async updateJob(id: string, data: any): Promise<BackupJobModel> {
    const job = await this.prismaClient.backupJob.update({
      where: { id },
      data,
    });
    return job as unknown as BackupJobModel;
  }

  async findStorageByName(name: string): Promise<StorageLocationModel | null> {
    const storage = await this.prismaClient.storageLocation.findUnique({
      where: { name },
    });
    return (storage as unknown as StorageLocationModel) || null;
  }

  async findDefaultStorage(): Promise<StorageLocationModel | null> {
    const storage = await this.prismaClient.storageLocation.findFirst({
      where: { default: true, enabled: true },
    });
    return (storage as unknown as StorageLocationModel) || null;
  }

  async listStorages(enabledOnly = true): Promise<StorageLocationModel[]> {
    const storages = await this.prismaClient.storageLocation.findMany({
      where: enabledOnly ? { enabled: true } : undefined,
    });
    return storages as unknown as StorageLocationModel[];
  }
}

export const prismaBackupRepository = new PrismaBackupRepository();
