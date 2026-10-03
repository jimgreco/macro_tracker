const test = require('node:test');
const assert = require('node:assert/strict');
const { requestLogPath } = require('../src/request-log');

test('request and error log paths exclude authentication and health query values', () => {
  for (const path of ['/auth/google/callback', '/webhooks/oura', '/api/entries']) {
    const url = `${path}?code=synthetic-code&verification_token=synthetic-token&notes=synthetic-private-note`;
    assert.equal(requestLogPath({ originalUrl: url, url: '/mounted' }), path);
    assert.equal(requestLogPath({ url }), path);
  }
  assert.equal(requestLogPath({ url: '/version' }), '/version');
  assert.equal(requestLogPath({}), '');
});
