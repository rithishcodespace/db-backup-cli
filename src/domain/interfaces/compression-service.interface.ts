export interface ICompressionService {
  isCompressed(filePath: string): boolean;
  compressFile(inputPath: string, outputPath: string): Promise<void>;
  decompressFile(inputPath: string, outputPath: string): Promise<void>;
}
