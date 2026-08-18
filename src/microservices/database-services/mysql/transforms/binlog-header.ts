import { Transform } from 'stream';

export class BinlogHeaderTransform extends Transform {
    private buffer = '';
    private maxBytes = 1024 * 200;
    private bytesRead = 0;
    private parsed = false;
    private file: string | null = null;
    private position: number | null = null;

    _transform(chunk: Buffer, encoding: string, callback: Function) {
        if (!this.parsed && this.bytesRead < this.maxBytes) {
            this.buffer += chunk.toString('utf8');
            this.bytesRead += chunk.length;
            const match = this.buffer.match(/--(?:| CHANGE MASTER TO| CHANGE REPLICATION SOURCE TO).*(?:MASTER_LOG_FILE|SOURCE_LOG_FILE)='([^']+)',.*(?:MASTER_LOG_POS|SOURCE_LOG_POS)=([0-9]+);/i);
            if (match) {
                this.file = match[1];
                this.position = parseInt(match[2], 10);
                this.parsed = true;
            }
        }
        callback(null, chunk);
    }

    getBinlogCoordinate(): { file: string | null; position: number | null } {
        return { file: this.file, position: this.position };
    }
}
