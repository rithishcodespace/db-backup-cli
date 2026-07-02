import fs from 'fs';
import path from 'path';
import os from 'os';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import chalk from 'chalk';

const KEYSTORE_DIR = path.join(os.homedir(), '.db-backup');
const KEYSTORE_FILE = path.join(KEYSTORE_DIR, 'keys.json');
const MASTER_KEY_FILE = path.join(KEYSTORE_DIR, 'master.key');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;

export interface KeyEntry {
    backupId: string;
    key: string; // The actual encryption key (hex)
    dbName: string;
    dbType: string;
    createdAt: string;
    algorithm: string;
    keyId?: string; // Unique identifier for the key
}

export interface KeyStore {
    version: string;
    keys: KeyEntry[];
    createdAt: string;
    updatedAt: string;
}

export class KeyManager {
    private masterKey: Buffer | null = null;
    private keystore: KeyStore | null = null;

    constructor() {
        this.ensureKeystoreDirectory();
    }

    private ensureKeystoreDirectory(): void {
        if (!fs.existsSync(KEYSTORE_DIR)) {
            fs.mkdirSync(KEYSTORE_DIR, { recursive: true, mode: 0o700 });
        }
    }

    private getOrCreateMasterKey(): Buffer {
        if (this.masterKey) {
            return this.masterKey;
        }

        if (fs.existsSync(MASTER_KEY_FILE)) {
            // Read existing master key
            const masterKeyData = Buffer.from(
                fs.readFileSync(MASTER_KEY_FILE, 'utf-8'),
                'hex'
            );

            // Skip the first 32 bytes (salt)
            this.masterKey = masterKeyData.subarray(SALT_LENGTH);

            return this.masterKey;
        }

        // Create new master key
        const salt = randomBytes(SALT_LENGTH);
        const masterKey = randomBytes(32);
        const combined = Buffer.concat([salt, masterKey]);
        fs.writeFileSync(MASTER_KEY_FILE, combined.toString('hex'), { mode: 0o600 });
        this.masterKey = masterKey;
        return this.masterKey;
    }

    private loadKeystore(): KeyStore {
        if (this.keystore) {
            return this.keystore;
        }

        if (!fs.existsSync(KEYSTORE_FILE)) {
            const emptyStore: KeyStore = {
                version: '1.0',
                keys: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            this.keystore = emptyStore;
            this.saveKeystore(emptyStore);
            return emptyStore;
        }

        try {
            const data = fs.readFileSync(KEYSTORE_FILE, 'utf-8');
            const encryptedData = JSON.parse(data);
            
            // Decrypt the keystore
            const masterKey = this.getOrCreateMasterKey();
            const decipher = createDecipheriv(
                ALGORITHM,
                masterKey,
                Buffer.from(encryptedData.iv, 'base64')
            );
            decipher.setAuthTag(Buffer.from(encryptedData.tag, 'base64'));
            
            const decrypted = Buffer.concat([
                decipher.update(Buffer.from(encryptedData.data, 'base64')),
                decipher.final()
            ]);
            
            this.keystore = JSON.parse(decrypted.toString('utf-8'));
            return this.keystore as any;
        } catch (error) {
            console.warn('Failed to decrypt keystore, creating new one');
            const emptyStore: KeyStore = {
                version: '1.0',
                keys: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            this.keystore = emptyStore;
            this.saveKeystore(emptyStore);
            return emptyStore;
        }
    }

    private saveKeystore(keystore: KeyStore): void {
        const masterKey = this.getOrCreateMasterKey();
        const iv = randomBytes(IV_LENGTH);
        const cipher = createCipheriv(ALGORITHM, masterKey, iv);
        
        const data = Buffer.from(JSON.stringify(keystore), 'utf-8');
        const encrypted = Buffer.concat([
            cipher.update(data),
            cipher.final()
        ]);
        const tag = cipher.getAuthTag();
        
        const encryptedData = {
            iv: iv.toString('base64'),
            tag: tag.toString('base64'),
            data: encrypted.toString('base64')
        };
        
        fs.writeFileSync(KEYSTORE_FILE, JSON.stringify(encryptedData, null, 2), { mode: 0o600 });
        this.keystore = keystore;
    }

    // ==================== Public Methods ====================

    addKey(backupId: string, key: string, dbName: string, dbType: string): void {
        const keystore = this.loadKeystore();
        
        // Check if key already exists for this backup
        const existingIndex = keystore.keys.findIndex(k => k.backupId === backupId);
        if (existingIndex !== -1) {
            keystore.keys[existingIndex] = {
                backupId,
                key,
                dbName,
                dbType,
                createdAt: new Date().toISOString(),
                algorithm: ALGORITHM,
                keyId: keystore.keys[existingIndex].keyId || `key_${Date.now()}`
            };
        } else {
            keystore.keys.push({
                backupId,
                key,
                dbName,
                dbType,
                createdAt: new Date().toISOString(),
                algorithm: ALGORITHM,
                keyId: `key_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
            });
        }
        
        keystore.updatedAt = new Date().toISOString();
        this.saveKeystore(keystore);
    }

    getKey(backupId: string): KeyEntry | null {
        const keystore = this.loadKeystore();
        const entry = keystore.keys.find(k => k.backupId === backupId);
        return entry || null;
    }

    getAllKeys(): KeyEntry[] {
        const keystore = this.loadKeystore();
        return keystore.keys;
    }

    deleteKey(backupId: string): boolean {
        const keystore = this.loadKeystore();
        const initialLength = keystore.keys.length;
        keystore.keys = keystore.keys.filter(k => k.backupId !== backupId);
        
        if (keystore.keys.length < initialLength) {
            keystore.updatedAt = new Date().toISOString();
            this.saveKeystore(keystore);
            return true;
        }
        return false;
    }

    exportKeystore(exportPath: string): void {
        const keystore = this.loadKeystore();
        const exportData = {
            version: keystore.version,
            keys: keystore.keys,
            exportedAt: new Date().toISOString(),
            source: 'db-backup-cli'
        };
        
        // Encrypt the export with a temporary key
        const tempKey = randomBytes(32);
        const iv = randomBytes(IV_LENGTH);
        const cipher = createCipheriv(ALGORITHM, tempKey, iv);
        
        const data = Buffer.from(JSON.stringify(exportData, null, 2), 'utf-8');
        const encrypted = Buffer.concat([
            cipher.update(data),
            cipher.final()
        ]);
        const tag = cipher.getAuthTag();
        
        const exportFile = {
            version: '1.0',
            iv: iv.toString('base64'),
            tag: tag.toString('base64'),
            data: encrypted.toString('base64'),
            keyHint: tempKey.toString('hex').substring(0, 8) + '...'
        };
        
        fs.writeFileSync(exportPath, JSON.stringify(exportFile, null, 2), { mode: 0o600 });
        console.log(chalk.green(`\n✅ Keystore exported to: ${exportPath}`));
        console.log(chalk.yellow(`\n⚠️  Import password: ${tempKey.toString('hex')}`));
        console.log(chalk.dim('   Save this password securely! You\'ll need it for import.'));
    }

    importKeystore(importPath: string, password: string): void {
        if (!fs.existsSync(importPath)) {
            throw new Error(`Import file not found: ${importPath}`);
        }
        
        const importData = JSON.parse(fs.readFileSync(importPath, 'utf-8'));
        const tempKey = Buffer.from(password, 'hex');
        
        const decipher = createDecipheriv(
            ALGORITHM,
            tempKey,
            Buffer.from(importData.iv, 'base64')
        );
        decipher.setAuthTag(Buffer.from(importData.tag, 'base64'));
        
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(importData.data, 'base64')),
            decipher.final()
        ]);
        
        const keystoreData = JSON.parse(decrypted.toString('utf-8'));
        
        // Merge with existing keystore
        const currentKeystore = this.loadKeystore();
        
        for (const key of keystoreData.keys) {
            const existing = currentKeystore.keys.find(k => k.backupId === key.backupId);
            if (!existing) {
                currentKeystore.keys.push(key);
            }
        }
        
        currentKeystore.updatedAt = new Date().toISOString();
        this.saveKeystore(currentKeystore);
        
        console.log(chalk.green(`\n✅ Keystore imported successfully`));
        console.log(chalk.dim(`   Imported ${keystoreData.keys.length} keys`));
    }

    getKeyCount(): number {
        const keystore = this.loadKeystore();
        return keystore.keys.length;
    }

    getKeystorePath(): string {
        return KEYSTORE_FILE;
    }
}

export const keyManager = new KeyManager();