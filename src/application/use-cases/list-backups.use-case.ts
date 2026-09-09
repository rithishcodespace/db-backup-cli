import { ListBackupsInputDTO } from '../dto';
import { IBackupRepository } from '../../domain/interfaces/backup-repository.interface';
import { BackupJobModel } from '../../domain/models';

export class ListBackupsUseCase {
  constructor(private readonly backupRepo: IBackupRepository) {}

  async execute(input: ListBackupsInputDTO = {}): Promise<BackupJobModel[]> {
    const where: any = {};

    if (input.type) {
      where.backupType = input.type;
    }

    if (input.database) {
      where.dbName = input.database;
    }

    if (input.status) {
      where.status = input.status;
    }

    const limit = input.limit ? Math.min(input.limit, 500) : 50;

    return this.backupRepo.findManyJobs({
      where,
      take: limit,
      orderBy: { startedAt: 'desc' },
    });
  }
}
