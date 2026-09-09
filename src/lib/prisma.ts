/**
 * @deprecated This module is strictly internal to the Metadata Service.
 * Non-metadata services must NOT directly import Prisma or access SQLite.
 * Always interact with metadata via `MetadataClient` (`src/lib/metadata-client.ts`).
 */
import { prisma, connectDatabase, disconnectDatabase } from '../config/database';

export { prisma, connectDatabase, disconnectDatabase };
export default prisma;