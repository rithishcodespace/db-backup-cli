import { prisma } from '../config/database';

export class StorageRepository {
  async findById(id: string) {
    return prisma.storageLocation.findUnique({
      where: { id },
    });
  }

  async findByName(name: string) {
    return prisma.storageLocation.findUnique({
      where: { name },
    });
  }

  async findDefault() {
    return prisma.storageLocation.findFirst({
      where: { default: true },
    });
  }

  async findMany(where?: any) {
    return prisma.storageLocation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async count(where?: any): Promise<number> {
    return prisma.storageLocation.count({ where });
  }

  async create(data: any) {
    return prisma.storageLocation.create({ data });
  }

  async update(id: string, data: any) {
    return prisma.storageLocation.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return prisma.storageLocation.delete({
      where: { id },
    });
  }

  async clearDefaults(): Promise<void> {
    await prisma.storageLocation.updateMany({
      where: { default: true },
      data: { default: false },
    });
  }

  async setDefault(id: string) {
    await this.clearDefaults();
    return prisma.storageLocation.update({
      where: { id },
      data: { default: true },
    });
  }
}

export const storageRepository = new StorageRepository();
export default storageRepository;
