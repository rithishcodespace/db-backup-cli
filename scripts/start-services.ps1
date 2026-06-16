# Windows PowerShell script for starting services
Write-Host "Starting Database Backup Microservices" -ForegroundColor Cyan

# Check if PM2 is installed
$pm2Installed = Get-Command pm2 -ErrorAction SilentlyContinue
if (-not $pm2Installed) {
    Write-Host "PM2 not found. Installing globally..." -ForegroundColor Yellow
    npm install -g pm2
}

# Create logs directory
New-Item -ItemType Directory -Force -Path logs

# Start services
Write-Host "Starting API Gateway..." -ForegroundColor Green
pm2 start dist/src/microservices/gateway/index.js --name api-gateway -- --port 3000

Write-Host "Starting Backup Orchestrator..." -ForegroundColor Green
pm2 start dist/src/microservices/backup-orchestrator/index.js --name backup-orchestrator -- --port 3001

Write-Host "Starting PostgreSQL Backup Service..." -ForegroundColor Green
pm2 start dist/src/microservices/database-services/postgres/service.js --name postgres-backup -- --port 3010

Write-Host "Starting MySQL Backup Service..." -ForegroundColor Green
pm2 start dist/src/microservices/database-services/mysql/service.js --name mysql-backup -- --port 3011

Write-Host "Starting MongoDB Backup Service..." -ForegroundColor Green
pm2 start dist/src/microservices/database-services/mongodb/service.js --name mongodb-backup -- --port 3012

Write-Host "Starting SQLite Backup Service..." -ForegroundColor Green
pm2 start dist/src/microservices/database-services/sqlite/service.js --name sqlite-backup -- --port 3013

Write-Host "`nAll services started successfully!" -ForegroundColor Green
Write-Host "`nService URLs:" -ForegroundColor Yellow
Write-Host "  API Gateway:       http://localhost:3000"
Write-Host "  Orchestrator:      http://localhost:3001"
Write-Host "  PostgreSQL:        http://localhost:3010"
Write-Host "  MySQL:             http://localhost:3011"
Write-Host "  MongoDB:           http://localhost:3012"
Write-Host "  SQLite:            http://localhost:3013"