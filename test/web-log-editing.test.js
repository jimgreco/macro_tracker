const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/script.js'), 'utf8');
function browserFunction(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `Missing browser function ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function timestamps() {
  const context = vm.createContext({});
  vm.runInContext(['toDateTimeLocalValue', 'isoToLocalInputValue', 'editedLogTimestamp'].map(browserFunction).join('\n'), context);
  return context;
}

for (const fixture of [
  { timezone: 'America/New_York', original: '2026-10-12T02:45:37.123Z', displayed: '2026-10-11T22:45' },
  { timezone: 'Asia/Tokyo', original: '2026-10-12T22:45:37.123Z', displayed: '2026-10-13T07:45' },
  { timezone: 'America/New_York', original: '2026-11-01T06:30:47.123Z', displayed: '2026-11-01T01:30' }
]) {
  test(`workout editing preserves the original instant in ${fixture.timezone}: ${fixture.original}`, () => {
    const previousTZ = process.env.TZ;
    try {
      process.env.TZ = fixture.timezone;
      const context = timestamps();
      assert.equal(context.isoToLocalInputValue(fixture.original), fixture.displayed);
      assert.equal(context.editedLogTimestamp(fixture.displayed, fixture.original), fixture.original);
    } finally {
      if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ;
    }
  });
}

test('an intentional workout time change uses the entered local date and time', () => {
  const previousTZ = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    assert.equal(timestamps().editedLogTimestamp('2026-10-13T18:15', '2026-10-12T02:45:37.123Z'), '2026-10-13T22:15:00.000Z');
  } finally {
    if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ;
  }
});

test('clearing an edit timestamp cannot silently move a historical entry to now', () => {
  assert.throws(() => timestamps().editedLogTimestamp('', '2026-10-12T02:45:37.123Z'), /Choose a valid date and time/);
  assert.throws(() => timestamps().editedLogTimestamp('invalid', '2026-10-12T02:45:37.123Z'), /Choose a valid date and time/);
});
