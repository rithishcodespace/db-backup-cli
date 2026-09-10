-- CreateTable
CREATE TABLE "NotificationConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUser" TEXT,
    "smtpPassword" TEXT,
    "from" TEXT,
    "to" TEXT,
    "webhook" TEXT
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BackupJob" (
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
    "storageLocationId" TEXT,
    "compressionType" TEXT,
    "encryptionType" TEXT,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "encryptionMetadata" JSONB,
    "backupVersion" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "metadata" JSONB,
    CONSTRAINT "BackupJob_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "StorageLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BackupJob" ("backupLevel", "backupName", "backupType", "backupVersion", "baseBackupId", "binlogFile", "binlogPosition", "checksum", "completedAt", "compressedSize", "compressionType", "dbName", "dbType", "duration", "encryptionType", "error", "expiresAt", "fileName", "filePath", "fileSize", "id", "metadata", "oplogTimestamp", "parentBackupId", "retryCount", "startedAt", "status", "storagePath", "storageRegion", "storageType", "walPosition") SELECT "backupLevel", "backupName", "backupType", "backupVersion", "baseBackupId", "binlogFile", "binlogPosition", "checksum", "completedAt", "compressedSize", "compressionType", "dbName", "dbType", "duration", "encryptionType", "error", "expiresAt", "fileName", "filePath", "fileSize", "id", "metadata", "oplogTimestamp", "parentBackupId", "retryCount", "startedAt", "status", "storagePath", "storageRegion", "storageType", "walPosition" FROM "BackupJob";
DROP TABLE "BackupJob";
ALTER TABLE "new_BackupJob" RENAME TO "BackupJob";
CREATE INDEX "BackupJob_status_idx" ON "BackupJob"("status");
CREATE INDEX "BackupJob_startedAt_idx" ON "BackupJob"("startedAt");
CREATE INDEX "BackupJob_dbType_idx" ON "BackupJob"("dbType");
CREATE INDEX "BackupJob_dbName_idx" ON "BackupJob"("dbName");
CREATE INDEX "BackupJob_baseBackupId_idx" ON "BackupJob"("baseBackupId");
CREATE INDEX "BackupJob_storageType_idx" ON "BackupJob"("storageType");
CREATE INDEX "BackupJob_expiresAt_idx" ON "BackupJob"("expiresAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "NotificationConfig_type_idx" ON "NotificationConfig"("type");

-- CreateIndex
CREATE INDEX "NotificationConfig_enabled_idx" ON "NotificationConfig"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationConfig_type_key" ON "NotificationConfig"("type");

