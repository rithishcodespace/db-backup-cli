import express from 'express';
import {prisma} from '../../lib/prisma';
import cron from 'node-cron';
import axios from 'axios';
import { createModuleLogger } from '../../logger';

const app = express();
app.use(express.json());

const log = createModuleLogger('scheduler-service');

const SERVICE_PORT = process.env.SCHEDULER_SERVICE_PORT || 3020;
const SERVICE_NAME = 'scheduler-service';
const startTime = Date.now();

// Store scheduled tasks - cache of cron jobs keyed by schedule ID for easy management (stop, update, etc.)
const scheduledTasks = new Map();

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
  const { schedule, dbConfig, backupType, options, storageType } = req.body;
  
  try {
    // Validate cron expression
    if (!cron.validate(schedule)) { 
      throw new Error('Invalid cron expression');
    }
    
    // Create schedule record
    const scheduleRecord = await prisma.backupSchedule.create({
      data: {
        name: options.name || `${dbConfig.type}_${dbConfig.database}_backup`, // backup name based on db type and name
        dbType: dbConfig.type,
        dbName: dbConfig.database,
        schedule: schedule,
        backupType: backupType, 
        compress: options.compress,
        storageType: storageType || 'local',
        enabled: true,
        metadata: {
          dbConfig,
          options,
          storageType: storageType || 'local'
        }
      }
    });
    
    // Schedule the task
    const task = cron.schedule(schedule, async () => {
      await executeScheduledBackup(scheduleRecord.id, dbConfig, backupType, options);
    });
    
    scheduledTasks.set(scheduleRecord.id, task);
    
    log.info('Backup schedule created', {
      id: scheduleRecord.id,
      schedule: schedule,
      dbType: dbConfig.type
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

async function executeScheduledBackup(scheduleId: string, dbConfig: any, backupType: string, options: any){
  log.info('Executing scheduled backup', { scheduleId, dbType: dbConfig.type });
  
  try {
    // Update schedule last run
    await prisma.backupSchedule.update({
      where: { id: scheduleId },
      data: {
        lastRunAt: new Date(),
      }
    });
    
    // Call backup orchestrator
    const orchestratorUrl = process.env.ORCHESTRATOR_URL || 'http://localhost:3001';
    const response = await axios.post(`${orchestratorUrl}/backup`, {
      dbConfig,
      backupType,
      options: {
        ...options,
        scheduled: true,
        scheduleId
      }
    });
    
    if (response.data.success) {
      log.info('Scheduled backup completed', { scheduleId, backupId: response.data.backupId });
      
      // Update schedule status
      await prisma.backupSchedule.update({
        where: { id: scheduleId },
        data: {
          lastRunStatus: 'success'
        }
      });
    } else {
      throw new Error(response.data.error || 'Backup failed');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Scheduled backup failed', { scheduleId, error: errorMessage });
    
    await prisma.backupSchedule.update({
      where: { id: scheduleId },
      data: {
        lastRunStatus: 'failed',
        error: errorMessage
      }
    });
  }
}

// Load existing schedules on startup - function runs when application starts to load schedules from database and set up cron jobs for them
async function loadSchedules() {
  try {
    const schedules = await prisma.backupSchedule.findMany({
      where: { enabled: true }
    });
    
    log.info(`Loading ${schedules.length} schedules`);
    
    for (const schedule of schedules) {
      if (cron.validate(schedule.schedule)) {
        const metadata = JSON.parse(schedule.metadata as any || '{}');
        
        const task = cron.schedule(schedule.schedule, async () => { // create cron for each schedule and executes backup when cron triggers    
          await executeScheduledBackup(
            schedule.id,
            metadata.dbConfig,
            schedule.backupType,
            metadata.options || {}
          );
        });
        
        scheduledTasks.set(schedule.id, task);
        log.info('Schedule loaded', { 
          id: schedule.id,
          name: schedule.name,
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