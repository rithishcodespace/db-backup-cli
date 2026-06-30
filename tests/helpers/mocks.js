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
  return {
    get: overrides.get || (async () => ({ data: { success: true, status: 'healthy' } })),
    post: overrides.post || (async () => ({ data: { success: true } })),
  };
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

module.exports = {
  createNoopLogger,
  createOraMock,
  createAxiosMock,
  createProcessExitInterceptor,
};
