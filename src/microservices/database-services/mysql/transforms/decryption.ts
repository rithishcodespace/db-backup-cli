import { Transform } from 'stream';
import { createDecipheriv } from 'crypto';
import { EncryptedBackupHeader } from '../types';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const MAGIC_BYTES = 'MYSQLBACKUP';
const ENCRYPTION_VERSION = 1;

export class DecryptionTransform extends Transform {
    private keyBuffer: Buffer;
    private state: 'header' | 'data' | 'tag' = 'header';
    private headerLength: number = 0;
    private headerBuffer: Buffer = Buffer.alloc(0);
    private header: EncryptedBackupHeader | null = null;
    private iv: Buffer | null = null;
    private tag: Buffer | null = null;
    private decipher: any = null;
    private dataBuffer: Buffer = Buffer.alloc(0);
    private expectedDataLength: number = 0;
    private processedDataLength: number = 0;

    constructor(key: string) {
        super();
        this.keyBuffer = Buffer.from(key, 'hex');
    }

    _transform(chunk: Buffer, encoding: string, callback: Function) {
        try {
            this.dataBuffer = Buffer.concat([this.dataBuffer, chunk]);
            
            while (this.dataBuffer.length > 0) {
                if (this.state === 'header') {
                    if (this.headerLength === 0 && this.dataBuffer.length >= 4) {
                        this.headerLength = this.dataBuffer.readUInt32BE(0);
                        this.dataBuffer = this.dataBuffer.slice(4);
                    }
                    
                    if (this.headerLength > 0 && this.dataBuffer.length >= this.headerLength) {
                        const headerJson = this.dataBuffer.slice(0, this.headerLength).toString('utf-8');
                        const header = JSON.parse(headerJson) as EncryptedBackupHeader;
                        this.header = header;
                        this.dataBuffer = this.dataBuffer.slice(this.headerLength);
                        
                        if (this.header.magic !== MAGIC_BYTES) {
                            throw new Error('Invalid encrypted backup format: magic bytes mismatch');
                        }
                        
                        if (this.header.version !== ENCRYPTION_VERSION) {
                            throw new Error(`Unsupported encryption version: ${this.header.version}`);
                        }
                        
                        this.iv = Buffer.from(this.header.iv, 'base64');
                        if (this.iv.length !== IV_LENGTH) {
                            throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${this.iv.length}`);
                        }
                        
                        this.expectedDataLength = this.header.dataLength || 0;
                        this.decipher = createDecipheriv(ALGORITHM, this.keyBuffer, this.iv);
                        this.state = 'data';
                    } else {
                        break;
                    }
                }
                
                if (this.state === 'data') {
                    const tagDataSize = 4 + TAG_LENGTH;
                    
                    if (this.dataBuffer.length <= tagDataSize) {
                        break;
                    }
                    
                    const tagLengthStart = this.dataBuffer.length - tagDataSize;
                    const tagLength = this.dataBuffer.readUInt32BE(tagLengthStart);
                    
                    if (tagLength !== TAG_LENGTH) {
                        throw new Error(`Invalid tag length: expected ${TAG_LENGTH}, got ${tagLength}`);
                    }
                    
                    const totalTagData = 4 + tagLength;
                    if (this.dataBuffer.length < totalTagData) {
                        break;
                    }
                    
                    const dataEnd = this.dataBuffer.length - totalTagData;
                    const encryptedData = this.dataBuffer.slice(0, dataEnd);
                    this.dataBuffer = this.dataBuffer.slice(dataEnd);
                    
                    const tagStart = 4;
                    this.tag = this.dataBuffer.slice(tagStart);
                    this.dataBuffer = Buffer.alloc(0);
                    
                    if (encryptedData.length > 0) {
                        const decrypted = this.decipher.update(encryptedData);
                        this.processedDataLength += decrypted.length;
                        this.push(decrypted);
                    }
                    
                    if (this.tag) {
                        this.decipher.setAuthTag(this.tag);
                        try {
                            const final = this.decipher.final();
                            if (final.length > 0) {
                                this.processedDataLength += final.length;
                                this.push(final);
                            }
                        } catch (error) {
                            throw new Error('Authentication failed: backup file may be corrupted or tampered with');
                        }
                    }
                    
                    if (this.expectedDataLength > 0 && this.processedDataLength !== this.expectedDataLength) {
                        throw new Error(
                            `Data length mismatch: expected ${this.expectedDataLength}, got ${this.processedDataLength}`
                        );
                    }
                    
                    this.state = 'tag';
                }
                
                if (this.state === 'tag') {
                    break;
                }
            }
            
            callback(null);
        } catch (err) {
            callback(err);
        }
    }

    _flush(callback: Function) {
        try {
            if (this.decipher && this.state === 'data') {
                if (this.dataBuffer.length > 0) {
                    if (this.dataBuffer.length >= 4) {
                        const tagLength = this.dataBuffer.readUInt32BE(0);
                        if (this.dataBuffer.length === tagLength + 4) {
                            this.tag = this.dataBuffer.slice(4);
                            if (this.tag) {
                                this.decipher.setAuthTag(this.tag);
                                try {
                                    const final = this.decipher.final();
                                    if (final.length > 0) {
                                        this.push(final);
                                    }
                                } catch (error) {
                                    throw new Error('Authentication failed: backup file may be corrupted or tampered with');
                                }
                            }
                        }
                    }
                }
            }
            callback(null);
        } catch (err) {
            callback(err);
        }
    }

    getTag(): Buffer | null {
        return this.tag;
    }
}