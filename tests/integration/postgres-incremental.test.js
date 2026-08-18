const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { prisma } = require('../../dist/src/lib/prisma');
const { PostgresIncrementalService } = require('../../dist/src/services/postgres-incremental.service');

const execAsync = promisify(exec);

const DB_NAME = 'pg_inc_test_db';
const PG_USER = 'postgres';
const PG_PASS = 'Rithish@2006';
const PG_HOST = 'localhost';
const PG_PORT = 5432;

const dbConfig = {
  host: PG_HOST,
  port: PG_PORT,
  username: PG_USER,
  password: PG_PASS,
  database: DB_NAME
};

async function runSql(sql, database = DB_NAME) {
  const cmd = `psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${database} -tA -c "${sql.replace(/"/g, '\\"')}"`;
  const { stdout } = await execAsync(cmd, {
    env: { ...process.env, PGPASSWORD: PG_PASS }
  });
  return stdout.trim();
}

async function setupDatabase() {
  try {
    await execAsync(`psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -c "DROP DATABASE IF EXISTS ${DB_NAME};"`, {
      env: { ...process.env, PGPASSWORD: PG_PASS }
    });
  } catch {}

  await execAsync(`psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -c "CREATE DATABASE ${DB_NAME};"`, {
    env: { ...process.env, PGPASSWORD: PG_PASS }
  });

  await runSql('CREATE TABLE customers (id SERIAL PRIMARY KEY, name TEXT, stage TEXT);');
}

async function cleanupTestData() {
  await prisma.backupJob.deleteMany({
    where: {
      dbType: 'postgresql',
      dbName: DB_NAME
    }
  });
  try {
    await execAsync(`psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -c "DROP DATABASE IF EXISTS ${DB_NAME};"`, {
      env: { ...process.env, PGPASSWORD: PG_PASS }
    });
  } catch {}
}

async function testIncrementalBackupChain() {
  console.log('=== STARTING POSTGRES NATIVE INCREMENTAL BACKUP INTEGRATION TEST ===');

  await setupDatabase();
  const incService = new PostgresIncrementalService(dbConfig);
  await incService.verifyPostgresRequirements();
  console.log('✓ PostgreSQL server 17+ and pg_combinebackup requirement verified');
  await runSql("INSERT INTO customers (name, stage) VALUES ('Alice', 'Initial Full Base');");
  const count1 = await runSql('SELECT count(*) FROM customers;');
  assert.strictEqual(count1, '1');

  const fullId = `full_base_${Date.now()}`;
  console.log(`Taking Physical Base Backup (ID: ${fullId})...`);
  const fullResult = await incService.performIncrementalBackup(fullId, {
    type: 'full',
    compress: true
  });

  assert.strictEqual(fullResult.success, true);
  assert.strictEqual(fullResult.backupId, fullId);
  assert.strictEqual(fullResult.baseBackupId, fullId);
  assert.strictEqual(fullResult.parentBackupId, null);
  assert.strictEqual(fullResult.backupLevel, 0);

  await prisma.backupJob.create({
    data: {
      id: fullId,
      dbType: 'postgresql',
      dbName: DB_NAME,
      backupType: 'full',
      status: 'success',
      startedAt: new Date(),
      completedAt: new Date(),
      filePath: fullResult.filePath,
      fileSize: fullResult.fileSize,
      duration: fullResult.duration,
      checksum: fullResult.checksum,
      baseBackupId: fullResult.baseBackupId,
      parentBackupId: fullResult.parentBackupId,
      backupLevel: fullResult.backupLevel,
      metadata: JSON.stringify(fullResult.metadata)
    }
  });
  console.log('✓ Full Base Backup registered in DB metadata');

  await runSql("INSERT INTO customers (name, stage) VALUES ('Bob', 'Incremental Step 1');");
  const count2 = await runSql('SELECT count(*) FROM customers;');
  assert.strictEqual(count2, '2');

  const inc1Id = `inc_step1_${Date.now()}`;
  console.log(`Taking Native Incremental Backup 1 (ID: ${inc1Id})...`);
  const inc1Result = await incService.performIncrementalBackup(inc1Id, {
    type: 'incremental',
    parentBackupId: fullId
  });

  assert.strictEqual(inc1Result.success, true);
  assert.strictEqual(inc1Result.backupId, inc1Id);
  assert.strictEqual(inc1Result.baseBackupId, fullId);
  assert.strictEqual(inc1Result.parentBackupId, fullId);
  assert.strictEqual(inc1Result.backupLevel, 1);

  await prisma.backupJob.create({
    data: {
      id: inc1Id,
      dbType: 'postgresql',
      dbName: DB_NAME,
      backupType: 'incremental',
      status: 'success',
      startedAt: new Date(),
      completedAt: new Date(),
      filePath: inc1Result.filePath,
      fileSize: inc1Result.fileSize,
      duration: inc1Result.duration,
      checksum: inc1Result.checksum,
      baseBackupId: inc1Result.baseBackupId,
      parentBackupId: inc1Result.parentBackupId,
      backupLevel: inc1Result.backupLevel,
      metadata: JSON.stringify(inc1Result.metadata)
    }
  });
  console.log('✓ Incremental Backup 1 registered in DB metadata');

  await runSql("INSERT INTO customers (name, stage) VALUES ('Charlie', 'Incremental Step 2');");
  const count3 = await runSql('SELECT count(*) FROM customers;');
  assert.strictEqual(count3, '3');

  const inc2Id = `inc_step2_${Date.now()}`;
  console.log(`Taking Native Incremental Backup 2 (ID: ${inc2Id})...`);
  const inc2Result = await incService.performIncrementalBackup(inc2Id, {
    type: 'incremental',
    parentBackupId: inc1Id
  });

  assert.strictEqual(inc2Result.success, true);
  assert.strictEqual(inc2Result.backupId, inc2Id);
  assert.strictEqual(inc2Result.baseBackupId, fullId);
  assert.strictEqual(inc2Result.parentBackupId, inc1Id);
  assert.strictEqual(inc2Result.backupLevel, 2);

  await prisma.backupJob.create({
    data: {
      id: inc2Id,
      dbType: 'postgresql',
      dbName: DB_NAME,
      backupType: 'incremental',
      status: 'success',
      startedAt: new Date(),
      completedAt: new Date(),
      filePath: inc2Result.filePath,
      fileSize: inc2Result.fileSize,
      duration: inc2Result.duration,
      checksum: inc2Result.checksum,
      baseBackupId: inc2Result.baseBackupId,
      parentBackupId: inc2Result.parentBackupId,
      backupLevel: inc2Result.backupLevel,
      metadata: JSON.stringify(inc2Result.metadata)
    }
  });
  console.log('✓ Incremental Backup 2 registered in DB metadata');

  console.log('Simulating database corruption/loss by dropping test database...');
  await runSql(`TRUNCATE TABLE customers;`);
  const emptyCount = await runSql('SELECT count(*) FROM customers;');
  assert.strictEqual(emptyCount, '0');

  console.log(`Restoring full incremental backup chain for ID ${inc2Id} via pg_combinebackup...`);
  const restoreRes = await PostgresIncrementalService.restoreBackupChain(inc2Id, dbConfig);
  assert.strictEqual(restoreRes.success, true);
  console.log(`✓ Restore finished in ${restoreRes.duration}s`);

  const restoredCount = await runSql('SELECT count(*) FROM customers;');
  assert.strictEqual(restoredCount, '3');

  const restoredNames = await runSql("SELECT string_agg(name, ', ' ORDER BY id) FROM customers;");
  assert.strictEqual(restoredNames, 'Alice, Bob, Charlie');
  console.log('✓ Restored data verified successfully: Alice, Bob, Charlie');

  console.log('Testing failure case: Invalid parent backup ID...');
  try {
    await incService.performIncrementalBackup(`invalid_inc_${Date.now()}`, {
      type: 'incremental',
      parentBackupId: 'non_existent_id'
    });
    assert.fail('Should have thrown error for non-existent parent ID');
  } catch (err) {
    assert.ok(err.message.includes('not found') || err.message.includes('invalid'));
    console.log('✓ Correctly failed on missing parent ID');
  }

  await cleanupTestData();
  await prisma.$disconnect();
  console.log('=== POSTGRES NATIVE INCREMENTAL BACKUP INTEGRATION TEST PASSED SUCCESSFULY ===');
}

testIncrementalBackupChain().catch(async (err) => {
  console.error('❌ Integration Test Failed:', err);
  await cleanupTestData();
  await prisma.$disconnect();
  process.exit(1);
});
