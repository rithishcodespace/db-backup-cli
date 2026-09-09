import { metadataClient, MetadataClient } from '../lib/metadata-client';

export class BackupRepository {
  constructor(private readonly client: MetadataClient = metadataClient) {}

  async findActiveJobs() {
    return this.client.getActiveJobs();
  }

  async findJobById(id: string) {
    return this.client.getJob(id);
  }

  async findManyJobs(params: {
    where?: any;
    take?: number;
    skip?: number;
    orderBy?: any;
    include?: any;
  }) {
    const result = await this.client.listJobs({
      status: params.where?.status?.in || params.where?.status,
      dbType: params.where?.dbType,
      dbName: params.where?.dbName,
      since: params.where?.startedAt?.gte,
      take: params.take,
      skip: params.skip,
      orderBy: params.orderBy?.startedAt === 'asc' ? 'asc' : 'desc',
    });
    return result.jobs;
  }

  async countJobs(where?: any): Promise<number> {
    return this.client.countJobs(where);
  }

  async createJob(data: any) {
    return this.client.createJob(data);
  }

  async updateJob(id: string, data: any) {
    return this.client.updateJob(id, data);
  }

  async findLogs(params: { where?: any; take?: number; orderBy?: any }) {
    return this.client.getLogs({
      backupJobId: params.where?.backupJobId,
      level: params.where?.level,
      take: params.take,
    });
  }

  async createLog(data: any) {
    return this.client.addLog(data.backupJobId, {
      level: data.level,
      message: data.message,
      details: data.details,
    });
  }

  async countJobsSince(sinceDate: Date, statusList?: string[]): Promise<number> {
    return this.client.countJobs({
      startedAt: { gte: sinceDate },
      status: statusList ? { in: statusList } : undefined,
    });
  }

  async findRecentFailedJobs(sinceDate: Date, limit = 5) {
    const res = await this.client.listJobs({
      status: ['FAILED', 'failed'],
      since: sinceDate,
      take: limit,
      orderBy: 'desc',
    });
    return res.jobs;
  }
}

export const backupRepository = new BackupRepository();
export default backupRepository;
