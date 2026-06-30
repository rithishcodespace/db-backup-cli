const Module = require('module');

function withMockedModules(mocks, loadModule) {
  const originalLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return loadModule();
  } finally {
    Module._load = originalLoad;
  }
}

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

module.exports = {
  withMockedModules,
  clearModule,
};
