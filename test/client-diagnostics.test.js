const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeClientDiagnostic,
  sanitizeRequestReference,
  sanitizeRouteTemplate
} = require('../src/client-diagnostics');

test('client diagnostic sanitizer stores only allowlisted operational metadata', () => {
  const requestId = '2df7eb8d-6ddf-4bb4-970d-c790838b17c3';
  const sanitized = sanitizeClientDiagnostic({
    level: 'debug',
    category: 'api',
    message: 'Ate private breakfast token=secret https://example.test/user/42?key=secret',
    details: {
      path: 'https://example.test/api/entries/42?meal=private-breakfast&token=secret',
      status: 503,
      requestId,
      requestBody: '{"meal":"private breakfast"}',
      responseBody: '{"weight":182}',
      userId: 'user@example.com',
      healthValue: 'HRV 42',
      token: 'bearer secret',
      stack: 'private stack'
    },
    userAgent: 'Private full user agent',
    appPlatform: 'web',
    appVersion: 'abc1234'
  });

  assert.deepEqual(sanitized, {
    level: 'error',
    category: 'api_error',
    message: 'API request failed',
    details: {
      routeTemplate: '/api/entries/:id',
      status: 503,
      requestId
    },
    appPlatform: 'web',
    appVersion: 'abc1234',
    requestId
  });

  const serialized = JSON.stringify(sanitized);
  for (const sensitiveValue of [
    'private breakfast',
    'example.test',
    'token=secret',
    'bearer secret',
    'user@example.com',
    'HRV 42',
    'private stack',
    'Private full user agent'
  ]) {
    assert.equal(serialized.includes(sensitiveValue), false, sensitiveValue);
  }
});

test('client diagnostic sanitizer rejects unsafe references, URLs, and app metadata', () => {
  assert.equal(sanitizeRequestReference('short'), null);
  const requestId = '9955a693-c0dd-469d-a62b-7f077c2e02fc';
  assert.equal(sanitizeRequestReference(requestId), requestId);
  assert.equal(sanitizeRouteTemplate('https://example.test/private/secret?token=value'), null);
  assert.equal(sanitizeRouteTemplate('/api/private-breakfast?token=value'), null);
  assert.equal(
    sanitizeRouteTemplate('/api/admin/accounts/user@example.com/diagnostics?token=value'),
    '/api/admin/accounts/:id/diagnostics'
  );
  assert.equal(
    sanitizeRouteTemplate('/api/entries/private-breakfast?token=value'),
    '/api/entries/:id'
  );

  const sanitized = sanitizeClientDiagnostic({
    category: 'unrecognized',
    requestId: 'unsafe request id',
    appPlatform: 'web secret@example.com',
    appVersion: 'build?token=secret',
    details: {
      url: 'https://example.test/private',
      identifier: 'user-123'
    }
  });
  assert.deepEqual(sanitized, {
    level: 'error',
    category: 'client_error',
    message: 'Client error',
    details: null,
    appPlatform: 'unknown',
    appVersion: 'unknown',
    requestId: null
  });

  const disguisedMetadata = sanitizeClientDiagnostic({
    category: 'window_error',
    appPlatform: 'john-doe-iphone',
    appVersion: 'private-breakfast',
    details: {
      script: '/assets/private-breakfast.js',
      line: 12,
      column: 4
    }
  });
  assert.deepEqual(disguisedMetadata, {
    level: 'error',
    category: 'window_error',
    message: 'Unhandled browser error',
    details: { line: 12, column: 4 },
    appPlatform: 'unknown',
    appVersion: 'unknown',
    requestId: null
  });
});
