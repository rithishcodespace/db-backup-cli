require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const { makeTempDir, cleanupTempDir } = require('../helpers/temp-dir');
const { withMockedModules, clearModule } = require('../helpers/mock-require');
const { createNoopLogger } = require('../helpers/mocks');

const modulePath = '../../src/microservices/storage-service/providers/s3.ts';

test('S3StorageProvider uploads, downloads, lists, deletes, and signs URLs', async () => {
  class PutObjectCommand { constructor(input) { this.input = input; } }
  class GetObjectCommand { constructor(input) { this.input = input; } }
  class ListObjectsCommand { constructor(input) { this.input = input; } }
  class DeleteObjectCommand { constructor(input) { this.input = input; } }

  class FakeClient {
    constructor(config) {
      this.config = config;
      this.sent = [];
    }

    async send(command) {
      this.sent.push(command);

      if (command instanceof ListObjectsCommand) {
        if (command.input.MaxKeys === 1) {
          return { Contents: [{ Key: 'probe' }] };
        }

        return { Contents: [{ Key: 'prefix/file1.sql' }, { Key: 'prefix/file2.sql' }] };
      }

      if (command instanceof PutObjectCommand) {
        return { ETag: 'etag-1', VersionId: 'version-1' };
      }

      if (command instanceof GetObjectCommand) {
        return { Body: Readable.from(['downloaded-backup']), ContentLength: 17 };
      }

      if (command instanceof DeleteObjectCommand) {
        return {};
      }

      throw new Error(`Unexpected command: ${command.constructor.name}`);
    }
  }

  const loaded = withMockedModules(
    {
      '@aws-sdk/client-s3': {
        S3Client: FakeClient,
        PutObjectCommand,
        GetObjectCommand,
        ListObjectsCommand,
        DeleteObjectCommand,
      },
      '@aws-sdk/s3-request-presigner': {
        getSignedUrl: async () => 'https://example.com/signed-url',
      },
      '../../../logger': { createModuleLogger: () => createNoopLogger() },
    },
    () => {
      clearModule(modulePath);
      return require(modulePath);
    }
  );

  const tmpDir = makeTempDir();

  try {
    const provider = new loaded.S3StorageProvider({
      type: 's3',
      bucket: 'bucket-name',
      region: 'us-east-1',
      accessKey: 'access-key',
      secretKey: 'secret-key',
      prefix: 'backups',
    });

    await provider.initialize();

    const sourceFile = path.join(tmpDir, 'source.txt');
    fs.writeFileSync(sourceFile, 's3-backup-data');

    const uploadResult = await provider.upload(sourceFile, 'folder/backup.gz');
    assert.equal(uploadResult.bucket, 'bucket-name');
    assert.equal(uploadResult.key, 'folder/backup.gz');
    assert.equal(uploadResult.etag, 'etag-1');

    const downloadTarget = path.join(tmpDir, 'download.txt');
    const downloadResult = await provider.download('folder/backup.gz', downloadTarget);
    assert.equal(downloadResult.path, downloadTarget);
    assert.equal(fs.readFileSync(downloadTarget, 'utf8'), 'downloaded-backup');

    const listed = await provider.list('prefix');
    assert.deepEqual(listed, ['prefix/file1.sql', 'prefix/file2.sql']);

    await provider.delete('folder/backup.gz');

    const signedUrl = await provider.getUrl('folder/backup.gz');
    assert.equal(signedUrl, 'https://example.com/signed-url');
  } finally {
    cleanupTempDir(tmpDir);
    clearModule(modulePath);
  }
});
