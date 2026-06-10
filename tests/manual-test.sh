#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}Database Backup CLI - Phase 1 Tests${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""

# Check if build exists
if [ ! -f "dist/index.js" ]; then
    echo -e "${RED}Error: Build not found. Running build...${NC}"
    npm run build
    echo ""
fi

# Test 1: Help command
echo -e "${GREEN}Test 1: Display help${NC}"
node dist/index.js --help
echo ""

# Test 2: Version
echo -e "${GREEN}Test 2: Display version${NC}"
node dist/index.js --version
echo ""

# Test 3: Connect to database (simulated)
echo -e "${GREEN}Test 3: Test database connection${NC}"
node dist/index.js connect --type postgresql --host localhost --database testdb
echo ""

# Test 4: Backup (simulated)
echo -e "${GREEN}Test 4: Run backup${NC}"
node dist/index.js backup --type full --compress
echo ""

# Test 5: Verbose logging
echo -e "${GREEN}Test 5: Verbose mode${NC}"
node dist/index.js --verbose backup
echo ""

# Test 6: Invalid command
echo -e "${GREEN}Test 6: Invalid command handling${NC}"
node dist/index.js invalidcommand
echo ""

# Test 7: Check log files
echo -e "${GREEN}Test 7: Check log files${NC}"
if [ -f "logs/combined.log" ]; then
    echo -e "${GREEN}✓ Log file created: logs/combined.log${NC}"
    echo "Last 5 lines:"
    tail -5 logs/combined.log
else
    echo -e "${RED}✗ Log file not found${NC}"
fi
echo ""

echo -e "${BLUE}======================================${NC}"
echo -e "${GREEN}Phase 1 tests completed!${NC}"
echo -e "${BLUE}======================================${NC}"