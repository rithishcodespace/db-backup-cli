#!/bin/bash
# run this bash env

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}     Starting Database Backup Microservices${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}PM2 not found. Installing globally...${NC}"
    npm install -g pm2
fi

# Create logs directory
mkdir -p logs

# Start services with PM2
echo -e "${GREEN}Starting API Gateway...${NC}"
pm2 start dist/src/microservices/gateway/index.js --name api-gateway -- --port 3000

echo -e "${GREEN}Starting Backup Orchestrator...${NC}"
pm2 start dist/src/microservices/backup-orchestrator/index.js --name backup-orchestrator -- --port 3001

echo -e "${GREEN}Starting PostgreSQL Backup Service...${NC}"
pm2 start dist/src/microservices/database-services/postgres/service.js --name postgres-backup -- --port 3010

echo -e "${GREEN}Starting MySQL Backup Service...${NC}"
pm2 start dist/src/microservices/database-services/mysql/service.js --name mysql-backup -- --port 3011

echo -e "${GREEN}Starting MongoDB Backup Service...${NC}"
pm2 start dist/src/microservices/database-services/mongodb/service.js --name mongodb-backup -- --port 3012

echo -e "${GREEN}Starting SQLite Backup Service...${NC}"
pm2 start dist/src/microservices/database-services/sqlite/service.js --name sqlite-backup -- --port 3013

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ All services started successfully!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}Service URLs:${NC}"
echo "  API Gateway:       http://localhost:3000"
echo "  Orchestrator:      http://localhost:3001"
echo "  PostgreSQL:        http://localhost:3010"
echo "  MySQL:             http://localhost:3011"
echo "  MongoDB:           http://localhost:3012"
echo "  SQLite:            http://localhost:3013"
echo ""
echo -e "${YELLOW}Commands:${NC}"
echo "  View logs:    pm2 logs"
echo "  Stop all:     pm2 stop all"
echo "  Restart all:  pm2 restart all"
echo "  Monitor:      pm2 monit"
echo ""