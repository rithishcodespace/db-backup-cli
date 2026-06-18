// Any class implementing StorageProvider MUST provide these methods.

export interface StorageProvider {
  initialize(): Promise<void>; // // Setup connection/resources before using storage
  upload(localPath: string, remotePath: string): Promise<any>;  // Upload file from local machine to storage
  download(remotePath: string, localPath: string): Promise<any>; // Download file from storage to local machine
  list(prefix?: string): Promise<string[]>; // List all files (optionally filtered by prefix/folder)
  delete(remotePath: string): Promise<void>;  // Delete a file from storage
  getUrl(remotePath: string): Promise<string>;   // Get public/presigned URL for a file
}

  
export interface StorageConfig { 
  type: string; // Storage type (e.g., "local", "s3", "azure")
  bucket?: string; // Storage bucket/container name (optional)
  region?: string; // Cloud region (optional)
  [key: string]: any;  // Allow any additional configuration properties
}