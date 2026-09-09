import { BackupJobModel, StorageLocationModel } from '../models';

export interface IBackupRepository {
  findJobById(id: string): Promise<BackupJobModel | null>;
  findManyJobs(params?: {
    where?: any;
    take?: number;
    skip?: number;
    orderBy?: any;
  }): Promise<BackupJobModel[]>;
  createJob(data: any): Promise<BackupJobModel>;
  updateJob(id: string, data: any): Promise<BackupJobModel>;
  findStorageByName(name: string): Promise<StorageLocationModel | null>;
  findDefaultStorage(): Promise<StorageLocationModel | null>;
  listStorages(enabledOnly?: boolean): Promise<StorageLocationModel[]>;
}
