# Windows PowerShell script for starting services with BullMQ

Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "     Starting Database Backup Microservices with BullMQ" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan

# Check if PM2 is installed
$pm2Installed = Get-Command pm2 -ErrorAction SilentlyContinue
if (-not $pm2Installed) {
    Write-Host "PM2 not found. Installing globally..." -ForegroundColor Yellow
    npm install -g pm2
}

# Create logs directory
New-Item -ItemType Directory -Force -Path logs | Out-Null
New-Item -ItemType Directory -Force -Path backups/local | Out-Null
New-Item -ItemType Directory -Force -Path tmp | Out-Null

# Start BullMQ Workers
Write-Host "Starting BullMQ Workers..." -ForegroundColor Green
pm2 start dist/src/index.js --name backup-workers -- --worker

# Start services
Write-Host "Starting API Gateway..." -ForegroundColor Green
pm2 start dist/src/microservices/gateway/index.js --name api-gateway -- --port 3000

Write-Host "Starting Backup Orchestrator..." -ForegroundColor Green
pm2 start dist/src/microservices/backup-orchestrator/index.js --name backup-orchestrator -- --port 3001

Write-Host "Starting Scheduler Service..." -ForegroundColor Green
pm2 start dist/src/microservices/scheduler-service/index.js --name scheduler-service -- --port 3020

Write-Host "Starting Storage Service..." -ForegroundColor Green
pm2 start dist/src/microservices/storage-service/index.js --name storage-service -- --port 3030

Write-Host "Starting Notification Service..." -ForegroundColor Green
pm2 start dist/src/microservices/notification-service/index.js --name notification-service -- --port 3040

Write-Host "Starting PostgreSQL Backup Service..." -ForegroundColor Green
pm2 start dist/src/microservices/database-services/postgres/service.js --name postgres-backup -- --port 3010

Write-Host "Starting MySQL Backup Service..." -ForegroundColor Green
pm2 start dist/src/microservices/database-services/mysql/service.js --name mysql-backup -- --port 3011

Write-Host "Starting MongoDB Backup Service..." -ForegroundColor Green
pm2 start dist/src/microservices/database-services/mongodb/service.js --name mongodb-backup -- --port 3012

Write-Host "Starting SQLite Backup Service..." -ForegroundColor Green
pm2 start dist/src/microservices/database-services/sqlite/service.js --name sqlite-backup -- --port 3013

Write-Host "`n═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "✓ All services and workers started!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "`nService URLs:" -ForegroundColor Yellow
Write-Host "  API Gateway:       http://localhost:3000"
Write-Host "  Orchestrator:      http://localhost:3001"
Write-Host "  Scheduler:         http://localhost:3020"
Write-Host "  Storage:           http://localhost:3030"
Write-Host "  Notification:      http://localhost:3040"
Write-Host "  PostgreSQL:        http://localhost:3010"
Write-Host "  MySQL:             http://localhost:3011"
Write-Host "  MongoDB:           http://localhost:3012"
Write-Host "  SQLite:            http://localhost:3013"
Write-Host ""
Write-Host "BullMQ Workers:" -ForegroundColor Yellow
Write-Host "  Backup Worker      (processes backup jobs)"
Write-Host "  Storage Worker     (uploads to S3/local)"
Write-Host "  Notification Worker (sends Slack/Email)"
Write-Host ""
Write-Host "PM2 Commands:" -ForegroundColor Yellow
Write-Host "  View logs:    pm2 logs backup-workers"
Write-Host "  Stop all:     pm2 stop all"
Write-Host "  Restart all:  pm2 restart all"
Write-Host "  Monitor:      pm2 monit"