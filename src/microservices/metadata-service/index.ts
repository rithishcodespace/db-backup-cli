import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { prisma, connectDatabase, disconnectDatabase } from '../../config/database';
import { createModuleLogger } from '../../logger';

const log = createModuleLogger('metadata-service');

export const app = express();
app.use(helmet());
app.use(express.json({ limit: '10mb' }));

const PORT = parseInt(process.env.METADATA_SERVICE_PORT || process.env.PORT || '3005', 10);
const HOST = process.env.METADATA_SERVICE_HOST || '127.0.0.1';
const startTime = Date.now();

// ==================== Health Endpoint ====================

app.get('/health', async (_req: Request, res: Response): Promise<void> => {
  try {
    // Verify SQLite database connectivity with a lightweight check
    await prisma.$queryRawUnsafe('SELECT 1');
    res.json({
      service: 'metadata-service',
      status: 'healthy',
      database: 'connected',
      uptime: (Date.now() - startTime) / 1000,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Health check failed: database error', { error: message });
    res.status(503).json({
      service: 'metadata-service',
      status: 'unhealthy',
      database: 'disconnected',
      error: message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ==================== Backup Jobs Endpoints ====================

// Create a new backup job
app.post('/api/jobs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      id,
      dbType,
      dbName,
      backupType,
      status = 'pending',
      filePath,
      fileName,
      fileSize,
      compressedSize,
      checksum,
      baseBackupId,
      parentBackupId,
      backupLevel,
      walPosition,
      binlogFile,
      binlogPosition,
      oplogTimestamp,
      backupName,
      startedAt,
      completedAt,
      duration,
      expiresAt,
      storageType = 'local',
      storagePath,
      storageRegion,
      storageLocationId,
      compressionType,
      encryptionType,
      encrypted = false,
      encryptionMetadata,
      backupVersion,
      retryCount = 0,
      error,
      metadata,
    } = req.body;

    if (!dbType || !dbName || !backupType) {
      res.status(400).json({
        error: 'Validation error: dbType, dbName, and backupType are required',
      });
      return;
    }

    const job = await prisma.backupJob.create({
      data: {
        ...(id ? { id } : {}),
        dbType,
        dbName,
        backupType,
        status,
        filePath: filePath ?? null,
        fileName: fileName ?? null,
        fileSize: fileSize !== undefined && fileSize !== null ? Number(fileSize) : null,
        compressedSize: compressedSize !== undefined && compressedSize !== null ? Number(compressedSize) : null,
        checksum: checksum ?? null,
        baseBackupId: baseBackupId ?? null,
        parentBackupId: parentBackupId ?? null,
        backupLevel: backupLevel !== undefined && backupLevel !== null ? Number(backupLevel) : null,
        walPosition: walPosition ?? null,
        binlogFile: binlogFile ?? null,
        binlogPosition: binlogPosition !== undefined && binlogPosition !== null ? Number(binlogPosition) : null,
        oplogTimestamp: oplogTimestamp ?? null,
        backupName: backupName ?? null,
        startedAt: startedAt ? new Date(startedAt) : new Date(),
        completedAt: completedAt ? new Date(completedAt) : null,
        duration: duration !== undefined && duration !== null ? Number(duration) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        storageType,
        storagePath: storagePath ?? null,
        storageRegion: storageRegion ?? null,
        storageLocationId: storageLocationId ?? null,
        compressionType: compressionType ?? null,
        encryptionType: encryptionType ?? null,
        encrypted: Boolean(encrypted),
        encryptionMetadata: encryptionMetadata ?? null,
        backupVersion: backupVersion ?? null,
        retryCount: Number(retryCount) || 0,
        error: error ?? null,
        metadata: metadata ?? null,
      },
      include: {
        storageLocation: true,
      },
    });

    log.debug('Backup job created', { id: job.id, dbType: job.dbType, dbName: job.dbName });
    res.status(201).json(job);
  } catch (error) {
    next(error);
  }
});

// Get job by ID
app.get('/api/jobs/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const includeLogs = req.query.includeLogs === 'true';

    const job = await prisma.backupJob.findUnique({
      where: { id },
      include: {
        storageLocation: true,
        ...(includeLogs ? { logs: { orderBy: { timestamp: 'asc' } } } : {}),
      },
    });

    if (!job) {
      res.status(404).json({ error: `Backup job '${id}' not found` });
      return;
    }

    res.json(job);
  } catch (error) {
    next(error);
  }
});

// Update job by ID
app.patch('/api/jobs/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const updateData: any = { ...req.body };

    // Convert date strings if present
    if (updateData.startedAt) updateData.startedAt = new Date(updateData.startedAt);
    if (updateData.completedAt) updateData.completedAt = new Date(updateData.completedAt);
    if (updateData.expiresAt) updateData.expiresAt = new Date(updateData.expiresAt);

    // Ensure numeric fields are cast properly
    if (updateData.fileSize !== undefined) updateData.fileSize = updateData.fileSize !== null ? Number(updateData.fileSize) : null;
    if (updateData.compressedSize !== undefined) updateData.compressedSize = updateData.compressedSize !== null ? Number(updateData.compressedSize) : null;
    if (updateData.duration !== undefined) updateData.duration = updateData.duration !== null ? Number(updateData.duration) : null;
    if (updateData.backupLevel !== undefined) updateData.backupLevel = updateData.backupLevel !== null ? Number(updateData.backupLevel) : null;
    if (updateData.binlogPosition !== undefined) updateData.binlogPosition = updateData.binlogPosition !== null ? Number(updateData.binlogPosition) : null;

    const job = await prisma.backupJob.update({
      where: { id },
      data: updateData,
      include: {
        storageLocation: true,
      },
    });

    log.debug('Backup job updated', { id: job.id, status: job.status });
    res.json(job);
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: `Backup job '${req.params.id}' not found` });
      return;
    }
    next(error);
  }
});

// Query jobs list
app.get('/api/jobs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      status,
      dbType,
      dbName,
      since,
      limit,
      take,
      skip,
      orderBy = 'desc',
      countOnly,
    } = req.query;

    const where: any = {};

    if (status) {
      const statusArr = (status as string).split(',').map((s) => s.trim());
      where.status = statusArr.length > 1 ? { in: statusArr } : statusArr[0];
    }

    if (dbType) where.dbType = String(dbType);
    if (dbName) where.dbName = String(dbName);
    if (since) where.startedAt = { gte: new Date(String(since)) };

    if (countOnly === 'true') {
      const count = await prisma.backupJob.count({ where });
      res.json({ count });
      return;
    }

    const pageSize = limit ? parseInt(String(limit), 10) : take ? parseInt(String(take), 10) : undefined;
    const pageSkip = skip ? parseInt(String(skip), 10) : undefined;

    const [jobs, total] = await Promise.all([
      prisma.backupJob.findMany({
        where,
        take: pageSize,
        skip: pageSkip,
        orderBy: { startedAt: orderBy === 'asc' ? 'asc' : 'desc' },
        include: { storageLocation: true },
      }),
      prisma.backupJob.count({ where }),
    ]);

    res.json({
      success: true,
      jobs,
      total,
    });
  } catch (error) {
    next(error);
  }
});

// Active jobs query
app.get('/api/jobs-active', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const jobs = await prisma.backupJob.findMany({
      where: {
        status: { in: ['running', 'RUNNING', 'pending', 'PENDING'] },
      },
      include: { storageLocation: true },
      orderBy: { startedAt: 'desc' },
    });

    res.json({
      success: true,
      jobs,
    });
  } catch (error) {
    next(error);
  }
});

// Jobs telemetry stats summary for dashboard
app.get('/api/jobs-stats', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sinceDate = req.query.since
      ? new Date(String(req.query.since))
      : new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [activeJobs, countSince, failedSince, totalJobs, recentFailed] = await Promise.all([
      prisma.backupJob.count({
        where: { status: { in: ['running', 'RUNNING', 'pending', 'PENDING'] } },
      }),
      prisma.backupJob.count({
        where: { startedAt: { gte: sinceDate } },
      }),
      prisma.backupJob.count({
        where: {
          startedAt: { gte: sinceDate },
          status: { in: ['failed', 'FAILED'] },
        },
      }),
      prisma.backupJob.count(),
      prisma.backupJob.findMany({
        where: {
          status: { in: ['failed', 'FAILED'] },
          startedAt: { gte: sinceDate },
        },
        orderBy: { startedAt: 'desc' },
        take: 5,
      }),
    ]);

    res.json({
      success: true,
      activeJobs,
      countSince,
      failedSince,
      totalJobs,
      recentFailed,
    });
  } catch (error) {
    next(error);
  }
});

// ==================== Backup Logs Endpoints ====================

// Append log to job
app.post('/api/jobs/:id/logs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { level, message, details, timestamp } = req.body;

    if (!level || !message) {
      res.status(400).json({ error: 'Validation error: level and message are required' });
      return;
    }

    const logEntry = await prisma.backupLog.create({
      data: {
        backupJobId: id,
        level: String(level).toUpperCase(),
        message: String(message),
        details: details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
      },
    });

    res.status(201).json(logEntry);
  } catch (error) {
    next(error);
  }
});

// Get logs for a specific job
app.get('/api/jobs/:id/logs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const logs = await prisma.backupLog.findMany({
      where: { backupJobId: id },
      orderBy: { timestamp: 'asc' },
    });

    res.json({
      success: true,
      logs,
    });
  } catch (error) {
    next(error);
  }
});

// Query logs across jobs
app.get('/api/logs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { backupJobId, level, limit, take, skip, orderBy = 'desc' } = req.query;
    const where: any = {};

    if (backupJobId) where.backupJobId = String(backupJobId);
    if (level) where.level = String(level).toUpperCase();

    const pageSize = limit ? parseInt(String(limit), 10) : take ? parseInt(String(take), 10) : undefined;
    const pageSkip = skip ? parseInt(String(skip), 10) : undefined;

    const logs = await prisma.backupLog.findMany({
      where,
      take: pageSize,
      skip: pageSkip,
      orderBy: { timestamp: orderBy === 'asc' ? 'asc' : 'desc' },
    });

    res.json({
      success: true,
      logs,
    });
  } catch (error) {
    next(error);
  }
});

// ==================== Schedules Endpoints ====================

// List schedules
app.get('/api/schedules', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { enabled, countOnly } = req.query;
    const where: any = {};
    if (enabled !== undefined) {
      where.enabled = enabled === 'true';
    }

    if (countOnly === 'true') {
      const count = await prisma.backupSchedule.count({ where });
      res.json({ count });
      return;
    }

    const schedules = await prisma.backupSchedule.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      schedules,
    });
  } catch (error) {
    next(error);
  }
});

// Get schedule by ID
app.get('/api/schedules/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const schedule = await prisma.backupSchedule.findUnique({
      where: { id },
    });

    if (!schedule) {
      res.status(404).json({ error: `Schedule '${id}' not found` });
      return;
    }

    res.json(schedule);
  } catch (error) {
    next(error);
  }
});

// Create schedule
app.post('/api/schedules', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      name,
      dbType,
      dbName,
      schedule,
      backupType,
      compress = true,
      storageType = 'local',
      retention = 30,
      enabled = true,
      notifyOnSuccess = false,
      notifyOnError = true,
      slackWebhook,
      emailRecipients,
      metadata,
      createdBy,
    } = req.body;

    if (!dbType || !dbName || !schedule || !backupType) {
      res.status(400).json({
        error: 'Validation error: dbType, dbName, schedule, and backupType are required',
      });
      return;
    }

    const newSchedule = await prisma.backupSchedule.create({
      data: {
        name: name || `${dbType}_${dbName}_backup`,
        dbType,
        dbName,
        schedule,
        backupType,
        compress: Boolean(compress),
        storageType,
        retention: Number(retention) || 30,
        enabled: Boolean(enabled),
        notifyOnSuccess: Boolean(notifyOnSuccess),
        notifyOnError: Boolean(notifyOnError),
        slackWebhook: slackWebhook ?? null,
        emailRecipients: emailRecipients ?? null,
        metadata: metadata ?? null,
        createdBy: createdBy ?? null,
      },
    });

    res.status(201).json(newSchedule);
  } catch (error) {
    next(error);
  }
});

// Update schedule
app.patch('/api/schedules/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const updateData: any = { ...req.body };

    if (updateData.lastRunAt) updateData.lastRunAt = new Date(updateData.lastRunAt);
    if (updateData.nextRunAt) updateData.nextRunAt = new Date(updateData.nextRunAt);

    const updated = await prisma.backupSchedule.update({
      where: { id },
      data: updateData,
    });

    res.json(updated);
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: `Schedule '${req.params.id}' not found` });
      return;
    }
    next(error);
  }
});

// Delete schedule
app.delete('/api/schedules/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    await prisma.backupSchedule.delete({
      where: { id },
    });

    res.json({ success: true, message: `Schedule '${id}' deleted` });
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: `Schedule '${req.params.id}' not found` });
      return;
    }
    next(error);
  }
});

// ==================== Storage Locations Endpoints ====================

// List storage locations
app.get('/api/storage', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { enabled, countOnly } = req.query;
    const where: any = {};
    if (enabled !== undefined) {
      where.enabled = enabled === 'true';
    }

    if (countOnly === 'true') {
      const count = await prisma.storageLocation.count({ where });
      res.json({ count });
      return;
    }

    const storages = await prisma.storageLocation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      storages,
    });
  } catch (error) {
    next(error);
  }
});

// Get default storage location
app.get('/api/storage-default', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storage = await prisma.storageLocation.findFirst({
      where: { default: true, enabled: true },
    });

    if (!storage) {
      res.status(404).json({ error: 'No default storage location found' });
      return;
    }

    res.json(storage);
  } catch (error) {
    next(error);
  }
});

// Get storage location by ID or Name
app.get('/api/storage/:idOrName', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idOrName = req.params.idOrName as string;

    let storage = await prisma.storageLocation.findUnique({
      where: { id: idOrName },
    });

    if (!storage) {
      storage = await prisma.storageLocation.findUnique({
        where: { name: idOrName },
      });
    }

    if (!storage) {
      res.status(404).json({ error: `Storage location '${idOrName}' not found` });
      return;
    }

    res.json(storage);
  } catch (error) {
    next(error);
  }
});

// Create or upsert storage location
app.post('/api/storage', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      id,
      name,
      type,
      config,
      bucket,
      region,
      accessKey,
      secretKey,
      enabled = true,
      default: isDefault = false,
    } = req.body;

    if (!name || !type) {
      res.status(400).json({ error: 'Validation error: name and type are required' });
      return;
    }

    // If marked default, unset existing defaults first
    if (isDefault) {
      await prisma.storageLocation.updateMany({
        where: { default: true },
        data: { default: false },
      });
    }

    const storage = await prisma.storageLocation.upsert({
      where: { name: String(name) },
      update: {
        type: String(type),
        config: config ?? null,
        bucket: bucket ?? null,
        region: region ?? null,
        accessKey: accessKey ?? null,
        secretKey: secretKey ?? null,
        enabled: Boolean(enabled),
        default: Boolean(isDefault),
      },
      create: {
        ...(id ? { id: String(id) } : {}),
        name: String(name),
        type: String(type),
        config: config ?? null,
        bucket: bucket ?? null,
        region: region ?? null,
        accessKey: accessKey ?? null,
        secretKey: secretKey ?? null,
        enabled: Boolean(enabled),
        default: Boolean(isDefault),
      },
    });

    res.status(201).json(storage);
  } catch (error) {
    next(error);
  }
});

// Update storage location by ID
app.patch('/api/storage/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { default: isDefault, ...otherFields } = req.body;

    if (isDefault) {
      await prisma.storageLocation.updateMany({
        where: { default: true },
        data: { default: false },
      });
    }

    const updateData: any = { ...otherFields };
    if (isDefault !== undefined) updateData.default = Boolean(isDefault);

    const storage = await prisma.storageLocation.update({
      where: { id },
      data: updateData,
    });

    res.json(storage);
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: `Storage location '${req.params.id}' not found` });
      return;
    }
    next(error);
  }
});

// Set default storage location
app.post('/api/storage/:idOrName/default', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idOrName = req.params.idOrName as string;

    let storage = await prisma.storageLocation.findUnique({
      where: { id: idOrName },
    });

    if (!storage) {
      storage = await prisma.storageLocation.findUnique({
        where: { name: idOrName },
      });
    }

    if (!storage) {
      res.status(404).json({ error: `Storage location '${idOrName}' not found` });
      return;
    }

    // Clear previous defaults
    await prisma.storageLocation.updateMany({
      where: { default: true },
      data: { default: false },
    });

    const updated = await prisma.storageLocation.update({
      where: { id: storage.id },
      data: { default: true },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// Delete storage location
app.delete('/api/storage/:idOrName', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idOrName = req.params.idOrName as string;

    let storage = await prisma.storageLocation.findUnique({
      where: { id: idOrName },
    });

    if (!storage) {
      storage = await prisma.storageLocation.findUnique({
        where: { name: idOrName },
      });
    }

    if (!storage) {
      res.status(404).json({ error: `Storage location '${idOrName}' not found` });
      return;
    }

    await prisma.storageLocation.delete({
      where: { id: storage.id },
    });

    res.json({ success: true, message: `Storage location '${idOrName}' deleted` });
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: `Storage location '${req.params.idOrName}' not found` });
      return;
    }
    next(error);
  }
});

// ==================== Notification Configs Endpoints ====================

// List all notification configs
app.get('/api/notifications/config', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { countOnly } = req.query;
    if (countOnly === 'true') {
      const count = await prisma.notificationConfig.count();
      res.json({ count });
      return;
    }

    const configs = await prisma.notificationConfig.findMany();
    res.json({
      success: true,
      configs,
    });
  } catch (error) {
    next(error);
  }
});

// Get notification config by type ('email' | 'slack')
app.get('/api/notifications/config/:type', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const type = req.params.type as string;
    const config = await prisma.notificationConfig.findUnique({
      where: { type },
    });

    if (!config) {
      res.status(404).json({ error: `Notification config for '${type}' not found` });
      return;
    }

    res.json(config);
  } catch (error) {
    next(error);
  }
});

// Upsert notification config
app.post('/api/notifications/config/:type', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const type = req.params.type as string;
    const {
      enabled = true,
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPassword,
      from,
      to,
      webhook,
    } = req.body;

    const config = await prisma.notificationConfig.upsert({
      where: { type },
      update: {
        enabled: Boolean(enabled),
        smtpHost: smtpHost !== undefined ? smtpHost : undefined,
        smtpPort: smtpPort !== undefined ? (smtpPort ? Number(smtpPort) : null) : undefined,
        smtpUser: smtpUser !== undefined ? smtpUser : undefined,
        smtpPassword: smtpPassword !== undefined ? smtpPassword : undefined,
        from: from !== undefined ? from : undefined,
        to: to !== undefined ? to : undefined,
        webhook: webhook !== undefined ? webhook : undefined,
      },
      create: {
        type,
        enabled: Boolean(enabled),
        smtpHost: smtpHost ?? null,
        smtpPort: smtpPort ? Number(smtpPort) : null,
        smtpUser: smtpUser ?? null,
        smtpPassword: smtpPassword ?? null,
        from: from ?? null,
        to: to ?? null,
        webhook: webhook ?? null,
      },
    });

    res.json(config);
  } catch (error) {
    next(error);
  }
});

// Delete notification config
app.delete('/api/notifications/config/:type', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const type = req.params.type as string;
    await prisma.notificationConfig.delete({
      where: { type },
    });

    res.json({ success: true, message: `Notification config for '${type}' deleted` });
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: `Notification config for '${req.params.type}' not found` });
      return;
    }
    next(error);
  }
});

// ==================== Notification History Audit Endpoints ====================

// Record notification sent
app.post('/api/notifications', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      backupJobId,
      type,
      status,
      recipient,
      subject,
      message,
      sentAt,
      error,
      retryCount = 0,
    } = req.body;

    if (!type || !status) {
      res.status(400).json({ error: 'Validation error: type and status are required' });
      return;
    }

    const notification = await prisma.notification.create({
      data: {
        backupJobId: backupJobId ?? null,
        type: String(type),
        status: String(status),
        recipient: recipient ?? null,
        subject: subject ?? null,
        message: message ?? null,
        sentAt: sentAt ? new Date(sentAt) : new Date(),
        error: error ?? null,
        retryCount: Number(retryCount) || 0,
      },
    });

    res.status(201).json(notification);
  } catch (error) {
    next(error);
  }
});

// ==================== Central Error Handling ====================

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  log.error('Metadata service internal error', { error: message, stack: err.stack });
  res.status(500).json({
    error: 'Internal metadata error',
    message,
  });
});

// ==================== Server Initialization ====================

export let server: any = null;

export async function startMetadataService(port = PORT, host = HOST): Promise<any> {
  try {
    await connectDatabase();
  } catch (err: any) {
    log.error('Initial database connection failed, will retry on requests', { error: err?.message || String(err) });
  }
  return new Promise((resolve) => {
    server = app.listen(port, host, () => {
      log.info(`Metadata Service listening on http://${host}:${port}`);
      resolve(server);
    });
  });
}

export async function stopMetadataService(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err: any) => (err ? reject(err) : resolve()));
    });
    server = null;
  }
  await disconnectDatabase();
  log.info('Metadata Service stopped and database disconnected');
}

if (require.main === module) {
  startMetadataService().catch((err) => {
    log.error('Failed to start Metadata Service', { error: err });
    process.exit(1);
  });

  process.on('SIGTERM', async () => {
    log.info('SIGTERM received, shutting down gracefully');
    await stopMetadataService();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    log.info('SIGINT received, shutting down gracefully');
    await stopMetadataService();
    process.exit(0);
  });
}
