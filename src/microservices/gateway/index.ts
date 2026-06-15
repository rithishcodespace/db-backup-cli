import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import axios from 'axios';
import { createModuleLogger } from '../../logger';

const app = express();
const log = createModuleLogger('api-gateway');

const GATEWAY_PORT = process.env.GATEWAY_PORT || 3000;
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:3001';

// Middleware
app.use(helmet()); // prevents xss attacks
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter); // apply to all api's with /api

// Health check
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

// Backup 
app.post('/api/backup', async (req, res) => {
  log.info('Backup request received via gateway');
  
  try {
    const response = await axios.post(`${ORCHESTRATOR_URL}/backup`, req.body); // sends request to orchestrator-url/backup
    res.json(response.data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Gateway backup failed', { error: errorMessage });
    res.status(500).json({ error: errorMessage });
  }
});

// Get backup status
app.get('/api/backup/:id/status', async (req, res) => {
  const { id } = req.params;
  
  try {
    const response = await axios.get(`${ORCHESTRATOR_URL}/backup/${id}/status`);
    res.json(response.data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: errorMessage });
  }
});

// Service health check endpoint
app.get('/api/services/health', async (req, res) => {
  const services = ['postgresql', 'mysql', 'mongodb', 'sqlite'];
  const health: any = {};
  
  for (const service of services) {
    try {
      const port = service === 'postgresql' ? 3010 :
                   service === 'mysql' ? 3011 :
                   service === 'mongodb' ? 3012 : 3013;
      const response = await axios.get(`http://localhost:${port}/health`);
      health[service] = response.data;
    } catch (error) {
      health[service] = { status: 'unhealthy', error: 'Service unreachable' };
    }
  }
  
  res.json(health);
});

app.listen(GATEWAY_PORT, () => {
  log.info(`API Gateway listening on port ${GATEWAY_PORT}`);
});

export default app;