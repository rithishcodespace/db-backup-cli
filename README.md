# DB-Backup CLI

A production-ready, cross-platform database backup and restore system built using a microservices architecture. The project provides a unified command-line interface for managing backups across multiple database engines, cloud storage providers, and deployment environments.

Designed as a systems-focused backend project, it demonstrates distributed architecture, service communication, scheduling, security, automation, and cloud integration concepts commonly used in enterprise environments.

## Features

### Database Support

* PostgreSQL
* MySQL / MariaDB
* SQLite
* MongoDB

### Backup Operations

* Full backups
* Incremental backups
* Differential backups
* Compressed backups
* Scheduled backups
* Backup retention policies

### Restore Operations

* Full database restore
* Selective table/collection restore
* Restore validation
* Dry-run restore mode

### Storage Support

* Local filesystem
* AWS S3
* Google Cloud Storage
* Azure Blob Storage

### Security

* AES-256 backup encryption
* Configuration sanitization
* Backup integrity verification
* Checksum validation

### Monitoring

* Health monitoring
* Backup status tracking
* Backup duration metrics
* Storage utilization reporting
* Slack notifications
* Email notifications

### DevOps

* Docker support
* CI/CD automation
* Automated testing
* Structured logging
* Environment-based configuration

## Architecture

The system follows a microservices architecture to ensure scalability, maintainability, and separation of concerns.

```text
CLI Gateway
     |
     v
API Gateway Service
     |
     +------------------------+
     |                        |
     v                        v
Backup Service          Restore Service
     |                        |
     +------------+-----------+
                  |
                  v
         Database Connectors
      (Postgres / MySQL /
       MongoDB / SQLite)
                  |
                  v
          Storage Service
      (Local / S3 / GCS /
         Azure Blob)
                  |
                  v
      Notification Service
      (Slack / Email)
```

## Microservices

### API Gateway

Responsible for:

* Request routing
* Validation
* Service coordination
* Authentication middleware

### Backup Service

Responsible for:

* Full backups
* Incremental backups
* Compression
* Encryption
* Backup metadata generation

### Restore Service

Responsible for:

* Database restoration
* Restore validation
* Recovery workflows
* Dry-run support

### Storage Service

Responsible for:

* Local storage
* Cloud storage uploads
* Cloud storage downloads
* Retention policy enforcement

### Notification Service

Responsible for:

* Slack notifications
* Email alerts
* Backup success/failure reports

### Scheduler Service

Responsible for:

* Cron-based scheduling
* Recurring backup execution
* Automated cleanup jobs

## Technology Stack

### Backend

* Node.js
* TypeScript
* Express.js

### Database Connectivity

* Prisma ORM
* PostgreSQL
* MySQL
* MongoDB
* SQLite

### Infrastructure

* Docker
* Redis
* RabbitMQ

### Cloud Storage

* AWS S3
* Google Cloud Storage
* Azure Blob Storage

### Monitoring

* Winston Logging
* Prometheus Metrics

### Testing

* Jest
* Supertest

## Project Structure

```text
db-backup-cli/

services/
│
├── api-gateway/
├── backup-service/
├── restore-service/
├── storage-service/
├── scheduler-service/
├── notification-service/
│
shared/
├── types/
├── utils/
├── logger/
├── config/
│
docker/
tests/
docs/
```

## Example Commands

Connect to a database:

```bash
db-backup connect \
  --type postgres \
  --host localhost \
  --port 5432 \
  --user admin
```

Create a backup:

```bash
db-backup backup \
  --type full \
  --compress
```

Restore a backup:

```bash
db-backup restore \
  --file backup.gz
```

Schedule automated backups:

```bash
db-backup schedule \
  --cron "0 2 * * *"
```

List available backups:

```bash
db-backup list
```

## Cross-Platform Support

Supported operating systems:

* Windows
* Linux
* macOS

The project automatically uses the appropriate database backup utilities available on the host system:

* pg_dump
* pg_restore
* mysqldump
* mysql
* mongodump
* mongorestore

## Engineering Highlights

* Microservices architecture
* Message queue communication
* Database abstraction layer
* Cloud-native design
* Cross-platform execution
* Backup encryption
* Automated scheduling
* Health monitoring
* Scalable service boundaries
* Production-oriented deployment workflow

## Learning Outcomes

This project demonstrates practical experience with:

* Distributed systems
* Microservices architecture
* Database administration
* Backup and disaster recovery workflows
* Cloud integrations
* System design principles
* Secure software development
* DevOps fundamentals
* API development
* TypeScript backend engineering

## Future Enhancements

* Kubernetes deployment
* Multi-region backup replication
* Web-based management dashboard
* Backup analytics and reporting
* Role-based access control
* Advanced disaster recovery workflows

## Author

Rithish

Second Year Computer Science Engineering Student

Focused on Backend Engineering, Distributed Systems, Databases, Cloud Infrastructure, and System Design.
