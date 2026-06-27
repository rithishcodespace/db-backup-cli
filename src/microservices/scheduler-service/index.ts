import express from 'express';
import { prisma } from '../../lib/prisma';
import cron from 'node-cron';
import axios from 'axios';
import { createModuleLogger } from '../../logger';

const app = express();
app.use(express.json());

const log = createModuleLogger('scheduler-service');

const SERVICE_PORT = process.env.SCHEDULER_SERVICE_PORT || 3020;
const SERVICE_NAME = 'scheduler-service';
const startTime = Date.now();

// Store scheduled tasks
const scheduledTasks = new Map();

// Service URLs
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:3001';
const NOTIFICATION_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3040';

// Health check
app.get('/health', (req, res) => {
  res.json({
    service: SERVICE_NAME,
    status: 'healthy',
    version: '1.0.0',
    uptime: (Date.now() - startTime) / 1000,
    scheduledTasks: scheduledTasks.size
  });
});

// Schedule a backup
app.post('/api/schedule', async (req, res) => {
  const { schedule, dbConfig, backupType, options, storageType, notification } = req.body;
  
  try {
    // Validate cron expression
    if (!cron.validate(schedule)) {
      throw new Error('Invalid cron expression');
    }
    
    // Get notification configuration if enabled
    let notificationConfig = null;
    if (notification && notification.type) {
      if (notification.type === 'email' && notification.details?.to) {
        notificationConfig = {
          type: 'email',
          details: {
            to: notification.details.to,
            from: notification.details.from || 'backup@system.local'
          }
        };
      } else if (notification.type === 'slack' && notification.details?.webhookUrl) {
        notificationConfig = {
          type: 'slack',
          details: {
            webhookUrl: notification.details.webhookUrl
          }
        };
      }
    }
    
    // Create schedule record
    const scheduleRecord = await prisma.backupSchedule.create({
      data: {
        name: options.name || `${dbConfig.type}_${dbConfig.database}_backup`,
        dbType: dbConfig.type,
        dbName: dbConfig.database,
        schedule: schedule,
        backupType: backupType,
        compress: options.compress || true,
        storageType: storageType || 'local',
        retention: options.retention || 30,
        enabled: true,
        notifyOnSuccess: notificationConfig?.type === 'slack' || notificationConfig?.type === 'email',
        notifyOnError: true,
        slackWebhook: notificationConfig?.type === 'slack' ? notificationConfig.details.webhookUrl : null,
        emailRecipients: notificationConfig?.type === 'email' ? notificationConfig.details.to : null,
        metadata: {
          dbConfig,
          options,
          storageType: storageType || 'local',
          notification: notificationConfig
        }
      }
    });
    
    // Schedule the task
    const task = cron.schedule(schedule, async () => {
      await executeScheduledBackup(scheduleRecord.id, dbConfig, backupType, options, notificationConfig);
    });
    
    scheduledTasks.set(scheduleRecord.id, task);
    
    log.info('Backup schedule created', {
      id: scheduleRecord.id,
      schedule: schedule,
      dbType: dbConfig.type,
      notification: notificationConfig?.type || 'none'
    });
    
    res.json({
      success: true,
      scheduleId: scheduleRecord.id,
      schedule: scheduleRecord
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

// Stop a schedule
app.post('/api/schedule/:id/stop', async (req, res) => {
  const { id } = req.params;
  
  try {
    const task = scheduledTasks.get(id);
    if (task) {
      task.stop();
      scheduledTasks.delete(id);
    }
    
    await prisma.backupSchedule.update({
      where: { id },
      data: { enabled: false }
    });
    
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

// List all schedules
app.get('/api/schedule', async (req, res) => {
  try {
    const schedules = await prisma.backupSchedule.findMany({
      where: { enabled: true }
    });
    
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

async function executeScheduledBackup(
  scheduleId: string,
  dbConfig: any,
  backupType: string,
  options: any,
  notificationConfig: any
) {
  log.info('Executing scheduled backup', { scheduleId, dbType: dbConfig.type });
  
  let backupSuccess = false;
  let backupId = null;
  let errorMessage = null;
  let startTime = Date.now();
  
  try {
    // Update schedule last run
    await prisma.backupSchedule.update({
      where: { id: scheduleId },
      data: {
        lastRunAt: new Date()
      }
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
      
      await prisma.backupSchedule.update({
        where: { id: scheduleId },
        data: {
          lastRunStatus: 'success',
          error: null
        }
      });
      
      // Send success notification if configured
      if (notificationConfig) {
        await sendBackupNotification({
          success: true,
          backupId,
          scheduleId,
          dbConfig,
          backupType,
          duration,
          fileSize: response.data.fileSize,
          notificationConfig
        });
      }
    } else {
      throw new Error(response.data.error || 'Backup failed');
    }
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    errorMessage = error instanceof Error ? error.message : String(error);
    
    log.error('Scheduled backup failed', { scheduleId, error: errorMessage });
    
    await prisma.backupSchedule.update({
      where: { id: scheduleId },
      data: {
        lastRunStatus: 'failed',
        error: errorMessage
      }
    });
    
    // Send failure notification if configured
    if (notificationConfig) {
      await sendBackupNotification({
        success: false,
        backupId: null,
        scheduleId,
        dbConfig,
        backupType,
        duration,
        errorMessage,
        notificationConfig
      });
    }
  }
}

async function sendBackupNotification(params: {
  success: boolean;
  backupId: string | null;
  scheduleId: string;
  dbConfig: any;
  backupType: string;
  duration: number;
  fileSize?: number;
  errorMessage?: string;
  notificationConfig: any;
}) {
  const { success, backupId, scheduleId, dbConfig, backupType, duration, fileSize, errorMessage, notificationConfig } = params;
  
  try {
    // Get schedule details for additional context
    const schedule = await prisma.backupSchedule.findUnique({
      where: { id: scheduleId }
    });
    
    const message = {
      subject: success 
        ? `✅ Backup Completed - ${dbConfig.database}` 
        : `❌ Backup Failed - ${dbConfig.database}`,
      text: `
        Backup ${success ? 'Completed Successfully' : 'Failed'}

        Database: ${dbConfig.type}/${dbConfig.database}
        Type: ${backupType}
        Schedule: ${schedule?.name || 'Scheduled Backup'}
        Time: ${new Date().toISOString()}
        Duration: ${duration.toFixed(2)} seconds
        ${backupId ? `Backup ID: ${backupId}` : ''}
        ${fileSize ? `Size: ${(fileSize / 1024 / 1024).toFixed(2)} MB` : ''}
        ${errorMessage ? `Error: ${errorMessage}` : ''}
      `,
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
    
    // Prepare notification config based on type
    let notifyConfig: any = {};
    let notifyType = notificationConfig.type;
    
    if (notifyType === 'email') {
      // For email, we need SMTP config from stored settings
      // Use the notification service to handle sending
      notifyConfig = {
        smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
        smtpPort: parseInt(process.env.SMTP_PORT || '587'),
        username: process.env.SMTP_USER,
        password: process.env.SMTP_PASS,
        from: notificationConfig.details?.from || process.env.SMTP_FROM || 'backup@system.local',
        to: notificationConfig.details?.to || process.env.SMTP_TO
      };
    } else if (notifyType === 'slack') {
      notifyConfig = {
        webhookUrl: notificationConfig.details?.webhookUrl || process.env.SLACK_WEBHOOK_URL
      };
    }
    
    // Call notification service
    const response = await axios.post(`${NOTIFICATION_URL}/api/notify`, {
      type: notifyType,
      backupId: backupId || scheduleId,
      config: notifyConfig,
      message
    });
    
    if (response.data.success) {
      log.info('Notification sent for scheduled backup', { 
        scheduleId, 
        backupId, 
        type: notifyType,
        success 
      });
    } else {
      log.warn('Notification service returned error', { 
        scheduleId, 
        response: response.data 
      });
    }
  } catch (error) {
    log.error('Failed to send notification for scheduled backup', { 
      scheduleId, 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
}

// Load existing schedules on startup
async function loadSchedules() {
  try {
    const schedules = await prisma.backupSchedule.findMany({
      where: { enabled: true }
    });
    
    log.info(`Loading ${schedules.length} schedules`);
    
    for (const schedule of schedules) {
      if (cron.validate(schedule.schedule)) {
        const metadata = JSON.parse(schedule.metadata as any || '{}');
        const notificationConfig = metadata.notification || null;
        
        const task = cron.schedule(schedule.schedule, async () => {
          await executeScheduledBackup(
            schedule.id,
            metadata.dbConfig,
            schedule.backupType,
            metadata.options || {},
            notificationConfig
          );
        });
        
        scheduledTasks.set(schedule.id, task);
        log.info('Schedule loaded', { 
          id: schedule.id,
          name: schedule.name,
          notification: notificationConfig?.type || 'none'
        });
      } else {
        log.warn('Invalid schedule configuration', { id: schedule.id });
      }
    }
  } catch (error) {
    log.error('Failed to load schedules', { error });
  }
}

// Start the service
app.listen(SERVICE_PORT, async () => {
  log.info(`${SERVICE_NAME} listening on port ${SERVICE_PORT}`);
  await loadSchedules();
});

export default app;