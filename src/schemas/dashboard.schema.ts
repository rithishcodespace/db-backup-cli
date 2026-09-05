import * as v from 'valibot';
import { DatabaseTypeSchema, BackupTypeSchema, StorageTypeSchema } from './common.schema';

/**
 * Payload schema for triggering a quick backup from the dashboard
 */
export const TriggerBackupSchema = v.object({
  dbType: DatabaseTypeSchema,
  dbName: v.pipe(
    v.string('dbName must be a string'),
    v.trim(),
    v.minLength(1, 'dbName cannot be empty')
  ),
  backupType: v.optional(BackupTypeSchema, 'full'),
  storageType: v.optional(StorageTypeSchema, 'local'),
});

/**
 * Query schema for listing backup history on the dashboard
 */
export const DashboardBackupsQuerySchema = v.object({
  status: v.optional(v.string()),
  dbType: v.optional(v.string()),
  search: v.optional(v.string()),
  limit: v.optional(
    v.pipe(
      v.string(),
      v.transform((val) => parseInt(val, 10)),
      v.check((n) => !isNaN(n) && n > 0 && n <= 500, 'Limit must be an integer between 1 and 500')
    )
  ),
  page: v.optional(
    v.pipe(
      v.string(),
      v.transform((val) => parseInt(val, 10)),
      v.check((n) => !isNaN(n) && n >= 1, 'Page must be an integer >= 1')
    )
  ),
});

/**
 * Query schema for viewing logs on the dashboard
 */
export const DashboardLogsQuerySchema = v.object({
  level: v.optional(v.string()),
  jobId: v.optional(v.string()),
  search: v.optional(v.string()),
  limit: v.optional(
    v.pipe(
      v.string(),
      v.transform((val) => parseInt(val, 10)),
      v.check((n) => !isNaN(n) && n > 0 && n <= 500, 'Limit must be an integer between 1 and 500')
    )
  ),
});

export type TriggerBackupDTO = v.InferOutput<typeof TriggerBackupSchema>;
export type DashboardBackupsQueryDTO = v.InferOutput<typeof DashboardBackupsQuerySchema>;
export type DashboardLogsQueryDTO = v.InferOutput<typeof DashboardLogsQuerySchema>;
