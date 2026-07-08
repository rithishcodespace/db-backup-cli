#!/bin/bash

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${YELLOW}Stopping all microservices and workers...${NC}"

# Stop all PM2 processes
pm2 stop all

# Remove all PM2 processes
pm2 delete all

echo -e "${GREEN}✓ All services and workers stopped${NC}"