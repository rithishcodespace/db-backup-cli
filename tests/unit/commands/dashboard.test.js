require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Command } = require('commander');

const { withMockedModules, clearModule } = require('../../helpers/mock-require');
const { createNoopLogger, createOraMock, createProcessExitInterceptor } = require('../../helpers/mocks');

const path = require('path');
const modulePath = path.resolve(__dirname, '../../../src/commands/dashboard.ts');

function loadDashboardCommand(overrides = {}) {
  const ora = createOraMock();
  const httpMock = overrides.http || http;
  const execMock = overrides.exec || ((cmd, cb) => cb && cb(null));

  return withMockedModules(
    {
      ora,
      http: httpMock,
      child_process: { exec: execMock },
      '../logger': { logger: createNoopLogger() },
    },
    () => {
      clearModule(modulePath);
      return { ...require(modulePath), ora };
    }
  );
}

test('dashboard command detects reachable dashboard web server and opens browser', async () => {
  let commandExecuted = '';
  const fakeHttp = {
    get: (options, callback) => {
      callback({ statusCode: 200 });
      return { on: () => {} };
    },
  };

  const { registerDashboardCommand } = loadDashboardCommand({
    http: fakeHttp,
    exec: (cmd, cb) => {
      commandExecuted = cmd;
      if (cb) cb(null);
    },
  });

  const program = new Command();
  registerDashboardCommand(program);

  await program.parseAsync(['node', 'dbvault', 'dashboard', '--port', '5173']);

  assert.ok(commandExecuted.includes('http://localhost:5173'));
});

test('dashboard command exits when dashboard web server is unreachable', async () => {
  const exit = createProcessExitInterceptor();

  const fakeHttp = {
    get: (options, callback) => {
      const listeners = {};
      const req = {
        on: (event, fn) => {
          listeners[event] = fn;
        },
        destroy: () => {},
      };

      setTimeout(() => {
        if (listeners['error']) {
          listeners['error'](new Error('Connection refused'));
        }
      }, 10);

      return req;
    },
  };

  try {
    const { registerDashboardCommand } = loadDashboardCommand({
      http: fakeHttp,
    });

    const program = new Command();
    registerDashboardCommand(program);

    await assert.rejects(
      program.parseAsync(['node', 'dbvault', 'dashboard', '--port', '9999']),
      /process\.exit:1/
    );

    assert.equal(exit.calls.at(-1), 1);
  } finally {
    exit.restore();
  }
});
