import { prisma } from '../config/database';

export class ScheduleRepository {
  async findById(id: string) {
    return prisma.backupSchedule.findUnique({
      where: { id },
    });
  }

  async findMany(where?: any) {
    return prisma.backupSchedule.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async count(where?: any): Promise<number> {
    return prisma.backupSchedule.count({ where });
  }

  async create(data: any) {
    return prisma.backupSchedule.create({ data });
  }

  async update(id: string, data: any) {
    return prisma.backupSchedule.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return prisma.backupSchedule.delete({
      where: { id },
    });
  }
}

export const scheduleRepository = new ScheduleRepository();
export default scheduleRepository;
