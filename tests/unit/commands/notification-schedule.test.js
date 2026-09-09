require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const { Command } = require('commander');

const { withMockedModules, clearModule } = require('../../helpers/mock-require');
const { createNoopLogger, createOraMock, createProcessExitInterceptor } = require('../../helpers/mocks');

const path = require('path');
const notificationModulePath = path.resolve(__dirname, '../../../src/commands/notification.ts');
const scheduleModulePath = path.resolve(__dirname, '../../../src/commands/schedule.ts');

function loadNotificationCommand(overrides = {}) {
  const ora = createOraMock();
  const prisma = overrides.prisma || {
    notificationConfig: {
      findUnique: async () => null,
      upsert: async () => ({}),
      delete: async () => ({}),
    },
  };

  const httpClient = overrides.httpClient || overrides.axios || {
    post: async () => ({ status: 200, data: { ok: true } }),
    get: async () => ({ status: 200, data: {} }),
  };

  const loaded = withMockedModules(
    {
      ora,
      axios: httpClient,
      nodemailer: overrides.nodemailer || {
        createTransport: () => ({
          verify: async () => {},
          sendMail: async () => ({ messageId: 'msg-1' }),
        }),
      },
      '../logger': { createModuleLogger: () => createNoopLogger() },
      '../lib/prisma': { prisma },
      '../utils/http-client': { __esModule: true, default: httpClient, httpClient },
    },
    () => {
      clearModule(notificationModulePath);
      return { ...require(notificationModulePath), ora, prisma };
    }
  );

  return loaded;
}

function loadScheduleCommand(overrides = {}) {
  const ora = createOraMock();
  const prisma = overrides.prisma || {
    notificationConfig: {
      findUnique: async () => null,
    },
  };
  const config = overrides.config || {
    get(key) {
      if (key === 'database') {
        return {
          type: 'postgresql',
          host: 'localhost',
          database: 'appdb',
        };
      }

      return undefined;
    },
  };

  const httpClient = overrides.httpClient || overrides.axios || {
    post: async () => ({ data: { success: true, scheduleId: 'schedule-1', nextRun: 'tomorrow' } }),
    get: async () => ({ data: { success: true, schedules: [], activeCount: 0 } }),
  };

  const loaded = withMockedModules(
    {
      ora,
      axios: httpClient,
      '../logger': { createModuleLogger: () => createNoopLogger() },
      '../config': { config },
      '../lib/prisma': { prisma },
      '../utils/http-client': { __esModule: true, default: httpClient, httpClient },
    },
    () => {
      clearModule(scheduleModulePath);
      return { ...require(scheduleModulePath), ora, prisma, config };
    }
  );

  return loaded;
}

test('email notification configuration is saved and verified', async () => {
  const upserts = [];
  const { registerNotificationCommand } = loadNotificationCommand({
    prisma: {
      notificationConfig: {
        findUnique: async ({ where }) => {
          if (where.type === 'email') {
            return null;
          }

          return null;
        },
        upsert: async (payload) => {
          upserts.push(payload);
          return {};
        },
        delete: async () => ({}),
      },
    },
    nodemailer: {
      createTransport: () => ({
        verify: async () => {},
        sendMail: async () => ({ messageId: 'msg-1' }),
      }),
    },
  });

  const program = new Command();
  registerNotificationCommand(program);

  await program.parseAsync([
    'node',
    'dbvault',
    'notification',
    'email',
    'configure',
    '--smtp-host',
    'smtp.example.com',
    '--smtp-port',
    '587',
    '--smtp-user',
    'user@example.com',
    '--smtp-password',
    'secret',
    '--from',
    'user@example.com',
    '--to',
    'recipient@example.com',
  ]);

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].where.type, 'email');
  assert.equal(upserts[0].create.to, 'recipient@example.com');
});

test('slack notification configuration posts to the webhook and stores credentials', async () => {
  const upserts = [];
  const webhooks = [];
  const { registerNotificationCommand } = loadNotificationCommand({
    prisma: {
      notificationConfig: {
        findUnique: async ({ where }) => {
          if (where.type === 'slack') {
            return null;
          }

          return null;
        },
        upsert: async (payload) => {
          upserts.push(payload);
          return {};
        },
        delete: async () => ({}),
      },
    },
    axios: {
      post: async (url) => {
        webhooks.push(url);
        return { status: 200 };
      },
    },
  });

  const program = new Command();
  registerNotificationCommand(program);

  await program.parseAsync([
    'node',
    'dbvault',
    'notification',
    'slack',
    'configure',
    '--webhook',
    'https://hooks.slack.com/services/test',
  ]);

  assert.equal(webhooks[0], 'https://hooks.slack.com/services/test');
  assert.equal(upserts[0].where.type, 'slack');
});

test('schedule command validates cron expressions and sends schedule payloads', async () => {
  const payloads = [];
  const { registerScheduleCommand, registerScheduleListCommand } = loadScheduleCommand({
    prisma: {
      notificationConfig: {
        findUnique: async () => ({ enabled: true, smtpHost: 'smtp.example.com' }),
      },
    },
    axios: {
      post: async (url, payload) => {
        payloads.push({ url, payload });
        return { data: { success: true, scheduleId: 'schedule-1', nextRun: 'tomorrow' } };
      },
      get: async () => ({ data: { success: true, schedules: [], activeCount: 0 } }),
    },
  });

  const program = new Command();
  registerScheduleCommand(program);
  registerScheduleListCommand(program);

  await program.parseAsync([
    'node',
    'dbvault',
    'schedule',
    '--cron',
    '0 2 * * *',
    '--notify',
    'email,slack',
  ]);

  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].url, 'http://localhost:3020/api/schedule');
  assert.equal(payloads[0].payload.notification.providers.length, 2);
});

test('schedule command exits when cron is missing', async () => {
  const exit = createProcessExitInterceptor();

  try {
    const { registerScheduleCommand } = loadScheduleCommand();
    const program = new Command();
    registerScheduleCommand(program);

    await assert.rejects(
      program.parseAsync(['node', 'dbvault', 'schedule']),
      /process\.exit:1/
    );
  } finally {
    exit.restore();
  }
});
