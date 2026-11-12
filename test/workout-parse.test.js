const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
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

async function withMockedClaudeWorkoutParser(outputText, callback) {
  const parserPath = require.resolve(path.join(__dirname, '..', 'src', 'parser.js'));
  const aiClientPath = require.resolve(path.join(__dirname, '..', 'src', 'ai-client.js'));
  const originalLoad = Module._load;
  let capturedRequest = null;

  class FakeAnthropic {
    constructor() {
      this.beta = {
        messages: {
          create: async (request) => {
            capturedRequest = request;
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: outputText }] };
          }
        }
      };
    }
  }

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@anthropic-ai/sdk') {
      return FakeAnthropic;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[parserPath];
  delete require.cache[aiClientPath];
  try {
    const parser = require(parserPath);
    return await callback(parser, () => capturedRequest);
  } finally {
    Module._load = originalLoad;
    delete require.cache[parserPath];
    delete require.cache[aiClientPath];
  }
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

test('server workout Claude prompt asks for active conservative calories with strength rests', async () => {
  const outputText = JSON.stringify({
    description: 'Chest',
    intensity: 'medium',
    durationHours: 0.75,
    caloriesBurned: 150
  });

  await withMockedClaudeWorkoutParser(outputText, async ({ parseWorkoutText }, getRequest) => {
    const parsed = await parseWorkoutText({ text: '45 minute moderate chest workout' });
    const request = getRequest();
    const prompt = request.system;

    assert.equal(request.model, 'claude-opus-5-5');
    assert.equal(request.output_config.format.type, 'json_schema');

    assert.equal(parsed.caloriesBurned, 150);
    assert.match(prompt, /active exercise calories only/i);
    assert.match(prompt, /not total calories/i);
    assert.match(prompt, /conservative/i);
    assert.match(prompt, /rest periods between sets/i);
    assert.match(prompt, /low\/light or medium\/moderate intensity strength/i);
  });
});

test('server workout parser caps non-explicit medium strength calories conservatively', async () => {
  const outputText = JSON.stringify({
    description: 'Chest',
    intensity: 'medium',
    durationHours: 1,
    caloriesBurned: 600
  });

  await withMockedClaudeWorkoutParser(outputText, async ({ parseWorkoutText }) => {
    const parsed = await parseWorkoutText({ text: '1 hour moderate chest workout' });

    assert.equal(parsed.caloriesBurned, 220);
  });
});

test('server workout parser preserves explicitly reported active calories', async () => {
  const outputText = JSON.stringify({
    description: 'Strength',
    intensity: 'medium',
    durationHours: 1,
    caloriesBurned: 480
  });

  await withMockedClaudeWorkoutParser(outputText, async ({ parseWorkoutText }) => {
    const parsed = await parseWorkoutText({
      text: '1 hour strength training, Apple Watch active calories 480 and total calories 620'
    });

    assert.equal(parsed.caloriesBurned, 480);
  });
});

test('fallback workout calorie estimates are active and rest-adjusted for strength', () => {
  const { estimateWorkoutCalories } = require('../src/workout-calories');

  assert.equal(estimateWorkoutCalories('45 minute moderate chest workout', 0.75, 'medium'), 165);
  assert.equal(estimateWorkoutCalories('45 minute light chest workout', 0.75, 'low'), 98);
  assert.equal(estimateWorkoutCalories('45 minute moderate run', 0.75, 'medium'), 375);
});
