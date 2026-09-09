import { metadataClient, MetadataClient } from '../lib/metadata-client';

export class StorageRepository {
  constructor(private readonly client: MetadataClient = metadataClient) {}

  async findById(id: string) {
    return this.client.getStorage(id);
  }

  async findByName(name: string) {
    return this.client.getStorage(name);
  }

  async findDefault() {
    return this.client.getDefaultStorage();
  }

  async findMany(where?: any) {
    return this.client.listStorage(where?.enabled);
  }

  async count(where?: any): Promise<number> {
    return this.client.countStorage(where);
  }

  async create(data: any) {
    return this.client.createStorage(data);
  }

  async update(id: string, data: any) {
    return this.client.updateStorage(id, data);
  }

  async delete(id: string) {
    return this.client.deleteStorage(id);
  }

  async clearDefaults(): Promise<void> {
    const storages = await this.client.listStorage();
    for (const s of storages) {
      if (s.default) {
        await this.client.updateStorage(s.id, { default: false });
      }
    }
  }

  async setDefault(id: string) {
    return this.client.setDefaultStorage(id);
  }
}

export const storageRepository = new StorageRepository();
export default storageRepository;
