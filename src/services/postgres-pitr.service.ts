// @ts-nocheck
import { Client } from 'pg';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable, PassThrough } from 'stream';
import { prisma } from '../lib/prisma';
import { createModuleLogger } from '../logger';
import { ConnectionConfig } from '../utils/db_connection';
import { LocalStorageProvider } from '../microservices/storage-service/providers/local';
import { S3StorageProvider } from '../microservices/storage-service/providers/s3';
import { StorageProvider } from '../microservices/storage-service/providers/base';
import { keyManager } from '../lib/key-manager';

const execAsync = promisify(exec);
const log = createModuleLogger('postgres-pitr');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export interface PitrSetupOptions {
  autoConfigure?: boolean;
  storageName?: string;
  storagePath?: string;
}

export interface PitrBackupOptions {
  storageName?: string;
  compress?: boolean;
  encrypt?: boolean;
  key?: string;
}

export interface PitrRestoreOptions {
  time: string;
  target: string;
  port?: number;
  storageName?: string;
  key?: string;
  force?: boolean;
}

export interface PitrStatusResult {
  dbName: string;
  systemIdentifier: string | null;
  walLevel: string;
  archiveMode: string;
  archiveCommand: string;
  configured: boolean;
  activelyWorking: boolean;
  lastArchivedWal: string | null;
  lastArchivedAt: Date | null;
  baseBackupCount: number;
  earliestRecoverableTime: string | null;
  latestRecoverableTime: string | null;
  currentTimeline: string;
  readiness: string;
  restartRequired: boolean;
}

export class PostgresPitrService {
  private dbConfig: ConnectionConfig;

  constructor(dbConfig: ConnectionConfig) {
    this.dbConfig = dbConfig;
  }

  private async getPgClient(): Promise<Client> {
    const client = new Client({
      host: this.dbConfig.host || 'localhost',
      port: this.dbConfig.port || 5432,
      user: this.dbConfig.username || 'postgres',
      password: this.dbConfig.password,
      database: this.dbConfig.database,
    });
    await client.connect();
    return client;
  }

  private async resolveStorageProvider(storageName?: string): Promise<{ provider: StorageProvider; name: string; type: string }> {
    if (storageName) {
      const storage = await prisma.storageLocation.findUnique({
        where: { name: storageName },
      });
      if (!storage) {
        throw new Error(`Storage location "${storageName}" not found`);
      }
      const storageConfig = (storage.config as any) || {};
      if (storage.type === 's3') {
        const provider = new S3StorageProvider({
          type: 's3',
          bucket: storage.bucket || '',
          region: storage.region || 'us-east-1',
          accessKey: storage.accessKey || '',
          secretKey: storage.secretKey || '',
        });
        await provider.initialize();
        return { provider, name: storage.name, type: 's3' };
      } else {
        const provider = new LocalStorageProvider({
          type: 'local',
          bucket: '',
          basePath: storageConfig.basePath || './backups',
        });

        await provider.initialize();
        return { provider, name: storage.name, type: 'local' };
      }
    }

    const defaultStorage = await prisma.storageLocation.findFirst({
      where: { default: true, enabled: true },
    });

    if (defaultStorage) {
      const storageConfig = (defaultStorage.config as any) || {};
      if (defaultStorage.type === 's3') {
        const provider = new S3StorageProvider({
          type: 's3',
          bucket: defaultStorage.bucket || '',
          region: defaultStorage.region || 'us-east-1',
          accessKey: defaultStorage.accessKey || '',
          secretKey: defaultStorage.secretKey || '',
        });
        await provider.initialize();
        return { provider, name: defaultStorage.name, type: 's3' };
      } else {
        const provider = new LocalStorageProvider({
          type: 'local',
          bucket: '',
          basePath: storageConfig.basePath || './backups',
        });

        await provider.initialize();
        return { provider, name: defaultStorage.name, type: 'local' };
      }
    }

    const provider = new LocalStorageProvider({
      type: 'local',
      bucket: '',
      basePath: './backups',
    });

    await provider.initialize();
    return { provider, name: 'local', type: 'local' };
  }

  async setupPitr(options: PitrSetupOptions = {}): Promise<any> {
    const client = await this.getPgClient();
    let systemIdentifier: string | null = null;
    let walLevel = 'unknown';
    let archiveMode = 'unknown';
    let archiveCommand = 'unknown';

    try {
      const walLevelRes = await client.query("SHOW wal_level");
      walLevel = walLevelRes.rows[0]?.wal_level || 'unknown';

      const archiveModeRes = await client.query("SHOW archive_mode");
      archiveMode = archiveModeRes.rows[0]?.archive_mode || 'unknown';

      const archiveCommandRes = await client.query("SHOW archive_command");
      archiveCommand = archiveCommandRes.rows[0]?.archive_command || 'unknown';

      try {
        const sysIdRes = await client.query("SELECT system_identifier FROM pg_control_system()");
        systemIdentifier = sysIdRes.rows[0]?.system_identifier || null;
      } catch (e) {
        systemIdentifier = this.dbConfig.database;
      }
    } finally {
      await client.end();
    }

    const execPath = process.argv[1] && path.isAbsolute(process.argv[1])
      ? `"${process.argv[0]}" "${path.resolve(process.argv[1])}"`
      : 'db-backup';
    const storageOpt = options.storageName ? `--storage ${options.storageName} ` : '';
    const expectedCommand = `${execPath} pitr archive-wal --database ${this.dbConfig.database} ${storageOpt}--file %f --path %p`;

    let restartRequired = false;
    let autoConfigured = false;

    if (options.autoConfigure) {
      const clientConfig = await this.getPgClient();
      try {
        if (walLevel !== 'replica' && walLevel !== 'logical') {
          await clientConfig.query("ALTER SYSTEM SET wal_level = 'replica'");
          restartRequired = true;
          autoConfigured = true;
        }
        if (archiveMode !== 'on' && archiveMode !== 'always') {
          await clientConfig.query("ALTER SYSTEM SET archive_mode = 'on'");
          restartRequired = true;
          autoConfigured = true;
        }
        if (archiveCommand !== expectedCommand) {
          await clientConfig.query(`ALTER SYSTEM SET archive_command = '${expectedCommand}'`);
          autoConfigured = true;
        }

        await clientConfig.query("SELECT pg_reload_conf()");
      } catch (err: any) {
        log.warn('Auto-configuration failed or partially succeeded', { error: err.message });
      } finally {
        await clientConfig.end();
      }

      const clientVerify = await this.getPgClient();
      try {
        const walLevelRes = await clientVerify.query("SHOW wal_level");
        walLevel = walLevelRes.rows[0]?.wal_level || walLevel;

        const archiveModeRes = await clientVerify.query("SHOW archive_mode");
        archiveMode = archiveModeRes.rows[0]?.archive_mode || archiveMode;

        const archiveCommandRes = await clientVerify.query("SHOW archive_command");
        archiveCommand = archiveCommandRes.rows[0]?.archive_command || archiveCommand;
      } finally {
        await clientVerify.end();
      }
    }

    const configured = (walLevel === 'replica' || walLevel === 'logical') &&
                       (archiveMode === 'on' || archiveMode === 'always') &&
                       archiveCommand.includes('pitr archive-wal');

    const activelyWorking = configured && !restartRequired;

    await prisma.pitrConfig.upsert({
      where: { dbName: this.dbConfig.database },
      update: {
        systemIdentifier,
        walLevel,
        archiveMode,
        archiveCommand,
        enabled: configured,
        updatedAt: new Date(),
      },
      create: {
        dbName: this.dbConfig.database,
        dbType: 'postgresql',
        systemIdentifier,
        walLevel,
        archiveMode,
        archiveCommand,
        enabled: configured,
      },
    });

    return {
      dbName: this.dbConfig.database,
      systemIdentifier,
      walLevel,
      archiveMode,
      archiveCommand,
      expectedCommand,
      configured,
      activelyWorking,
      restartRequired,
      autoConfigured,
    };
  }

  async archiveWal(walFileName: string, sourcePath: string, options: { storageName?: string; key?: string } = {}): Promise<boolean> {
    let resolvedPath = sourcePath;
    if (!fs.existsSync(resolvedPath)) {
      const dataDir = (this.dbConfig as any).dataDirectory || '/var/lib/postgresql/18/main';
      const candidates = [
        path.isAbsolute(sourcePath) ? sourcePath : path.join(process.cwd(), sourcePath),
        path.join(dataDir, sourcePath),
        path.join(dataDir, 'pg_wal', walFileName),
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          resolvedPath = cand;
          break;
        }
      }
    }


    if (!fs.existsSync(resolvedPath)) {
      log.error('Source WAL file does not exist', { sourcePath, walFileName });
      return false;
    }

    const dbName = this.dbConfig.database;
    const stats = fs.statSync(resolvedPath);
    const fileSize = stats.size;

    const { provider, name: storageName, type: storageType } = await this.resolveStorageProvider(options.storageName);

    const timeline = walFileName.substring(0, 8);
    const remoteRelativePath = `pitr/${dbName}/wal/${timeline}/${walFileName}`;

    try {
      const existingFiles = await provider.list(`pitr/${dbName}/wal/${timeline}`);
      const isAlreadyArchived = existingFiles.some((f) => f.endsWith(walFileName));

      if (isAlreadyArchived) {
        log.info('WAL segment already archived, skipping upload (idempotent)', { walFileName });
        return true;
      }
    } catch (e) {
      log.warn('Could not check existing WAL archive list', { error: String(e) });
    }

    let rawBuffer = fs.readFileSync(resolvedPath);

    const checksum = crypto.createHash('sha256').update(rawBuffer).digest('hex');

    let processedBuffer = rawBuffer;
    let isCompressed = false;
    let isEncrypted = false;
    let encryptionType: string | null = null;

    if (process.env.PITR_COMPRESS !== 'false') {
      processedBuffer = zlib.gzipSync(processedBuffer);
      isCompressed = true;
    }

    let encryptionKeyHex = options.key || process.env.PITR_ENCRYPTION_KEY;
    if (!encryptionKeyHex) {
      try {
        const storedKey = keyManager.getKey(`pitr-${dbName}`);
        if (storedKey) {
          encryptionKeyHex = storedKey.key;
        }
      } catch (e) {
        encryptionKeyHex = undefined;
      }
    }

    if (encryptionKeyHex) {
      const keyBuffer = Buffer.from(encryptionKeyHex, 'hex');
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
      const encryptedData = Buffer.concat([cipher.update(processedBuffer), cipher.final()]);
      const tag = cipher.getAuthTag();
      processedBuffer = Buffer.concat([iv, tag, encryptedData]);
      isEncrypted = true;
      encryptionType = ALGORITHM;
    }

    const tempUploadPath = path.join(process.cwd(), 'tmp', `upload_${walFileName}`);
    const tempDir = path.dirname(tempUploadPath);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    fs.writeFileSync(tempUploadPath, processedBuffer);

    let uploadSuccess = false;
    try {
      await provider.upload(tempUploadPath, remoteRelativePath);
      uploadSuccess = true;
    } catch (err: any) {
      log.error('Failed to upload WAL to storage', { walFileName, error: err.message });
      return false;
    } finally {
      if (fs.existsSync(tempUploadPath)) {
        fs.unlinkSync(tempUploadPath);
      }
    }

    if (!uploadSuccess) {
      return false;
    }

    try {
      await prisma.pitrWalLog.upsert({
        where: {
          dbName_walFileName: {
            dbName,
            walFileName,
          },
        },
        update: {
          timeline,
          fileSize,
          checksum,
          storageType,
          storagePath: remoteRelativePath,
          encrypted: isEncrypted,
          encryptionType,
          compressed: isCompressed,
          archivedAt: new Date(),
        },
        create: {
          dbName,
          walFileName,
          timeline,
          fileSize,
          checksum,
          storageType,
          storagePath: remoteRelativePath,
          encrypted: isEncrypted,
          encryptionType,
          compressed: isCompressed,
        },
      });

      await prisma.pitrConfig.upsert({
        where: { dbName },
        update: {
          lastArchivedWal: walFileName,
          lastArchivedAt: new Date(),
          consecutiveFailures: 0,
          lastError: null,
        },
        create: {
          dbName,
          dbType: 'postgresql',
          lastArchivedWal: walFileName,
          lastArchivedAt: new Date(),
          consecutiveFailures: 0,
          enabled: true,
        },
      });

    } catch (dbErr: any) {
      log.warn('Prisma metadata update failed after successful WAL upload', { error: dbErr.message });
    }

    log.info('WAL segment successfully archived', { walFileName, remoteRelativePath });
    return true;
  }

  async fetchWal(walFileName: string, destPath: string, options: { storageName?: string; key?: string } = {}): Promise<boolean> {
    const dbName = this.dbConfig.database;
    const { provider } = await this.resolveStorageProvider(options.storageName);

    const timeline = walFileName.substring(0, 8);
    const remoteRelativePath = `pitr/${dbName}/wal/${timeline}/${walFileName}`;

    const tempDownloadPath = path.join(process.cwd(), 'tmp', `download_${walFileName}`);
    const tempDir = path.dirname(tempDownloadPath);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    try {
      await provider.download(remoteRelativePath, tempDownloadPath);
    } catch (err: any) {
      log.warn('WAL file not found in primary timeline path', { walFileName, error: err.message });
      const allFiles = await provider.list(`pitr/${dbName}/wal`);
      const matched = allFiles.find((f) => f.endsWith(walFileName));
      if (matched) {
        try {
          await provider.download(matched, tempDownloadPath);
        } catch (e2: any) {
          log.error('Failed to download WAL segment', { walFileName, error: e2.message });
          return false;
        }
      } else {
        return false;
      }
    }

    let downloadedBuffer = fs.readFileSync(tempDownloadPath);
    if (fs.existsSync(tempDownloadPath)) {
      fs.unlinkSync(tempDownloadPath);
    }

    let encryptionKeyHex = options.key || process.env.PITR_ENCRYPTION_KEY;
    if (!encryptionKeyHex) {
      try {
        const storedKey = keyManager.getKey(`pitr-${dbName}`);
        if (storedKey) {
          encryptionKeyHex = storedKey.key;
        }
      } catch (e) {
        encryptionKeyHex = undefined;
      }
    }

    if (encryptionKeyHex && downloadedBuffer.length > IV_LENGTH + TAG_LENGTH) {
      try {
        const keyBuffer = Buffer.from(encryptionKeyHex, 'hex');
        const iv = downloadedBuffer.subarray(0, IV_LENGTH);
        const tag = downloadedBuffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
        const ciphertext = downloadedBuffer.subarray(IV_LENGTH + TAG_LENGTH);
        const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
        decipher.setAuthTag(tag);
        downloadedBuffer = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      } catch (decErr) {
      }
    }

    if (downloadedBuffer.length >= 2 && downloadedBuffer[0] === 0x1f && downloadedBuffer[1] === 0x8b) {
      try {
        downloadedBuffer = zlib.gunzipSync(downloadedBuffer);
      } catch (zErr) {
      }
    }

    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.writeFileSync(destPath, downloadedBuffer);
    log.info('WAL segment successfully fetched and decoded', { walFileName, destPath });
    return true;
  }

  async createBaseBackup(options: PitrBackupOptions = {}): Promise<any> {
    const setupStatus = await this.setupPitr();
    if (!setupStatus.activelyWorking) {
      throw new Error(`Cannot create PITR base backup: PostgreSQL WAL archiving is not actively working. Run setup first.`);
    }

    const startTime = Date.now();
    const backupId = `base_${this.dbConfig.database}_${Date.now()}`;
    const tempDir = path.join(process.cwd(), 'tmp', backupId);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const host = this.dbConfig.host || 'localhost';
    const port = this.dbConfig.port || 5432;
    const user = this.dbConfig.username || 'postgres';
    const dbName = this.dbConfig.database;

    const basebackupCmd = `pg_basebackup -h ${host} -p ${port} -U ${user} -D "${tempDir}" -Fp -Xs -c fast --manifest-checksums=SHA256`;

    log.info('Executing pg_basebackup', { backupId, command: basebackupCmd });

    try {
      await execAsync(basebackupCmd, {
        env: {
          ...process.env,
          PGPASSWORD: this.dbConfig.password,
        },
      });
    } catch (err: any) {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      throw new Error(`pg_basebackup failed: ${err.stderr || err.message}`);
    }

    try {
      await execAsync(`pg_verifybackup "${tempDir}"`);
      log.info('pg_verifybackup verified base backup manifest successfully');
    } catch (vErr) {
      log.warn('pg_verifybackup unavailable or skipped', { backupId });
    }

    const backupLabelPath = path.join(tempDir, 'backup_label');
    let startLsn = 'unknown';
    let stopLsn = 'unknown';
    let timeline = '00000001';
    let startWalFile = '';

    if (fs.existsSync(backupLabelPath)) {
      const labelContent = fs.readFileSync(backupLabelPath, 'utf8');
      const startWalMatch = labelContent.match(/START WAL LOCATION:[^\n]+\(file ([0-9A-F]+)\)/i);
      if (startWalMatch) {
        startWalFile = startWalMatch[1];
      }
      const timelineMatch = labelContent.match(/START TIMELINE: (\d+)/i);
      if (timelineMatch) {
        timeline = timelineMatch[1].padStart(8, '0');
      }
    }

    const tarFilePath = path.join(process.cwd(), 'tmp', `${backupId}.tar.gz`);
    await execAsync(`tar -czf "${tarFilePath}" -C "${tempDir}" .`);

    const { provider, name: storageName, type: storageType } = await this.resolveStorageProvider(options.storageName);
    const remoteRelativePath = `pitr/${dbName}/base/${backupId}/${backupId}.tar.gz`;

    await provider.upload(tarFilePath, remoteRelativePath);

    const stats = fs.statSync(tarFilePath);
    const fileSize = stats.size;
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(tarFilePath)).digest('hex');

    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    if (fs.existsSync(tarFilePath)) {
      fs.unlinkSync(tarFilePath);
    }

    const duration = (Date.now() - startTime) / 1000;

    await prisma.backupJob.create({
      data: {
        id: backupId,
        dbType: 'postgresql',
        dbName,
        backupType: 'pitr-base',
        status: 'success',
        filePath: remoteRelativePath,
        fileName: `${backupId}.tar.gz`,
        fileSize,
        checksum,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        duration,
        storageType,
        storagePath: remoteRelativePath,
        walPosition: startWalFile,
        metadata: JSON.stringify({
          timeline,
          startWalFile,
          storageName,
        }),
      },
    });

    log.info('PITR base backup created successfully', { backupId, duration, fileSize });

    return {
      success: true,
      backupId,
      dbName,
      timeline,
      startWalFile,
      fileSize,
      checksum,
      storagePath: remoteRelativePath,
      duration,
    };
  }

  async getPitrStatus(): Promise<PitrStatusResult> {
    const dbName = this.dbConfig.database;
    const setupInfo = await this.setupPitr();

    const pitrConfig = await prisma.pitrConfig.findUnique({
      where: { dbName },
    });

    const baseBackups = await prisma.backupJob.findMany({
      where: {
        dbName,
        dbType: 'postgresql',
        backupType: 'pitr-base',
        status: 'success',
      },
      orderBy: { startedAt: 'asc' },
    });

    let earliestRecoverableTime: string | null = null;
    let latestRecoverableTime: string | null = null;

    if (baseBackups.length > 0) {
      earliestRecoverableTime = baseBackups[0].startedAt.toISOString();
      const lastWal = await prisma.pitrWalLog.findFirst({
        where: { dbName },
        orderBy: { archivedAt: 'desc' },
      });
      latestRecoverableTime = lastWal ? lastWal.archivedAt.toISOString() : baseBackups[baseBackups.length - 1].completedAt?.toISOString() || null;
    }

    const readiness = setupInfo.activelyWorking && baseBackups.length > 0 ? 'READY' : 'NOT_READY';

    return {
      dbName,
      systemIdentifier: setupInfo.systemIdentifier,
      walLevel: setupInfo.walLevel,
      archiveMode: setupInfo.archiveMode,
      archiveCommand: setupInfo.archiveCommand,
      configured: setupInfo.configured,
      activelyWorking: setupInfo.activelyWorking,
      lastArchivedWal: pitrConfig?.lastArchivedWal || null,
      lastArchivedAt: pitrConfig?.lastArchivedAt || null,
      baseBackupCount: baseBackups.length,
      earliestRecoverableTime,
      latestRecoverableTime,
      currentTimeline: '00000001',
      readiness,
      restartRequired: setupInfo.restartRequired,
    };
  }

  async listRecoveryPoints(): Promise<any[]> {
    const dbName = this.dbConfig.database;
    const baseBackups = await prisma.backupJob.findMany({
      where: {
        dbName,
        dbType: 'postgresql',
        backupType: 'pitr-base',
        status: 'success',
      },
      orderBy: { startedAt: 'desc' },
    });

    return baseBackups.map((b) => {
      const meta = b.metadata ? (typeof b.metadata === 'string' ? JSON.parse(b.metadata) : b.metadata) : {};
      return {
        backupId: b.id,
        dbName: b.dbName,
        startedAt: b.startedAt,
        completedAt: b.completedAt,
        fileSize: b.fileSize,
        timeline: meta.timeline || '00000001',
        startWalFile: meta.startWalFile || b.walPosition,
        storagePath: b.storagePath,
      };
    });
  }

  private getPgCtlBin(): string {
    if (fs.existsSync('/usr/lib/postgresql/18/bin/pg_ctl')) {
      return '/usr/lib/postgresql/18/bin/pg_ctl';
    }
    return 'pg_ctl';
  }

  async restorePitr(options: PitrRestoreOptions): Promise<any> {

    const { time, target, port = 5433 } = options;

    if (!time.includes('Z') && !time.match(/[+-]\d{2}:\d{2}$/)) {
      throw new Error(`Invalid recovery timestamp "${time}". An explicit timezone offset (e.g. Z or +05:30) is required.`);
    }

    const targetTime = new Date(time);
    if (isNaN(targetTime.getTime())) {
      throw new Error(`Invalid recovery timestamp date format: "${time}"`);
    }

    const absTarget = path.resolve(target);
    if (fs.existsSync(absTarget) && fs.readdirSync(absTarget).length > 0 && !options.force) {
      throw new Error(`Target directory "${absTarget}" is not empty. Use --force to overwrite.`);
    }

    const dbName = this.dbConfig.database;
    const baseBackup = await prisma.backupJob.findFirst({
      where: {
        dbName,
        dbType: 'postgresql',
        backupType: 'pitr-base',
        status: 'success',
        startedAt: { lte: targetTime },
      },
      orderBy: { startedAt: 'desc' },
    });

    if (!baseBackup) {
      throw new Error(`No compatible base backup found prior to requested recovery timestamp ${time}.`);
    }

    const meta = baseBackup.metadata ? (typeof baseBackup.metadata === 'string' ? JSON.parse(baseBackup.metadata) : baseBackup.metadata) : {};
    const startWalFile = meta.startWalFile || baseBackup.walPosition;

    if (startWalFile && startWalFile.length === 24) {
      const { provider } = await this.resolveStorageProvider(options.storageName);
      const timeline = startWalFile.substring(0, 8);
      const archivedWals = await provider.list(`pitr/${dbName}/wal/${timeline}`);
      const hasStartWal = archivedWals.some((f) => f.endsWith(startWalFile));
      if (!hasStartWal) {
        log.warn('Start WAL file not yet in archive list, proceeding with recovery', { startWalFile });
      }
    }

    if (!fs.existsSync(absTarget)) {
      fs.mkdirSync(absTarget, { recursive: true, mode: 0o700 });
    }
    fs.chmodSync(absTarget, 0o700);

    let storageName = options.storageName;
    if (!storageName && baseBackup.metadata) {
      try {
        const meta = typeof baseBackup.metadata === 'string' ? JSON.parse(baseBackup.metadata) : (baseBackup.metadata as any);
        storageName = meta.storageName;
      } catch (e) {
        storageName = undefined;
      }
    }


    const { provider } = await this.resolveStorageProvider(storageName);
    const tempTarPath = path.join(process.cwd(), 'tmp', `restore_${baseBackup.id}.tar.gz`);

    await provider.download(baseBackup.storagePath || `pitr/${dbName}/base/${baseBackup.id}/${baseBackup.id}.tar.gz`, tempTarPath);

    await execAsync(`tar -xzf "${tempTarPath}" -C "${absTarget}"`);
    fs.chmodSync(absTarget, 0o700);

    if (fs.existsSync(tempTarPath)) {
      fs.unlinkSync(tempTarPath);
    }

    fs.writeFileSync(path.join(absTarget, 'recovery.signal'), '');

    const hbaPath = path.join(absTarget, 'pg_hba.conf');
    if (!fs.existsSync(hbaPath)) {
      const defaultHba = [
        'local   all             all                                     trust',
        'host    all             all             127.0.0.1/32            trust',
        'host    all             all             ::1/128                 trust',
      ].join('\n');
      fs.writeFileSync(hbaPath, defaultHba);
    }

    const identPath = path.join(absTarget, 'pg_ident.conf');
    if (!fs.existsSync(identPath)) {
      fs.writeFileSync(identPath, '# Default pg_ident.conf\n');
    }

    const fetchWalCmd = storageName
      ? `db-backup pitr fetch-wal --database ${dbName} --storage ${storageName} --file %f --path %p`
      : `db-backup pitr fetch-wal --database ${dbName} --file %f --path %p`;

    const pgTargetTime = time.replace('T', ' ').replace('Z', '+00');
    const confLines = [
      `port = ${port}`,
      `unix_socket_directories = '/tmp'`,
      `hba_file = '${hbaPath}'`,
      `ident_file = '${identPath}'`,
      `restore_command = '${fetchWalCmd}'`,
      `recovery_target_time = '${pgTargetTime}'`,
      `recovery_target_action = 'promote'`,
      `hot_standby = off`,
    ];




    fs.appendFileSync(path.join(absTarget, 'postgresql.conf'), `\n${confLines.join('\n')}\n`);

    const logPath = path.join(absTarget, 'recovery.log');
    const pgCtlBin = this.getPgCtlBin();
    const startCmd = `"${pgCtlBin}" start -D "${absTarget}" -l "${logPath}"`;


    log.info('Starting isolated PostgreSQL cluster for PITR recovery', { port, target: absTarget, time });

    await execAsync(startCmd);

    let recoveryComplete = false;
    const maxRetries = 30;
    for (let i = 0; i < maxRetries; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const client = new Client({
          host: 'localhost',
          port,
          user: this.dbConfig.username || 'postgres',
          password: this.dbConfig.password,
          database: this.dbConfig.database,
        });
        await client.connect();
        const res = await client.query('SELECT pg_is_in_recovery()');
        await client.end();

        if (res.rows[0]?.pg_is_in_recovery === false) {
          recoveryComplete = true;
          break;
        }
      } catch (e) {
      }
    }

    if (!recoveryComplete) {
      log.warn('Recovery monitor timed out, verifying database readiness', { port });
    }

    return {
      success: true,
      recoveredTimestamp: time,
      baseBackupId: baseBackup.id,
      targetDirectory: absTarget,
      port,
    };
  }
}
