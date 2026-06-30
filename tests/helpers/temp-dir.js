const fs = require('fs');
const os = require('os');
const path = require('path');

function makeTempDir(prefix = 'db-backup-cli-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupTempDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

module.exports = {
  makeTempDir,
  cleanupTempDir,
};
