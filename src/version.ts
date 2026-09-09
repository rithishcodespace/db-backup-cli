import fs from 'fs';
import path from 'path';

/**
 * Single global source of truth for DBVault application version.
 * Reads version dynamically from package.json.
 */
function resolveAppVersion(): string {
  // Check override from environment if provided
  if (process.env.DBVAULT_VERSION || process.env.DB_BACKUP_VERSION) {
    return (process.env.DBVAULT_VERSION || process.env.DB_BACKUP_VERSION) as string;
  }

  const candidateDirs = [
    path.resolve(__dirname, '..'),       // from src/
    path.resolve(__dirname, '../..'),    // from dist/src/
    path.resolve(__dirname, '../../..'), // nested
    process.cwd(),
  ];

  for (const dir of candidateDirs) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if ((pkg.name === 'dbvault' || pkg.name === 'db-backup-cli') && pkg.version) {
          return pkg.version;
        }
      } catch {
        // continue
      }
    }
  }

  return '1.0.0';
}

export const APP_VERSION = resolveAppVersion();
export default APP_VERSION;
