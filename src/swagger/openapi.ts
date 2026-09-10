// It is manually written OPENAI api specification
// swagger-jsdocs will be used, when i written the data about the api as comments above each API


import { APP_VERSION } from '../version';

export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'dbvault API Gateway',
    version: APP_VERSION,
    description:
      'Comprehensive OpenAPI 3.0 documentation for the dbvault microservices architecture. Provides endpoints for triggering, monitoring, and managing database backups (PostgreSQL, MySQL, MongoDB, SQLite), schedules, storage locations, notifications, and telemetry dashboard.',
    contact: {
      name: 'dbvault Maintainers',
      url: 'https://github.com/rithishcodespace/db-backup-cli',
    },
    license: {
      name: 'ISC',
    },
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'API Gateway (Primary Entrypoint)',
    },
    {
      url: 'http://localhost:3001',
      description: 'Backup Orchestrator Service',
    },
    {
      url: 'http://localhost:3020',
      description: 'Scheduler Service',
    },
    {
      url: 'http://localhost:3030',
      description: 'Storage Service',
    },
    {
      url: 'http://localhost:3040',
      description: 'Notification Service',
    },
  ],
  security: [
    {
      ApiKeyAuth: [],
    },
  ],
  tags: [
    {
      name: 'Gateway & Health',
      description: 'API Gateway diagnostics, client registration, and rate limiting status',
    },
    {
      name: 'Backups',
      description: 'Backup execution, job status monitoring, and queue management',
    },
    {
      name: 'Dashboard',
      description: 'Management dashboard APIs for metrics, live jobs, logs, and alerts',
    },
    {
      name: 'Scheduler',
      description: 'Cron-based automated backup schedule orchestration',
    },
    {
      name: 'Notification',
      description: 'Multi-channel notification delivery (Slack, Email)',
    },
    {
      name: 'Storage',
      description: 'Storage provider operations for local and Amazon S3 destinations',
    },
  ],
  paths: {
    '/health': {
      get: {
        summary: 'API Gateway Health Check',
        description: 'Returns health status of the API gateway service and connected orchestrator.',
        tags: ['Gateway & Health'],
        security: [],
        responses: {
          '200': {
            description: 'Gateway is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    service: { type: 'string', example: 'api-gateway' },
                    status: { type: 'string', example: 'healthy' },
                    timestamp: { type: 'string', format: 'date-time' },
                    services: {
                      type: 'object',
                      properties: {
                        orchestrator: { type: 'string', example: 'http://localhost:3001' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/client-id': {
      get: {
        summary: 'Get Client ID Info',
        description: 'Retrieves current CLI client ID configuration and metadata.',
        tags: ['Gateway & Health'],
        security: [],
        responses: {
          '200': {
            description: 'Client ID details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    clientId: { type: 'string', example: '9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d' },
                    createdAt: { type: 'string', nullable: true },
                    lastUpdated: { type: 'string', nullable: true },
                    configPath: { type: 'string', example: '/home/user/.db-backup/config.json' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/rate-limit/status': {
      get: {
        summary: 'Get Client Rate Limit Status',
        description: 'Checks remaining rate limit quota for API and backup endpoints.',
        tags: ['Gateway & Health'],
        security: [{ ApiKeyAuth: [] }],
        responses: {
          '200': {
            description: 'Rate limit quotas',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RateLimitStatus',
                },
              },
            },
          },
        },
      },
    },
    '/api/services/health': {
      get: {
        summary: 'Health Check Database Microservices',
        description: 'Queries health of all underlying database driver microservices (PostgreSQL, MySQL, MongoDB, SQLite).',
        tags: ['Gateway & Health'],
        security: [],
        responses: {
          '200': {
            description: 'Database services health status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: {
                    type: 'object',
                    properties: {
                      service: { type: 'string' },
                      status: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/backup': {
      post: {
        summary: 'Trigger Database Backup',
        description: 'Enqueues a database backup request for PostgreSQL, MySQL, MongoDB, or SQLite.',
        tags: ['Backups'],
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/BackupRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Backup job successfully queued',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/BackupResponse',
                },
              },
            },
          },
          '400': {
            description: 'Invalid input or missing header',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '429': {
            description: 'Rate limit or queue size limit exceeded',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/backup/{id}/status': {
      get: {
        summary: 'Get Backup Job Status',
        description: 'Retrieves current execution status, progress, file size, and queue metadata for a backup job.',
        tags: ['Backups'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Backup job UUID',
            schema: { type: 'string' },
          },
        ],
        security: [{ ApiKeyAuth: [] }],
        responses: {
          '200': {
            description: 'Backup status detail',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/BackupJobStatus',
                },
              },
            },
          },
          '404': {
            description: 'Backup job not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/backup/{id}': {
      delete: {
        summary: 'Cancel Backup Job',
        description: 'Cancels a pending or running backup job and updates status to cancelled.',
        tags: ['Backups'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Backup job UUID',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Backup job cancelled',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Backup job cancelled' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Backup job not found',
          },
        },
      },
    },
    '/queue/stats': {
      get: {
        summary: 'Get Queue Statistics',
        description: 'Retrieves counts of waiting, active, completed, failed, and delayed jobs in BullMQ.',
        tags: ['Backups'],
        responses: {
          '200': {
            description: 'BullMQ queue stats',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/QueueStats',
                },
              },
            },
          },
        },
      },
    },
    '/api/dashboard/summary': {
      get: {
        summary: 'Get Dashboard Summary Metrics',
        description: 'Provides aggregate metrics for total backups, success rates, total backup storage, and active jobs.',
        tags: ['Dashboard'],
        responses: {
          '200': {
            description: 'Dashboard summary metrics',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/DashboardSummary',
                },
              },
            },
          },
        },
      },
    },
    '/api/dashboard/backups': {
      get: {
        summary: 'List Backup History',
        description: 'Returns paginated backup execution history with optional filtering by status and database type.',
        tags: ['Dashboard'],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'dbType', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Paginated backup jobs',
          },
        },
      },
    },
    '/api/dashboard/backups/active': {
      get: {
        summary: 'List Active Backups',
        description: 'Returns currently running or queued backup jobs.',
        tags: ['Dashboard'],
        responses: {
          '200': {
            description: 'List of active backup jobs',
          },
        },
      },
    },
    '/api/dashboard/queues': {
      get: {
        summary: 'Get Queue System Health',
        description: 'Retrieves detailed BullMQ queue counts and Redis connection status.',
        tags: ['Dashboard'],
        responses: {
          '200': {
            description: 'Queue system details',
          },
        },
      },
    },
    '/api/dashboard/logs': {
      get: {
        summary: 'Get System Logs',
        description: 'Retrieves system log entries with support for log level filtering and keyword search.',
        tags: ['Dashboard'],
        parameters: [
          { name: 'level', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'System log items',
          },
        },
      },
    },
    '/api/dashboard/alerts': {
      get: {
        summary: 'Get System Alerts',
        description: 'Returns recent backup failure alerts and system notifications.',
        tags: ['Dashboard'],
        responses: {
          '200': {
            description: 'List of system alerts',
          },
        },
      },
    },
    '/api/dashboard/health': {
      get: {
        summary: 'Get System Aggregate Health',
        description: 'Returns comprehensive health checks across Gateway, Orchestrator, Storage, Notification, and Scheduler services.',
        tags: ['Dashboard'],
        responses: {
          '200': {
            description: 'System health map',
          },
        },
      },
    },
    '/api/dashboard/backups/{id}/cancel-waiting': {
      post: {
        summary: 'Cancel Waiting Job via Dashboard',
        description: 'Cancels a waiting job in queue via dashboard control.',
        tags: ['Dashboard'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Job cancelled successfully',
          },
        },
      },
    },
    '/api/dashboard/trigger-backup': {
      post: {
        summary: 'Trigger Backup via Dashboard',
        description: 'Allows triggering a database backup from the web dashboard interface.',
        tags: ['Dashboard'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/BackupRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Backup job enqueued',
          },
        },
      },
    },
    '/api/schedule': {
      post: {
        summary: 'Create Backup Schedule',
        description: 'Registers a cron schedule for automated database backups.',
        tags: ['Scheduler'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ScheduleRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Schedule created',
          },
        },
      },
      get: {
        summary: 'List Active Schedules',
        description: 'Returns all active cron backup schedules.',
        tags: ['Scheduler'],
        responses: {
          '200': {
            description: 'List of active backup schedules',
          },
        },
      },
    },
    '/api/schedule/{id}/stop': {
      post: {
        summary: 'Stop Backup Schedule',
        description: 'Disables and stops an active cron backup schedule.',
        tags: ['Scheduler'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Schedule stopped',
          },
        },
      },
    },
    '/api/notify': {
      post: {
        summary: 'Send Notification',
        description: 'Dispatches notification to configured channels (Slack, Email).',
        tags: ['Notification'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/NotificationRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Notification sent',
          },
        },
      },
    },
    '/api/notify/test/slack': {
      post: {
        summary: 'Test Slack Notification',
        description: 'Sends a test message to a specified Slack webhook URL.',
        tags: ['Notification'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  webhookUrl: { type: 'string', example: 'https://hooks.slack.com/services/...' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Slack test successful' },
        },
      },
    },
    '/api/notify/test/email': {
      post: {
        summary: 'Test Email Notification',
        description: 'Sends a test email to a specified email address.',
        tags: ['Notification'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  to: { type: 'string', example: 'admin@example.com' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Email test successful' },
        },
      },
    },
    '/api/storage/upload': {
      post: {
        summary: 'Upload Backup to Storage',
        description: 'Directly uploads a backup archive file to a storage provider.',
        tags: ['Storage'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/StorageUploadRequest' },
            },
          },
        },
        responses: {
          '200': { description: 'Upload completed' },
        },
      },
    },
    '/api/storage/download': {
      post: {
        summary: 'Download Backup from Storage',
        description: 'Downloads a backup archive from storage location to local path.',
        tags: ['Storage'],
        responses: {
          '200': { description: 'Download completed' },
        },
      },
    },
    '/api/storage/list': {
      post: {
        summary: 'List Files in Storage Provider',
        description: 'Lists stored backup files under a specified prefix.',
        tags: ['Storage'],
        responses: {
          '200': { description: 'Files list' },
        },
      },
    },
    '/api/storage/delete': {
      post: {
        summary: 'Delete File from Storage',
        description: 'Deletes a backup file from storage location.',
        tags: ['Storage'],
        responses: {
          '200': { description: 'File deleted' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-client-id',
        description: 'Unique CLI client ID for request tracking and rate limiting',
      },
    },
    schemas: {
      BackupRequest: {
        type: 'object',
        required: ['dbConfig', 'backupType'],
        properties: {
          dbConfig: {
            type: 'object',
            required: ['type', 'database'],
            properties: {
              type: {
                type: 'string',
                enum: ['postgresql', 'mysql', 'mongodb', 'sqlite'],
                example: 'postgresql',
              },
              database: { type: 'string', example: 'production_db' },
              host: { type: 'string', example: 'localhost' },
              port: { type: 'integer', example: 5432 },
              user: { type: 'string', example: 'postgres' },
              password: { type: 'string', example: 'secret' },
            },
          },
          backupType: {
            type: 'string',
            enum: ['full', 'incremental'],
            example: 'full',
          },
          options: {
            type: 'object',
            properties: {
              compress: { type: 'boolean', example: true },
              encrypt: { type: 'boolean', example: false },
              backupName: { type: 'string', example: 'daily-postgres-backup' },
              storage: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'my-s3-bucket' },
                  type: { type: 'string', enum: ['local', 's3'], example: 's3' },
                  bucket: { type: 'string', example: 'backups-vault' },
                  region: { type: 'string', example: 'us-east-1' },
                },
              },
            },
          },
        },
      },
      BackupResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          backupId: { type: 'string', example: 'c1f2e3d4-5678-90ab-cdef-1234567890ab' },
          queued: { type: 'boolean', example: true },
          status: { type: 'string', example: 'queued' },
          message: { type: 'string', example: 'Backup has been queued and will be processed shortly' },
          statusUrl: { type: 'string', example: '/backup/c1f2e3d4-5678-90ab-cdef-1234567890ab/status' },
        },
      },
      BackupJobStatus: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed', 'cancelled'] },
          progress: { type: 'number', example: 100 },
          filePath: { type: 'string', nullable: true },
          fileSize: { type: 'integer', nullable: true },
          duration: { type: 'number', nullable: true },
          error: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          completedAt: { type: 'string', format: 'date-time', nullable: true },
          backupName: { type: 'string' },
          storage: {
            type: 'object',
            nullable: true,
            properties: {
              name: { type: 'string' },
              type: { type: 'string' },
            },
          },
          queueStatus: {
            type: 'object',
            nullable: true,
            properties: {
              state: { type: 'string' },
              attempts: { type: 'integer' },
            },
          },
        },
      },
      DashboardSummary: {
        type: 'object',
        properties: {
          totalBackups: { type: 'integer', example: 42 },
          successfulBackups: { type: 'integer', example: 40 },
          failedBackups: { type: 'integer', example: 2 },
          successRate: { type: 'number', example: 95.2 },
          totalStorageBytes: { type: 'integer', example: 1073741824 },
          activeJobsCount: { type: 'integer', example: 1 },
          averageDuration: { type: 'number', example: 12.4 },
        },
      },
      QueueStats: {
        type: 'object',
        properties: {
          queue: { type: 'string', example: 'backup-queue' },
          stats: {
            type: 'object',
            properties: {
              waiting: { type: 'integer', example: 0 },
              active: { type: 'integer', example: 1 },
              completed: { type: 'integer', example: 15 },
              failed: { type: 'integer', example: 0 },
              delayed: { type: 'integer', example: 0 },
              total: { type: 'integer', example: 16 },
            },
          },
        },
      },
      RateLimitStatus: {
        type: 'object',
        properties: {
          clientId: { type: 'string', example: '9a8b7c6d...' },
          limits: {
            type: 'object',
            properties: {
              api: {
                type: 'object',
                properties: {
                  points: { type: 'integer', example: 100 },
                  duration: { type: 'integer', example: 60 },
                  remaining: { type: 'integer', example: 98 },
                  msBeforeNext: { type: 'integer', example: 0 },
                },
              },
              backup: {
                type: 'object',
                properties: {
                  points: { type: 'integer', example: 10 },
                  duration: { type: 'integer', example: 60 },
                  remaining: { type: 'integer', example: 9 },
                  msBeforeNext: { type: 'integer', example: 0 },
                },
              },
            },
          },
        },
      },
      ScheduleRequest: {
        type: 'object',
        required: ['schedule', 'dbConfig', 'backupType'],
        properties: {
          schedule: { type: 'string', example: '0 0 * * *' },
          dbType: { type: 'string', example: 'postgresql' },
          dbName: { type: 'string', example: 'production_db' },
          backupType: { type: 'string', example: 'full' },
          options: { type: 'object' },
          storageType: { type: 'string', example: 'local' },
        },
      },
      NotificationRequest: {
        type: 'object',
        required: ['type', 'message'],
        properties: {
          type: { type: 'string', enum: ['slack', 'email'], example: 'slack' },
          backupId: { type: 'string', nullable: true },
          config: { type: 'object' },
          message: {
            type: 'object',
            properties: {
              subject: { type: 'string' },
              text: { type: 'string' },
            },
          },
        },
      },
      StorageUploadRequest: {
        type: 'object',
        required: ['storageType', 'localPath', 'remotePath', 'backupId'],
        properties: {
          storageType: { type: 'string', enum: ['local', 's3'], example: 's3' },
          config: { type: 'object' },
          localPath: { type: 'string', example: '/backups/backup-123.tar.gz' },
          remotePath: { type: 'string', example: 'backups/2026/backup-123.tar.gz' },
          backupId: { type: 'string', example: 'c1f2e3d4-5678-90ab-cdef-1234567890ab' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'string', example: 'Invalid request body' },
          message: { type: 'string', example: 'Details about the error' },
        },
      },
    },
  },
};
