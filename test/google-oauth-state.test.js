const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('Google OAuth callbacks require the single-use state from the initiating session', async () => {
  const serverPath = require.resolve('../src/server');
  const originalLoad = Module._load;
  const env = { ...process.env };
  let strategy;
  try {
    Object.assign(process.env, {
      NODE_ENV: 'test', LOCAL_AUTH_BYPASS: 'false',
      GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-secret',
      SESSION_SECRET: 'synthetic-session-secret',
    });
    Module._load = function (request, parent, isMain) {
      if (request === './db' && parent?.filename === serverPath) {
        return {
          getPool: () => ({}),
          claimClientMutation: async () => {}, getClientMutation: async () => {},
          completeClientMutation: async () => {},
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    require(serverPath);
    strategy = require('passport')._strategy('google');
  } finally {
    Module._load = originalLoad;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    delete require.cache[serverPath];
  }

  let exchanges = 0;
  strategy._oauth2.getOAuthAccessToken = (_code, _params, done) => {
    exchanges += 1;
    done(null, 'synthetic-access-token', null, {});
  };
  strategy.userProfile = (_token, done) => done(null, { id: 'synthetic-user', emails: [] });
  const run = (session, query = {}) => new Promise((resolve, reject) => {
    const attempt = Object.create(strategy);
    attempt.redirect = (url) => resolve({ redirect: new URL(url) });
    attempt.fail = () => resolve({ failed: true });
    attempt.success = (user) => resolve({ user });
    attempt.error = reject;
    attempt.authenticate({ session, query, headers: { host: 'localhost' }, connection: {} }, { state: true });
  });

  const session = {};
  const started = await run(session);
  const state = started.redirect.searchParams.get('state');
  assert.ok(state, 'authorization URL must include a generated state');
  assert.equal((await run({}, { code: 'synthetic-code', state })).failed, true);
  assert.equal((await run(structuredClone(session), { code: 'synthetic-code' })).failed, true);
  assert.equal((await run(structuredClone(session), { code: 'synthetic-code', state: 'wrong-state' })).failed, true);
  assert.equal(exchanges, 0, 'invalid callbacks must be rejected before token exchange');
  assert.equal((await run(session, { code: 'synthetic-code', state })).user.id, 'synthetic-user');
  assert.equal(exchanges, 1);
  assert.equal((await run(session, { code: 'synthetic-code', state })).failed, true);
  assert.equal(exchanges, 1, 'state must not be replayable');
});
