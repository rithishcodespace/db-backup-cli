import { prisma } from '../config/database';

export interface NotificationConfigData {
  enabled?: boolean;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUser?: string | null;
  smtpPassword?: string | null;
  from?: string | null;
  to?: string | null;
  webhook?: string | null;
  [key: string]: any;
}

export class NotificationRepository {
  async findByType(type: string) {
    return prisma.notificationConfig.findUnique({
      where: { type },
    });
  }

  async findMany(where?: any) {
    return prisma.notificationConfig.findMany({
      where,
    });
  }

  async count(where?: any): Promise<number> {
    return prisma.notificationConfig.count({ where });
  }

  async upsert(type: string, data: NotificationConfigData) {
    const { enabled = true, ...fields } = data;
    return prisma.notificationConfig.upsert({
      where: { type },
      update: {
        ...fields,
        enabled,
      },
      create: {
        type,
        enabled,
        ...fields,
      },
    });
  }

  async delete(type: string) {
    return prisma.notificationConfig.delete({
      where: { type },
    });
  }
}

export const notificationRepository = new NotificationRepository();
export default notificationRepository;
