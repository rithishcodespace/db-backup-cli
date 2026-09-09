import 'dotenv/config';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../../generated/prisma/client';
import { env } from './env';
import { createModuleLogger } from '../logger';

const log = createModuleLogger('database-config');

const adapter = new PrismaBetterSqlite3({
  url: env.DATABASE_URL,
});

export const prisma = new PrismaClient({
  adapter,
});

/**
 * Connect to metadata SQLite database and apply resilient locking pragmas.
 * Note: Database access is encapsulated behind one service boundary (Metadata Service),
 * reducing concurrent file access and making transaction/locking behavior centrally controllable.
 */
export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  try {
    // Encapsulate SQLite configuration behind this service boundary
    await prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL;');
    await prisma.$executeRawUnsafe('PRAGMA busy_timeout = 5000;');
    await prisma.$executeRawUnsafe('PRAGMA synchronous = NORMAL;');
    log.debug('SQLite database connected with WAL and 5000ms busy_timeout');
  } catch (err) {
    // Non-fatal if pragmas not supported by the environment
    log.debug('Pragma initialization skipped or failed', { error: (err as any)?.message });
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export default prisma;
