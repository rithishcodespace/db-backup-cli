import { metadataClient, MetadataClient } from '../lib/metadata-client';

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
  constructor(private readonly client: MetadataClient = metadataClient) {}

  async findByType(type: string) {
    return this.client.getNotificationConfig(type);
  }

  async findMany(_where?: any) {
    return this.client.listNotificationConfigs();
  }

  async count(_where?: any): Promise<number> {
    return this.client.countNotificationConfigs();
  }

  async upsert(type: string, data: NotificationConfigData) {
    return this.client.upsertNotificationConfig(type, data);
  }

  async delete(type: string) {
    return this.client.deleteNotificationConfig(type);
  }
}

export const notificationRepository = new NotificationRepository();
export default notificationRepository;
