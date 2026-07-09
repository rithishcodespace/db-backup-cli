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

// Add request interceptor to include Client ID
httpClient.interceptors.request.use((config) => {
    const clientId = getClientId();
    config.headers['x-client-id'] = clientId;
    return config;
});

// Add response interceptor for logging
httpClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (axios.isAxiosError(error) && error.response?.status === 429) {
            console.error('\n⚠️ Rate limit exceeded. Please wait and try again.');
            console.error(`   Retry after: ${error.response.headers['retry-after'] || 'some time'}\n`);
        }
        return Promise.reject(error);
    }
);

export default httpClient;