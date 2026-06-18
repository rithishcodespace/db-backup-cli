import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, createWriteStream } from 'fs'; // read and writes gradually to avoid loading entire file into memory
import { pipeline } from 'stream';
import { promisify } from 'util';
import { StorageProvider, StorageConfig } from './base';
import { createModuleLogger } from '../../../logger';

const streamPipeline = promisify(pipeline);
const log = createModuleLogger('s3-storage');

export class S3StorageProvider implements StorageProvider {
  private client: S3Client; // class Name (like class in java)
  private bucket: string; // s3 bucket name
  private region: string; // s3 region (ap-south-1, us-east-1, etc.)

  constructor(config: StorageConfig) {
    this.bucket = config.bucket;
    this.region = config.region || 'us-east-1';
    
    this.client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
    });
  }

  async initialize(): Promise<void> {
    try {
      // Test connection by listing buckets
      await this.client.send(new ListObjectsCommand({
        Bucket: this.bucket,
        MaxKeys: 1,
      }));
      log.info('S3 connection initialized', { bucket: this.bucket, region: this.region });
    } catch (error) {
      log.error('S3 initialization failed', { error });
      throw new Error(`S3 initialization failed: ${error}`);
    }
  }

  async upload(localPath: string, remotePath: string): Promise<any> {
    const fileStream = createReadStream(localPath);
    
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: remotePath,
      Body: fileStream,
    });
    
    const result = await this.client.send(command);
    log.info('File uploaded to S3', { key: remotePath, bucket: this.bucket });
    
    return {
      bucket: this.bucket,
      key: remotePath,
      etag: result.ETag, // entity tag returned by S3 for the uploaded object (checksum)
      versionId: result.VersionId, // every upload creates a new version (if versioning enabled) and this is the version ID
    };
  }

  async download(remotePath: string, localPath: string): Promise<any> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: remotePath,
    });
    
    const response = await this.client.send(command);
    const writeStream = createWriteStream(localPath);
    
    if (!response.Body) {
      throw new Error('No data received from S3');
    }
    
    await streamPipeline(response.Body as any, writeStream);
    
    log.info('File downloaded from S3', { key: remotePath, bucket: this.bucket });
    return { path: localPath };
  }

  async list(prefix: string = ''): Promise<string[]> {
    const command = new ListObjectsCommand({
      Bucket: this.bucket,
      Prefix: prefix,
    });
    
    const response = await this.client.send(command);
    
    if (!response.Contents) {
      return [];
    }
    
    return response.Contents
      .filter(item => item.Key)
      .map(item => item.Key!);
  }

  async delete(remotePath: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: remotePath,
    });
    
    await this.client.send(command);
    log.info('File deleted from S3', { key: remotePath, bucket: this.bucket });
  }

  async getUrl(remotePath: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: remotePath,
    });
    
    const url = await getSignedUrl(this.client, command, { expiresIn: 3600 });
    return url;
  }
}