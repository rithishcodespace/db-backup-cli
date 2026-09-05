import * as v from 'valibot';
import cron from 'node-cron';

/**
 * Common schema for routes with an :id parameter
 */
export const IdParamSchema = v.object({
  id: v.pipe(
    v.string('ID must be a string'),
    v.trim(),
    v.minLength(1, 'ID parameter cannot be empty')
  ),
});

/**
 * Supported database types
 */
export const DatabaseTypeSchema = v.picklist(
  ['postgresql', 'mysql', 'mongodb', 'sqlite'],
  'Database type must be one of: postgresql, mysql, mongodb, sqlite'
);

/**
 * Supported backup types
 */
export const BackupTypeSchema = v.picklist(
  ['full', 'incremental', 'differential', 'full-backup'],
  'Backup type must be one of: full, incremental, differential, full-backup'
);

/**
 * Supported storage provider types
 */
export const StorageTypeSchema = v.picklist(
  ['local', 's3'],
  'Storage type must be one of: local, s3'
);

/**
 * Valid cron expression schema
 */
export const CronExpressionSchema = v.pipe(
  v.string('Cron expression must be a string'),
  v.trim(),
  v.minLength(1, 'Cron expression cannot be empty'),
  v.check((val) => cron.validate(val), 'Invalid cron expression format (e.g. "0 2 * * *")')
);

export type IdParam = v.InferOutput<typeof IdParamSchema>;
export type DatabaseType = v.InferOutput<typeof DatabaseTypeSchema>;
export type BackupType = v.InferOutput<typeof BackupTypeSchema>;
export type StorageType = v.InferOutput<typeof StorageTypeSchema>;
