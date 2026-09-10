import {Client, ClientConfig} from 'pg';
import { createModuleLogger } from '../logger';

const log = createModuleLogger('db_connection');

export interface ConnectionConfig {
  type: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database: string;
  ssl?: boolean;
}

export interface ConnectionResult {
  success: boolean;
  error?: string;
  version?: string;
  details?: any
}

export async function testConnection(config: ConnectionConfig): Promise<ConnectionResult> {
  log.debug(`Testing connection to ${config.type} database`, { 
    host: config.host, 
    database: config.database 
  });
  
  try {
    switch (config.type) {
      case 'postgresql':
      case 'postgres':
        return await testPostgresConnection(config);
      case 'mysql':
      case 'mariadb':
        return await testMySQLConnection(config);
      case 'mongodb':
        return await testMongoDBConnection(config);
      case 'sqlite':
        return await testSQLiteConnection(config);
      default:
        return {
          success: false,
          error: `Unsupported database type: ${config.type}. Supported types: postgresql, mysql, mongodb, sqlite`,
        };
    }
  } catch (error) {
    log.error('Connection test failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testPostgresConnection(config: ConnectionConfig): Promise<ConnectionResult> {
  const clientConfig: ClientConfig = {
    host: config.host || 'localhost',
    port: config.port || 5432,
    user: config.username,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
  };

  const client = new Client(clientConfig);
  
  try {
    log.debug('Connecting to PostgreSQL...');
    await client.connect();
    
    const result = await client.query('SELECT version() as version, current_database() as db, current_user as user');
    const version = result.rows[0].version;
    
    await client.end();
    
    log.debug('PostgreSQL connection successful', { 
      version: version.split(',')[0],
      database: config.database 
    });
    
    return {
      success: true,
      version: version.split(',')[0],
      details: {
        database: result.rows[0].db,
        user: result.rows[0].user,
      }
    };
  } catch (error) {
    log.error('PostgreSQL connection failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      await client.end();
    } catch (e) {
      // Ignore end errors
    }
  }
}

async function testMySQLConnection(config: ConnectionConfig): Promise<ConnectionResult> {
  const mysql = require('mysql2/promise');
  try {
    log.debug('Connecting to MySQL...');
    const conn = await mysql.createConnection({
      host: config.host || '127.0.0.1',
      port: config.port || 3306,
      user: config.username || 'root',
      password: config.password || '',
      database: config.database,
      connectTimeout: 5000
    });

    const [rows] = await conn.query('SELECT VERSION() as version');
    const version = Array.isArray(rows) && rows[0] ? (rows[0] as any).version : 'MySQL';
    await conn.end();

    log.debug('MySQL connection successful', { version, database: config.database });
    return {
      success: true,
      version: `MySQL ${version}`,
      details: { database: config.database }
    };
  } catch (error: any) {
    log.error('MySQL connection failed', { error });
    return {
      success: false,
      error: error.message || String(error)
    };
  }
}

async function testMongoDBConnection(config: ConnectionConfig): Promise<ConnectionResult> {
  const { MongoClient } = require('mongodb');
  try {
    log.debug('Connecting to MongoDB...');
    let uri = config.database;
    if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
      const authStr = config.username && config.password 
        ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@` 
        : '';
      const host = config.host || 'localhost';
      const port = config.port || 27017;
      uri = `mongodb://${authStr}${host}:${port}/${config.database}`;
    }

    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    await client.db().command({ ping: 1 });
    await client.close();

    log.debug('MongoDB connection successful', { database: config.database });
    return {
      success: true,
      version: 'MongoDB Connected',
      details: { database: config.database }
    };
  } catch (error: any) {
    log.error('MongoDB connection failed', { error });
    return {
      success: false,
      error: error.message || String(error)
    };
  }
}

async function testSQLiteConnection(config: ConnectionConfig): Promise<ConnectionResult> {
  const fs = require('fs');
  try {
    log.debug('Connecting to SQLite...');
    const dbPath = config.database;
    if (!fs.existsSync(dbPath)) {
      return {
        success: false,
        error: `SQLite database file does not exist at path: ${dbPath}`
      };
    }

    // Try using better-sqlite3 if available on the current platform
    let Database: any = null;
    try {
      Database = require('better-sqlite3');
    } catch {
      // better-sqlite3 not available or native binary skipped
    }

    if (Database) {
      const db = new Database(dbPath, { readonly: true });
      const row = db.prepare('SELECT sqlite_version() as version').get();
      db.close();

      const version = row ? (row as any).version : '3';
      log.debug('SQLite connection successful (via native engine)', { path: dbPath, version });
      return {
        success: true,
        version: `SQLite ${version}`,
        details: { path: dbPath }
      };
    }

    // Pure JavaScript fallback: verify SQLite file magic header (first 16 bytes: "SQLite format 3\0")
    const fd = fs.openSync(dbPath, 'r');
    const headerBuffer = Buffer.alloc(16);
    fs.readSync(fd, headerBuffer, 0, 16, 0);
    fs.closeSync(fd);

    const header = headerBuffer.toString('utf-8');
    if (header.startsWith('SQLite format 3')) {
      log.debug('SQLite database verified via header signature', { path: dbPath });
      return {
        success: true,
        version: 'SQLite 3 (Verified Header)',
        details: { path: dbPath }
      };
    }

    return {
      success: false,
      error: `File at ${dbPath} is not a valid SQLite database (missing SQLite header signature)`
    };
  } catch (error: any) {
    log.error('SQLite connection failed', { error });
    return {
      success: false,
      error: error.message || String(error)
    };
  }
}

// Helper function to get database size
export async function getDatabaseSize(config: ConnectionConfig): Promise<number> {
  if (config.type === 'postgresql') {
    const client = new Client({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database,
    });
    
    try {
      await client.connect();
      const result = await client.query(`
        SELECT pg_database_size($1) as size
      `, [config.database]);
      
      return result.rows[0].size;
    } finally {
      await client.end();
    }
  }
  
  return 0;
}