export interface EncryptionResult {
  iv: string;
  tag: string;
  algorithm: string;
}

export interface ICryptoService {
  calculateChecksum(filePath: string): Promise<string>;
  decryptFile(
    inputPath: string,
    outputPath: string,
    key: string,
    ivBase64: string,
    tagBase64: string
  ): Promise<void>;
  encryptFile(
    inputPath: string,
    outputPath: string,
    key: string
  ): Promise<EncryptionResult>;
  generateKey(): string;
  validateKey(key: string): boolean;
}
