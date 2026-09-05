require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const { app, createApp } = require('../../src/app');

test('createApp returns an Express instance with routing capabilities', () => {
  const instance = createApp();
  assert.equal(typeof instance, 'function');
  assert.equal(typeof instance.use, 'function');
  assert.equal(typeof instance.get, 'function');
  assert.equal(typeof instance.post, 'function');
});

test('app export is a configured singleton Express instance', () => {
  assert.equal(typeof app, 'function');
  assert.equal(typeof app.listen, 'function');
});
