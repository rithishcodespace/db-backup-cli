import { openSync, closeSync, existsSync, unlinkSync } from 'fs';
import { createModuleLogger } from '../../../../logger';

const log = createModuleLogger('reentrant-file-lock');

export class ReentrantFileLock {
    private lockFile: string;
    private lockFd: number | null = null;
    private readonly maxRetries: number = 5;
    private readonly retryDelay: number = 100;
    private owner: string | null = null;
    private refCount: number = 0;

    constructor(metadataFile: string) {
        this.lockFile = `${metadataFile}.lock`;
        this.owner = `${process.pid}-${Date.now()}`;
    }

    async acquire(): Promise<void> {
        if (this.lockFd !== null) {
            this.refCount++;
            return;
        }

        let attempts = 0;
        while (attempts < this.maxRetries) {
            try {
                this.lockFd = openSync(this.lockFile, 'wx');
                this.refCount = 1;
                return;
            } catch (error) {
                if ((error as any).code === 'EEXIST') {
                    attempts++;
                    if (attempts < this.maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempts));
                        continue;
                    }
                    throw new Error(`Failed to acquire lock after ${this.maxRetries} attempts`);
                }
                throw error;
            }
        }
    }

    release(): void {
        if (this.lockFd === null) {
            return;
        }

        this.refCount--;
        if (this.refCount > 0) {
            return;
        }

        try {
            closeSync(this.lockFd);
            if (existsSync(this.lockFile)) {
                unlinkSync(this.lockFile);
            }
        } catch (error) {
            log.warn('Failed to release file lock', { error });
        } finally {
            this.lockFd = null;
            this.refCount = 0;
        }
    }

    isHeld(): boolean {
        return this.lockFd !== null;
    }
}