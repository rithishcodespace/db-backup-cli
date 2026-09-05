module.exports = {
  apps: [
    {
      name: 'api-gateway',
      script: 'dist/src/server.js',
      env: {
        NODE_ENV: 'production',
        GATEWAY_PORT: 3000,
      },
    },
    {
      name: 'backup-workers',
      script: 'dist/src/index.js',
      args: '--worker',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'backup-orchestrator',
      script: 'dist/src/microservices/backup-orchestrator/index.js',
      args: '--port 3001',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'scheduler-service',
      script: 'dist/src/microservices/scheduler-service/index.js',
      args: '--port 3020',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'storage-service',
      script: 'dist/src/microservices/storage-service/index.js',
      args: '--port 3030',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'notification-service',
      script: 'dist/src/microservices/notification-service/index.js',
      args: '--port 3040',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'postgres-backup',
      script: 'dist/src/microservices/database-services/postgres/service.js',
      args: '--port 3010',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'mysql-backup',
      script: 'dist/src/microservices/database-services/mysql/service.js',
      args: '--port 3011',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'mongodb-backup',
      script: 'dist/src/microservices/database-services/mongodb/service.js',
      args: '--port 3012',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'sqlite-backup',
      script: 'dist/src/microservices/database-services/sqlite/service.js',
      args: '--port 3013',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
