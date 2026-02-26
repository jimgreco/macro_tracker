const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function extractFunctionSource(fileSource, functionName) {
  const signature = `function ${functionName}(`;
  const start = fileSource.indexOf(signature);
  if (start === -1) {
    throw new Error(`Could not locate ${functionName} in script.js`);
  }

  const bodyStart = fileSource.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < fileSource.length; index += 1) {
    const char = fileSource[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return fileSource.slice(start, index + 1);
    }
  }

  throw new Error(`Could not parse function body for ${functionName}`);
}

function loadWorkoutParser() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'script.js'), 'utf8');
  const normalizeSource = extractFunctionSource(source, 'normalizeWorkoutDescription');
  const intensitySource = extractFunctionSource(source, 'parseWorkoutIntensity');
  const parseSource = extractFunctionSource(source, 'parseWorkoutInput');
  const snippet = `${normalizeSource}\n${intensitySource}\n${parseSource}\nmodule.exports = { parseWorkoutInput };`;
  const context = { module: { exports: {} } };
  vm.createContext(context);
  new vm.Script(snippet).runInContext(context);
  return context.module.exports.parseWorkoutInput;
}

test('parses minute-based workout durations as fractional hours', () => {
  const parseWorkoutInput = loadWorkoutParser();
  const parsed = parseWorkoutInput('45 minute chest workout');

  assert.equal(parsed.description, 'chest');
  assert.equal(parsed.durationHours, 0.75);
});

test('preserves support for explicit hour units', () => {
  const parseWorkoutInput = loadWorkoutParser();
  const parsed = parseWorkoutInput('1.5h leg workout');

  assert.equal(parsed.description, 'leg');
  assert.equal(parsed.durationHours, 1.5);
});

test('defaults workout intensity to medium when not provided', () => {
  const parseWorkoutInput = loadWorkoutParser();
  const parsed = parseWorkoutInput('45 minute chest workout');

  assert.equal(parsed.intensity, 'medium');
});

test('removes intensity/workout words from description', () => {
  const parseWorkoutInput = loadWorkoutParser();
  const parsed = parseWorkoutInput('high intensity leg workout of 75 minutes');

  assert.equal(parsed.description, 'leg');
  assert.equal(parsed.intensity, 'high');
  assert.equal(parsed.durationHours, 1.25);
});
