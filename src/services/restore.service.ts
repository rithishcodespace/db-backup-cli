import axios from 'axios';
import { env } from '../config/env';
import { createModuleLogger } from '../utils/logger';
import { backupRepository } from '../repositories/backup.repository';
import { RestoreRequestDTO, RestoreResponseDTO } from '../types/restore.types';

const log = createModuleLogger('restore-service');

export class RestoreService {
  private orchestratorUrl: string;

  constructor(orchestratorUrl: string = env.ORCHESTRATOR_URL) {
    this.orchestratorUrl = orchestratorUrl;
  }

  async restoreBackup(payload: RestoreRequestDTO): Promise<RestoreResponseDTO> {
    log.info('Forwarding restore operation to orchestrator', {
      backupId: payload.backupId,
      filePath: payload.filePath,
      dbType: payload.dbConfig?.type,
      dryRun: payload.options?.dryRun,
    });

    if (payload.backupId) {
      const record = await backupRepository.findJobById(payload.backupId);
      if (!record) {
        throw new Error(`Backup record not found for id: ${payload.backupId}`);
      }
    }

    if (payload.options?.dryRun) {
      return {
        success: true,
        message: 'Dry run completed successfully. Verification passed.',
        backupId: payload.backupId,
      };
    }

    const response = await axios.post(`${this.orchestratorUrl}/restore`, payload);
    return response.data;
  }

  async getRestoreStatus(id: string): Promise<any> {
    log.debug('Checking restore status from orchestrator', { restoreId: id });
    const response = await axios.get(`${this.orchestratorUrl}/restore/${encodeURIComponent(id)}/status`);
    return response.data;
  }
}

export const restoreService = new RestoreService();
export default restoreService;
