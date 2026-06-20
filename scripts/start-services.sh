#!/bin/bash

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}     Starting Database Backup Microservices - Phase 4${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}PM2 not found. Installing globally...${NC}"
    npm install -g pm2
fi

# Create necessary directories
mkdir -p logs backups/local tmp

# Start all services
echo -e "${GREEN}Starting API Gateway...${NC}"
pm2 start dist/src/microservices/gateway/index.js --name api-gateway -- --port 3000

echo -e "${GREEN}Starting Backup Orchestrator...${NC}"
pm2 start dist/src/microservices/backup-orchestrator/index.js --name backup-orchestrator -- --port 3001

echo -e "${GREEN}Starting Scheduler Service...${NC}"
pm2 start dist/src/microservices/scheduler-service/index.js --name scheduler-service -- --port 3020

echo -e "${GREEN}Starting Storage Service...${NC}"
pm2 start dist/src/microservices/storage-service/index.js --name storage-service -- --port 3030

echo -e "${GREEN}Starting Notification Service...${NC}"
pm2 start dist/src/microservices/notification-service/index.js --name notification-service -- --port 3040

echo -e "${GREEN}Starting Database Services...${NC}"
pm2 start dist/src/microservices/database-services/postgres/service.js --name postgres-backup -- --port 3010
pm2 start dist/src/microservices/database-services/mysql/service.js --name mysql-backup -- --port 3011
pm2 start dist/src/microservices/database-services/mongodb/service.js --name mongodb-backup -- --port 3012
pm2 start dist/src/microservices/database-services/sqlite/service.js --name sqlite-backup -- --port 3013

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ All Phase 4 services started!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}Service URLs:${NC}"
echo "  API Gateway:       http://localhost:3000"
echo "  Orchestrator:      http://localhost:3001"
echo "  Scheduler:         http://localhost:3020"
echo "  Storage:           http://localhost:3030"
echo "  Notification:      http://localhost:3040"
echo "  PostgreSQL:        http://localhost:3010"
echo "  MySQL:             http://localhost:3011"
echo "  MongoDB:           http://localhost:3012"
echo "  SQLite:            http://localhost:3013"
echo ""
echo -e "${YELLOW}New Phase 4 Commands:${NC}"
echo "  db-backup schedule --cron '0 2 * * *' --type full"
echo "  db-backup schedule:list"
echo "  db-backup restore --id <backup-id> --drop-existing"
echo "  db-backup backup --storage s3 --retention 30"
echo ""
echo -e "${YELLOW}PM2 Commands:${NC}"
echo "  View logs:    pm2 logs"
echo "  Stop all:     pm2 stop all"
echo "  Restart all:  pm2 restart all"
echo "  Monitor:      pm2 monit"