const { AsyncLocalStorage } = require('node:async_hooks');

// Route SQL and existing transaction helpers through one request transaction.
// Nested BEGIN/COMMIT become savepoints; no helper can commit the outer receipt.
function createTransactionalPool(rawPool) {
  const scope = new AsyncLocalStorage();
  let savepointSequence = 0;
  function assertOpen(state) {
    if (state.closed) throw new Error('Mutation transaction is no longer active.');
  }
  function scopedClient(state) {
    let released = false;
    const savepoints = [];
    return {
      async query(sql, values) {
        assertOpen(state);
        if (released) throw new Error('Transaction client was released.');
        const text = String(typeof sql === 'string' ? sql : sql?.text || '').trim().replace(/;$/, '').toUpperCase();
        if (text === 'BEGIN') {
          const name = `mutation_nested_${++savepointSequence}`;
          savepoints.push(name);
          return state.client.query(`SAVEPOINT ${name}`);
        }
        if (text === 'COMMIT' || text === 'ROLLBACK') {
          const name = savepoints.pop();
          if (!name) throw new Error('No nested transaction is active.');
          if (text === 'ROLLBACK') await state.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
          return state.client.query(`RELEASE SAVEPOINT ${name}`);
        }
        return state.client.query(sql, values);
      },
      release() { released = true; }
    };
  }
  const pool = new Proxy(rawPool, {
    get(target, property) {
      if (property === 'query') return (sql, values) => {
        const state = scope.getStore();
        if (!state) return rawPool.query(sql, values);
        assertOpen(state);
        const text = String(typeof sql === 'string' ? sql : sql?.text || '').trim();
        if (/^(BEGIN|COMMIT|END|ROLLBACK|ABORT|START\s+TRANSACTION)\b/i.test(text)) {
          throw new Error('Transaction control requires a scoped client.');
        }
        return state.client.query(sql, values);
      };
      if (property === 'connect') return async () => {
        const state = scope.getStore();
        if (!state) return rawPool.connect();
        assertOpen(state);
        return scopedClient(state);
      };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });

  async function transaction(action, { deadlineMs = 60000 } = {}) {
    const client = await rawPool.connect();
    const state = { client, closed: false };
    // Idle transaction timeout is the database-side lease. A dead/stalled worker
    // loses both its lock and uncommitted effects. Only that connection can commit.
    let timer;
    let broken = false;
    let onConnectionError;
    const lostConnection = new Promise((_, reject) => { onConnectionError = reject; });
    // Listen while checked out: PostgreSQL may expire an idle lease when no query
    // promise is pending. Without a listener pg would emit an unhandled error.
    lostConnection.catch(() => {});
    client.on('error', onConnectionError);
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Mutation transaction timed out.'), { code: 'MUTATION_TIMEOUT' })), deadlineMs);
        timer.unref?.();
      });
      const result = await Promise.race([scope.run(state, action), deadline, lostConnection]);
      state.closed = true;
      await client.query(result?.rollback ? 'ROLLBACK' : 'COMMIT');
      return result;
    } catch (error) {
      state.closed = true;
      broken = true; // also release any session advisory locks left by a failed helper
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      state.closed = true;
      clearTimeout(timer);
      client.removeListener('error', onConnectionError);
      client.release(broken);
    }
  }
  return { pool, transaction };
}

module.exports = { createTransactionalPool };
