import { spawn, ChildProcess } from 'child_process';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { v4 as uuidv4 } from 'uuid';
import { createWriteStream, createReadStream, existsSync, mkdirSync, openSync, closeSync, writeFileSync, unlinkSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { DatabaseConfig } from '../../shared/types';
import { createModuleLogger } from '../../../logger';
import { ReentrantFileLock } from './locks/reentrant-file-lock';
import { ChecksumTransform } from './transforms/checksum';
import { EncryptionTransform } from './transforms/encryption';
import { DecryptionTransform } from './transforms/decryption';
import { IncrementalBackupMetadata, BackupChain, BackupResult } from './types';
import { createHash } from 'crypto';

const log = createModuleLogger('mysql-backup-manager');

export const ALGORITHM = 'aes-256-gcm';
export const IV_LENGTH = 16;
export const TAG_LENGTH = 16;
export const DEFAULT_TIMEOUT = 3600000;
export const MAGIC_BYTES = 'MYSQLBACKUP';
export const ENCRYPTION_VERSION = 1;
export const MAX_RETRIES = 3;
export const RETRY_DELAY = 1000;

export class MySQLIncrementalBackupManager {
    private connection: mysql.Connection | null = null;
    private backupDir: string;
    private metadataFile: string;
    private fileLock: ReentrantFileLock;
    private isRestoring: boolean = false;
    private restoreLockFile: string;
    private activeProcesses: ChildProcess[] = [];
    private connectionPromise: Promise<mysql.Connection> | null = null;
    private timeout: number;
    private static instance: MySQLIncrementalBackupManager | null = null;

    constructor(baseDir?: string, timeout?: number) {
        this.backupDir = baseDir || path.join(process.cwd(), 'backups', 'mysql');
        this.metadataFile = path.join(this.backupDir, 'metadata.json');
        this.restoreLockFile = path.join(this.backupDir, '.restore.lock');
        this.fileLock = new ReentrantFileLock(this.metadataFile);
        this.timeout = timeout || DEFAULT_TIMEOUT;
        
        if (!existsSync(this.backupDir)) {
            mkdirSync(this.backupDir, { recursive: true });
        }
    }

    static getInstance(baseDir?: string, timeout?: number): MySQLIncrementalBackupManager {
        if (!MySQLIncrementalBackupManager.instance) {
            MySQLIncrementalBackupManager.instance = new MySQLIncrementalBackupManager(baseDir, timeout);
        }
        return MySQLIncrementalBackupManager.instance;
    }

    // Connection Management 
    private async getConnection(dbConfig: DatabaseConfig): Promise<mysql.Connection> {
        if (this.connection) {
            try {
                await this.connection.query('SELECT 1');
                return this.connection;
            } catch {
                this.connection = null;
                this.connectionPromise = null;
            }
        }

        if (!this.connectionPromise) {
            this.connectionPromise = mysql.createConnection({
                host: dbConfig.host,
                port: dbConfig.port || 3306,
                user: dbConfig.username,
                password: dbConfig.password,
                database: dbConfig.database,
                multipleStatements: true,
                connectTimeout: 30000,
            });
        }

        this.connection = await this.connectionPromise;
        this.connectionPromise = null;
        return this.connection;
    }

    private async closeConnection(): Promise<void> {
        if (this.connection) {
            try {
                await this.connection.end();
            } catch (error) {
                log.warn('Error closing MySQL connection', { error });
            }
            this.connection = null;
            this.connectionPromise = null;
        }
    }

    // Process Management 
    private trackProcess(proc: ChildProcess): void {
        this.activeProcesses.push(proc);
        proc.on('exit', () => {
            const index = this.activeProcesses.indexOf(proc);
            if (index > -1) {
                this.activeProcesses.splice(index, 1);
            }
        });
    }

    private killAllProcesses(): void {
        for (const proc of this.activeProcesses) {
            try {
                if (!proc.killed) {
                    proc.kill('SIGTERM');
                    setTimeout(() => {
                        if (!proc.killed) {
                            proc.kill('SIGKILL');
                        }
                    }, 5000);
                }
            } catch (error) {
                log.warn('Failed to kill process', { error });
            }
        }
        this.activeProcesses = [];
    }

    async executeWithTimeout<T>(
        proc: ChildProcess,
        operation: () => Promise<T>,
        timeoutMs: number = this.timeout
    ): Promise<T> {
        this.trackProcess(proc);
        
        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                try {
                    if (!proc.killed) {
                        proc.kill('SIGTERM');
                        setTimeout(() => {
                            if (!proc.killed) {
                                proc.kill('SIGKILL');
                            }
                        }, 5000);
                    }
                } catch (error) {
                    // Ignore
                }
                reject(new Error(`Operation timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });

        try {
            return await Promise.race([operation(), timeoutPromise]);
        } finally {
            clearTimeout(timeoutId!);
        }
    }

    async executeWithRetry<T>(
        operation: () => Promise<T>,
        maxRetries: number = MAX_RETRIES
    ): Promise<T> {
        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                log.warn(`Operation failed (attempt ${attempt}/${maxRetries})`, { error: lastError.message });
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * Math.pow(2, attempt - 1)));
                }
            }
        }
        throw lastError || new Error('Operation failed after retries');
    }

    // Core Backup Methods 
    async validatePrivileges(dbConfig: DatabaseConfig): Promise<{ valid: boolean; missing: string[] }> {
        const requiredPrivileges = ['SELECT', 'RELOAD', 'LOCK TABLES', 'REPLICATION CLIENT', 'REPLICATION SLAVE', 'PROCESS'];
        const missing: string[] = [];

        try {
            const conn = await this.getConnection(dbConfig);
            const [rows] = await conn.query("SHOW GRANTS FOR CURRENT_USER()") as any;
            const grants = rows.map((row: any) => Object.values(row)[0] as string).join(' ');
            
            for (const priv of requiredPrivileges) {
                if (!grants.includes(priv) && !grants.includes('ALL PRIVILEGES') && !grants.includes('ALL')) {
                    missing.push(priv);
                }
            }
        } catch (error) {
            log.error('Failed to validate privileges', { error });
            return { valid: false, missing: ['Unable to validate privileges'] };
        }

        return { valid: missing.length === 0, missing };
    }

    async checkBinlogStatus(dbConfig: DatabaseConfig): Promise<{
        enabled: boolean;
        format: string;
        retention?: number;
        error?: string;
    }> {
        try {
            const conn = await this.getConnection(dbConfig);
            const [rows] = await conn.query("SHOW VARIABLES LIKE 'log_bin'") as any;
            const enabled = rows[0]?.Value === 'ON';
            
            if (!enabled) {
                return { enabled: false, format: 'N/A', error: 'Binary logging is not enabled.' };
            }

            const [formatRows] = await conn.query("SHOW VARIABLES LIKE 'binlog_format'") as any;
            const format = formatRows[0]?.Value || 'STATEMENT';

            let retention: number | undefined;
            try {
                const [retentionRows] = await conn.query("SHOW VARIABLES LIKE 'binlog_expire_logs_seconds'") as any;
                if (retentionRows[0]?.Value) {
                    retention = parseInt(retentionRows[0].Value) / 86400;
                }
            } catch {
                // Ignore
            }

            return { enabled: true, format, retention };
        } catch (error: any) {
            log.error('Failed to check binlog status', { error: error.message });
            return { enabled: false, format: 'N/A', error: error.message };
        }
    }

    async getCurrentBinlogPosition(dbConfig: DatabaseConfig): Promise<{ file: string; position: number }> {
        const conn = await this.getConnection(dbConfig);
        const [rows] = await conn.query("SHOW MASTER STATUS") as any;
        
        if (!rows || rows.length === 0) {
            throw new Error('Failed to get binlog position. Ensure REPLICATION CLIENT privilege.');
        }

        return { file: rows[0].File, position: rows[0].Position };
    }

    async listBinlogFiles(dbConfig: DatabaseConfig): Promise<string[]> {
        const conn = await this.getConnection(dbConfig);
        const [rows] = await conn.query("SHOW BINARY LOGS") as any;
        return rows.map((row: any) => row.Log_name);
    }

    private async hasBinlogDataAfterPosition(dbConfig: DatabaseConfig, binlogFile: string, position: number): Promise<boolean> {
        try {
            const conn = await this.getConnection(dbConfig);
            const [rows] = await conn.query("SHOW BINLOG EVENTS IN ? LIMIT 1", [binlogFile]) as any;
            
            if (rows && rows.length > 0) {
                for (const row of rows) {
                    if (row.Pos > position) {
                        return true;
                    }
                }
            }
            return false;
        } catch (error) {
            log.warn('Failed to check binlog events', { error });
            return false;
        }
    }

    async createFullBackup(dbConfig: DatabaseConfig, options: any = {}): Promise<BackupResult> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupId = `full_${timestamp}_${uuidv4().slice(0, 8)}`;
        const fileName = `${backupId}.sql.gz`;
        const filePath = path.join(this.backupDir, fileName);

        log.info('Creating full backup', { backupId, database: dbConfig.database });

        const binlogStatus = await this.getCurrentBinlogPosition(dbConfig);
        
        const args = [
            `--host=${dbConfig.host}`,
            `--port=${String(dbConfig.port || 3306)}`,
            `--user=${dbConfig.username}`,
            `--single-transaction`,
            `--routines`,
            `--triggers`,
            `--events`,
            `--hex-blob`,
            `--add-drop-table`,
            `--flush-logs`,
            `--master-data=2`,
            dbConfig.database
        ];

        if (options.tables && options.tables.length > 0) {
            args.push(...options.tables);
        }

        if (options.excludeTables && options.excludeTables.length > 0) {
            options.excludeTables.forEach((table: string) => {
                args.push(`--ignore-table=${dbConfig.database}.${table}`);
            });
        }

        const env = { ...process.env, MYSQL_PWD: dbConfig.password };
        const mysqldump = spawn('mysqldump', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

        const writeStream = createWriteStream(filePath);
        const gzip = createGzip();
        const checksumTransform = new ChecksumTransform();

        let stderrOutput = '';
        mysqldump.stderr.on('data', (data) => {
            stderrOutput += data.toString();
            log.debug('mysqldump stderr', { backupId, msg: data.toString().substring(0, 200) });
        });

        await this.executeWithRetry(async () => {
            await this.executeWithTimeout(mysqldump, async () => {
                await pipeline(mysqldump.stdout, gzip, checksumTransform, writeStream);
            });
        });

        await new Promise<void>((resolve, reject) => {
            mysqldump.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`mysqldump exited with code ${code}: ${stderrOutput}`));
            });
            mysqldump.on('error', reject);
        });

        const stats = await fs.stat(filePath);
        const checksum = checksumTransform.getChecksum();

        let encryptionMetadata = null;
        let finalFilePath = filePath;
        let finalFileName = fileName;

        if (options.encrypt && options.encryptionKey) {
            const encryptionResult = await this.encryptBackupFile(filePath, options.encryptionKey, fileName);
            finalFilePath = encryptionResult.filePath;
            finalFileName = encryptionResult.fileName;
            encryptionMetadata = encryptionResult.metadata;
        }

        const metadata: IncrementalBackupMetadata = {
            id: backupId,
            type: 'full',
            database: dbConfig.database,
            startBinlogFile: binlogStatus.file,
            startBinlogPosition: binlogStatus.position,
            timestamp: new Date(),
            file: finalFileName,
            size: stats.size,
            checksum: checksum,
            encrypted: !!encryptionMetadata
        };

        await this.saveMetadata(metadata);

        log.info('Full backup completed', { 
            backupId, size: stats.size, binlogFile: binlogStatus.file, 
            binlogPosition: binlogStatus.position, encrypted: !!encryptionMetadata 
        });

        return {
            success: true,
            backupId,
            file: finalFilePath,
            binlogFile: binlogStatus.file,
            binlogPosition: binlogStatus.position,
            size: stats.size,
            metadata,
            checksum,
            encryptionMetadata: encryptionMetadata || undefined
        };
    }

    private async encryptBackupFile(filePath: string, encryptionKey: string, originalFileName: string): Promise<{
        filePath: string;
        fileName: string;
        metadata: { iv: string; tag: string; algorithm: string; version: number };
    }> {
        const encryptedFileName = `${path.basename(filePath, '.sql.gz')}_encrypted.enc`;
        const encryptedFilePath = path.join(path.dirname(filePath), encryptedFileName);
        
        const readStream = createReadStream(filePath);
        const writeStream = createWriteStream(encryptedFilePath);
        const encryptTransform = new EncryptionTransform(encryptionKey, originalFileName);
        
        await pipeline(readStream, encryptTransform, writeStream);
        
        const metadata = encryptTransform.getEncryptionMetadata();
        if (!metadata.tag) {
            throw new Error('Encryption failed: no authentication tag generated');
        }
        
        await fs.unlink(filePath);
        
        return {
            filePath: encryptedFilePath,
            fileName: encryptedFileName,
            metadata: metadata as { iv: string; tag: string; algorithm: string; version: number }
        };
    }

    private async decryptBackupFile(filePath: string, encryptionKey: string): Promise<string> {
        const decryptedPath = filePath.replace('_encrypted.enc', '_decrypted.sql.gz');
        
        const readStream = createReadStream(filePath);
        const writeStream = createWriteStream(decryptedPath);
        const decryptTransform = new DecryptionTransform(encryptionKey);
        
        await pipeline(readStream, decryptTransform, writeStream);
        
        return decryptedPath;
    }

    async createIncrementalBackup(dbConfig: DatabaseConfig, fullBackupId: string, options: any = {}): Promise<any> {
        const chain = await this.getBackupChain(fullBackupId);
        if (!chain) {
            throw new Error(`Backup chain not found for ID: ${fullBackupId}`);
        }

        let lastBackup: IncrementalBackupMetadata;
        if (chain.increments.length > 0) {
            lastBackup = chain.increments[chain.increments.length - 1];
        } else {
            lastBackup = chain.fullBackup;
        }

        const binlogFiles = await this.listBinlogFiles(dbConfig);
        const startFileIndex = binlogFiles.indexOf(lastBackup.startBinlogFile);
        if (startFileIndex === -1) {
            throw new Error(`Binlog file ${lastBackup.startBinlogFile} not found. Please create a new full backup.`);
        }

        const hasNewData = await this.hasBinlogDataAfterPosition(
            dbConfig, binlogFiles[startFileIndex], lastBackup.startBinlogPosition
        );

        if (!hasNewData && startFileIndex === binlogFiles.length - 1) {
            throw new Error('No new binlog data to backup.');
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupId = `inc_${timestamp}_${uuidv4().slice(0, 8)}`;
        const backupDir = path.join(this.backupDir, backupId);
        
        if (!existsSync(backupDir)) {
            mkdirSync(backupDir, { recursive: true });
        }

        log.info('Creating incremental backup', { 
            backupId, from: lastBackup.startBinlogFile, position: lastBackup.startBinlogPosition
        });

        let filesToBackup: string[] = [];
        let currentPosition = lastBackup.startBinlogPosition;

        for (let i = startFileIndex; i < binlogFiles.length; i++) {
            const file = binlogFiles[i];
            if (i === startFileIndex) {
                const hasData = await this.hasBinlogDataAfterPosition(dbConfig, file, currentPosition);
                if (hasData) {
                    filesToBackup.push(file);
                }
            } else {
                filesToBackup.push(file);
            }
        }

        if (filesToBackup.length === 0) {
            throw new Error('No new binlog data to backup.');
        }

        let totalSize = 0;
        const downloadedFiles: string[] = [];
        let lastEndFile = lastBackup.startBinlogFile;
        let lastEndPosition = lastBackup.startBinlogPosition;

        for (let i = 0; i < filesToBackup.length; i++) {
            const binlogFile = filesToBackup[i];
            const outputFile = path.join(backupDir, `${binlogFile}.sql.gz`);
            
            let startPosition = 4;
            if (i === 0 && lastBackup.startBinlogFile === binlogFile) {
                startPosition = lastBackup.startBinlogPosition;
            }

            const env = { ...process.env, MYSQL_PWD: dbConfig.password };
            const mysqlbinlogArgs = [
                `--host=${dbConfig.host}`,
                `--port=${String(dbConfig.port || 3306)}`,
                `--user=${dbConfig.username}`,
                `--read-from-remote-server`,
                `--start-position=${String(startPosition)}`,
                `--result-file=-`,
                binlogFile
            ];

            const mysqlbinlog = spawn('mysqlbinlog', mysqlbinlogArgs, {
                env,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            const writeStream = createWriteStream(outputFile);
            const gzip = createGzip();

            let stderrOutput = '';
            mysqlbinlog.stderr.on('data', (data) => {
                stderrOutput += data.toString();
                log.debug('mysqlbinlog stderr', { backupId, msg: data.toString().substring(0, 200) });
            });

            await this.executeWithRetry(async () => {
                await this.executeWithTimeout(mysqlbinlog, async () => {
                    await pipeline(mysqlbinlog.stdout, gzip, writeStream);
                });
            });

            await new Promise<void>((resolve, reject) => {
                mysqlbinlog.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`mysqlbinlog exited with code ${code}: ${stderrOutput}`));
                });
                mysqlbinlog.on('error', reject);
            });

            const stats = await fs.stat(outputFile);
            if (stats.size > 0) {
                totalSize += stats.size;
                downloadedFiles.push(binlogFile);
                lastEndFile = binlogFile;
            } else {
                await fs.unlink(outputFile);
            }
        }

        const currentStatus = await this.getCurrentBinlogPosition(dbConfig);
        lastEndFile = currentStatus.file;
        lastEndPosition = currentStatus.position;

        if (downloadedFiles.length === 0) {
            throw new Error('No binlog data was downloaded.');
        }

        const metadata: IncrementalBackupMetadata = {
            id: backupId,
            type: 'incremental',
            database: dbConfig.database,
            fullBackupId: fullBackupId,
            startBinlogFile: lastBackup.startBinlogFile,
            startBinlogPosition: lastBackup.startBinlogPosition,
            endBinlogFile: lastEndFile,
            endBinlogPosition: lastEndPosition,
            binlogFiles: downloadedFiles,
            timestamp: new Date(),
            file: backupId,
            size: totalSize,
            encrypted: false
        };

        await this.saveMetadata(metadata);

        log.info('Incremental backup completed', {
            backupId, files: downloadedFiles.length, size: totalSize,
            endBinlogFile: lastEndFile, endPosition: lastEndPosition
        });

        return {
            success: true,
            backupId,
            file: backupDir,
            binlogFiles: downloadedFiles,
            size: totalSize,
            metadata
        };
    }

    async getBackupChain(fullBackupId: string): Promise<BackupChain | null> {
        await this.fileLock.acquire();
        try {
            const allMetadata = await this.listMetadata();
            const fullBackup = allMetadata.find((m: any) => m.id === fullBackupId && m.type === 'full');
            if (!fullBackup) {
                return null;
            }

            const increments = allMetadata
                .filter((m: any) => m.type === 'incremental' && m.fullBackupId === fullBackupId)
                .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

            return { fullBackup, increments };
        } finally {
            this.fileLock.release();
        }
    }

    async listBackupChains(): Promise<BackupChain[]> {
        await this.fileLock.acquire();
        try {
            const allMetadata = await this.listMetadata();
            const fullBackups = allMetadata.filter((m: any) => m.type === 'full');
            
            const chains: BackupChain[] = [];
            for (const full of fullBackups) {
                const increments = allMetadata
                    .filter((m: any) => m.type === 'incremental' && m.fullBackupId === full.id)
                    .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                
                chains.push({ fullBackup: full, increments });
            }
            
            return chains;
        } finally {
            this.fileLock.release();
        }
    }

    async restoreToPointInTime(dbConfig: DatabaseConfig, backupId: string, targetTime?: Date): Promise<void> {
        let lockFd: number | null = null;
        try {
            lockFd = openSync(this.restoreLockFile, 'wx');
        } catch (error) {
            throw new Error('A restore operation is already in progress.');
        }

        try {
            writeFileSync(this.restoreLockFile, JSON.stringify({
                pid: process.pid,
                startTime: new Date().toISOString(),
                backupId: backupId
            }));

            this.isRestoring = true;

            const chain = await this.getBackupChain(backupId);
            if (!chain) {
                throw new Error('Backup chain not found');
            }

            log.info('Starting restore', { backupId, targetTime: targetTime?.toISOString() || 'latest' });

            await this.verifyBackupChecksum(chain.fullBackup);
            await this.restoreFullBackup(dbConfig, chain.fullBackup);

            let appliedCount = 0;
            for (const inc of chain.increments) {
                if (targetTime && new Date(inc.timestamp) > targetTime) {
                    log.info('Stopping at target time', { targetTime: targetTime.toISOString() });
                    break;
                }

                await this.verifyBackupChecksum(inc);
                await this.applyIncrementalBackup(dbConfig, inc);
                appliedCount++;
            }

            log.info('Restore completed', { backupId, incrementsApplied: appliedCount });
        } finally {
            this.isRestoring = false;
            if (lockFd !== null) {
                try {
                    closeSync(lockFd);
                    if (existsSync(this.restoreLockFile)) {
                        unlinkSync(this.restoreLockFile);
                    }
                } catch (error) {
                    log.warn('Failed to release restore lock', { error });
                }
            }
        }
    }

    private async verifyBackupChecksum(backup: IncrementalBackupMetadata): Promise<void> {
        if (!backup.checksum) {
            log.warn('No checksum found for backup', { id: backup.id });
            return;
        }

        const filePath = path.join(this.backupDir, backup.file);
        if (!existsSync(filePath)) {
            throw new Error(`Backup file not found: ${filePath}`);
        }

        let fileToVerify = filePath;
        if (backup.encrypted) {
            const key = process.env.BACKUP_ENCRYPTION_KEY;
            if (!key) {
                throw new Error('Encryption key not found in environment');
            }
            fileToVerify = await this.decryptBackupFile(filePath, key);
        }

        const calculatedChecksum = await this.calculateFileChecksum(fileToVerify);
        
        if (fileToVerify !== filePath && existsSync(fileToVerify)) {
            await fs.unlink(fileToVerify);
        }

        if (calculatedChecksum !== backup.checksum) {
            throw new Error(`Checksum verification failed for ${backup.id}`);
        }

        log.info('Checksum verification passed', { id: backup.id });
    }

    private async calculateFileChecksum(filePath: string): Promise<string> {
        const hash = createHash('sha256');
        const stream = createReadStream(filePath);
        
        return new Promise((resolve, reject) => {
            stream.on('data', (data) => hash.update(data));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', reject);
        });
    }

    private async restoreFullBackup(dbConfig: DatabaseConfig, fullBackup: IncrementalBackupMetadata): Promise<void> {
        let filePath = path.join(this.backupDir, fullBackup.file);
        
        if (!existsSync(filePath)) {
            throw new Error(`Full backup file not found: ${filePath}`);
        }

        let restoreFile = filePath;
        if (fullBackup.encrypted) {
            const key = process.env.BACKUP_ENCRYPTION_KEY;
            if (!key) {
                throw new Error('Encryption key not found in environment');
            }
            restoreFile = await this.decryptBackupFile(filePath, key);
        }

        const env = { ...process.env, MYSQL_PWD: dbConfig.password };

        const gunzip = spawn('gunzip', ['-c', restoreFile]);
        this.trackProcess(gunzip);
        
        const mysqlArgs = [
            `--host=${dbConfig.host}`,
            `--port=${String(dbConfig.port || 3306)}`,
            `--user=${dbConfig.username}`,
            dbConfig.database
        ];

        const mysqlProcess = spawn('mysql', mysqlArgs, { env, stdio: ['pipe', 'pipe', 'pipe'] });
        this.trackProcess(mysqlProcess);

        let stderrOutput = '';
        mysqlProcess.stderr.on('data', (data) => {
            stderrOutput += data.toString();
        });

        await this.executeWithRetry(async () => {
            await this.executeWithTimeout(mysqlProcess, async () => {
                await pipeline(gunzip.stdout, mysqlProcess.stdin);
            });
        });

        await new Promise<void>((resolve, reject) => {
            mysqlProcess.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`mysql restore failed with code ${code}: ${stderrOutput}`));
            });
            mysqlProcess.on('error', reject);
            gunzip.on('error', reject);
        });

        if (restoreFile !== filePath && existsSync(restoreFile)) {
            await fs.unlink(restoreFile);
        }

        log.info('Full backup restored', { file: fullBackup.file });
    }

    private async applyIncrementalBackup(dbConfig: DatabaseConfig, inc: IncrementalBackupMetadata): Promise<void> {
        const incDir = path.join(this.backupDir, inc.file);
        
        if (!existsSync(incDir)) {
            throw new Error(`Incremental backup directory not found: ${incDir}`);
        }

        const env = { ...process.env, MYSQL_PWD: dbConfig.password };

        for (const binlogFile of inc.binlogFiles || []) {
            const sqlFile = path.join(incDir, `${binlogFile}.sql.gz`);
            
            if (!existsSync(sqlFile)) {
                log.warn(`Binlog file not found: ${sqlFile}, skipping`);
                continue;
            }

            const gunzip = spawn('gunzip', ['-c', sqlFile]);
            this.trackProcess(gunzip);
            
            const mysqlArgs = [
                `--host=${dbConfig.host}`,
                `--port=${String(dbConfig.port || 3306)}`,
                `--user=${dbConfig.username}`,
                dbConfig.database
            ];

            const mysqlProcess = spawn('mysql', mysqlArgs, { env, stdio: ['pipe', 'pipe', 'pipe'] });
            this.trackProcess(mysqlProcess);

            let stderrOutput = '';
            mysqlProcess.stderr.on('data', (data) => {
                stderrOutput += data.toString();
            });

            await this.executeWithRetry(async () => {
                await this.executeWithTimeout(mysqlProcess, async () => {
                    await pipeline(gunzip.stdout, mysqlProcess.stdin);
                });
            });

            await new Promise<void>((resolve, reject) => {
                mysqlProcess.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`mysql restore failed with code ${code}: ${stderrOutput}`));
                });
                mysqlProcess.on('error', reject);
                gunzip.on('error', reject);
            });
        }

        log.info('Incremental backup applied', { id: inc.id });
    }

    async cleanup(retentionDays: number = 7): Promise<void> {
        await this.fileLock.acquire();
        try {
            const allMetadata = await this.listMetadata();
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - retentionDays);

            const fullBackupDependencies = new Map<string, Set<string>>();
            const incrementalDependencies = new Map<string, Set<string>>();

            for (const meta of allMetadata) {
                if (meta.type === 'full') {
                    fullBackupDependencies.set(meta.id, new Set());
                }
            }

            for (const meta of allMetadata) {
                if (meta.type === 'incremental' && meta.fullBackupId) {
                    const deps = fullBackupDependencies.get(meta.fullBackupId);
                    if (deps) {
                        deps.add(meta.id);
                    }
                }
            }

            const sortedIncrements = allMetadata
                .filter((m: any) => m.type === 'incremental')
                .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

            for (let i = 0; i < sortedIncrements.length; i++) {
                const current = sortedIncrements[i];
                const deps = new Set<string>();
                for (let j = i + 1; j < sortedIncrements.length; j++) {
                    deps.add(sortedIncrements[j].id);
                }
                incrementalDependencies.set(current.id, deps);
            }

            const toDelete: any[] = [];
            const toKeep: any[] = [];

            for (const meta of allMetadata) {
                const isOld = new Date(meta.timestamp) < cutoff;
                let hasDependents = false;

                if (meta.type === 'full') {
                    const deps = fullBackupDependencies.get(meta.id);
                    hasDependents = deps !== undefined && deps.size > 0;
                } else if (meta.type === 'incremental') {
                    const deps = incrementalDependencies.get(meta.id);
                    hasDependents = deps !== undefined && deps.size > 0;
                }

                if (isOld && !hasDependents) {
                    toDelete.push(meta);
                } else {
                    toKeep.push(meta);
                }
            }

            for (const meta of toDelete) {
                try {
                    const filePath = path.join(this.backupDir, meta.file);
                    if (existsSync(filePath)) {
                        await fs.rm(filePath, { recursive: true, force: true });
                    }
                    log.info('Deleted old backup', { id: meta.id });
                } catch (error) {
                    log.warn('Failed to delete old backup', { id: meta.id, error });
                }
            }

            await fs.writeFile(this.metadataFile, JSON.stringify(toKeep, null, 2));
            log.info('Cleanup completed', { deleted: toDelete.length, kept: toKeep.length, retentionDays });
        } finally {
            this.fileLock.release();
        }
    }

    private async saveMetadata(metadata: any): Promise<void> {
        await this.fileLock.acquire();
        try {
            let allMetadata: any[] = [];
            if (existsSync(this.metadataFile)) {
                const content = await fs.readFile(this.metadataFile, 'utf-8');
                try {
                    allMetadata = JSON.parse(content);
                } catch {
                    allMetadata = [];
                }
            }

            allMetadata = allMetadata.filter((m: any) => m.id !== metadata.id);
            allMetadata.push(metadata);
            await fs.writeFile(this.metadataFile, JSON.stringify(allMetadata, null, 2));
        } finally {
            this.fileLock.release();
        }
    }

    private async listMetadata(): Promise<any[]> {
        if (!existsSync(this.metadataFile)) {
            return [];
        }

        const content = await fs.readFile(this.metadataFile, 'utf-8');
        try {
            return JSON.parse(content);
        } catch {
            return [];
        }
    }

    async shutdown(): Promise<void> {
        log.info('Shutting down manager...');
        this.killAllProcesses();
        await this.closeConnection();
        if (this.fileLock.isHeld()) {
            this.fileLock.release();
        }
        MySQLIncrementalBackupManager.instance = null;
        log.info('Manager shutdown complete');
    }
}