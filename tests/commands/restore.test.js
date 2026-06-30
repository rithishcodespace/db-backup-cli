require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { Command } = require('commander');

const { makeTempDir, cleanupTempDir } = require('../helpers/temp-dir');
const { withMockedModules, clearModule } = require('../helpers/mock-require');
const { createNoopLogger, createOraMock, createProcessExitInterceptor } = require('../helpers/mocks');

const modulePath = '../../src/commands/restore.ts';

function loadRestoreCommand(overrides = {}) {
  const ora = createOraMock();
  const prisma = overrides.prisma || {
    backupJob: {
      findUnique: async () => null,
    },
  };
  const config = overrides.config || {
    get(key) {
      if (key === 'database') {
        return {
          type: 'postgresql',
          host: 'localhost',
          username: 'app',
          password: 'secret',
          database: 'appdb',
        };
      }

      return undefined;
    },
  };

  return withMockedModules(
    {
      ora,
      '../logger': { createModuleLogger: () => createNoopLogger() },
      '../config': { config },
      '../lib/prisma': { prisma },
    },
    () => {
      clearModule(modulePath);
      return { ...require(modulePath), ora, prisma, config };
    }
  );
}

test('restore command completes a dry run for a local file', async () => {
  const tmpDir = makeTempDir();

  try {
    const backupFile = path.join(tmpDir, 'backup.sql');
    fs.writeFileSync(backupFile, 'restore me');

    const { registerRestoreCommand } = loadRestoreCommand();
    const program = new Command();
    registerRestoreCommand(program);

    await program.parseAsync([
      'node',
      'db-backup',
      'restore',
      '--file',
      backupFile,
      '--dry-run',
    ]);

    assert.equal(fs.existsSync(backupFile), true);
  } finally {
    cleanupTempDir(tmpDir);
  }
});

test('restore command verifies checksum when restoring by backup id', async () => {
  const tmpDir = makeTempDir();

  try {
    const backupFile = path.join(tmpDir, 'backup.sql');
    const payload = 'checksum-content';
    fs.writeFileSync(backupFile, payload);
    const checksum = crypto.createHash('sha256').update(payload).digest('hex');

    const { registerRestoreCommand } = loadRestoreCommand({
      prisma: {
        backupJob: {
          findUnique: async () => ({
            id: 'backup-1',
            filePath: backupFile,
            backupType: 'full',
            dbType: 'postgresql',
            dbName: 'appdb',
            fileSize: 1024,
            startedAt: new Date('2026-06-30T00:00:00Z'),
            checksum,
            storageLocation: null,
          }),
        },
      },
    });

    const program = new Command();
    registerRestoreCommand(program);

    await program.parseAsync([
      'node',
      'db-backup',
      'restore',
      '--id',
      'backup-1',
      '--dry-run',
    ]);
  } finally {
    cleanupTempDir(tmpDir);
  }
});

test('restore command exits when the backup file is missing', async () => {
  const exit = createProcessExitInterceptor();

  try {
    const { registerRestoreCommand } = loadRestoreCommand();
    const program = new Command();
    registerRestoreCommand(program);

    await assert.rejects(
      program.parseAsync(['node', 'db-backup', 'restore', '--file', '/does/not/exist.sql']),
      /process\.exit:1/
    );
  } finally {
    exit.restore();
  }
});
