#!/bin/bash

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Stopping all microservices...${NC}"
pm2 stop all
pm2 delete all
echo -e "${GREEN}✓ All services stopped${NC}"