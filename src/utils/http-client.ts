import axios from 'axios';
import { getClientId } from '../lib/client-id';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';

export const httpClient = axios.create({
    baseURL: GATEWAY_URL,
    timeout: 30000,
    headers: {
        'Content-Type': 'application/json',
    }
});

// Request interceptor: Adds Client ID to every request
httpClient.interceptors.request.use((config) => {
    const clientId = getClientId();  // ← Uses the singleton
    config.headers['x-client-id'] = clientId;
    
    // Optional: Add for debugging
    if (process.env.DEBUG === 'true') {
        console.log(`[HTTP] Request to ${config.url} with client-id: ${clientId.substring(0, 8)}...`);
    }
    
    return config;
});

// Response interceptor: Handles rate limiting errors
httpClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (axios.isAxiosError(error) && error.response?.status === 429) {
            console.error('\n⚠️ Rate limit exceeded. Please wait and try again.');
            
            const retryAfter = error.response.headers['retry-after'] || 
                              error.response.headers['x-ratelimit-reset'] || 
                              'some time';
            console.error(`   Retry after: ${retryAfter} seconds\n`);
        }
        return Promise.reject(error);
    }
);

export default httpClient;