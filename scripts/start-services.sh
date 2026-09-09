#!/bin/bash

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}     Starting Database Backup Services via PM2${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}PM2 is required to run background services.${NC}"
    echo -e "${YELLOW}Please install PM2 via: npm install -g pm2${NC}"
    exit 1
fi

# Create necessary directories
mkdir -p logs backups/local tmp data/redis

echo -e "${GREEN}Starting all services via PM2 ecosystem...${NC}"
pm2 start ecosystem.config.js

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ All services and workers started!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}Service URLs (Internal & External):${NC}"
echo "  API Gateway:       http://localhost:3000 (Public)"
echo "  Orchestrator:      http://localhost:3001"
echo "  Metadata Service:  http://localhost:3005"
echo "  PostgreSQL:        http://localhost:3010"
echo "  MySQL:             http://localhost:3011"
echo "  MongoDB:           http://localhost:3012"
echo "  SQLite:            http://localhost:3013"
echo "  Scheduler:         http://localhost:3020"
echo "  Redis:             localhost:6379"
echo ""
echo -e "${YELLOW}BullMQ Workers (Supervised by backup-workers):${NC}"
echo "  • Backup Worker     (processes backup-queue)"
echo "  • Restore Worker    (processes restore-queue)"
echo "  • Storage Worker    (processes storage-queue -> S3)"
echo "  • Notification Worker (processes notification-queue -> Slack/Email)"
echo ""
echo -e "${YELLOW}PM2 Commands:${NC}"
echo "  View status:  pm2 status"
echo "  View logs:    pm2 logs"
echo "  Stop all:     pm2 stop all"
echo "  Restart all:  pm2 restart all"
echo "  Monitor:      pm2 monit"