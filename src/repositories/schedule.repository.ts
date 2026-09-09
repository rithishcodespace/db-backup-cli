import { metadataClient, MetadataClient } from '../lib/metadata-client';

export class ScheduleRepository {
  constructor(private readonly client: MetadataClient = metadataClient) {}

  async findById(id: string) {
    return this.client.getSchedule(id);
  }

  async findMany(where?: any) {
    return this.client.listSchedules(where?.enabled);
  }

  async count(where?: any): Promise<number> {
    return this.client.countSchedules(where);
  }

  async create(data: any) {
    return this.client.createSchedule(data);
  }

  async update(id: string, data: any) {
    return this.client.updateSchedule(id, data);
  }

  async delete(id: string) {
    return this.client.deleteSchedule(id);
  }
}

export const scheduleRepository = new ScheduleRepository();
export default scheduleRepository;
