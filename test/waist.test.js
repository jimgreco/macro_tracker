const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWaist } = require('../src/waist');
const payload = { readings: [30, 32], unit: 'in', method: 'navel_relaxed', loggedAt: '2026-09-08T01:00:00Z' };
test('waist retains raw readings and converts only the mean to centimeters', () => {
  const result = normalizeWaist(payload);
  assert.deepEqual(result.readings, [30, 32]);
  assert.equal(result.valueCm, 31 * 2.54);
  assert.equal(normalizeWaist({ ...payload, unit: 'cm' }).valueCm, 31);
});
test('waist rejects missing, ambiguous and invalid measurement values', () => {
  for (const override of [{ readings: [] }, { readings: ['30'] }, { readings: [0] }, { readings: [NaN] }, { readings: [1,2,3] }, { unit: 'lbs' }, { method: 'other' }, { loggedAt: '2026-09-08' }, { notes: 'x'.repeat(301) }]) {
    assert.throws(() => normalizeWaist({ ...payload, ...override }));
  }
});
