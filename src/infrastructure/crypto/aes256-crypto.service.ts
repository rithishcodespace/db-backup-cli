import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { ICryptoService, EncryptionResult } from '../../domain/interfaces/crypto-service.interface';
import { DecryptionError } from '../../domain/errors';

export class AES256CryptoService implements ICryptoService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 16;

  async calculateChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (error) => reject(error));
    });
  }

  async decryptFile(
    inputPath: string,
    outputPath: string,
    key: string,
    ivBase64: string,
    tagBase64: string
  ): Promise<void> {
    try {
      const keyBuffer = Buffer.from(key, 'hex');
      const iv = Buffer.from(ivBase64, 'base64');
      const tag = Buffer.from(tagBase64, 'base64');

      const decipher = createDecipheriv(this.algorithm, keyBuffer, iv);
      decipher.setAuthTag(tag);

      const inputStream = createReadStream(inputPath);
      const outputStream = createWriteStream(outputPath);

      return await new Promise<void>((resolve, reject) => {
        inputStream.pipe(decipher).pipe(outputStream);

        outputStream.on('finish', () => resolve());
        inputStream.on('error', (err) => reject(new DecryptionError(err.message)));
        decipher.on('error', (err) => reject(new DecryptionError(err.message)));
        outputStream.on('error', (err) => reject(new DecryptionError(err.message)));
      });
    } catch (err: any) {
      throw new DecryptionError(err?.message || 'Decryption failed');
    }
  }

  async encryptFile(
    inputPath: string,
    outputPath: string,
    key: string
  ): Promise<EncryptionResult> {
    const keyBuffer = Buffer.from(key, 'hex');
    const iv = randomBytes(this.ivLength);

    const cipher = createCipheriv(this.algorithm, keyBuffer, iv);
    const inputStream = createReadStream(inputPath);
    const outputStream = createWriteStream(outputPath);

    return new Promise((resolve, reject) => {
      inputStream.pipe(cipher).pipe(outputStream);

      outputStream.on('finish', () => {
        const tag = cipher.getAuthTag();
        resolve({
          iv: iv.toString('base64'),
          tag: tag.toString('base64'),
          algorithm: this.algorithm,
        });
      });

      inputStream.on('error', reject);
      cipher.on('error', reject);
      outputStream.on('error', reject);
    });
  }

  generateKey(): string {
    return randomBytes(32).toString('hex');
  }

  validateKey(key: string): boolean {
    return typeof key === 'string' && key.length === 64 && /^[0-9a-fA-F]+$/.test(key);
  }
}

export const cryptoService = new AES256CryptoService();
