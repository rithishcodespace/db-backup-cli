import * as v from 'valibot';
import { DatabaseTypeSchema, BackupTypeSchema, StorageTypeSchema } from './common.schema';

/**
 * Database connection configuration schema
 */
export const DatabaseConfigSchema = v.object({
  type: DatabaseTypeSchema,
  database: v.pipe(
    v.string('Database name must be a string'),
    v.trim(),
    v.minLength(1, 'Database name cannot be empty'),
    v.check((name) => !/[\r\n\0;&|`$]/.test(name), 'Database name contains illegal characters')
  ),
  host: v.optional(v.string('Host must be a string')),
  port: v.optional(
    v.pipe(
      v.number('Port must be a number'),
      v.integer('Port must be an integer'),
      v.minValue(1, 'Port must be greater than 0'),
      v.maxValue(65535, 'Port must be less than or equal to 65535')
    )
  ),
  username: v.optional(v.string('Username must be a string')),
  password: v.optional(v.string('Password must be a string')),
  ssl: v.optional(v.boolean('SSL must be a boolean')),
  connectionString: v.optional(v.string('Connection string must be a string')),
});

/**
 * Storage configuration options schema
 */
export const StorageOptionsSchema = v.pipe(
  v.object({
    type: StorageTypeSchema,
    name: v.optional(v.string()),
    basePath: v.optional(v.string()),
    bucket: v.optional(v.string()),
    region: v.optional(v.string()),
    accessKey: v.optional(v.string()),
    secretKey: v.optional(v.string()),
    prefix: v.optional(v.string()),
  }),
  v.check(
    (val) => val.type !== 's3' || !!val.bucket,
    'S3 storage requires a bucket name'
  )
);

const SafeIdentifierSchema = v.pipe(
  v.string('Table name must be a string'),
  v.trim(),
  v.check((name) => !/[\r\n\0;&|`$]/.test(name), 'Table name contains illegal characters')
);

/**
 * Backup options schema
 */
export const BackupOptionsSchema = v.pipe(
  v.object({
    compress: v.optional(v.boolean('Compress must be a boolean'), true),
    tables: v.optional(v.array(SafeIdentifierSchema)),
    excludeTables: v.optional(v.array(SafeIdentifierSchema)),
    outputPath: v.optional(v.string('Output path must be a string')),
    backupName: v.optional(v.string('Backup name must be a string')),
    backupId: v.optional(v.string('Backup ID must be a string')),
    parentBackupId: v.optional(v.string('Parent backup ID must be a string')),
    storage: v.nullish(StorageOptionsSchema),
    encrypt: v.optional(v.boolean('Encrypt must be a boolean'), false),
    encryptionKey: v.optional(v.string('Encryption key must be a string')),
    physical: v.optional(v.boolean()),
    timeout: v.optional(v.number()),
    backupDir: v.optional(v.string()),
  }),
  v.check(
    (opts) =>
      !opts.encrypt ||
      (typeof opts.encryptionKey === 'string' && /^[0-9a-fA-F]{64}$/.test(opts.encryptionKey)),
    'Encryption key must be 64 hexadecimal characters (32 bytes) when encryption is enabled'
  )
);

/**
 * Full backup request payload schema
 */
export const BackupRequestSchema = v.object({
  dbConfig: DatabaseConfigSchema,
  backupType: v.optional(BackupTypeSchema, 'full'),
  options: v.optional(BackupOptionsSchema, {}),
});

export type DatabaseConfigDTO = v.InferOutput<typeof DatabaseConfigSchema>;
export type StorageOptionsDTO = v.InferOutput<typeof StorageOptionsSchema>;
export type BackupOptionsDTO = v.InferOutput<typeof BackupOptionsSchema>;
export type BackupRequestDTO = v.InferOutput<typeof BackupRequestSchema>;
