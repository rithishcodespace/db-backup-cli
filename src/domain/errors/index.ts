/**
 * Domain-level error hierarchy for db-backup-cli.
 * Provides typed, actionable errors while preventing credential exposure.
 */

export class DomainError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code = 'DOMAIN_ERROR', details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class DatabaseError extends DomainError {
  constructor(message: string, code = 'DATABASE_ERROR', details?: Record<string, unknown>) {
    super(message, code, details);
  }
}

export class DatabaseConnectionError extends DatabaseError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'DATABASE_CONNECTION_ERROR', details);
  }
}

export class UnsupportedDatabaseError extends DatabaseError {
  constructor(dbType: string) {
    super(
      `Unsupported database type: ${dbType}. Supported types: postgresql, mysql, mongodb, sqlite`,
      'UNSUPPORTED_DATABASE_ERROR',
      { dbType }
    );
  }
}

export class BackupExecutionError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'BACKUP_EXECUTION_ERROR', details);
  }
}

export class RestoreExecutionError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'RESTORE_EXECUTION_ERROR', details);
  }
}

export class ChecksumMismatchError extends RestoreExecutionError {
  constructor(expected: string, actual: string) {
    super(
      `Backup artifact checksum verification failed. Expected ${expected}, but calculated ${actual}`,
      { expected, actual }
    );
  }
}

export class DecryptionError extends RestoreExecutionError {
  constructor(message = 'Failed to decrypt backup artifact with provided encryption key') {
    super(message, { code: 'DECRYPTION_FAILED' });
  }
}

export class StorageError extends DomainError {
  constructor(message: string, code = 'STORAGE_ERROR', details?: Record<string, unknown>) {
    super(message, code, details);
  }
}

export class StorageNotFoundError extends StorageError {
  constructor(storageName: string) {
    super(`Storage location "${storageName}" not found`, 'STORAGE_NOT_FOUND', { storageName });
  }
}

export class ConfigurationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIGURATION_ERROR', details);
  }
}
