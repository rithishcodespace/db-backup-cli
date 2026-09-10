# ==========================================
# Stage 1: Build React Dashboard (Vite)
# ==========================================
FROM node:20-alpine AS dashboard-builder

WORKDIR /app/dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

# ==========================================
# Stage 2: Build Node.js TypeScript Backend
# ==========================================
FROM node:20-alpine AS backend-builder

WORKDIR /app
COPY package*.json prisma.config.ts ./
COPY prisma ./prisma/
COPY scripts ./scripts/

RUN apk add --no-cache python3 make g++
RUN npm ci --ignore-scripts
RUN npm rebuild better-sqlite3

COPY . .
RUN npx prisma generate
RUN npm run build
RUN mkdir -p /app/data-template && DATABASE_URL="file:/app/data-template/backup-meta.db" npx prisma migrate deploy
RUN npm prune --omit=dev
RUN npm rebuild better-sqlite3

# ==========================================
# Stage 3: All-in-One Production Runtime
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV GATEWAY_PORT=3000
ENV BACKUP_PATH=/app/backups

# Install native database client tools, redis server, and utilities
RUN apk add --no-cache \
    postgresql-client \
    mysql-client \
    mongodb-tools \
    sqlite \
    redis \
    bash \
    ca-certificates \
    curl \
    libstdc++

# Install PM2 process supervisor globally
RUN npm install -g pm2

# Copy production artifacts
COPY package*.json prisma.config.js ./
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/generated ./generated
COPY --from=backend-builder /app/prisma ./prisma
COPY --from=backend-builder /app/data-template ./data-template
COPY --from=backend-builder /app/bin ./bin
COPY --from=backend-builder /app/scripts ./scripts
COPY --from=dashboard-builder /app/dashboard/dist ./dashboard/dist

# Copy PM2 configuration and entrypoint
COPY ecosystem.config.js ./ecosystem.config.js
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh

# Create runtime directories for data, backups, and logs
RUN mkdir -p /app/data /app/data/redis /app/backups /app/logs /app/tmp /root/.db-backup \
    && chmod -R 775 /app/data /app/backups /app/logs /app/tmp /root/.db-backup

# Publish strictly port 3000 (API Gateway)
EXPOSE 3000

# Container healthcheck
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://127.0.0.1:3000/health || exit 1

# Start container through production entrypoint
ENTRYPOINT ["/app/docker/entrypoint.sh"]
