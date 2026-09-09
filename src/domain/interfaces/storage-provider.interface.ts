import { Readable } from 'stream';

export interface IStorageProvider {
  initialize(): Promise<void>;
  upload(localPath: string, remotePath: string): Promise<{ success: boolean; path: string; size?: number }>;
  uploadStream(stream: Readable, remotePath: string): Promise<{ success: boolean; path: string; size?: number }>;
  download(remotePath: string, localPath: string): Promise<{ success: boolean; path: string; size?: number }>;
  list(prefix?: string): Promise<string[]>;
  delete(remotePath: string): Promise<void>;
  getUrl(remotePath: string): Promise<string>;
}
