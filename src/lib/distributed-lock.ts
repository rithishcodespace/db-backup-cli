import type { Redis } from 'ioredis';
import { randomUUID } from 'crypto';
import { createModuleLogger } from '../logger';

const log = createModuleLogger('distributed-lock');

export interface DistributedLockOptions {
    ttl?: number; // Time to live in seconds (default: 3600) 1hr
}

export class DistributedLock {
    private readonly key: string;
    private readonly ttl: number;
    private lockValue: string | null = null;
    private isLocked: boolean = false;
    private refreshInterval: NodeJS.Timeout | null = null;
    private readonly redis: Redis;
    private readonly REFRESH_THRESHOLD = 0.5; // Refresh when TTL < 50% remaining

    constructor(redis: Redis, key: string, options: DistributedLockOptions = {}) {
        this.redis = redis;
        this.key = key;
        this.ttl = options.ttl || 3600; // Default 1 hour
        
        // Validate Redis connection
        if (!this.redis || typeof this.redis.set !== 'function') {
            throw new Error('Invalid Redis connection');
        }
    }

    /**
     * Acquire a distributed lock
     * @returns true if lock acquired, false if already locked
     */
    async acquire(): Promise<boolean> {
        try {
            // Generate a unique UUID for this lock instance
            this.lockValue = randomUUID();
            
            // Attempt to set the lock with NX (only if not exists) and EX (expiry)
            // ioredis accepts: set(key, value, 'EX', seconds, 'NX')
            const result = await this.redis.set(
                this.key,
                this.lockValue,
                'EX', // Set expiry in seconds
                this.ttl,
                'NX' // Only set if key doesn't exist
            );

            // Redis SET with NX returns 'OK' if successful, null if key exists
            if (result === 'OK') {
                this.isLocked = true;
                this.startRefreshInterval();
                return true;
            }

            // Lock already exists
            this.lockValue = null;
            this.isLocked = false;
            return false;
        } catch (error) {
            // Log error but rethrow so caller can handle
            this.isLocked = false;
            this.lockValue = null;
            throw new Error(`Failed to acquire lock: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Release the distributed lock safely
     * Only releases if the lock value matches the one we acquired
     * @returns true if lock released successfully
     */
    async release(): Promise<boolean> {
        // Stop refresh interval first
        this.stopRefreshInterval();

        if (!this.isLocked || !this.lockValue) {
            // Already released or never acquired
            return false;
        }

        try {
            // Use Lua script to atomically check and delete
            // This ensures we only delete if the value matches
            const script = `
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                else
                    return 0
                end
            `;

            // Correct usage: script, number of keys, key, argument
            const result = await this.redis.eval(
                script,
                1, // Number of keys
                this.key, // KEYS[1]
                this.lockValue // ARGV[1]
            );
            
            // result is 1 if deleted, 0 if not
            const released = result === 1;
            
            if (released) {
                this.isLocked = false;
                this.lockValue = null;
                return true;
            }

            // Lock was already released or belongs to another process
            this.isLocked = false;
            this.lockValue = null;
            return false;
        } catch (error) {
            // Log error but don't throw - we want to continue even if release fails
            // because the lock has TTL and will expire automatically
            log.error('Failed to release lock', { 
                error: error instanceof Error ? error.message : 'Unknown error',
                key: this.key
            });
            
            // Reset state even on error to prevent memory leaks
            this.isLocked = false;
            this.lockValue = null;
            return false;
        }
    }

    /**
     * Refresh the lock TTL to prevent expiration during long operations
     * @returns true if refresh successful
     */
    async refresh(): Promise<boolean> {
        if (!this.isLocked || !this.lockValue) { // i already lost my lock
            return false;
        }

        try {
            // Use Lua script to atomically check and refresh
            // tonumber() ensures Redis treats the TTL as a number
            const script = `
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("expire", KEYS[1], tonumber(ARGV[2]))
                else
                    return 0
                end
            `;

            const result = await this.redis.eval(
                script,
                1, // Number of keys
                this.key, // KEYS[1]
                this.lockValue, // ARGV[1]
                this.ttl // ARGV[2]
            );

            return result === 1;
        } catch (error) {
            log.error('Failed to refresh lock', {
                error: error instanceof Error ? error.message : 'Unknown error',
                key: this.key
            });
            return false;
        }
    }

    /**
     * Start automatic refresh interval
     * Refreshes when TTL is 50% or less of original TTL
     */
    private startRefreshInterval(): void {
        if (this.refreshInterval) {
            return;
        }

        // Calculate refresh interval: refresh when 50% of TTL remaining
        const refreshIntervalMs = (this.ttl * 1000) / 2;
        
        this.refreshInterval = setInterval(async () => {
            if (!this.isLocked) {
                this.stopRefreshInterval();
                return;
            }
            
            const refreshed = await this.refresh();
            if (!refreshed) {
                // Lock was lost (probably expired or deleted by another process)
                this.isLocked = false;
                this.lockValue = null;
                this.stopRefreshInterval();
                log.warn('Lock refresh failed - lock lost', { key: this.key });
            }
        }, refreshIntervalMs);

        // Don't let the interval keep the process alive
        if (this.refreshInterval.unref) {
            this.refreshInterval.unref();
        }
    }

    /**
     * Stop automatic refresh interval
     */
    private stopRefreshInterval(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    /**
     * Check if the lock is currently held by this instance
     */
    isHeld(): boolean {
        return this.isLocked && this.lockValue !== null;
    }

    /**
     * Get the current lock key
     */
    getKey(): string {
        return this.key;
    }

    /**
     * Get the lock value (UUID)
     */
    getLockValue(): string | null {
        return this.lockValue;
    }

    /**
     * Get the remaining TTL of the lock in seconds
     * @returns TTL in seconds, or -1 if key doesn't exist, or -2 if key expired
     */
    async getTTL(): Promise<number> {
        try {
            return await this.redis.ttl(this.key);
        } catch (error) {
            log.error('Failed to get TTL', { 
                error: error instanceof Error ? error.message : 'Unknown error',
                key: this.key
            });
            return -1;
        }
    }
}