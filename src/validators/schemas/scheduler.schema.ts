import * as v from 'valibot';
import { CronExpressionSchema, BackupTypeSchema, StorageTypeSchema } from './common.schema';
import { DatabaseConfigSchema, BackupOptionsSchema } from './backup.schema';

/**
 * Single notification provider schema
 */
export const NotificationProviderSchema = v.object({
  type: v.picklist(['email', 'slack'], 'Notification provider type must be email or slack'),
  details: v.record(v.string(), v.any()),
});

/**
 * Payload schema for scheduling a backup
 */
export const ScheduleRequestSchema = v.object({
  schedule: CronExpressionSchema,
  dbConfig: DatabaseConfigSchema,
  backupType: v.optional(BackupTypeSchema, 'full'),
  options: v.optional(
    v.object({
      name: v.optional(v.string()),
      compress: v.optional(v.boolean(), true),
      retention: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 30),
      storage: v.optional(v.any()),
    }),
    {}
  ),
  storageType: v.optional(StorageTypeSchema, 'local'),
  notification: v.optional(v.any()),
});

export type ScheduleRequestDTO = v.InferOutput<typeof ScheduleRequestSchema>;
