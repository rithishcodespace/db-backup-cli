#!/usr/bin/env node
/**
 * DBVault Postinstall Notice
 * Checks Docker availability and provides a friendly initial setup hint.
 * Never throws or exits with non-zero to ensure npm install succeeds seamlessly.
 */

const { execSync } = require('child_process');

function checkDocker() {
  try {
    // 1. Check if Docker CLI is installed
    try {
      execSync('docker --version', { stdio: 'pipe', timeout: 3000 });
    } catch {
      console.log('\n💡 Tip: DBVault uses Docker to run background database engines.');
      console.log('   Please install Docker Desktop: https://www.docker.com/products/docker-desktop/\n');
      return;
    }

    // 2. Check if Docker daemon is actively running
    try {
      execSync('docker info', { stdio: 'pipe', timeout: 4000 });
      console.log('\n✨ DBVault installed successfully! Docker is ready.');
      console.log('   Run "dbvault start" to launch background services.\n');
    } catch {
      console.log('\n💡 Tip: Docker is installed, but the Docker daemon is currently stopped.');
      console.log('   Remember to launch Docker Desktop before running "dbvault start".\n');
    }
  } catch {
    // Non-blocking catch-all
  }
}

checkDocker();
process.exit(0);
