import { exec } from 'child_process'; // Used to execute shell commands. - exec("pg_dump ...")
import { promisify } from 'util'; // It converts callback-based functions into Promise-based function
import { createWriteStream, createReadStream, statSync } from 'fs';
import { createGzip } from 'zlib'; // Used for compression.
import path from 'path';
import { PrismaClient } from "@prisma/client";
import { config } from '../config';
import { createModuleLogger } from '../logger';
import { ConnectionConfig } from '../utils/db_connection';
import { createHash } from 'crypto';

const execAsync = promisify(exec); // now exec, can be used with async/await instead of callbacks
const prisma = new PrismaClient();
const log = createModuleLogger('postgres-backup');

export interface BackupOptions {
  type: 'full' | 'incremental' | 'differential';
  compress: boolean;
  output?: string;
  name?: string;
  tables?: string[];
  excludeTables?: string[];
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
      const job = await prisma.backupJob.create({
        data: {
          id: backupId,
          dbType: 'postgresql',
          dbName: this.dbConfig.database || 'unknown',
          backupType: options.type,
          status: 'running',
          startedAt: new Date(),
          metadata: JSON.stringify({
            tables: options.tables,
            excludeTables: options.excludeTables,
            host: this.dbConfig.host,
          }),
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
      await prisma.backupJob.update({
        where: { id: backupId },
        data: {
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
        },
      });
      
      // Create log entry
      await prisma.backupLog.create({
        data: {
          backupJobId: backupId,
          level: 'info',
          message: 'Backup completed successfully',
          details: JSON.stringify({ duration, fileSize }),
        },
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
      await prisma.backupJob.update({
        where: { id: backupId },
        data: {
          status: 'failed',
          error: errorMessage,
          completedAt: new Date(),
          duration,
        },
      });
      
      await prisma.backupLog.create({
        data: {
          backupJobId: backupId,
          level: 'error',
          message: 'Backup failed',
          details: JSON.stringify({ error: errorMessage }),
        },
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
    // Build pg_dump command
    let command = this.buildPgDumpCommand(options);
    
    // Add output redirection
    if (options.compress) {
      command += ` | gzip > "${outputPath}"`;
    } else {
      command += ` > "${outputPath}"`;
    }
    
    log.debug('Executing pg_dump', { command: command.substring(0, 200) });
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer
        env: {
          ...process.env,
          PGPASSWORD: this.dbConfig.password,
        },
      });
      
      if (stderr && !stderr.includes('NOTICE')) {
        log.warn('pg_dump produced warnings', { stderr });
      }
      
    } catch (error: any) {
      log.error('pg_dump failed', { error: error.message, stderr: error.stderr });
      throw new Error(`pg_dump failed: ${error.stderr || error.message}`);
    }
  }
  
  private buildPgDumpCommand(options: BackupOptions): string {
    const host = this.dbConfig.host || 'localhost';
    const port = this.dbConfig.port || 5432;
    const username = this.dbConfig.username || 'postgres';
    const database = this.dbConfig.database;
    
    let command = `pg_dump -h ${host} -p ${port} -U ${username} -d ${database}`;
    
    // Add format option for better compatibility
    command += ' --format=custom'; // Custom format allows selective restore
    
    // Add table filters
    if (options.tables && options.tables.length > 0) {
      options.tables.forEach(table => {
        command += ` -t ${table}`;
      });
    }
    
    // Exclude tables
    if (options.excludeTables && options.excludeTables.length > 0) {
      options.excludeTables.forEach(table => {
        command += ` -T ${table}`;
      });
    }
    
    // Add other useful options
    command += ' --verbose';
    command += ' --no-owner'; // Avoid ownership issues
    command += ' --no-privileges'; // Skip privilege commands
    
    if (options.type === 'full') {
      command += ' --blobs'; // Include large objects
      command += ' --clean'; // Clean (drop) objects before creating
      command += ' --if-exists'; // Use IF EXISTS in clean commands
    }
    
    return command;
  }
  
  private async calculateChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);
      
      stream.on('data', data => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
  
  async listBackups(): Promise<any[]> {
    const backups = await prisma.backupJob.findMany({
      where: {
        dbType: 'postgresql',
        dbName: this.dbConfig.database,
        status: 'success',
      },
      orderBy: {
        startedAt: 'desc',
      },
      take: 50,
    });
    
    return backups;
  }
  
  async getBackupStatus(backupId: string): Promise<any> {
    return await prisma.backupJob.findUnique({
      where: { id: backupId },
      include: {
        logs: true,
      },
    });
  }
}