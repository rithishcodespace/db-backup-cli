// create connection to the databases
// reuses if exists

import { Client as PGClient } from 'pg';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';
import { DatabaseConfig } from '../types';
import { createModuleLogger } from '../../../logger';

const log = createModuleLogger('client-manager');

export class DatabaseClientManager {
  private static instances: Map<string, any> = new Map();

  static async getClient(dbType: string, config: DatabaseConfig): Promise<any> {
    const key = `${dbType}_${config.host}_${config.database}`;
    
    if (this.instances.has(key)) {
      log.debug('Reusing existing database client', { dbType, key });
      return this.instances.get(key);
    }

    let client;
    
    try {
      switch (dbType) {
        case 'postgresql':
        case 'postgres':
          client = new PGClient({
            host: config.host,
            port: config.port || 5432,
            user: config.username,
            password: config.password,
            database: config.database,
            ssl: config.ssl ? { rejectUnauthorized: false } : false
          });
          await client.connect();
          break;

        case 'mysql':
        case 'mariadb':
          client = await mysql.createConnection({
            host: config.host,
            port: config.port || 3306,
            user: config.username,
            password: config.password,
            database: config.database,
            ssl: config.ssl ? {} : undefined
          });
          break;

        case 'mongodb':
          const connectionString = config.connectionString || 
            `mongodb://${config.username}:${config.password}@${config.host}:${config.port || 27017}`;
          client = new MongoClient(connectionString);
          await client.connect();
          break;

        case 'sqlite':
          const Database = require('better-sqlite3');
          client = new Database(config.database);
          break;

        default:
          throw new Error(`Unsupported database type: ${dbType}`);
      }

      this.instances.set(key, client);
      log.info('Database client created', { dbType, key });
      
      return client;
    } catch (error) {
      log.error('Failed to create database client', { dbType, error });
      throw error;
    }
  }

  static async closeAll(): Promise<void> {
    for (const [key, client] of this.instances) {
      try {
        if (client.end) await client.end();
        if (client.close) await client.close();
        log.info('Closed database client', { key });
      } catch (error) {
        log.error('Error closing client', { key, error });
      }
    }
    this.instances.clear();
  }
}