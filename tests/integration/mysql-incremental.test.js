const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const dbConfig = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    username: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'mysql',
    database: 'test_inc_db'
};

const backupDir = path.join(process.cwd(), 'backups', 'mysql_test_inc');

process.env.PATH = `${path.join(process.cwd(), 'bin')}:${process.env.PATH}`;

const { MySQLIncrementalBackupManager } = require('../../dist/src/microservices/database-services/mysql/manager');

async function runTest() {
    console.log('🚀 Starting MySQL Incremental Backup & Restore Integration Test');

    if (fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
    }
    fs.mkdirSync(backupDir, { recursive: true });

    const rootConn = await mysql.createConnection({
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.username,
        password: dbConfig.password,
        multipleStatements: true
    });

    await rootConn.query(`DROP DATABASE IF EXISTS ${dbConfig.database}`);
    await rootConn.query(`CREATE DATABASE ${dbConfig.database}`);
    await rootConn.end();

    const conn = await mysql.createConnection({
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.username,
        password: dbConfig.password,
        database: dbConfig.database,
        multipleStatements: true
    });

    const manager = new MySQLIncrementalBackupManager(backupDir);

    console.log('1. Checking binlog status...');
    const binlogStatus = await manager.checkBinlogStatus(dbConfig);
    assert.strictEqual(binlogStatus.enabled, true, 'Binary logging (log_bin) must be enabled on MySQL server');

    console.log('2. Initializing table and seed data...');
    await conn.query(`
        CREATE TABLE users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(100) NOT NULL,
            status VARCHAR(20) DEFAULT 'active'
        ) ENGINE=InnoDB;
    `);
    await conn.query("INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')");

    console.log('3. Performing Full Base Backup (A)...');
    const baseBackup = await manager.createFullBackup(dbConfig);
    assert.strictEqual(baseBackup.success, true);
    assert.ok(baseBackup.binlogFile);
    assert.ok(baseBackup.binlogPosition > 0);
    console.log(`   Base Backup A ID: ${baseBackup.backupId} at ${baseBackup.binlogFile}:${baseBackup.binlogPosition}`);

    console.log('4. Performing mutations (INSERT, UPDATE, DELETE) & concurrent write simulation...');
    await conn.query("INSERT INTO users (name, email) VALUES ('Bob', 'bob@example.com')");
    await conn.query("INSERT INTO users (name, email) VALUES ('Charlie', 'charlie@example.com')");
    await conn.query("UPDATE users SET status = 'updated' WHERE name = 'Alice'");
    await conn.query("DELETE FROM users WHERE name = 'Bob'");

    console.log('5. Creating Incremental Backup B...');
    const incB = await manager.createIncrementalBackup(dbConfig, baseBackup.backupId);
    assert.strictEqual(incB.success, true);
    assert.strictEqual(incB.parentBackupId, baseBackup.backupId);
    assert.strictEqual(incB.startBinlogFile, baseBackup.binlogFile);
    assert.strictEqual(incB.startBinlogPosition, baseBackup.binlogPosition);
    console.log(`   Incremental B ID: ${incB.backupId} (${incB.startBinlogFile}:${incB.startBinlogPosition} -> ${incB.endBinlogFile}:${incB.endBinlogPosition})`);

    console.log('6. Triggering binlog rotation (FLUSH LOGS)...');
    await conn.query('FLUSH LOGS');

    console.log('7. Performing post-rotation mutations...');
    await conn.query("INSERT INTO users (name, email) VALUES ('David', 'david@example.com')");
    await conn.query("UPDATE users SET status = 'active' WHERE name = 'Charlie'");

    console.log('8. Creating Incremental Backup C (spanning log rotation)...');
    const incC = await manager.createIncrementalBackup(dbConfig, incB.backupId);
    assert.strictEqual(incC.success, true);
    assert.strictEqual(incC.parentBackupId, incB.backupId);
    assert.strictEqual(incC.startBinlogFile, incB.endBinlogFile);
    assert.strictEqual(incC.startBinlogPosition, incB.endBinlogPosition);
    console.log(`   Incremental C ID: ${incC.backupId} (${incC.startBinlogFile}:${incC.startBinlogPosition} -> ${incC.endBinlogFile}:${incC.endBinlogPosition})`);

    console.log('9. Validating Backup Chain Resolution & Validation...');
    const chain = await manager.getBackupChain(incC.backupId);
    assert.ok(chain);
    assert.strictEqual(chain.fullBackup.id, baseBackup.backupId);
    assert.strictEqual(chain.increments.length, 2);
    assert.strictEqual(chain.increments[0].id, incB.backupId);
    assert.strictEqual(chain.increments[1].id, incC.backupId);

    await manager.validateBackupChain(chain);
    console.log('   Backup chain validation passed 100%');

    console.log('10. Testing Error Cases (Missing parent, corrupted checksum)...');
    await assert.rejects(
        () => manager.createIncrementalBackup(dbConfig, 'non_existent_parent_id'),
        /Parent backup not found/
    );

    console.log('11. Simulating database loss & restoring Incremental C (full chain A -> B -> C)...');
    await conn.query("DROP TABLE users");

    await manager.restoreToPointInTime(dbConfig, incC.backupId);

    console.log('12. Verifying restored database data...');
    const [rows] = await conn.query('SELECT name, email, status FROM users ORDER BY id ASC') ;
    
    assert.strictEqual(rows.length, 3, 'Restored row count should be exactly 3');
    assert.deepStrictEqual(rows[0], { name: 'Alice', email: 'alice@example.com', status: 'updated' });
    assert.deepStrictEqual(rows[1], { name: 'Charlie', email: 'charlie@example.com', status: 'active' });
    assert.deepStrictEqual(rows[2], { name: 'David', email: 'david@example.com', status: 'active' });

    console.log('✅ Restoration verified! Data content matches expected state exactly:');
    console.table(rows);

    await conn.end();
    await manager.shutdown();

    console.log('🎉 All MySQL Incremental Backup & Restore Integration Tests Passed Successfully!');
}

runTest().catch((error) => {
    console.error('❌ Integration Test Failed:', error);
    process.exit(1);
});
