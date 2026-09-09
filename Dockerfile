# Multi-stage production Dockerfile for db-backup-cli
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies and Prisma engines
COPY package*.json prisma.config.ts ./
COPY prisma ./prisma/
RUN apk add --no-cache python3 make g++
RUN npm ci

# Copy source and build TypeScript
COPY . .
RUN npx prisma generate
RUN npm run build

# Production runtime stage
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install native client tools (PostgreSQL, MySQL, SQLite)
RUN apk add --no-cache \
    postgresql-client \
    mysql-client \
    sqlite \
    bash \
    ca-certificates

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/generated ./generated

RUN mkdir -p backups/local tmp logs /app/data && chmod -R 755 backups tmp logs /app/data

EXPOSE 3000
CMD ["node", "dist/src/server.js"]
