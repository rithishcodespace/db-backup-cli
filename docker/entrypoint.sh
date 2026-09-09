#!/bin/bash
set -e

echo "═══════════════════════════════════════════════════════════"
echo "        Starting Database Backup Production Runtime        "
echo "═══════════════════════════════════════════════════════════"

# 1. Initialize and verify runtime directories
echo "[entrypoint] Initializing runtime directories..."
mkdir -p /app/data /app/data/redis /app/backups /app/logs /app/tmp /root/.db-backup
chmod -R 775 /app/data /app/backups /app/logs /app/tmp /root/.db-backup 2>/dev/null || true

# Symlink keystore/backups path if not already mounted
if [ ! -L /root/.db-backup ] && [ ! -d /root/.db-backup ]; then
  ln -sfn /app/backups /root/.db-backup
fi

# 2. Prepare metadata storage (SQLite) with production migrations
DATABASE_FILE="/app/data/backup-meta.db"
echo "[entrypoint] Applying production metadata migrations at ${DATABASE_FILE}..."
DATABASE_URL="file:${DATABASE_FILE}" npx prisma migrate deploy

# 3. Verify and set default runtime environment variables
export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-3000}"
export GATEWAY_PORT="${GATEWAY_PORT:-3000}"
export REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
export REDIS_PORT="${REDIS_PORT:-6379}"
export METADATA_SERVICE_URL="${METADATA_SERVICE_URL:-http://127.0.0.1:3005}"
export ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://127.0.0.1:3001}"
export DATABASE_URL="${DATABASE_URL:-file:${DATABASE_FILE}}"
export BACKUP_PATH="${BACKUP_PATH:-/app/backups}"

echo "[entrypoint] Configuration validated:"
echo "  • Node Environment:     ${NODE_ENV}"
echo "  • API Gateway Port:     ${PORT} (Publicly Exposed)"
echo "  • Metadata Service:     ${METADATA_SERVICE_URL} (Internal Loopback)"
echo "  • Orchestrator:         ${ORCHESTRATOR_URL} (Internal Loopback)"
echo "  • Redis Host:           ${REDIS_HOST}:${REDIS_PORT} (Internal Loopback)"
echo "  • Metadata DB Path:     ${DATABASE_URL}"
echo "  • Backup Storage Path:  ${BACKUP_PATH}"

echo "[entrypoint] Launching PM2 process supervisor (PID 1)..."
# 4. Exec pm2-runtime so PM2 becomes PID 1 and receives Docker SIGTERM/SIGINT signals
exec pm2-runtime start ecosystem.config.js
