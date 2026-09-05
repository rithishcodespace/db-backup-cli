import * as v from 'valibot';

/**
 * Notification service request payload schema
 */
export const NotificationRequestSchema = v.object({
  type: v.picklist(['slack', 'email'], 'Notification type must be either slack or email'),
  backupId: v.optional(v.string('Backup ID must be a string')),
  config: v.record(v.string(), v.any(), 'Notification config must be an object'),
  message: v.record(v.string(), v.any(), 'Message payload must be an object'),
});

export type NotificationRequestDTO = v.InferOutput<typeof NotificationRequestSchema>;
