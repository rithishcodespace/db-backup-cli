import { exec } from 'child_process';
import { promisify } from 'util';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { metadataClient } from '../lib/metadata-client';
import { createModuleLogger } from '../logger';
import { ConnectionConfig } from '../utils/db_connection';

const execAsync = promisify(exec);
const log = createModuleLogger('postgres-incremental-service');

export interface IncrementalBackupOptions {
  type: 'full' | 'incremental';
  compress?: boolean;
  output?: string;
  name?: string;
  storage?: any;
  storageLocationId?: string | null;
  encrypt?: boolean;
  encryptionKey?: string;
  parentBackupId?: string;
}

export interface IncrementalBackupResult {
  success: boolean;
  backupId: string;
  filePath: string;
  fileSize: number;
  duration: number;
  checksum: string;
  parentBackupId: string | null;
  baseBackupId: string;
  backupLevel: number;
  metadata: any;
  fileName: string;
}

export class PostgresIncrementalService {
  private dbConfig: ConnectionConfig;
  private manifestsDir: string;

  constructor(dbConfig: ConnectionConfig) {
    this.dbConfig = dbConfig;
    const baseDir = process.env.DB_BACKUP_HOME || path.join(os.homedir(), '.db-backup');
    this.manifestsDir = path.join(baseDir, 'manifests');
    if (!existsSync(this.manifestsDir)) {
      mkdirSync(this.manifestsDir, { recursive: true });
    }
  }

  public static async getPgCombinebackupPath(): Promise<string> {
    try {
      await execAsync('pg_combinebackup --version');
      return 'pg_combinebackup';
    } catch {
      const candidates = [
        '/usr/lib/postgresql/18/bin/pg_combinebackup',
        '/usr/lib/postgresql/17/bin/pg_combinebackup',
        '/usr/local/pgsql/bin/pg_combinebackup'
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return candidate;
        }
      }
      throw new Error('pg_combinebackup tool not found. PostgreSQL 17+ client tools are required.');
    }
  }

  public async verifyPostgresRequirements(): Promise<{ pgVersion: number; combinebackupPath: string }> {
    const host = this.dbConfig.host || 'localhost';
    const port = this.dbConfig.port || 5432;
    const username = this.dbConfig.username || 'postgres';

    let combinebackupPath = '';
    try {
      combinebackupPath = await PostgresIncrementalService.getPgCombinebackupPath();
    } catch {
      throw new Error('PostgreSQL 17+ tool pg_combinebackup is missing. Native physical incremental backups require PostgreSQL 17 or higher client tools.');
    }

    try {
      const { stdout: verOut } = await execAsync(`pg_basebackup --version`);
      const match = verOut.match(/\(PostgreSQL\)\s+(\d+)/i);
      if (match && parseInt(match[1], 10) < 17) {
        throw new Error(`pg_basebackup version ${match[1]} is unsupported. PostgreSQL 17+ is required for native incremental backups.`);
      }
    } catch (err: any) {
      if (err.message.includes('unsupported')) throw err;
      throw new Error('pg_basebackup tool is not available on PATH.');
    }

    let versionNum = 0;
    try {
      const targetDb = this.dbConfig.database || 'postgres';
      const cmd = `psql -h ${host} -p ${port} -U ${username} -d postgres -tA -c "SHOW server_version_num;"`;
      const { stdout } = await execAsync(cmd, {
        env: { ...process.env, PGPASSWORD: this.dbConfig.password }
      });
      versionNum = parseInt(stdout.trim(), 10);
    } catch (err: any) {
      throw new Error(`Failed to query PostgreSQL server version: ${err.message}`);
    }

    if (versionNum < 170000) {
      throw new Error(`PostgreSQL server version must be 17 or higher (found server version num ${versionNum}). Native physical incremental backups require PostgreSQL 17+.`);
    }

    try {
      const cmd = `psql -h ${host} -p ${port} -U ${username} -d ${this.dbConfig.database} -tA -c "SHOW summarize_wal;"`;
      const { stdout } = await execAsync(cmd, {
        env: { ...process.env, PGPASSWORD: this.dbConfig.password }
      });
      const walState = stdout.trim().toLowerCase();
      if (walState !== 'on') {
        try {
          const alterCmd = `psql -h ${host} -p ${port} -U ${username} -d ${this.dbConfig.database} -c "ALTER SYSTEM SET summarize_wal = 'on';" && psql -h ${host} -p ${port} -U ${username} -d ${this.dbConfig.database} -c "SELECT pg_reload_conf();"`;
          await execAsync(alterCmd, {
            env: { ...process.env, PGPASSWORD: this.dbConfig.password }
          });
        } catch {
          throw new Error('PostgreSQL summarize_wal is disabled and could not be automatically enabled. Enable summarize_wal = on in postgresql.conf to perform native incremental backups.');
        }
      }
    } catch (err: any) {
      if (err.message.includes('summarize_wal')) throw err;
    }

    return { pgVersion: versionNum, combinebackupPath };
  }

  public async getParentBackup(requestedParentId?: string): Promise<any> {
    if (requestedParentId) {
      const parent = await metadataClient.getJob(requestedParentId);
      if (!parent || parent.status !== 'success') {
        throw new Error(`Parent backup ${requestedParentId} not found or has invalid status.`);
      }
      if (parent.dbType !== 'postgresql' || parent.dbName !== this.dbConfig.database) {
        throw new Error(`Parent backup ${requestedParentId} belongs to a different database or DBMS.`);
      }
      return parent;
    }

    const res = await metadataClient.listJobs({
      dbType: 'postgresql',
      dbName: this.dbConfig.database,
      status: 'success',
      orderBy: 'desc',
    });
    const backups = res.jobs;

    const physicalParent = backups.find(job => {
      if (job.backupLevel !== null) return true;
      const cached = path.join(this.manifestsDir, `${job.id}.manifest`);
      if (existsSync(cached)) return true;
      const metadata = typeof job.metadata === 'string' ? JSON.parse(job.metadata) : job.metadata;
      return !!metadata?.manifestContent;
    });

    if (!physicalParent) {
      throw new Error(`No previous physical base backup (with backup_manifest) found for database '${this.dbConfig.database}'. Please create a physical base backup first with: db-backup backup --type full --physical`);
    }

    return physicalParent;
  }

  private async getParentManifestPath(parentJob: any): Promise<string> {
    const cachedPath = path.join(this.manifestsDir, `${parentJob.id}.manifest`);
    if (existsSync(cachedPath)) {
      return cachedPath;
    }

    if (parentJob.filePath && existsSync(parentJob.filePath)) {
      const tempExtractDir = path.join(os.tmpdir(), `manifest_extract_${parentJob.id}_${Date.now()}`);
      mkdirSync(tempExtractDir, { recursive: true });
      try {
        await execAsync(`tar -xzf "${parentJob.filePath}" -C "${tempExtractDir}"`);
        const extractedManifest = path.join(tempExtractDir, 'backup_manifest');
        if (existsSync(extractedManifest)) {
          const content = readFileSync(extractedManifest, 'utf-8');
          writeFileSync(cachedPath, content, 'utf-8');
          rmSync(tempExtractDir, { recursive: true, force: true });
          return cachedPath;
        }
      } catch {
        rmSync(tempExtractDir, { recursive: true, force: true });
      }
    }

    const metadata = typeof parentJob.metadata === 'string' ? JSON.parse(parentJob.metadata) : parentJob.metadata;
    if (metadata?.manifestContent) {
      writeFileSync(cachedPath, metadata.manifestContent, 'utf-8');
      return cachedPath;
    }

    throw new Error(`Parent backup ${parentJob.id} is missing its backup_manifest required for incremental backup.`);
  }

  private async packageDirectoryToTarGz(sourceDir: string, destFile: string): Promise<number> {
    await execAsync(`tar -czf "${destFile}" -C "${sourceDir}" .`);
    const stats = statSync(destFile);
    return stats.size;
  }

  public async performIncrementalBackup(
    backupId: string,
    options: IncrementalBackupOptions
  ): Promise<IncrementalBackupResult> {
    const startTime = Date.now();
    await this.verifyPostgresRequirements();

    const isIncremental = options.type === 'incremental';
    let parentJob: any = null;
    let baseBackupId = backupId;
    let parentBackupId: string | null = null;
    let backupLevel = 0;
    let parentManifestPath = '';

    if (isIncremental) {
      parentJob = await this.getParentBackup(options.parentBackupId);
      parentBackupId = parentJob.id;
      baseBackupId = parentJob.baseBackupId || parentJob.id;
      backupLevel = (parentJob.backupLevel || 0) + 1;
      parentManifestPath = await this.getParentManifestPath(parentJob);
    }

    const host = this.dbConfig.host || 'localhost';
    const port = this.dbConfig.port || 5432;
    const username = this.dbConfig.username || 'postgres';

    const tempDir = path.join(os.tmpdir(), `pg_inc_${backupId}`);
    mkdirSync(tempDir, { recursive: true });

    try {
      let cmd = `pg_basebackup -h ${host} -p ${port} -U ${username} -D "${tempDir}" -F plain -X stream`;
      if (isIncremental) {
        cmd += ` --incremental="${parentManifestPath}"`;
      }

      log.info(`Executing physical ${options.type} backup via pg_basebackup`, { backupId, parentBackupId });
      await execAsync(cmd, {
        env: { ...process.env, PGPASSWORD: this.dbConfig.password },
        maxBuffer: 50 * 1024 * 1024
      });

      const manifestPath = path.join(tempDir, 'backup_manifest');
      if (!existsSync(manifestPath)) {
        throw new Error('pg_basebackup completed but backup_manifest file was not generated.');
      }

      const manifestContent = readFileSync(manifestPath, 'utf-8');
      const cachedManifest = path.join(this.manifestsDir, `${backupId}.manifest`);
      writeFileSync(cachedManifest, manifestContent, 'utf-8');

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputDir = options.output || path.join(process.cwd(), 'backups');
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      const fileName = options.name || `${this.dbConfig.database}_${options.type}_${timestamp}.tar.gz`;
      const finalFilePath = path.join(outputDir, fileName);

      await this.packageDirectoryToTarGz(tempDir, finalFilePath);

      const hash = createHash('sha256');
      const fileBuffer = readFileSync(finalFilePath);
      hash.update(fileBuffer);
      const checksum = hash.digest('hex');
      const fileSize = fileBuffer.length;
      const duration = (Date.now() - startTime) / 1000;

      rmSync(tempDir, { recursive: true, force: true });

      const metadata = {
        backupId,
        dbType: 'postgresql',
        dbName: this.dbConfig.database,
        backupType: options.type,
        baseBackupId,
        parentBackupId,
        backupLevel,
        checksum,
        fileSize,
        duration,
        manifestContent,
        createdAt: new Date().toISOString()
      };

      return {
        success: true,
        backupId,
        filePath: finalFilePath,
        fileSize,
        duration,
        checksum,
        parentBackupId,
        baseBackupId,
        backupLevel,
        metadata,
        fileName
      };

    } catch (err: any) {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      throw new Error(`PostgreSQL physical ${options.type} backup failed: ${err.message}`);
    }
  }

  public static async restoreBackupChain(
    targetBackupId: string,
    targetDbConfig: ConnectionConfig
  ): Promise<{ success: boolean; duration: number; combinedDir: string }> {
    const startTime = Date.now();
    const chain: Array<{ id: string; filePath: string | null; parentBackupId: string | null; status: string }> = [];
    let currentId: string | null = targetBackupId;

    while (currentId) {
      const jobRecord: any = await metadataClient.getJob(currentId);
      if (!jobRecord || jobRecord.status !== 'success') {
        throw new Error(`Backup record ${currentId} in chain not found or invalid.`);
      }
      chain.unshift(jobRecord);
      currentId = jobRecord.parentBackupId;
    }

    if (chain.length === 0) {
      throw new Error(`Invalid backup chain for backup ID ${targetBackupId}.`);
    }

    const combinebackupPath = await PostgresIncrementalService.getPgCombinebackupPath();
    const tempWorkDir = path.join(os.tmpdir(), `pg_restore_chain_${Date.now()}`);
    mkdirSync(tempWorkDir, { recursive: true });

    const dirPaths: string[] = [];

    try {
      for (let i = 0; i < chain.length; i++) {
        const item = chain[i];
        if (!item.filePath || !existsSync(item.filePath)) {
          throw new Error(`Backup artifact for ${item.id} not found on disk at ${item.filePath}.`);
        }
        const dirName = `step_${i}_${item.id}`;
        const stepDir = path.join(tempWorkDir, dirName);
        mkdirSync(stepDir, { recursive: true });

        await execAsync(`tar -xzf "${item.filePath}" -C "${stepDir}"`);
        dirPaths.push(stepDir);
      }

      const combinedDir = path.join(tempWorkDir, 'combined_cluster');
      const cmd = `"${combinebackupPath}" ${dirPaths.map(d => `"${d}"`).join(' ')} -o "${combinedDir}"`;

      await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });

      const confPath = path.join(combinedDir, 'postgresql.conf');
      const hbaPath = path.join(combinedDir, 'pg_hba.conf');
      const { appendFileSync } = require('fs');

      if (!existsSync(confPath)) {
        writeFileSync(confPath, "listen_addresses = '*'\n", 'utf-8');
      } else {
        appendFileSync(confPath, "\nlisten_addresses = '*'\n");
      }

      if (!existsSync(hbaPath)) {
        writeFileSync(hbaPath, 'host all all 127.0.0.1/32 trust\nlocal all all trust\n', 'utf-8');
      } else {
        appendFileSync(hbaPath, '\nhost all all 127.0.0.1/32 trust\nlocal all all trust\n');
      }

      const host = targetDbConfig.host || 'localhost';
      const port = targetDbConfig.port || 5432;
      const username = targetDbConfig.username || 'postgres';

      let pgDumpBin = 'pg_dump';
      try { await execAsync('pg_dump --version'); } catch { pgDumpBin = '/usr/lib/postgresql/18/bin/pg_dump'; }
      let psqlBin = 'psql';
      try { await execAsync('psql --version'); } catch { psqlBin = '/usr/lib/postgresql/18/bin/psql'; }
      let postgresBin = 'postgres';
      try { await execAsync('postgres --version'); } catch { postgresBin = '/usr/lib/postgresql/18/bin/postgres'; }

      const tempPort = 5439;
      const tempSocketDir = os.tmpdir();
      const startCmd = `"${postgresBin}" -D "${combinedDir}" -p ${tempPort} -k "${tempSocketDir}" -h 127.0.0.1`;

      const child = exec(startCmd);
      
      let isReady = false;
      let pgIsreadyBin = 'pg_isready';
      try { await execAsync('pg_isready --version'); } catch { pgIsreadyBin = '/usr/lib/postgresql/18/bin/pg_isready'; }

      for (let attempt = 0; attempt < 15; attempt++) {
        try {
          await execAsync(`"${pgIsreadyBin}" -h 127.0.0.1 -p ${tempPort}`);
          isReady = true;
          break;
        } catch {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      if (!isReady) {
        child.kill('SIGKILL');
        throw new Error(`Restored temporary PostgreSQL instance failed to start on port ${tempPort}.`);
      }

      try {
        const dumpPipeCmd = `"${pgDumpBin}" --clean --if-exists -h 127.0.0.1 -p ${tempPort} -U ${username} -d ${targetDbConfig.database} | "${psqlBin}" -h ${host} -p ${port} -U ${username} -d ${targetDbConfig.database}`;
        const { stdout: pipeOut, stderr: pipeErr } = await execAsync(dumpPipeCmd, {
          env: { ...process.env, PGPASSWORD: targetDbConfig.password },
          maxBuffer: 50 * 1024 * 1024
        });
        log.info('Dump pipe output', { pipeOut, pipeErr });
      } catch (pipeError: any) {
        log.error('Dump pipe error', { error: pipeError.message });
        throw pipeError;
      } finally {
        child.kill('SIGKILL');
        rmSync(tempWorkDir, { recursive: true, force: true });
      }

      const duration = (Date.now() - startTime) / 1000;
      return { success: true, duration, combinedDir };

    } catch (err: any) {
      if (existsSync(tempWorkDir)) {
        rmSync(tempWorkDir, { recursive: true, force: true });
      }
      throw new Error(`Failed to restore PostgreSQL incremental backup chain: ${err.message}`);
    }
  }
}
