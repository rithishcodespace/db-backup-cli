#!/usr/bin/env node

/**
 * scripts/verify-package.js
 *
 * Automated verification of the npm release package:
 * 1. Executes `npm pack` to generate the production tarball.
 * 2. Scans archive contents for strictly forbidden development files and secrets.
 * 3. Asserts required runtime production artifacts are included.
 * 4. Extracts/installs the package into an isolated temporary directory outside the repo.
 * 5. Executes smoke tests verifying version consistency and complete repository independence.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const pkgJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

console.log('📦 Starting DBVault Package Verification...\n');

// 1. Generate npm pack tarball
console.log('1. Packing npm tarball...');
let packOutput;
try {
  packOutput = execSync('npm pack', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
} catch (err) {
  console.error('❌ Failed to execute npm pack:', err.message);
  process.exit(1);
}

// Find generated .tgz file (last line of npm pack)
const lines = packOutput.split('\n');
const tarballName = lines[lines.length - 1].trim();
const tarballPath = path.join(REPO_ROOT, tarballName);

if (!fs.existsSync(tarballPath)) {
  console.error(`❌ Tarball not found at ${tarballPath}`);
  process.exit(1);
}
console.log(`✓ Created tarball: ${tarballName} (${(fs.statSync(tarballPath).size / 1024).toFixed(1)} kB)`);

// 2. Inspect tarball contents
console.log('\n2. Inspecting tarball contents...');
const tarListOutput = execSync(`tar -tf "${tarballPath}"`, { encoding: 'utf8' });
const files = tarListOutput
  .split('\n')
  .map((f) => f.replace(/^package\//, '').trim())
  .filter(Boolean);

console.log(`✓ Found ${files.length} packaged entries in tarball.`);

// Forbidden patterns
const forbiddenPatterns = [
  /^\.env/i,
  /\.env(\..+)?$/i,
  /\.db$/i,
  /\.db-wal$/i,
  /\.db-shm$/i,
  /\.db-journal$/i,
  /\.key$/i,
  /keys\.json$/i,
  /\.pem$/i,
  /\.cert$/i,
  /\.crt$/i,
  /^backups(\/|$)/i,
  /^logs(\/|$)/i,
  /^coverage(\/|$)/i,
  /^tests(\/|$)/i,
  /\.test\.(js|ts)$/i,
  /\.spec\.(js|ts)$/i,
  /^Dockerfile/i,
  /^node_modules(\/|$)/i,
  /^\.git(\/|$)/i,
  /^\.github(\/|$)/i,
];

const forbiddenViolations = [];
for (const file of files) {
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(file)) {
      forbiddenViolations.push({ file, pattern: pattern.toString() });
    }
  }
}

if (forbiddenViolations.length > 0) {
  console.error('❌ Security / Packaging Violation: Forbidden files found in npm package:');
  for (const v of forbiddenViolations) {
    console.error(`   - ${v.file} (matched ${v.pattern})`);
  }
  process.exit(1);
}
console.log('✓ Zero forbidden files found in package (no secrets, databases, logs, tests, or Dockerfiles).');

// Required runtime artifacts
const requiredPrefixes = [
  'bin/dbvault.js',
  'dist/src/index.js',
  'dashboard/dist/index.html',
  'generated/prisma/client.ts',
  'docker-compose.yml',
  'package.json',
  'README.md',
];

const missingRequired = requiredPrefixes.filter((req) => !files.includes(req));
if (missingRequired.length > 0) {
  console.error('❌ Package Validation Error: Missing required distribution files:');
  for (const req of missingRequired) {
    console.error(`   - ${req}`);
  }
  process.exit(1);
}
console.log('✓ All required production files present (bin, dist, dashboard/dist, generated, compose, docs).');

// 3. Smoke Test & Repository Independence
console.log('\n3. Testing CLI Smoke Test and Repository Independence...');
const tempTestDir = path.join(os.tmpdir(), `dbvault-ci-test-${Date.now()}`);
fs.mkdirSync(tempTestDir, { recursive: true });

try {
  // Install package tarball into temporary sandbox
  fs.writeFileSync(path.join(tempTestDir, 'package.json'), JSON.stringify({ name: 'ci-test', private: true }));
  execSync(`npm install --no-audit --no-fund "${tarballPath}"`, {
    cwd: tempTestDir,
    stdio: 'pipe',
  });

  const cliBin = path.join(tempTestDir, 'node_modules', '.bin', 'dbvault');

  // Verify binary exists
  if (!fs.existsSync(cliBin)) {
    throw new Error(`CLI binary not found at ${cliBin}`);
  }

  // Run --version from completely outside repo in an arbitrary isolated directory
  const isolatedDir = path.join(tempTestDir, 'isolated-cwd');
  fs.mkdirSync(isolatedDir, { recursive: true });

  const versionOutput = execSync(`node "${cliBin}" --version`, {
    cwd: isolatedDir,
    encoding: 'utf8',
  }).trim();

  console.log(`✓ CLI executed outside repository from ${isolatedDir}`);
  console.log(`  Package version: ${pkgJson.version}`);
  console.log(`  CLI reported:    ${versionOutput}`);

  if (versionOutput !== pkgJson.version) {
    throw new Error(`Version mismatch: package.json has ${pkgJson.version}, but CLI reported ${versionOutput}`);
  }
  console.log('✓ Version consistency verified.');

  // Run --help from isolated directory
  const helpOutput = execSync(`node "${cliBin}" --help`, {
    cwd: isolatedDir,
    encoding: 'utf8',
  });

  if (!helpOutput.includes('Usage: dbvault [options] [command]')) {
    throw new Error('CLI help output does not contain expected usage header.');
  }
  console.log('✓ CLI help menu successfully rendered outside repository.');

  // Verify no unwanted files created in the isolated current working directory
  const createdFiles = fs.readdirSync(isolatedDir);
  if (createdFiles.length > 0) {
    throw new Error(`CLI polluted current working directory with files: ${createdFiles.join(', ')}`);
  }
  console.log('✓ Zero directory pollution: CWD remained completely clean.');

} finally {
  // Clean up temporary test sandbox
  try {
    fs.rmSync(tempTestDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup error
  }
}

console.log('\n✨ DBVault Release Package Verification PASSED!\n');
process.exit(0);
