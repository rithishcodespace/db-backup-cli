const Module = require('module');
const { createMockMetadataClient } = require('./mocks');

function withMockedModules(mocks, loadModule) {
  const originalLoad = Module._load;

  const effectiveMocks = { ...mocks };
  const prismaMock =
    effectiveMocks['../lib/prisma']?.prisma ||
    effectiveMocks['../../lib/prisma']?.prisma;

  if (prismaMock && !effectiveMocks['../lib/metadata-client']) {
    const metaMock = createMockMetadataClient(prismaMock);
    effectiveMocks['../lib/metadata-client'] = metaMock;
    effectiveMocks['../../lib/metadata-client'] = metaMock;
  }
  if (effectiveMocks['../lib/metadata-client'] && !effectiveMocks['../../lib/metadata-client']) {
    effectiveMocks['../../lib/metadata-client'] = effectiveMocks['../lib/metadata-client'];
  }
  if (effectiveMocks['../../lib/metadata-client'] && !effectiveMocks['../lib/metadata-client']) {
    effectiveMocks['../lib/metadata-client'] = effectiveMocks['../../lib/metadata-client'];
  }

  Module._load = function(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(effectiveMocks, request)) {
      return effectiveMocks[request];
    }

    if (request.endsWith('/lib/metadata-client')) {
      if (effectiveMocks['../lib/metadata-client']) return effectiveMocks['../lib/metadata-client'];
      if (effectiveMocks['../../lib/metadata-client']) return effectiveMocks['../../lib/metadata-client'];
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const result = loadModule();
    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        Module._load = originalLoad;
      });
    }
    Module._load = originalLoad;
    return result;
  } catch (err) {
    Module._load = originalLoad;
    throw err;
  }
}

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

module.exports = {
  withMockedModules,
  clearModule,
};
