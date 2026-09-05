import { prisma } from '../config/database';

export class BackupRepository {
  async findActiveJobs() {
    return prisma.backupJob.findMany({
      where: { status: { in: ['running', 'RUNNING', 'pending', 'PENDING'] } },
      include: { storageLocation: true },
      orderBy: { startedAt: 'desc' },
    });
  }

  async findJobById(id: string) {
    return prisma.backupJob.findUnique({
      where: { id },
      include: { storageLocation: true },
    });
  }

  async findManyJobs(params: {
    where?: any;
    take?: number;
    skip?: number;
    orderBy?: any;
    include?: any;
  }) {
    return prisma.backupJob.findMany({
      where: params.where,
      take: params.take,
      skip: params.skip,
      orderBy: params.orderBy || { startedAt: 'desc' },
      include: params.include ?? { storageLocation: true },
    });
  }

  async countJobs(where?: any): Promise<number> {
    return prisma.backupJob.count({ where });
  }

  async createJob(data: any) {
    return prisma.backupJob.create({ data });
  }

  async updateJob(id: string, data: any) {
    return prisma.backupJob.update({
      where: { id },
      data,
    });
  }

  async findLogs(params: { where?: any; take?: number; orderBy?: any }) {
    return prisma.backupLog.findMany({
      where: params.where,
      take: params.take,
      orderBy: params.orderBy || { timestamp: 'desc' },
    });
  }

  async createLog(data: any) {
    return prisma.backupLog.create({ data });
  }

  async countJobsSince(sinceDate: Date, statusList?: string[]): Promise<number> {
    const where: any = { startedAt: { gte: sinceDate } };
    if (statusList && statusList.length > 0) {
      where.status = { in: statusList };
    }
    return prisma.backupJob.count({ where });
  }

  async findRecentFailedJobs(sinceDate: Date, limit = 5) {
    return prisma.backupJob.findMany({
      where: {
        status: { in: ['FAILED', 'failed'] },
        startedAt: { gte: sinceDate },
      },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }
}

export const backupRepository = new BackupRepository();
export default backupRepository;
