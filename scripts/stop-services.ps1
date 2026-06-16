# Colors
$Green = "Green"
$Yellow = "Yellow"

Write-Host "Stopping all microservices..." -ForegroundColor $Yellow

# Stop all PM2 processes
pm2 stop all

# Remove all PM2 processes from list
pm2 delete all

Write-Host "✓ All services stopped" -ForegroundColor $Green