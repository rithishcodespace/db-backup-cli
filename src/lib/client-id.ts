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

export function getClientId(): string {
    // Ensure config directory exists
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
    
    // If config file exists, read it
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
            const config = JSON.parse(data);
            if (config.clientId) {
                return config.clientId;
            }
        } catch (error) {
            console.warn('Failed to read client config, generating new ID');
        }
    }
    
    // Generate new client ID
    const clientId = uuidv4();
    const config: ClientConfig = {
        clientId,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
    };
    
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
    
    console.log(`\n🔑 Client ID generated: ${clientId}`);
    console.log(`   Stored in: ${CONFIG_FILE}\n`);
    
    return clientId;
}