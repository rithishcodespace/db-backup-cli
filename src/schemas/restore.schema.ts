import * as v from 'valibot';
import { DatabaseConfigSchema } from './backup.schema';

/**
 * Restore execution options schema
 */
export const RestoreOptionsSchema = v.object({
  tables: v.optional(v.array(v.string())),
  clean: v.optional(v.boolean()),
  ifExists: v.optional(v.boolean()),
  dryRun: v.optional(v.boolean()),
  key: v.optional(v.string()),
  skipChecksum: v.optional(v.boolean()),
});

/**
 * Restore request schema for API Gateway and Backup Orchestrator
 */
export const RestoreRequestSchema = v.pipe(
  v.object({
    dbConfig: DatabaseConfigSchema,
    backupId: v.optional(v.string('backupId must be a string')),
    filePath: v.optional(v.string('filePath must be a string')),
    options: v.optional(RestoreOptionsSchema),
  }),
  v.check(
    (val) => Boolean(val.backupId || val.filePath),
    'Either backupId or filePath must be provided for restore'
  )
);

export type RestoreRequestInput = v.InferInput<typeof RestoreRequestSchema>;
export type RestoreRequestOutput = v.InferOutput<typeof RestoreRequestSchema>;
