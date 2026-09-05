import 'dotenv/config';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../../generated/prisma/client';
import { env } from './env';

const adapter = new PrismaBetterSqlite3({
  url: env.DATABASE_URL,
});

export const prisma = new PrismaClient({
  adapter,
});

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export default prisma;
