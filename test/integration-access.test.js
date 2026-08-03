const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SOURCE_IDS,
  buildSourceAccess,
  enabledOuraProviderDataTypes,
  normalizeAccessSelection,
  sourceCatalog
} = require('../src/integration-access');

test('integration access exposes supported directions and preserves an explicit false selection', () => {
  const source = buildSourceAccess({
    id: SOURCE_IDS.OURA,
    displayName: 'Oura Ring',
    connected: true,
    available: true,
    permissions: [{
      source: 'oura',
      dataType: 'sleep',
      readEnabled: false,
      writeEnabled: false
    }]
  });
  const sleep = source.dataTypes.find((dataType) => dataType.id === 'sleep');

  assert.deepEqual(sleep.selection, { readEnabled: false, writeEnabled: false });
  assert.equal(sleep.read.supported, true);
  assert.equal(sleep.write.supported, false);
  assert.match(sleep.write.disabledReason, /does not write/i);
  assert.equal(source.configurationRequired, true);
});

test('a complete all-disabled selection is configured rather than treated as missing', () => {
  const catalog = sourceCatalog(SOURCE_IDS.HEALTHKIT);
  const permissions = catalog.map((dataType) => ({
    source: 'healthkit',
    dataType: dataType.id,
    readEnabled: false,
    writeEnabled: false
  }));
  const source = buildSourceAccess({
    id: SOURCE_IDS.HEALTHKIT,
    displayName: 'Apple Health',
    connected: true,
    available: true,
    permissions
  });

  assert.equal(source.configurationRequired, false);
  assert.equal(source.dataTypes.every((dataType) => dataType.selection), true);
});

test('access selection validation requires the complete catalog and rejects unsupported writes', () => {
  const valid = sourceCatalog(SOURCE_IDS.OURA).map((dataType) => ({
    id: dataType.id,
    readEnabled: dataType.id === 'readiness',
    writeEnabled: false
  }));

  assert.deepEqual(
    normalizeAccessSelection(SOURCE_IDS.OURA, { dataTypes: valid })
      .find((selection) => selection.dataType === 'readiness'),
    { dataType: 'readiness', readEnabled: true, writeEnabled: false }
  );
  assert.throws(
    () => normalizeAccessSelection(SOURCE_IDS.OURA, { dataTypes: valid.slice(1) }),
    /Missing oura data type selections: sleep/
  );
  assert.throws(
    () => normalizeAccessSelection(SOURCE_IDS.OURA, {
      dataTypes: valid.map((selection) => (
        selection.id === 'sleep' ? { ...selection, writeEnabled: true } : selection
      ))
    }),
    /write access is not supported/
  );
});

test('Oura logical choices expand to the exact provider data types', () => {
  const permissions = [
    { dataType: 'sleep', readEnabled: true, writeEnabled: false },
    { dataType: 'readiness', readEnabled: false, writeEnabled: false },
    { dataType: 'activity', readEnabled: false, writeEnabled: false },
    { dataType: 'stress', readEnabled: false, writeEnabled: false },
    { dataType: 'resilience', readEnabled: false, writeEnabled: false },
    { dataType: 'bedtime', readEnabled: true, writeEnabled: false },
    { dataType: 'workouts', readEnabled: true, writeEnabled: false }
  ];

  assert.deepEqual(
    enabledOuraProviderDataTypes(permissions, { includeWorkouts: true }),
    ['sleep', 'daily_sleep', 'sleep_time', 'workout']
  );
  assert.deepEqual(
    enabledOuraProviderDataTypes(permissions, { includeWorkouts: false }),
    ['sleep', 'daily_sleep', 'sleep_time']
  );
});
