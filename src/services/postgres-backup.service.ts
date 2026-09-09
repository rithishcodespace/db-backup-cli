import { spawn } from 'child_process';
import { createReadStream, createWriteStream, statSync } from 'fs';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import path from 'path';
import { metadataClient } from "../lib/metadata-client";
import { config } from '../config';
import { createModuleLogger } from '../logger';
import { ConnectionConfig } from '../utils/db_connection';
import { createHash } from 'crypto';

const log = createModuleLogger('postgres-backup');

export interface BackupOptions {
  type: 'full' | 'incremental' | 'differential';
  compress: boolean;
  output?: string; // Custom output folder.
  name?: string;
  tables?: string[]; // only backup specific tables
  excludeTables?: string[]; // skip specific tables
}

export interface BackupResult {
  success: boolean;
  backupId?: string;
  filePath?: string;
  fileSize?: number;
  compressedSize?: number;
  duration?: number;
  error?: string;
  checksum?: string;
}

export class PostgresBackupService {
  private dbConfig: ConnectionConfig;
  
  constructor(dbConfig: ConnectionConfig) {
    this.dbConfig = dbConfig;
  }
  
  async createBackup(options: BackupOptions): Promise<BackupResult> {
    const startTime = Date.now();
    const backupId = `${this.dbConfig.database}_${Date.now()}`;
    
    log.info('Starting PostgreSQL backup', { 
      database: this.dbConfig.database,
      type: options.type,
      compress: options.compress 
    });
    
    try {
      // Create backup job record
      await metadataClient.createJob({
        id: backupId,
        dbType: 'postgresql',
        dbName: this.dbConfig.database || 'unknown',
        backupType: options.type,
        status: 'running',
        startedAt: new Date(),
        metadata: {
          tables: options.tables,
          excludeTables: options.excludeTables,
          host: this.dbConfig.host,
        },
      });
      
      // Generate backup filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupName = options.name || `${this.dbConfig.database}_${timestamp}`;
      const backupFileName = `${backupName}.${options.compress ? 'gz' : 'sql'}`;
      const backupPath = path.join(options.output || config.get('storage.localPath'), backupFileName);
      
      // Perform backup
      await this.performBackup(backupPath, options);
      
      // Get file stats
      const stats = statSync(backupPath);
      const fileSize = stats.size;
      
      // Calculate checksum
      const checksum = await this.calculateChecksum(backupPath);
      
      const duration = (Date.now() - startTime) / 1000;
      
      // Update job record
      await metadataClient.updateJob(backupId, {
        status: 'success',
        filePath: backupPath,
        fileName: backupFileName,
        fileSize: fileSize,
        compressedSize: options.compress ? fileSize : undefined,
        checksum: checksum,
        completedAt: new Date(),
        duration: duration,
        compressionType: options.compress ? 'gzip' : 'none',
        backupVersion: '1.0',
      });
      
      // Create log entry
      await metadataClient.addLog(backupId, {
        level: 'info',
        message: 'Backup completed successfully',
        details: JSON.stringify({ duration, fileSize }),
      });
      
      log.info('Backup completed', { backupId, duration, fileSize });
      
      return {
        success: true,
        backupId,
        filePath: backupPath,
        fileSize,
        compressedSize: options.compress ? fileSize : undefined,
        duration,
        checksum,
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const duration = (Date.now() - startTime) / 1000;
      
      log.error('Backup failed', { error: errorMessage, duration });
      
      // Update job with error
      await metadataClient.updateJob(backupId, {
        status: 'failed',
        error: errorMessage,
        completedAt: new Date(),
        duration,
      });
      
      await metadataClient.addLog(backupId, {
        level: 'error',
        message: 'Backup failed',
        details: JSON.stringify({ error: errorMessage }),
      });
      
      return {
        success: false,
        backupId,
        error: errorMessage,
        duration,
      };
    }
  }
  
  private async performBackup(outputPath: string, options: BackupOptions): Promise<void> {
    const pgArgs = this.buildPgDumpArgs(options);
    
    log.debug('Executing pg_dump', { database: this.dbConfig.database, host: this.dbConfig.host, port: this.dbConfig.port });
    
    try {
      const pgDump = spawn('pg_dump', pgArgs, {
        shell: false,
        env: {
          ...process.env,
          PGPASSWORD: this.dbConfig.password,
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stderr = '';
      pgDump.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      const writeStream = createWriteStream(outputPath);

      if (options.compress) {
        const gzip = createGzip();
        await pipeline(pgDump.stdout, gzip, writeStream);
      } else {
        await pipeline(pgDump.stdout, writeStream);
      }

      await new Promise<void>((resolve, reject) => {
        pgDump.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`pg_dump exited with code ${code}: ${stderr.trim() || 'Process execution failed'}`));
          } else {
            resolve();
          }
        });
        pgDump.on('error', reject);
      });

      if (stderr && !stderr.includes('NOTICE')) {
        log.warn('pg_dump produced warnings', { stderr });
      }
      
    } catch (error: any) {
      log.error('pg_dump failed', { error: error.message, stderr: error.stderr });
      throw new Error(`pg_dump failed: ${error.stderr || error.message}`);
    }
  }
  
  private buildPgDumpArgs(options: BackupOptions): string[] {
    const host = this.dbConfig.host || 'localhost';
    const port = this.dbConfig.port || 5432;
    const username = this.dbConfig.username || 'postgres';
    const database = this.dbConfig.database;
    
    const args: string[] = [
      '-h', String(host),
      '-p', String(port),
      '-U', String(username),
      '-d', String(database),
      '--format=custom',
      '--verbose',
      '--no-owner',
      '--no-privileges',
    ];
    
    if (options.tables && options.tables.length > 0) {
      options.tables.forEach(table => {
        args.push('-t', table);
      });
    }
    
    if (options.excludeTables && options.excludeTables.length > 0) {
      options.excludeTables.forEach(table => {
        args.push('-T', table);
      });
    }
    
    if (options.type === 'full') {
      args.push('--blobs', '--clean', '--if-exists');
    }
    
    return args;
  }
  
  private async calculateChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath); // reads file asynchronously
      
      stream.on('data', data => hash.update(data)); // This event is fired every time a chunk of data is read from the file.
      stream.on('end', () => resolve(hash.digest('hex'))); // This event is fired once, when the entire file has been read.
      stream.on('error', reject); // This event is fired if something goes wrong.
    });
  }
  
  async listBackups(): Promise<any[]> {
    const res = await metadataClient.listJobs({
      dbType: 'postgresql',
      dbName: this.dbConfig.database,
      status: 'success',
      take: 50,
      orderBy: 'desc',
    });
    return res.jobs;
  }
  
  async getBackupStatus(backupId: string): Promise<any> {
    return await metadataClient.getJob(backupId, true);
  }
}