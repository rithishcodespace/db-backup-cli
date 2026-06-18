import express from 'express';
import { prisma } from '../../lib/prisma';
import { createModuleLogger } from '../../logger';
import { LocalStorageProvider } from './providers/local';
import { S3StorageProvider } from './providers/s3';

const app = express();
app.use(express.json());

const log = createModuleLogger('storage-service');

const SERVICE_PORT = process.env.STORAGE_SERVICE_PORT || 3030;
const SERVICE_NAME = 'storage-service';
const startTime = Date.now();

// Provider cache - stores provider instances based on storage type and config to avoid re-initialization
const providers = new Map();

async function getStorageProvider(storageType: string, config: any) {
  const key = `${storageType}_${JSON.stringify(config)}`;
  
  if (providers.has(key)) {
    return providers.get(key);
  }
  
  let provider;
  
  switch (storageType) {
    case 'local':
      provider = new LocalStorageProvider(config);
      break;
    case 's3':
      provider = new S3StorageProvider(config);
      break;
    default:
      throw new Error(`Unsupported storage type: ${storageType}`);
  }
  
  await provider.initialize();
  providers.set(key, provider);
  
  return provider;
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    service: SERVICE_NAME,
    status: 'healthy',
    version: '1.0.0',
    uptime: (Date.now() - startTime) / 1000
  });
});

// Upload backup
app.post('/api/storage/upload', async (req, res) => {
  const { storageType, config, localPath, remotePath, backupId } = req.body;
  
  log.info('Uploading backup to storage', { storageType, backupId });
  
  try {
    const provider = await getStorageProvider(storageType, config);
    const result = await provider.upload(localPath, remotePath);
    
    // Update backup record
    await prisma.backupJob.update({
      where: { id: backupId },
      data: {
        storageType: storageType,
        storagePath: remotePath,
        metadata: {
          uploadResult: result
        }
      }
    });
    
    res.json({
      success: true,
      backupId,
      storageType,
      remotePath,
      result
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Upload failed', { backupId, error: errorMessage });
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

// Download backup
app.post('/api/storage/download', async (req, res) => {
  const { storageType, config, remotePath, localPath, backupId } = req.body;
  
  log.info('Downloading backup from storage', { storageType, backupId });
  
  try {
    const provider = await getStorageProvider(storageType, config);
    const result = await provider.download(remotePath, localPath);
    
    res.json({
      success: true,
      backupId,
      storageType,
      localPath,
      result
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Download failed', { backupId, error: errorMessage });
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

// List backups
app.post('/api/storage/list', async (req, res) => {
  const { storageType, config, prefix } = req.body;
  
  try {
    const provider = await getStorageProvider(storageType, config);
    const files = await provider.list(prefix);
    res.json({ success: true, files });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

// Delete backup
app.post('/api/storage/delete', async (req, res) => {
  const { storageType, config, remotePath } = req.body;
  
  try {
    const provider = await getStorageProvider(storageType, config);
    await provider.delete(remotePath);
    res.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

app.listen(SERVICE_PORT, () => {
  log.info(`${SERVICE_NAME} listening on port ${SERVICE_PORT}`);
});

export default app;