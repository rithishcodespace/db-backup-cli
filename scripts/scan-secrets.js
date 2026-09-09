#!/usr/bin/env node

/**
 * Secret Leak Prevention Scanner
 * Scans git-tracked files for accidental credentials, private keys, API tokens, and secret strings.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// Patterns that identify potential secrets
const SECRET_PATTERNS = [
  {
    name: 'AWS Access Key ID',
    regex: /(?:^|[^A-Z0-9])(AKIA[0-9A-Z]{16})(?:[^A-Z0-9]|$)/,
  },
  {
    name: 'Private Key Header',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    name: 'Slack Webhook URL',
    regex: /https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9_]+\/B[a-zA-Z0-9_]+\/[a-zA-Z0-9_]+/,
    filter: (match) => !match.includes('T00000000') && !match.includes('T1/B2/token') && !match.includes('XXXXX'),
  },
  {
    name: 'GitHub Personal Access Token',
    regex: /ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82}/,
  },
  {
    name: 'Generic Bearer / API Token in Config',
    regex: /(?:api[_-]?key|secret[_-]?key|auth[_-]?token|bearer[_-]?token)\s*[:=]\s*['"][a-zA-Z0-9_\-]{32,}['"]/i,
    // Exclude placeholders
    filter: (match) => !match.toLowerCase().includes('example') && !match.toLowerCase().includes('placeholder') && !match.toLowerCase().includes('your_') && !match.toLowerCase().includes('test'),
  },
];

// Files to skip scanning (e.g. documentation, examples, test mocks)
const SKIP_PATTERNS = [
  /\.env\.example$/,
  /\.md$/,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.ico$/,
  /\.woff2?$/,
  /\.tgz$/,
  /^tests\/.*fixtures/,
  /^scripts\/scan-secrets\.js$/, // skip this scanner file itself
];

function shouldSkip(filePath) {
  return SKIP_PATTERNS.some((pattern) => pattern.test(filePath));
}

function main() {
  console.log('[scan-secrets] Checking git-tracked files for accidental secret leaks...');

  let trackedFiles = [];
  try {
    const stdout = execSync('git ls-files', { cwd: REPO_ROOT, encoding: 'utf8' });
    trackedFiles = stdout.split('\n').filter(Boolean);
  } catch (err) {
    console.error('[scan-secrets] Error running git ls-files:', err.message);
    process.exit(1);
  }

  // Also check if any .env or sensitive files are tracked
  const forbiddenFiles = trackedFiles.filter((f) => {
    const base = path.basename(f);
    return (
      (base.startsWith('.env') && base !== '.env.example') ||
      base.endsWith('.pem') ||
      base.endsWith('.key') ||
      base.endsWith('.p12') ||
      base.endsWith('.pfx') ||
      base.endsWith('.db') ||
      base.endsWith('.sqlite')
    );
  });

  if (forbiddenFiles.length > 0) {
    console.error('[scan-secrets] ❌ ERROR: Sensitive/environment files are tracked in git:');
    forbiddenFiles.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }

  let violations = [];

  for (const relPath of trackedFiles) {
    if (shouldSkip(relPath)) {
      continue;
    }

    const fullPath = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(fullPath)) continue;

    // Check if binary
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) continue;
    if (stat.size > 2 * 1024 * 1024) continue; // Skip files > 2MB

    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      for (const pattern of SECRET_PATTERNS) {
        const match = line.match(pattern.regex);
        if (match) {
          if (pattern.filter && !pattern.filter(line)) {
            continue;
          }
          violations.push({
            file: relPath,
            line: idx + 1,
            name: pattern.name,
            snippet: line.trim().slice(0, 100),
          });
        }
      }
    });
  }

  if (violations.length > 0) {
    console.error(`[scan-secrets] ❌ Found ${violations.length} potential secret leak(s):`);
    violations.forEach((v) => {
      console.error(`  - ${v.file}:${v.line} [${v.name}] -> ${v.snippet}`);
    });
    process.exit(1);
  }

  console.log(`[scan-secrets] ✅ Scanned ${trackedFiles.length} tracked files. 0 secrets found.`);
}

main();
