function createNoopLogger() {
  const logger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
    child() {
      return logger;
    },
  };

  return logger;
}

function createOraMock() {
  const events = [];

  function spinnerFactory(message) {
    const spinner = {
      text: message,
      start() {
        events.push({ type: 'start', message: this.text });
        return this;
      },
      succeed(message) {
        events.push({ type: 'succeed', message });
        return this;
      },
      fail(message) {
        events.push({ type: 'fail', message });
        return this;
      },
      stop() {
        events.push({ type: 'stop' });
        return this;
      },
    };

    return spinner;
  }

  spinnerFactory.events = events;
  return spinnerFactory;
}

function createAxiosMock(overrides = {}) {
  const mock = {
    get: overrides.get || (async () => ({ data: { success: true, status: 'healthy' } })),
    post: overrides.post || (async () => ({ data: { success: true } })),
    patch: overrides.patch || (async () => ({ data: { success: true } })),
    put: overrides.put || (async () => ({ data: { success: true } })),
    delete: overrides.delete || (async () => ({ data: { success: true } })),
    isAxiosError: overrides.isAxiosError || (() => false),
  };
  mock.create = () => mock;
  return mock;
}

function createProcessExitInterceptor() {
  const calls = [];
  const originalExit = process.exit;

  process.exit = ((code) => {
    calls.push(code);
    throw new Error(`process.exit:${code}`);
  });

  return {
    calls,
    restore() {
      process.exit = originalExit;
    },
  };
}

function createMockMetadataClient(prisma = {}) {
  const client = {
    getBaseUrl: () => 'http://127.0.0.1:3005',
    health: async () => {
      if (prisma?.backupJob?.findMany) {
        await prisma.backupJob.findMany();
      }
      return { status: 'healthy', database: 'connected' };
    },
    getJob: async (id) => {
      if (prisma?.backupJob?.findUnique) {
        return prisma.backupJob.findUnique({ where: { id } });
      }
      return null;
    },
    listJobs: async (options = {}) => {
      if (prisma?.backupJob?.findMany) {
        return prisma.backupJob.findMany({ where: options.where, orderBy: options.orderBy, take: options.limit });
      }
      return [];
    },
    createJob: async (data) => {
      if (prisma?.backupJob?.create) {
        return prisma.backupJob.create({ data });
      }
      return { id: data.id || 'job-mock-1', ...data };
    },
    updateJob: async (id, data) => {
      if (prisma?.backupJob?.update) {
        return prisma.backupJob.update({ where: { id }, data });
      }
      return { id, ...data };
    },
    getActiveJobs: async () => [],
    getJobStats: async () => ({ total: 0, completed: 0, failed: 0 }),
    getJobLogs: async () => [],
    createJobLog: async (id, level, message, metadata) => {
      if (prisma?.backupLog?.create) {
        return prisma.backupLog.create({ data: { backupJobId: id, level, message, metadata } });
      }
      return { id: 'log-1', backupJobId: id, level, message };
    },
    listLogs: async () => [],
    getStorage: async (idOrName) => {
      if (prisma?.storageLocation?.findUnique) {
        return prisma.storageLocation.findUnique({ where: { name: idOrName } }) ||
               prisma.storageLocation.findUnique({ where: { id: idOrName } });
      }
      if (prisma?.storageLocation?.findFirst) {
        return prisma.storageLocation.findFirst({ where: { name: idOrName } });
      }
      return null;
    },
    getDefaultStorage: async () => {
      if (prisma?.storageLocation?.findFirst) {
        return prisma.storageLocation.findFirst({ where: { default: true } });
      }
      return null;
    },
    listStorage: async () => {
      if (prisma?.storageLocation?.findMany) {
        return prisma.storageLocation.findMany();
      }
      return [];
    },
    createStorage: async (data) => {
      if (prisma?.storageLocation?.create) {
        return prisma.storageLocation.create({ data });
      }
      return { id: 'storage-mock-1', ...data };
    },
    updateStorage: async (id, data) => {
      if (prisma?.storageLocation?.update) {
        return prisma.storageLocation.update({ where: { id }, data });
      }
      return { id, ...data };
    },
    setDefaultStorage: async () => ({ success: true }),
    deleteStorage: async (idOrName) => {
      if (prisma?.storageLocation?.delete) {
        return prisma.storageLocation.delete({ where: { id: idOrName } });
      }
      return { success: true };
    },
    getNotificationConfig: async (type) => {
      if (prisma?.notificationConfig?.findUnique) {
        return prisma.notificationConfig.findUnique({ where: { type } });
      }
      return null;
    },
    upsertNotificationConfig: async (type, data) => {
      if (prisma?.notificationConfig?.upsert) {
        return prisma.notificationConfig.upsert({
          where: { type },
          update: data,
          create: { type, ...data },
        });
      }
      return { type, ...data };
    },
    deleteNotificationConfig: async (type) => {
      if (prisma?.notificationConfig?.delete) {
        return prisma.notificationConfig.delete({ where: { type } });
      }
      return { type };
    },
    listSchedules: async () => {
      if (prisma?.backupSchedule?.findMany) {
        return prisma.backupSchedule.findMany();
      }
      return [];
    },
    getSchedule: async (id) => {
      if (prisma?.backupSchedule?.findUnique) {
        return prisma.backupSchedule.findUnique({ where: { id } });
      }
      return null;
    },
    createSchedule: async (data) => {
      if (prisma?.backupSchedule?.create) {
        return prisma.backupSchedule.create({ data });
      }
      return { id: 'schedule-mock-1', ...data };
    },
    updateSchedule: async (id, data) => {
      if (prisma?.backupSchedule?.update) {
        return prisma.backupSchedule.update({ where: { id }, data });
      }
      return { id, ...data };
    },
    deleteSchedule: async (id) => {
      if (prisma?.backupSchedule?.delete) {
        return prisma.backupSchedule.delete({ where: { id } });
      }
      return { success: true };
    },
  };

  class MockMetadataClientClass {
    constructor() {
      return client;
    }
  }

  return {
    metadataClient: client,
    MetadataClient: MockMetadataClientClass,
    default: client,
  };
}

module.exports = {
  createNoopLogger,
  createOraMock,
  createAxiosMock,
  createProcessExitInterceptor,
  createMockMetadataClient,
};

