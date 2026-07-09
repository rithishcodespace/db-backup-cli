import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../logger';

const log = createModuleLogger('client-id-manager');

const CONFIG_DIR = path.join(os.homedir(), '.db-backup');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface ClientConfig {
    clientId: string;
    createdAt: string;
    lastUpdated: string;
}

export class ClientIdManager {
    private config: ClientConfig | null = null;

    constructor() {
        this.ensureConfigDirectory();
        this.loadOrCreateConfig();
    }

    private ensureConfigDirectory(): void {
        if (!fs.existsSync(CONFIG_DIR)) {
            fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
        }
    }

    private loadOrCreateConfig(): void {
        if (fs.existsSync(CONFIG_FILE)) {
            try {
                const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
                this.config = JSON.parse(data);
                
                // Validate the config has a clientId
                if (!this.config?.clientId) {
                    this.createNewConfig();
                }
                
                log.info('Client ID loaded from config', { 
                    clientId: this.config?.clientId?.substring(0, 8) + '...' 
                });
                
            } catch (error) {
                log.warn('Failed to load config, creating new one', { error });
                this.createNewConfig();
            }
        } else {
            this.createNewConfig();
        }
    }

    private createNewConfig(): void {
        const clientId = uuidv4();
        
        this.config = {
            clientId: clientId,
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };
        
        this.saveConfig();
        
        console.log(`\n🔑 Client ID generated: ${clientId}`);
        console.log(`   Stored in: ${CONFIG_FILE}\n`);
        
        log.info('New Client ID created', { clientId: clientId.substring(0, 8) + '...' });
    }

    private saveConfig(): void {
        if (!this.config) return;
        
        this.config.lastUpdated = new Date().toISOString();
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), { mode: 0o600 });
    }

    getClientId(): string {
        return this.config?.clientId || '';
    }

    getConfig(): ClientConfig | null {
        return this.config;
    }

    resetConfig(): void {
        this.createNewConfig();
    }
}

export const clientIdManager = new ClientIdManager();