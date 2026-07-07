# Windows PowerShell script for stopping services

Write-Host "Stopping all microservices and workers..." -ForegroundColor Yellow

# Stop all PM2 processes
pm2 stop all

# Remove all PM2 processes from list
pm2 delete all

Write-Host "✓ All services and workers stopped" -ForegroundColor Green