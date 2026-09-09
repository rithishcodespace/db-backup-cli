import express from 'express';
import helmet from 'helmet';
import { metadataClient } from '../../lib/metadata-client';
import cron from 'node-cron';
import axios from 'axios';
import { createModuleLogger } from '../../logger';
import { connection } from '../../lib/queue-manager';
import { DistributedLock } from '../../lib/distributed-lock';
import { validateBody, validateParams, ScheduleRequestSchema, IdParamSchema } from '../shared/validators';

const app = express();
app.use(helmet());
app.use(express.json({ limit: '10mb' }));

const log = createModuleLogger('scheduler-service');

const SERVICE_PORT = process.env.SCHEDULER_SERVICE_PORT || 3020;
const SERVICE_NAME = 'scheduler-service';
const startTime = Date.now();

// Store scheduled tasks
const scheduledTasks = new Map();

// Service URLs
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:3001';
const NOTIFICATION_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3040';

// Types 

interface NotificationProvider {
  type: 'email' | 'slack';
  details: Record<string, any>;
}

interface NotificationPayload {
  providers: NotificationProvider[];
}

// Helper Functions

function normalizeNotification(notification: any): NotificationPayload | null {
  if (!notification) {
    return null;
  }

  // New format: { providers: [...] }
  if (notification.providers && Array.isArray(notification.providers)) {
    return notification;
  }

  // Old format: { type: "email", details: {...} }
  if (notification.type && notification.details) {
    return {
      providers: [{
        type: notification.type,
        details: notification.details
      }]
    };
  }

  return null;
}

function getNotificationProviders(notification: any): NotificationProvider[] {
  const normalized = normalizeNotification(notification);
  return normalized?.providers || [];
}

function hasProvider(notification: any, type: string): boolean {
  const providers = getNotificationProviders(notification);
  return providers.some(p => p.type === type);
}

function getProviderDetails(notification: any, type: string): any | null {
  const providers = getNotificationProviders(notification);
  const provider = providers.find(p => p.type === type);
  return provider?.details || null;
}

function getProviderTypes(notification: any): string[] {
  const providers = getNotificationProviders(notification);
  return providers.map(p => p.type);
}

// Health Check 

app.get('/health', (req, res) => {
  res.json({
    service: SERVICE_NAME,
    status: 'healthy',
    version: '1.0.0',
    uptime: (Date.now() - startTime) / 1000,
    scheduledTasks: scheduledTasks.size
  });
});

// Schedule a Backup

app.post('/api/schedule', validateBody(ScheduleRequestSchema), async (req, res) => {
  const { schedule, dbConfig, backupType, options, storageType, notification } = req.body;
  
  try {
    // Validate cron expression
    if (!cron.validate(schedule)) {
      throw new Error('Invalid cron expression');
    }
    
    // Normalize notification to new format
    const normalizedNotification = normalizeNotification(notification);
    const providers = getNotificationProviders(normalizedNotification);
    
    // Extract slack webhook and email recipients for backward compatibility
    let slackWebhook = null;
    let emailRecipients = null;
    
    if (providers.length > 0) {
      const slackProvider = providers.find(p => p.type === 'slack');
      if (slackProvider) {
        slackWebhook = slackProvider.details.webhookUrl || null;
      }
      
      const emailProvider = providers.find(p => p.type === 'email');
      if (emailProvider) {
        emailRecipients = emailProvider.details.to || null;
      }
    }
    
    // Create schedule record
    const scheduleRecord = await metadataClient.createSchedule({
      name: options.name || `${dbConfig.type}_${dbConfig.database}_backup`,
      dbType: dbConfig.type,
      dbName: dbConfig.database,
      schedule: schedule,
      backupType: backupType,
      compress: options.compress || true,
      storageType: storageType || 'local',
      retention: options.retention || 30,
      enabled: true,
      notifyOnSuccess: providers.length > 0,
      notifyOnError: true,
      slackWebhook: slackWebhook,
      emailRecipients: emailRecipients,
      metadata: {
        dbConfig,
        options,
        storageType: storageType || 'local',
        notification: normalizedNotification // Store full notification with providers
      }
    });
    
    // Schedule the task
    const task = cron.schedule(schedule, async () => {
      await executeScheduledBackup(
        scheduleRecord.id,
        dbConfig,
        backupType,
        options,
        normalizedNotification
      );
    });
    
    scheduledTasks.set(scheduleRecord.id, task);
    
    const providerTypes = getProviderTypes(normalizedNotification);
    
    log.info('Backup schedule created', {
      id: scheduleRecord.id,
      schedule: schedule,
      dbType: dbConfig.type,
      notification: providerTypes.length > 0 ? providerTypes : 'none'
    });
    
    res.json({
      success: true,
      scheduleId: scheduleRecord.id,
      schedule: scheduleRecord,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Failed to create schedule', { error: errorMessage });
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

// Stop a Schedule

app.post('/api/schedule/:id/stop', validateParams(IdParamSchema), async (req, res) => {
  const id = req.params.id as string;
  
  try {
    const task = scheduledTasks.get(id);
    if (task) {
      task.stop();
      scheduledTasks.delete(id);
    }
    
    await metadataClient.updateSchedule(id, { enabled: false });
    
    log.info('Schedule stopped', { id });
    res.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

// List All Schedules

app.get('/api/schedule', async (req, res) => {
  try {
    const schedules = await metadataClient.listSchedules(true);
    
    res.json({
      success: true,
      schedules,
      activeCount: scheduledTasks.size
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

// Execute Scheduled Backup
async function executeScheduledBackup(
  scheduleId: string,
  dbConfig: any,
  backupType: string,
  options: any,
  notification: NotificationPayload | null
) {
  // DISTRIBUTED LOCK GUARD 
  // Acquire lock to prevent duplicate scheduled backups for the same database
  const lockKey = `backup:${dbConfig.type}:${dbConfig.database}`;
  const lock = new DistributedLock(connection as any, lockKey, { ttl: 3600 });
  
  let lockAcquired = false;
  
  try {
    // Try to acquire the lock
    lockAcquired = await lock.acquire();
    
    if (!lockAcquired) {
      // Lock already held by another scheduled backup execution
      log.info('Scheduled backup already running. Skipping execution.', {
        scheduleId,
        dbType: dbConfig.type,
        dbName: dbConfig.database,
        lockKey
      });
      return; // Exit immediately - do NOT execute backup
    }
    
    // Lock acquired - proceed with backup execution
    log.debug('Scheduled backup lock acquired', {
      scheduleId,
      dbType: dbConfig.type,
      dbName: dbConfig.database,
      lockKey
    });
    
    // EXISTING BACKUP EXECUTION LOGIC 
    log.info('Executing scheduled backup', { 
      scheduleId, 
      dbType: dbConfig.type,
      notification: notification ? getProviderTypes(notification) : 'none'
    });
    
    let backupSuccess = false;
    let backupId = null;
    let errorMessage = null;
    let startTime = Date.now();
    
    try {
      // Update schedule last run
      await metadataClient.updateSchedule(scheduleId, {
        lastRunAt: new Date()
      });
      
      // Call backup orchestrator
      const response = await axios.post(`${ORCHESTRATOR_URL}/backup`, {
        dbConfig,
        backupType,
        options: {
          ...options,
          scheduled: true,
          scheduleId
        }
      });
      
      const duration = (Date.now() - startTime) / 1000;
      
      if (response.data.success) {
        backupSuccess = true;
        backupId = response.data.backupId;
        
        log.info('Scheduled backup completed', { 
          scheduleId, 
          backupId, 
          duration 
        });
        
        await metadataClient.updateSchedule(scheduleId, {
          lastRunStatus: 'success',
          error: null
        });
        
        // Send success notifications to all providers
        if (notification) {
          await sendBackupNotifications({
            success: true,
            backupId,
            scheduleId,
            dbConfig,
            backupType,
            duration,
            fileSize: response.data.fileSize,
            notification
          });
        }
      } else {
        throw new Error(response.data.error || 'Backup failed');
      }
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      errorMessage = error instanceof Error ? error.message : String(error);
      
      log.error('Scheduled backup failed', { scheduleId, error: errorMessage });
      
      await metadataClient.updateSchedule(scheduleId, {
        lastRunStatus: 'failed',
        error: errorMessage
      });
      
      // Send failure notifications to all providers
      if (notification) {
        await sendBackupNotifications({
          success: false,
          backupId: null,
          scheduleId,
          dbConfig,
          backupType,
          duration,
          errorMessage,
          notification
        });
      }
    }
    
  } catch (error) {
    // Handle any errors from lock acquisition or backup execution
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Scheduled backup execution error', {
      scheduleId,
      dbType: dbConfig.type,
      dbName: dbConfig.database,
      error: errorMessage
    });
  } finally {
    // ALWAYS release the lock in finally block
    if (lockAcquired) {
      try {
        await lock.release();
        log.debug('Scheduled backup lock released', {
          scheduleId,
          dbType: dbConfig.type,
          dbName: dbConfig.database,
          lockKey
        });
      } catch (releaseError) {
        log.error('Failed to release scheduled backup lock', {
          scheduleId,
          error: releaseError instanceof Error ? releaseError.message : String(releaseError)
        });
        // Lock will expire via TTL, so we don't need to rethrow
      }
    }
  }
}

// Send Backup Notifications to All Providers 

async function sendBackupNotifications(params: {
  success: boolean;
  backupId: string | null;
  scheduleId: string;
  dbConfig: any;
  backupType: string;
  duration: number;
  fileSize?: number;
  errorMessage?: string;
  notification: NotificationPayload;
}) {
  const { success, backupId, scheduleId, dbConfig, backupType, duration, fileSize, errorMessage, notification } = params;
  
  const providers = getNotificationProviders(notification);
  
  if (providers.length === 0) {
    log.debug('No notification providers configured', { scheduleId });
    return;
  }
  
  log.info(`Sending notifications to ${providers.length} provider(s)`, {
    scheduleId,
    providers: providers.map(p => p.type)
  });
  
  // Get schedule details for additional context
  const schedule = await metadataClient.getSchedule(scheduleId);
  
  // Build the common message
  const message = {
    subject: success 
      ? `✅ Backup Completed - ${dbConfig.database}` 
      : `❌ Backup Failed - ${dbConfig.database}`,
    text: `Backup ${success ? 'Completed Successfully' : 'Failed'}

Database: ${dbConfig.type}/${dbConfig.database}
Type: ${backupType}
Schedule: ${schedule?.name || 'Scheduled Backup'}
Time: ${new Date().toISOString()}
Duration: ${duration.toFixed(2)} seconds
${backupId ? `Backup ID: ${backupId}` : ''}
${fileSize ? `Size: ${(fileSize / 1024 / 1024).toFixed(2)} MB` : ''}
${errorMessage ? `Error: ${errorMessage}` : ''}`,
    attachments: success ? [
      {
        color: '#36a64f',
        title: '✅ Backup Successful',
        fields: [
          { title: 'Database', value: `${dbConfig.type}/${dbConfig.database}`, short: true },
          { title: 'Type', value: backupType, short: true },
          { title: 'Duration', value: `${duration.toFixed(2)}s`, short: true },
          { title: 'Backup ID', value: backupId || 'N/A', short: true },
          { title: 'Size', value: fileSize ? `${(fileSize / 1024 / 1024).toFixed(2)} MB` : 'N/A', short: true }
        ],
        footer: 'DB Backup CLI',
        ts: Math.floor(Date.now() / 1000)
      }
    ] : [
      {
        color: '#ff0000',
        title: '❌ Backup Failed',
        fields: [
          { title: 'Database', value: `${dbConfig.type}/${dbConfig.database}`, short: true },
          { title: 'Type', value: backupType, short: true },
          { title: 'Duration', value: `${duration.toFixed(2)}s`, short: true },
          { title: 'Error', value: errorMessage || 'Unknown error', short: false }
        ],
        footer: 'DB Backup CLI',
        ts: Math.floor(Date.now() / 1000)
      }
    ]
  };
  
  // Send notification to each provider
  for (const provider of providers) {
    try {
      let notifyConfig: any = {};
      
      if (provider.type === 'email') {
        // For email, prepare SMTP config
        notifyConfig = {
          smtpHost: provider.details.smtpHost || process.env.SMTP_HOST || 'smtp.gmail.com',
          smtpPort: provider.details.smtpPort || parseInt(process.env.SMTP_PORT || '587'),
          smtpSecure: provider.details.smtpSecure || process.env.SMTP_SECURE === 'true',
          smtpUser: provider.details.smtpUser || process.env.SMTP_USER,
          smtpPassword: provider.details.smtpPassword || process.env.SMTP_PASS,
          from: provider.details.from || process.env.SMTP_FROM,
          to: provider.details.to || process.env.SMTP_TO
        };
      } else if (provider.type === 'slack') {
        // For Slack, prepare webhook config
        notifyConfig = {
          webhookUrl: provider.details.webhookUrl || process.env.SLACK_WEBHOOK_URL
        };
      }
      
      // Call notification service
      const response = await axios.post(`${NOTIFICATION_URL}/api/notify`, {
        type: provider.type,
        backupId: backupId || scheduleId,
        config: notifyConfig,
        message
      });
      
      if (response.data.success) {
        log.info('Notification sent successfully', { 
          scheduleId, 
          backupId, 
          type: provider.type,
          success 
        });
      } else {
        log.warn('Notification service returned error', { 
          scheduleId, 
          type: provider.type,
          response: response.data 
        });
      }
    } catch (error) {
      log.error('Failed to send notification', { 
        scheduleId, 
        type: provider.type,
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }
}

// Load Existing Schedules 

async function loadSchedules() {
  try {
    const schedules = await metadataClient.listSchedules(true);
    
    log.info(`Loading ${schedules.length} schedules`);
    
    for (const schedule of schedules) {
      if (cron.validate(schedule.schedule)) {
        const metadata = JSON.parse(schedule.metadata as any || '{}');
        
        // Normalize notification to new format
        const notification = normalizeNotification(metadata.notification);
        const providerTypes = getProviderTypes(notification);
        
        const task = cron.schedule(schedule.schedule, async () => {
          await executeScheduledBackup(
            schedule.id,
            metadata.dbConfig,
            schedule.backupType,
            metadata.options || {},
            notification
          );
        });
        
        scheduledTasks.set(schedule.id, task);
        log.info('Schedule loaded', { 
          id: schedule.id,
          name: schedule.name,
          notification: providerTypes.length > 0 ? providerTypes : 'none'
        });
      } else {
        log.warn('Invalid schedule configuration', { id: schedule.id });
      }
    }
  } catch (error) {
    log.error('Failed to load schedules', { error });
  }
}

app.listen(SERVICE_PORT, async () => {
  log.info(`${SERVICE_NAME} listening on port ${SERVICE_PORT}`);
  await loadSchedules();
});

export default app;