import * as v from 'valibot';
import { StorageTypeSchema } from './common.schema';

/**
 * Storage service upload payload schema
 */
export const StorageUploadSchema = v.object({
  storageType: StorageTypeSchema,
  config: v.record(v.string(), v.any(), 'Storage config must be an object'),
  localPath: v.pipe(
    v.string('localPath must be a string'),
    v.trim(),
    v.minLength(1, 'localPath cannot be empty')
  ),
  remotePath: v.pipe(
    v.string('remotePath must be a string'),
    v.trim(),
    v.minLength(1, 'remotePath cannot be empty')
  ),
  backupId: v.pipe(
    v.string('backupId must be a string'),
    v.trim(),
    v.minLength(1, 'backupId cannot be empty')
  ),
});

/**
 * Storage service download payload schema
 */
export const StorageDownloadSchema = v.object({
  storageType: StorageTypeSchema,
  config: v.record(v.string(), v.any(), 'Storage config must be an object'),
  remotePath: v.pipe(
    v.string('remotePath must be a string'),
    v.trim(),
    v.minLength(1, 'remotePath cannot be empty')
  ),
  localPath: v.pipe(
    v.string('localPath must be a string'),
    v.trim(),
    v.minLength(1, 'localPath cannot be empty')
  ),
  backupId: v.pipe(
    v.string('backupId must be a string'),
    v.trim(),
    v.minLength(1, 'backupId cannot be empty')
  ),
});

/**
 * Storage service list payload schema
 */
export const StorageListSchema = v.object({
  storageType: StorageTypeSchema,
  config: v.record(v.string(), v.any(), 'Storage config must be an object'),
  prefix: v.optional(v.string('Prefix must be a string')),
});

/**
 * Storage service delete payload schema
 */
export const StorageDeleteSchema = v.object({
  storageType: StorageTypeSchema,
  config: v.record(v.string(), v.any(), 'Storage config must be an object'),
  remotePath: v.pipe(
    v.string('remotePath must be a string'),
    v.trim(),
    v.minLength(1, 'remotePath cannot be empty')
  ),
});

export type StorageUploadDTO = v.InferOutput<typeof StorageUploadSchema>;
export type StorageDownloadDTO = v.InferOutput<typeof StorageDownloadSchema>;
export type StorageListDTO = v.InferOutput<typeof StorageListSchema>;
export type StorageDeleteDTO = v.InferOutput<typeof StorageDeleteSchema>;
