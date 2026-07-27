const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CLIENT_MUTATION_ID_PATTERN,
  requestHash,
  stableJson,
  waitForCompletedMutation
} = require('../src/idempotency');

test('client mutation request hashes are stable without retaining request bodies', () => {
  const first = {
    body: {
      loggedAt: '2026-07-27T12:00:00.000Z',
      metrics: { protein: 40, calories: 500 },
      items: [{ name: 'Lunch', amount: 1 }]
    }
  };
  const reordered = {
    body: {
      items: [{ amount: 1, name: 'Lunch' }],
      metrics: { calories: 500, protein: 40 },
      loggedAt: '2026-07-27T12:00:00.000Z'
    }
  };

  assert.equal(stableJson(first.body), stableJson(reordered.body));
  assert.equal(requestHash(first), requestHash(reordered));
  assert.match(requestHash(first), /^[0-9a-f]{64}$/);
  assert.equal(requestHash(first).includes('Lunch'), false);
});

test('client mutation ids require UUIDs', () => {
  assert.equal(
    CLIENT_MUTATION_ID_PATTERN.test('1ebc54be-2d4d-4d04-986b-87226b5523e7'),
    true
  );
  assert.equal(CLIENT_MUTATION_ID_PATTERN.test('shared-retry-key'), false);
  assert.equal(CLIENT_MUTATION_ID_PATTERN.test('../other-account'), false);
});

test('concurrent replay waits for the first mutation result', async () => {
  let reads = 0;
  const result = await waitForCompletedMutation(
    async (_userId, clientMutationId) => {
      reads += 1;
      return reads < 3
        ? { clientMutationId, state: 'processing' }
        : {
            clientMutationId,
            state: 'completed',
            responseStatus: 200,
            responseBody: { ok: true }
          };
    },
    'account-a',
    '1ebc54be-2d4d-4d04-986b-87226b5523e7',
    { timeoutMs: 100, pollIntervalMs: 1 }
  );

  assert.equal(result.state, 'completed');
  assert.deepEqual(result.responseBody, { ok: true });
});
