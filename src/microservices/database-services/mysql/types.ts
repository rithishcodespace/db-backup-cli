export interface IncrementalBackupMetadata {
    id: string;
    type: 'full' | 'incremental';
    database: string;
    baseBackupId?: string;
    parentBackupId?: string | null;
    backupLevel?: number;
    fullBackupId?: string;
    startBinlogFile: string;
    startBinlogPosition: number;
    endBinlogFile?: string;
    endBinlogPosition?: number;
    binlogFiles?: string[];
    timestamp: Date;
    size: number;
    file: string;
    checksum?: string;
    encrypted: boolean;
    status?: 'pending' | 'running' | 'success' | 'failed';
}

export interface BackupChain {
    fullBackup: IncrementalBackupMetadata;
    increments: IncrementalBackupMetadata[];
}

export interface EncryptedBackupHeader {
    magic: string;
    version: number;
    ivLength: number;
    iv: string;
    tagLength: number;
    tag: string;
    originalFileName: string;
    timestamp: string;
    algorithm: string;
    dataLength: number;
}

export interface BackupResult {
    success: boolean;
    backupId: string;
    file: string;
    binlogFile: string;
    binlogPosition: number;
    endBinlogFile?: string;
    endBinlogPosition?: number;
    baseBackupId?: string;
    parentBackupId?: string | null;
    backupLevel?: number;
    size: number;
    metadata: IncrementalBackupMetadata;
    checksum: string;
    encryptionMetadata?: any;
}