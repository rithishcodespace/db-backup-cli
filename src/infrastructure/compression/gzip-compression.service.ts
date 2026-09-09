import { createReadStream, createWriteStream, openSync, readSync, closeSync } from 'fs';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { ICompressionService } from '../../domain/interfaces/compression-service.interface';

export class GzipCompressionService implements ICompressionService {
  isCompressed(filePath: string): boolean {
    try {
      const fd = openSync(filePath, 'r');
      const header = Buffer.alloc(2);
      readSync(fd, header, 0, 2, 0);
      closeSync(fd);
      return header[0] === 0x1f && header[1] === 0x8b;
    } catch {
      return false;
    }
  }

  async compressFile(inputPath: string, outputPath: string): Promise<void> {
    const source = createReadStream(inputPath);
    const gzip = createGzip();
    const destination = createWriteStream(outputPath);
    await pipeline(source, gzip, destination);
  }

  async decompressFile(inputPath: string, outputPath: string): Promise<void> {
    const source = createReadStream(inputPath);
    const gunzip = createGunzip();
    const destination = createWriteStream(outputPath);
    await pipeline(source, gunzip, destination);
  }
}

export const compressionService = new GzipCompressionService();
