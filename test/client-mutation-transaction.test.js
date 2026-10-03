const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createTransactionalPool } = require('../src/transactional-pool');
const { createClientMutationMiddleware } = require('../src/idempotency');
const { EventEmitter } = require('node:events');

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const descriptor = { method: 'POST', path: '/weights', requestHash: 'synthetic-hash' };

test('atomic mutation recovery and concurrent retries on disposable PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.match(url.pathname, /_test$/, 'Use a disposable _test database');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Synthetic recovery tests require loopback');
  process.env.DATABASE_URL = url.href;
  const db = require('../src/db');
  const observer = require('./helpers/database').createObserverPool(url.href);
  const user = `mutation-test-${crypto.randomUUID()}`;
  const pool = db.getPool();
  const count = async () => Number((await observer.query('SELECT COUNT(*) FROM weight_entries WHERE user_id=$1', [user])).rows[0].count);
  const write = async () => ({ status: 200, body: await db.addWeightEntry(user, { weight: 100, loggedAt: '2026-10-03T00:00:00Z' }) });
  const run = (id, execute = write, owner = user, request = descriptor) => db.runClientMutation(owner, id, request, execute);
  try {
    await require('./helpers/database').initializeTestSchema(db);
    await db.upsertUser({ id: user, provider: 'local-dev', providerUserId: user, email: `${user}@example.invalid`, name: 'Synthetic' });
    await t.test('parallel identical retries commit one effect and one completed receipt', async () => {
      const id = crypto.randomUUID(); const before = await count();
      const results = await Promise.all(Array.from({ length: 8 }, () => run(id)));
      assert.equal(results.filter(x => x.disposition === 'response').length, 1);
      assert.equal(results.filter(x => x.disposition === 'replay').length, 7);
      assert.equal(await count(), before + 1);
      assert.equal((await db.getClientMutation(user, id)).state, 'completed');
      assert.equal((await run(id, write, user, { ...descriptor, requestHash: 'different' })).disposition, 'conflict');
    });
    await t.test('failure after the health insert rolls back both the record and claim; same id can retry', async () => {
      const id = crypto.randomUUID(); const before = await count();
      await assert.rejects(run(id, async () => { await write(); throw new Error('simulated interruption'); }), /interruption/);
      assert.equal(await count(), before);
      assert.equal(await db.getClientMutation(user, id), null);
      await run(id); await run(id);
      assert.equal(await count(), before + 1);
    });
    await t.test('a failed receipt write also rolls back health records', async () => {
      const id = crypto.randomUUID(); const before = await count();
      // A circular response fails serialization in completion after the health insert.
      await assert.rejects(run(id, async () => { await write(); const body = {}; body.self = body; return { status: 200, body }; }), /circular/i);
      assert.equal(await count(), before);
      assert.equal(await db.getClientMutation(user, id), null);
      await run(id); assert.equal(await count(), before + 1);
    });
    await t.test('HTTP error outcomes roll back partial effects without reserving the id forever', async () => {
      const id = crypto.randomUUID(); const before = await count();
      const result = await run(id, async () => { await write(); return { status: 500, body: { error: 'synthetic' } }; });
      assert.equal(result.rollback, true); assert.equal(await count(), before);
      assert.equal(await db.getClientMutation(user, id), null);
      await run(id); assert.equal(await count(), before + 1);
    });
    await t.test('database connection loss frees the fenced lease; a waiting retry runs once', async () => {
      const id = crypto.randomUUID(); const inserted = deferred(); const continueOld = deferred(); const before = await count();
      const interrupted = run(id, async () => {
        await write();
        const pid = (await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        inserted.resolve(pid); await continueOld.promise;
        await write(); // Must never fall back to the unscoped pool after rollback.
        return { status: 200, body: {} };
      });
      const rejected = assert.rejects(interrupted);
      const pid = await inserted.promise;
      const retry = run(id);
      await observer.query('SELECT pg_terminate_backend($1)', [pid]);
      await rejected; await retry;
      continueOld.resolve(); await new Promise(resolve => setImmediate(resolve));
      assert.equal(await count(), before + 1);
      assert.equal((await db.getClientMutation(user, id)).state, 'completed');
    });
    await t.test('idle database lease expires without a heartbeat and rolls back before retry', async () => {
      const id = crypto.randomUUID(); const before = await count();
      await assert.rejects(run(id, async () => {
        await write();
        await pool.query("SET LOCAL idle_in_transaction_session_timeout = '75ms'");
        await new Promise(() => {}); // worker stalled after its last database heartbeat
      }));
      assert.equal(await count(), before);
      assert.equal(await db.getClientMutation(user, id), null);
      await run(id); await run(id);
      assert.equal(await count(), before + 1);
    });
    await t.test('legacy processing receipts remain quarantined regardless of age', async () => {
      const id = crypto.randomUUID(); const before = await count();
      await db.claimClientMutation(user, id, descriptor);
      await pool.query("UPDATE client_mutations SET created_at=NOW()-INTERVAL '30 days' WHERE user_id=$1 AND client_mutation_id=$2", [user, id]);
      assert.equal((await run(id, () => { throw new Error('must not execute'); })).disposition, 'processing');
      assert.equal(await count(), before);
    });
    await t.test('transaction helpers use savepoints and cannot commit health records before the receipt', async () => {
      const id = crypto.randomUUID(); const before = await count();
      await assert.rejects(run(id, async () => {
        const nested = await pool.connect();
        try {
          await nested.query('BEGIN'); await write(); await nested.query('COMMIT');
          assert.equal(await count(), before, 'nested commit must remain invisible outside the request');
        } finally { nested.release(); }
        throw new Error('after nested commit');
      }), /after nested commit/);
      assert.equal(await count(), before);
    });
    await t.test('real bulk nutrition helper cannot commit ahead of its receipt', async () => {
      const id = crypto.randomUUID();
      const rows = [{ itemName: 'Synthetic', quantity: 1, unit: 'item', calories: 100, protein: 5, carbs: 10, fat: 4, consumedAt: '2026-10-03T00:00:00Z' }];
      const countEntries = async () => Number((await observer.query('SELECT COUNT(*) FROM entries WHERE user_id=$1', [user])).rows[0].count);
      const before = await countEntries();
      await assert.rejects(run(id, async () => {
        await db.addEntries(user, rows);
        assert.equal(await countEntries(), before);
        throw new Error('bulk interruption');
      }), /bulk interruption/);
      assert.equal(await countEntries(), before);
      const insert = async () => { await db.addEntries(user, rows); return { status: 200, body: { ok: true } }; };
      await run(id, insert); await run(id, insert);
      assert.equal(await countEntries(), before + 1);
    });
    await t.test('nested rollback preserves the outer transaction; dead callbacks are fenced after deadline', async () => {
      const raw = new Pool({ connectionString: url.href, ssl: false });
      const scoped = createTransactionalPool(raw);
      let resume; const gate = new Promise(resolve => { resume = resolve; }); const entered = deferred();
      try {
        const before = await count();
        const pending = scoped.transaction(async () => {
          await scoped.pool.query('INSERT INTO weight_entries(user_id,weight,logged_at) VALUES($1,100,NOW())', [user]);
          entered.resolve(); await gate;
          await assert.rejects(async () => scoped.pool.query('SELECT 1'), /no longer active/);
          return {};
        }, { deadlineMs: 60 });
        const rejected = assert.rejects(pending, /timed out/);
        await entered.promise; await rejected; resume();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(await count(), before);
        await scoped.transaction(async () => {
          const client = await scoped.pool.connect();
          await client.query('BEGIN');
          await assert.rejects(client.query('SELECT 1/0'));
          await client.query('ROLLBACK'); client.release();
          await assert.rejects(async () => scoped.pool.query('COMMIT'), /scoped client/);
          await scoped.pool.query('SELECT 1');
          return {};
        });
      } finally { resume?.(); await raw.end(); }
    });
  } finally {
    await pool.query('DELETE FROM client_mutations WHERE user_id=$1', [user]);
    await db.deleteUserAccount(user);
    await observer.end(); await pool.end();
  }
});

function fakeResponse() {
  const res = new EventEmitter(); res.statusCode = 200; res.headers = {};
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.sent = body; return res; };
  return res;
}
const fakeRequest = () => ({ method: 'POST', path: '/weights', body: { weight: 100 }, get: () => '10000000-0000-4000-8000-000000000001' });

test('HTTP success waits for the receipt transaction commit', async () => {
  const committed = deferred(); const executing = deferred(); const res = fakeResponse();
  const middleware = createClientMutationMiddleware({ userIdFromRequest: () => 'synthetic', runClientMutation: async (_u, _id, _d, execute) => {
    const response = await execute(); executing.resolve(); await committed.promise; return { disposition: 'response', response };
  } });
  const pending = middleware(fakeRequest(), res, () => res.json({ ok: true }));
  await executing.promise; assert.equal(res.sent, undefined);
  committed.resolve(); await pending; assert.deepEqual(res.sent, { ok: true });
});

test('unknown legacy outcome is explicit and remains nonterminal for existing clients', async () => {
  const res = fakeResponse();
  await createClientMutationMiddleware({ userIdFromRequest: () => 'synthetic', runClientMutation: async () => ({ disposition: 'processing' }) })(fakeRequest(), res, () => assert.fail('must not execute'));
  assert.equal(res.statusCode, 409); assert.equal(res.sent.recoveryRequired, true);
  assert.match(res.sent.error, /still processing/);
});

test('late route response after rollback cannot replace the retry response', async () => {
  const res = fakeResponse(); let sendLate;
  await createClientMutationMiddleware({ userIdFromRequest: () => 'synthetic', runClientMutation: async (_u, _i, _d, execute) => {
    execute(); throw new Error('lost lease');
  } })(fakeRequest(), res, () => { sendLate = () => res.json({ late: true }); });
  assert.equal(res.statusCode, 503); sendLate(); assert.equal(res.sent.code, 'MUTATION_RETRY_REQUIRED');
});
