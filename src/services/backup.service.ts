import axios from 'axios';
import { env } from '../config/env';
import { createModuleLogger } from '../utils/logger';
import { backupRepository } from '../repositories/backup.repository';
import { BackupRequestDTO, BackupResponseDTO, BackupStatusDTO } from '../types/backup.types';

const log = createModuleLogger('backup-service');

export class BackupService {
  private orchestratorUrl: string;

  constructor(orchestratorUrl: string = env.ORCHESTRATOR_URL) {
    this.orchestratorUrl = orchestratorUrl;
  }

  async triggerBackup(payload: BackupRequestDTO, clientId?: string): Promise<BackupResponseDTO> {
    log.info('Forwarding backup request to orchestrator', {
      clientId: clientId ? `${clientId.substring(0, 8)}...` : undefined,
      dbType: payload.dbConfig?.type,
      database: payload.dbConfig?.database,
    });

    const response = await axios.post(`${this.orchestratorUrl}/backup`, payload, {
      headers: clientId ? { 'x-client-id': clientId } : undefined,
    });

    return response.data;
  }

  async getBackupStatus(id: string): Promise<BackupStatusDTO> {
    log.debug('Checking backup status from orchestrator', { backupId: id });

    try {
      const response = await axios.get(`${this.orchestratorUrl}/backup/${id}/status`);
      return response.data;
    } catch (error) {
      log.warn('Orchestrator status check failed, falling back to database query', { id });
      const job = await backupRepository.findJobById(id);
      if (!job) {
        throw new Error(`Backup job ${id} not found`);
      }
      return {
        id: job.id,
        status: job.status,
        error: job.error || undefined,
      };
    }
  }
}

export const backupService = new BackupService();
export default backupService;
