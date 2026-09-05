import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { connection } from '../../lib/queue-manager';
import { clientIdManager } from '../../lib/client-id'; 
import axios from 'axios';
import swaggerUi from 'swagger-ui-express';
import { createModuleLogger } from '../../logger';
import { swaggerSpec } from '../../swagger/openapi';
import dashboardRoutes from './modules/dashboard/dashboard.routes';

const app = express();
const log = createModuleLogger('api-gateway');

const GATEWAY_PORT = process.env.GATEWAY_PORT || 3000;
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:3001';

// Rate Limiter Configuration

// Default rate limits
const RATE_LIMIT_POINTS = parseInt(process.env.RATE_LIMIT_POINTS || '100'); // 100 requests
const RATE_LIMIT_DURATION = parseInt(process.env.RATE_LIMIT_DURATION || '60'); // per 60 seconds

// Different limits for different endpoints
const rateLimiters = {
    // General API rate limit
    api: new RateLimiterRedis({
        storeClient: connection,
        points: RATE_LIMIT_POINTS,
        duration: RATE_LIMIT_DURATION,
        keyPrefix: 'gateway_rate_limit_api', // prefix of the key used for rate limiting -> prefix:client-id
    }),
    // Stricter limit for backup operations
    backup: new RateLimiterRedis({
        storeClient: connection,
        points: parseInt(process.env.RATE_LIMIT_BACKUP_POINTS || '10'),
        duration: parseInt(process.env.RATE_LIMIT_BACKUP_DURATION || '60'),
        keyPrefix: 'gateway_rate_limit_backup',
    }),
    // Health check has no limit
};

app.use(helmet());
app.use(cors());
app.use(express.json());

// client id middleware
const clientIdMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Check if client ID is provided in header
    let clientId = req.header('x-client-id');
    
    if (!clientId) {
        return res.status(400).json({
            error: "Missing x-client-id header"
        });
    }
    
    // Store in request object for logging
    (req as any).clientId = clientId;
    
    log.debug('Client ID detected', { 
        clientId: clientId.substring(0, 8) + '...' 
    });
    
    return next();
};

// Rate Limiting Middleware Factory
const createRateLimiter = (limiter: RateLimiterRedis) => {
    return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        try {
            // Use client ID or IP as key
            const key = (req as any).clientId || req.ip || 'unknown';
            
            // Consume a point for this key
            await limiter.consume(key);
            return next();
        } catch (error: any) {
            // Rate limit exceeded
            if (error instanceof Error && error.message?.includes('Rate limit exceeded')) {
                log.warn('Rate limit exceeded', {
                    clientId: (req as any).clientId?.substring(0, 8) + '...',
                    ip: req.ip,
                    path: req.path,
                });
                
                res.set('X-RateLimit-Limit', String(RATE_LIMIT_POINTS));
                
                return res.status(429).json({
                    success: false,
                    error: 'Too Many Requests',
                    message: 'Rate limit exceeded. Please try again later.',
                });
            }
            
            // Other errors
            log.error('Rate limiter error', { error: error.message });
            return next();
        }
    };
};

// Dashboard API - no client ID header required for telemetry reading
app.use('/api/dashboard', dashboardRoutes);

// Swagger Documentation UI & JSON endpoint
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api-docs/json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
});

// Static Dashboard serving for production NPM package deployment
const dashboardDistPath = [
    path.resolve(__dirname, '../../../dashboard/dist'),
    path.resolve(__dirname, '../../dashboard/dist'),
    path.resolve(process.cwd(), 'dashboard/dist'),
].find(p => fs.existsSync(p)) || path.resolve(__dirname, '../../../dashboard/dist');

app.use('/dashboard', express.static(dashboardDistPath));
app.get('/dashboard', (_req, res) => {
    res.sendFile(path.join(dashboardDistPath, 'index.html'));
});

app.use('/api/backup', clientIdMiddleware, createRateLimiter(rateLimiters.backup));
app.use('/api/', clientIdMiddleware, createRateLimiter(rateLimiters.api));

// Health check - no rate limit
app.get('/health', (req, res) => {
    res.json({
        service: 'api-gateway',
        status: 'healthy',
        timestamp: new Date(),
        services: {
            orchestrator: ORCHESTRATOR_URL
        }
    });
});

app.get('/api/client-id', (req, res) => {
    const clientId = clientIdManager.getClientId();
    const config = clientIdManager.getConfig();
    
    res.json({
        clientId: clientId,
        createdAt: config?.createdAt || null,
        lastUpdated: config?.lastUpdated || null,
        configPath: process.env.HOME || process.env.USERPROFILE + '/.db-backup/config.json'
    });
});

app.get('/api/rate-limit/status', async (req, res) => {
    try {
        const clientId = (req as any).clientId || req.ip || 'unknown';
        
        const [apiStatus, backupStatus] = await Promise.all([
            rateLimiters.api.get(clientId),
            rateLimiters.backup.get(clientId)
        ]);
        
        res.json({
            clientId: clientId.substring(0, 8) + '...',
            limits: {
                api: {
                    points: RATE_LIMIT_POINTS,
                    duration: RATE_LIMIT_DURATION,
                    remaining: apiStatus?.remainingPoints || RATE_LIMIT_POINTS,
                    msBeforeNext: apiStatus?.msBeforeNext || 0,
                },
                backup: {
                    points: parseInt(process.env.RATE_LIMIT_BACKUP_POINTS || '10'),
                    duration: parseInt(process.env.RATE_LIMIT_BACKUP_DURATION || '60'),
                    remaining: backupStatus?.remainingPoints || parseInt(process.env.RATE_LIMIT_BACKUP_POINTS || '10'),
                    msBeforeNext: backupStatus?.msBeforeNext || 0,
                }
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get rate limit status' });
    }
});


app.post('/api/backup', async (req, res) => {
    log.info('Backup request received via gateway', {
        clientId: (req as any).clientId?.substring(0, 8) + '...'
    });
    
    try {
        const response = await axios.post(`${ORCHESTRATOR_URL}/backup`, req.body);
        res.json(response.data);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Gateway backup failed', { error: errorMessage });
        
        if (axios.isAxiosError(error) && error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: errorMessage });
        }
    }
});

app.get('/api/backup/:id/status', async (req, res) => {
    const { id } = req.params;
    
    try {
        const response = await axios.get(`${ORCHESTRATOR_URL}/backup/${id}/status`);
        res.json(response.data);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (axios.isAxiosError(error) && error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: errorMessage });
        }
    }
});

app.get('/api/services/health', async (req, res) => {
    const services = ['postgresql', 'mysql', 'mongodb', 'sqlite'];
    const health: any = {};
    
    for (const service of services) {
        try {
            const port = service === 'postgresql' ? 3010 :
                         service === 'mysql' ? 3011 :
                         service === 'mongodb' ? 3012 : 3013;
            const response = await axios.get(`http://localhost:${port}/health`, {
                timeout: 3000
            });
            health[service] = response.data;
        } catch (error) {
            health[service] = { 
                status: 'unhealthy', 
                error: 'Service unreachable' 
            };
        }
    }
    
    res.json(health);
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    log.error('Unhandled error in gateway', { error: err.message, stack: err.stack });
    res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});


app.listen(GATEWAY_PORT, () => {
    log.info(`API Gateway listening on port ${GATEWAY_PORT}`);
    log.info(`Swagger UI documentation available at http://localhost:${GATEWAY_PORT}/api-docs`);
    log.info(`Rate Limit: ${RATE_LIMIT_POINTS} requests per ${RATE_LIMIT_DURATION} seconds`);
    log.info(`Client ID stored at: ${process.env.HOME || process.env.USERPROFILE}/.db-backup/config.json`);
});

export default app;