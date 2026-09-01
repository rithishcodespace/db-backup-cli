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
