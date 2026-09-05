import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../../../logger';
import { MySQLIncrementalBackupManager } from './manager';
import {
  validateBody,
  validateQuery,
  BackupRequestSchema,
  MySQLRestoreSchema,
  MySQLCheckBinlogSchema,
  MySQLCleanupSchema,
  MySQLListBackupsQuerySchema,
} from '../../../validators';

const log = createModuleLogger('mysql-backup-routes');
const router = express.Router();

router.post('/backup', validateBody(BackupRequestSchema), async (req, res) => {
    const { dbConfig, backupType, options } = req.body;
    const backupId = options?.backupId || uuidv4();
    
    log.info('Received MySQL backup request', { backupId, database: dbConfig.database, type: backupType });
    
    try {
        const backupManager = MySQLIncrementalBackupManager.getInstance(options?.backupDir, options?.timeout);
        
        const privilegeCheck = await backupManager.validatePrivileges(dbConfig);
        if (!privilegeCheck.valid) {
            throw new Error(`Missing required MySQL privileges: ${privilegeCheck.missing.join(', ')}`);
        }

        if (backupType === 'incremental') {
            const status = await backupManager.checkBinlogStatus(dbConfig);
            if (!status.enabled) {
                throw new Error(`Binlog is not enabled. ${status.error || 'Please enable log_bin in MySQL config.'}`);
            }
            log.info('Binlog status checked', { format: status.format, retention: status.retention });
        }

        let result;
        if (backupType === 'full' || backupType === 'full-backup') {
            result = await backupManager.createFullBackup(dbConfig, options);
        } else if (backupType === 'incremental') {
            let parentId = options?.parentBackupId;
            if (!parentId) {
                const chains = await backupManager.listBackupChains();
                if (chains.length === 0) {
                    throw new Error('No full backup found. Please create a full backup first.');
                }
                const latestChain = chains[chains.length - 1];
                if (latestChain.increments.length > 0) {
                    parentId = latestChain.increments[latestChain.increments.length - 1].id;
                } else {
                    parentId = latestChain.fullBackup.id;
                }
            }
            result = await backupManager.createIncrementalBackup(dbConfig, parentId, options);
        } else {
            throw new Error(`Unsupported backup type: ${backupType}`);
        }
        
        res.json({ success: true, backupId, ...result });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('MySQL backup failed', { backupId, error: errorMessage });
        res.status(500).json({ success: false, backupId, error: errorMessage });
    }
});

router.get('/backups', validateQuery(MySQLListBackupsQuerySchema), async (req, res) => {
    try {
        const { backupDir } = req.query;
        const backupManager = new MySQLIncrementalBackupManager(backupDir as string);
        const chains = await backupManager.listBackupChains();
        res.json({ success: true, chains, total: chains.length });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(500).json({ success: false, error: errorMessage });
    }
});

router.post('/restore', validateBody(MySQLRestoreSchema), async (req, res) => {
    const { dbConfig, backupId, targetTime, options } = req.body;
    
    log.info('Received MySQL restore request', { backupId, targetTime });
    
    try {
        const backupManager = MySQLIncrementalBackupManager.getInstance(options?.backupDir, options?.timeout);
        
        const chain = await backupManager.getBackupChain(backupId);
        if (!chain) {
            throw new Error(`Backup chain not found for ID: ${backupId}`);
        }

        const targetDate = targetTime ? new Date(targetTime) : undefined;
        await backupManager.restoreToPointInTime(dbConfig, backupId, targetDate);
        
        res.json({
            success: true,
            backupId,
            targetTime: targetDate?.toISOString() || 'latest',
            message: 'Restore completed successfully'
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('MySQL restore failed', { backupId, error: errorMessage });
        res.status(500).json({ success: false, backupId, error: errorMessage });
    }
});

router.post('/check-binlog', validateBody(MySQLCheckBinlogSchema), async (req, res) => {
    const { dbConfig } = req.body;
    
    try {
        const backupManager = new MySQLIncrementalBackupManager();
        const status = await backupManager.checkBinlogStatus(dbConfig);
        res.json({ success: true, ...status });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(500).json({ success: false, error: errorMessage });
    }
});

router.post('/cleanup', validateBody(MySQLCleanupSchema), async (req, res) => {
    const { retentionDays, backupDir } = req.body;
    
    try {
        const backupManager = new MySQLIncrementalBackupManager(backupDir);
        await backupManager.cleanup(retentionDays || 7);
        res.json({ success: true, retentionDays: retentionDays || 7, message: 'Cleanup completed successfully' });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(500).json({ success: false, error: errorMessage });
    }
});

export default router;