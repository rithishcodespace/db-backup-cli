import { Transform } from 'stream';
import { createCipheriv, randomBytes } from 'crypto';
import { EncryptedBackupHeader } from '../types';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const MAGIC_BYTES = 'MYSQLBACKUP';
const ENCRYPTION_VERSION = 1;

export class EncryptionTransform extends Transform {
    private cipher: any;
    private iv: Buffer;
    private keyBuffer: Buffer;
    private tag: Buffer | null = null;
    private headerWritten: boolean = false;
    private originalFileName: string;
    private dataLength: number = 0;

    constructor(key: string, originalFileName: string = 'backup.sql.gz') {
        super();
        this.iv = randomBytes(IV_LENGTH);
        this.keyBuffer = Buffer.from(key, 'hex');
        this.cipher = createCipheriv(ALGORITHM, this.keyBuffer, this.iv);
        this.originalFileName = originalFileName;
        
        this.cipher.on('error', (err: Error) => this.emit('error', err));
    }

    _transform(chunk: Buffer, encoding: string, callback: Function) {
        try {
            if (!this.headerWritten) {
                const header: EncryptedBackupHeader = {
                    magic: MAGIC_BYTES,
                    version: ENCRYPTION_VERSION,
                    ivLength: this.iv.length,
                    iv: this.iv.toString('base64'),
                    tagLength: TAG_LENGTH,
                    tag: '',
                    originalFileName: this.originalFileName,
                    timestamp: new Date().toISOString(),
                    algorithm: ALGORITHM,
                    dataLength: 0
                };
                
                const headerJson = JSON.stringify(header);
                const headerBuffer = Buffer.from(headerJson);
                const headerLengthBuffer = Buffer.alloc(4);
                headerLengthBuffer.writeUInt32BE(headerBuffer.length);
                
                this.push(headerLengthBuffer);
                this.push(headerBuffer);
                this.headerWritten = true;
            }
            
            const encrypted = this.cipher.update(chunk);
            this.dataLength += chunk.length;
            callback(null, encrypted);
        } catch (err) {
            callback(err);
        }
    }

    _flush(callback: Function) {
        try {
            const final = this.cipher.final();
            this.tag = this.cipher.getAuthTag();
            
            if (this.tag) {
                const tagLengthBuffer = Buffer.alloc(4);
                tagLengthBuffer.writeUInt32BE(this.tag.length);
                this.push(tagLengthBuffer);
                this.push(this.tag);
            }
            
            if (final.length > 0) {
                callback(null, final);
            } else {
                callback(null);
            }
        } catch (err) {
            callback(err);
        }
    }

    getEncryptionMetadata() {
        return {
            iv: this.iv.toString('base64'),
            tag: this.tag ? this.tag.toString('base64') : null,
            algorithm: ALGORITHM,
            version: ENCRYPTION_VERSION
        };
    }
}