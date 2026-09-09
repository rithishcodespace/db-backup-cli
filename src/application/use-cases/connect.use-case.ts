import { ConnectDTO, ConnectResultDTO } from '../dto';
import { DatabaseAdapterFactory } from '../../infrastructure/database/database-adapter.factory';
import { DatabaseConnectionError } from '../../domain/errors';
import { createModuleLogger } from '../../logger';

const log = createModuleLogger('connect-use-case');

export interface IConfigStore {
  setDatabase(config: any): void;
  get(key: string): any;
}

export class ConnectUseCase {
  constructor(
    private readonly adapterFactory: DatabaseAdapterFactory,
    private readonly configStore: IConfigStore
  ) {}

  async execute(input: ConnectDTO): Promise<ConnectResultDTO> {
    if (!input.database && input.type !== 'sqlite') {
      throw new DatabaseConnectionError('--database option is required for this database type');
    }

    const dbConfig: any = {
      type: input.type,
      host: input.host,
      port: input.port,
      username: input.username,
      password: input.password,
      database: input.database,
      ssl: input.ssl,
    };

    // Clean undefined fields
    Object.keys(dbConfig).forEach(
      (k) => dbConfig[k] === undefined && delete dbConfig[k]
    );

    log.debug('Testing connection via adapter factory', { type: input.type, database: input.database });

    const adapter = this.adapterFactory.getAdapter(input.type);
    const result = await adapter.testConnection(dbConfig);

    if (result.success) {
      this.configStore.setDatabase(dbConfig);
      log.info('Database connection verified and saved', { type: input.type, database: input.database });

      return {
        success: true,
        version: result.version,
        database: input.database,
        host: input.host,
      };
    }

    throw new DatabaseConnectionError(result.error || 'Connection failed');
  }
}
