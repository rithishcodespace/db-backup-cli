import fs from 'fs';
import path from 'path';
import { StorageProvider, StorageConfig } from './base';
import { createModuleLogger } from '../../../logger';

const log = createModuleLogger('local-storage');

export class LocalStorageProvider implements StorageProvider { // implements StorageProvider
  private basePath: string;

  constructor(config: StorageConfig) {
    this.basePath = config.basePath || './backups';
  }

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
      log.info('Created local storage directory', { path: this.basePath });
    }
  }

  // localPath  = where the file currently exists
  // remotePath = where you want it stored in the storage system
  // Copies file from local machine into storage.
  async upload(localPath: string, remotePath: string): Promise<any> {
    const destPath = path.join(this.basePath, remotePath);
    const destDir = path.dirname(destPath);
    
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    fs.copyFileSync(localPath, destPath);
    
    const stats = fs.statSync(destPath);
    log.info('File uploaded to local storage', { path: destPath, size: stats.size });
    
    return { path: destPath, size: stats.size };
  }

  // Copies file from storage back to machine.
  async download(remotePath: string, localPath: string): Promise<any> {
    const sourcePath = path.join(this.basePath, remotePath);
    
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`File not found: ${sourcePath}`);
    }
    
    const destDir = path.dirname(localPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    fs.copyFileSync(sourcePath, localPath);
    
    const stats = fs.statSync(localPath);
    log.info('File downloaded from local storage', { path: sourcePath, size: stats.size });
    
    return { path: localPath, size: stats.size };
  }

  // Returns all files in basePath (optionally filtered by prefix/folder).
  async list(prefix: string = ''): Promise<string[]> {
    const searchPath = path.join(this.basePath, prefix);
    
    if (!fs.existsSync(searchPath)) {
      return [];
    }
    
    const files: string[] = [];
    const walk = (dir: string) => {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else {
          const relativePath = path.relative(this.basePath, fullPath);
          files.push(relativePath);
        }
      }
    };
    
    walk(searchPath);
    return files;
  }

  // Deletes a file from local storage.
  async delete(remotePath: string): Promise<void> {
    const filePath = path.join(this.basePath, remotePath);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    fs.unlinkSync(filePath);
    log.info('File deleted from local storage', { path: filePath });
  }

  async getUrl(remotePath: string): Promise<string> {
    return path.join(this.basePath, remotePath);
  }
}