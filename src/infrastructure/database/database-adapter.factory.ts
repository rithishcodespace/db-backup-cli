import { IDatabaseAdapter } from '../../domain/interfaces/database-adapter.interface';
import { UnsupportedDatabaseError } from '../../domain/errors';
import { PostgresAdapter } from './adapters/postgres.adapter';
import { MySQLAdapter } from './adapters/mysql.adapter';
import { MongoDBAdapter } from './adapters/mongodb.adapter';
import { SQLiteAdapter } from './adapters/sqlite.adapter';

export class DatabaseAdapterFactory {
  private adapters: IDatabaseAdapter[] = [];

  constructor() {
    this.registerAdapter(new PostgresAdapter());
    this.registerAdapter(new MySQLAdapter());
    this.registerAdapter(new MongoDBAdapter());
    this.registerAdapter(new SQLiteAdapter());
  }

  registerAdapter(adapter: IDatabaseAdapter): void {
    this.adapters.push(adapter);
  }

  getAdapter(dbType: string): IDatabaseAdapter {
    const normalized = (dbType || '').toLowerCase().trim();
    const adapter = this.adapters.find((a) => a.supportedTypes.includes(normalized));
    if (!adapter) {
      throw new UnsupportedDatabaseError(dbType);
    }
    return adapter;
  }
}

export const databaseAdapterFactory = new DatabaseAdapterFactory();
