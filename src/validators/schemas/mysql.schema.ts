import * as v from 'valibot';
import { DatabaseConfigSchema } from './backup.schema';

/**
 * MySQL restore request payload schema
 */
export const MySQLRestoreSchema = v.object({
  dbConfig: DatabaseConfigSchema,
  backupId: v.pipe(
    v.string('backupId must be a string'),
    v.trim(),
    v.minLength(1, 'backupId cannot be empty')
  ),
  targetTime: v.optional(v.string('targetTime must be an ISO date string')),
  options: v.optional(v.record(v.string(), v.any()), {}),
});

/**
 * MySQL check-binlog payload schema
 */
export const MySQLCheckBinlogSchema = v.object({
  dbConfig: DatabaseConfigSchema,
});

/**
 * MySQL cleanup payload schema
 */
export const MySQLCleanupSchema = v.object({
  retentionDays: v.optional(
    v.pipe(
      v.number('retentionDays must be a number'),
      v.integer('retentionDays must be an integer'),
      v.minValue(1, 'retentionDays must be at least 1')
    ),
    7
  ),
  backupDir: v.optional(v.string('backupDir must be a string')),
});

/**
 * MySQL query params for listing backups
 */
export const MySQLListBackupsQuerySchema = v.object({
  backupDir: v.optional(v.string('backupDir must be a string')),
});

export type MySQLRestoreDTO = v.InferOutput<typeof MySQLRestoreSchema>;
export type MySQLCheckBinlogDTO = v.InferOutput<typeof MySQLCheckBinlogSchema>;
export type MySQLCleanupDTO = v.InferOutput<typeof MySQLCleanupSchema>;
