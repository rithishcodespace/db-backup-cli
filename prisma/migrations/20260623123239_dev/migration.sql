-- CreateTable
CREATE TABLE "BackupJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dbType" TEXT NOT NULL,
    "dbName" TEXT NOT NULL,
    "backupType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "filePath" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "compressedSize" INTEGER,
    "checksum" TEXT,
    "baseBackupId" TEXT,
    "parentBackupId" TEXT,
    "backupLevel" INTEGER,
    "walPosition" TEXT,
    "binlogFile" TEXT,
    "binlogPosition" INTEGER,
    "oplogTimestamp" TEXT,
    "backupName" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "duration" INTEGER,
    "expiresAt" DATETIME,
    "storageType" TEXT NOT NULL DEFAULT 'local',
    "storagePath" TEXT,
    "storageRegion" TEXT,
    "compressionType" TEXT,
    "encryptionType" TEXT,
    "backupVersion" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "metadata" JSONB
);

-- CreateTable
CREATE TABLE "BackupSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "dbType" TEXT NOT NULL,
    "dbName" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "backupType" TEXT NOT NULL,
    "compress" BOOLEAN NOT NULL DEFAULT true,
    "storageType" TEXT NOT NULL,
    "retention" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnSuccess" BOOLEAN NOT NULL DEFAULT false,
    "notifyOnError" BOOLEAN NOT NULL DEFAULT true,
    "slackWebhook" TEXT,
    "emailRecipients" TEXT,
    "metadata" JSONB,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastRunAt" DATETIME,
    "nextRunAt" DATETIME,
    "lastRunStatus" TEXT,
    "error" TEXT
);

-- CreateTable
CREATE TABLE "BackupLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "backupJobId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" TEXT,
    CONSTRAINT "BackupLog_backupJobId_fkey" FOREIGN KEY ("backupJobId") REFERENCES "BackupJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "backupJobId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recipient" TEXT,
    "subject" TEXT,
    "message" TEXT,
    "sentAt" DATETIME,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Notification_backupJobId_fkey" FOREIGN KEY ("backupJobId") REFERENCES "BackupJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StorageLocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB,
    "bucket" TEXT,
    "region" TEXT,
    "accessKey" TEXT,
    "secretKey" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "default" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "BackupJob_status_idx" ON "BackupJob"("status");

-- CreateIndex
CREATE INDEX "BackupJob_startedAt_idx" ON "BackupJob"("startedAt");

-- CreateIndex
CREATE INDEX "BackupJob_dbType_idx" ON "BackupJob"("dbType");

-- CreateIndex
CREATE INDEX "BackupJob_dbName_idx" ON "BackupJob"("dbName");

-- CreateIndex
CREATE INDEX "BackupJob_baseBackupId_idx" ON "BackupJob"("baseBackupId");

-- CreateIndex
CREATE INDEX "BackupJob_storageType_idx" ON "BackupJob"("storageType");

-- CreateIndex
CREATE INDEX "BackupJob_expiresAt_idx" ON "BackupJob"("expiresAt");

-- CreateIndex
CREATE INDEX "BackupSchedule_enabled_idx" ON "BackupSchedule"("enabled");

-- CreateIndex
CREATE INDEX "BackupSchedule_nextRunAt_idx" ON "BackupSchedule"("nextRunAt");

-- CreateIndex
CREATE INDEX "BackupLog_backupJobId_idx" ON "BackupLog"("backupJobId");

-- CreateIndex
CREATE INDEX "BackupLog_timestamp_idx" ON "BackupLog"("timestamp");

-- CreateIndex
CREATE INDEX "Notification_status_idx" ON "Notification"("status");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StorageLocation_name_key" ON "StorageLocation"("name");

-- CreateIndex
CREATE INDEX "StorageLocation_type_idx" ON "StorageLocation"("type");

-- CreateIndex
CREATE INDEX "StorageLocation_enabled_idx" ON "StorageLocation"("enabled");
