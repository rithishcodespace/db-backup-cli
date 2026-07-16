import { Transform } from 'stream';
import { createHash } from 'crypto';

export class ChecksumTransform extends Transform {
    private hash = createHash('sha256');
    private size = 0;

    _transform(chunk: Buffer, encoding: string, callback: Function) {
        this.hash.update(chunk);
        this.size += chunk.length;
        callback(null, chunk);
    }

    getChecksum(): string {
        return this.hash.digest('hex');
    }

    getSize(): number {
        return this.size;
    }
}