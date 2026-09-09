#!/usr/bin/env node

/**
 * Global Version Manager for DBVault
 *
 * package.json is the single source of truth for the DBVault version.
 * This script synchronizes the version across:
 *  - package.json
 *  - package-lock.json
 *  - docker-compose.yml (default fallback tag)
 *  - dashboard/package.json
 *
 * Usage:
 *   node scripts/set-version.js <new-version>   # Set new version everywhere
 *   node scripts/set-version.js --sync          # Sync all files to current package.json version
 *   node scripts/set-version.js --get           # Print current global version
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(REPO_ROOT, 'package.json');
const LOCK_PATH = path.join(REPO_ROOT, 'package-lock.json');
const COMPOSE_PATH = path.join(REPO_ROOT, 'docker-compose.yml');
const DASHBOARD_PKG_PATH = path.join(REPO_ROOT, 'dashboard', 'package.json');
const DASHBOARD_LOCK_PATH = path.join(REPO_ROOT, 'dashboard', 'package-lock.json');

const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function getCurrentVersion() {
  const pkg = readJson(PKG_PATH);
  return pkg.version;
}

function syncVersion(targetVersion) {
  if (!SEMVER_REGEX.test(targetVersion)) {
    console.error(`❌ Invalid semver version: "${targetVersion}". Expected format: X.Y.Z (e.g. 1.0.1)`);
    process.exit(1);
  }

  console.log(`\n📦 Synchronizing global version to: ${targetVersion}`);
  const updatedFiles = [];

  // 1. package.json (single source of truth)
  const pkg = readJson(PKG_PATH);
  if (pkg.version !== targetVersion) {
    pkg.version = targetVersion;
    writeJson(PKG_PATH, pkg);
    updatedFiles.push('package.json');
  }

  // 2. package-lock.json
  if (fs.existsSync(LOCK_PATH)) {
    const lock = readJson(LOCK_PATH);
    let lockChanged = false;
    if (lock.version !== targetVersion) {
      lock.version = targetVersion;
      lockChanged = true;
    }
    if (lock.packages && lock.packages[''] && lock.packages[''].version !== targetVersion) {
      lock.packages[''].version = targetVersion;
      lockChanged = true;
    }
    if (lockChanged) {
      writeJson(LOCK_PATH, lock);
      updatedFiles.push('package-lock.json');
    }
  }

  // 3. docker-compose.yml
  if (fs.existsSync(COMPOSE_PATH)) {
    let compose = fs.readFileSync(COMPOSE_PATH, 'utf8');
    const composeRegex = /(\$\{VERSION:-)[^}]+(\})/;
    if (composeRegex.test(compose)) {
      const newCompose = compose.replace(composeRegex, `$1${targetVersion}$2`);
      if (newCompose !== compose) {
        fs.writeFileSync(COMPOSE_PATH, newCompose, 'utf8');
        updatedFiles.push('docker-compose.yml');
      }
    }
  }

  // 4. dashboard/package.json
  if (fs.existsSync(DASHBOARD_PKG_PATH)) {
    const dashPkg = readJson(DASHBOARD_PKG_PATH);
    if (dashPkg.version !== targetVersion) {
      dashPkg.version = targetVersion;
      writeJson(DASHBOARD_PKG_PATH, dashPkg);
      updatedFiles.push('dashboard/package.json');
    }
  }

  // 5. dashboard/package-lock.json
  if (fs.existsSync(DASHBOARD_LOCK_PATH)) {
    const dashLock = readJson(DASHBOARD_LOCK_PATH);
    let dashLockChanged = false;
    if (dashLock.version !== targetVersion) {
      dashLock.version = targetVersion;
      dashLockChanged = true;
    }
    if (dashLock.packages && dashLock.packages[''] && dashLock.packages[''].version !== targetVersion) {
      dashLock.packages[''].version = targetVersion;
      dashLockChanged = true;
    }
    if (dashLockChanged) {
      writeJson(DASHBOARD_LOCK_PATH, dashLock);
      updatedFiles.push('dashboard/package-lock.json');
    }
  }

  if (updatedFiles.length > 0) {
    console.log('✅ Updated version in:');
    updatedFiles.forEach((f) => console.log(`   - ${f}`));
  } else {
    console.log('✨ All files already in sync with target version.');
  }

  console.log(`\n🎉 Global version is now ${targetVersion}!`);
  console.log('   All CLI, service health endpoints, Swagger docs, and Docker runtimes');
  console.log('   dynamically read from this single source of truth.\n');
}

function main() {
  const arg = process.argv[2];

  if (!arg || arg === '--help' || arg === '-h') {
    console.log(`
DBVault Global Version Tool

Commands:
  node scripts/set-version.js <version>   Set version in package.json and sync everywhere
  node scripts/set-version.js --sync      Sync docker-compose and lockfiles with package.json
  node scripts/set-version.js --get       Print current version (${getCurrentVersion()})
`);
    return;
  }

  if (arg === '--get') {
    console.log(getCurrentVersion());
    return;
  }

  if (arg === '--sync') {
    syncVersion(getCurrentVersion());
    return;
  }

  syncVersion(arg);
}

main();
