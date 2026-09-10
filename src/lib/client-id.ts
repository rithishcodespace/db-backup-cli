import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

const CONFIG_DIR = path.join(os.homedir(), '.db-backup');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface ClientConfig {
    clientId: string;
    createdAt: string;
    lastUpdated: string;
}

export class ClientIdManager {
    private static instance: ClientIdManager;
    private config: ClientConfig | null = null;

    private constructor() {
        this.ensureConfigDirectory();
        this.loadOrCreateConfig();
    }

    public static getInstance(): ClientIdManager {
        if (!ClientIdManager.instance) {
            ClientIdManager.instance = new ClientIdManager();
        }
        return ClientIdManager.instance;
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
                
                // Validate config has clientId
                if (!this.config?.clientId) {
                    this.createNewConfig();
                }
            } catch (error) {
                // Config file is corrupted, create new one
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
    }

    private saveConfig(): void {
        if (!this.config) return;
        
        this.config.lastUpdated = new Date().toISOString();
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), { mode: 0o600 });
    }

    public getClientId(): string {
        return this.config?.clientId || '';
    }

    public getConfig(): ClientConfig | null {
        return this.config;
    }

    public resetConfig(): void {
        this.createNewConfig();
    }
}

// Singleton instance for easy import
export const clientIdManager = ClientIdManager.getInstance();

// Simple function for backward compatibility
export function getClientId(): string {
    return clientIdManager.getClientId();
}