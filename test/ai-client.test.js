const test = require('node:test');
const assert = require('node:assert/strict');
const { toClaudeSchema, imageBlockFromDataUrl, getAiModel } = require('../src/ai-client');

test('defaults the AI model to Claude Opus 5.5', () => {
  const previous = process.env.ANTHROPIC_MODEL;
  delete process.env.ANTHROPIC_MODEL;
  try {
    assert.equal(getAiModel(), 'claude-opus-5-5');
  } finally {
    if (previous !== undefined) process.env.ANTHROPIC_MODEL = previous;
  }
});

test('strips JSON schema constraints Claude structured outputs reject', () => {
  const schema = toClaudeSchema({
    type: 'object',
    additionalProperties: false,
    required: ['a', 'b', 'c'],
    properties: {
      a: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 6 },
      b: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 7 },
      c: { type: ['number', 'null'], minimum: 0 }
    }
  });
  assert.deepEqual(schema.properties.a, { type: 'array', items: { type: 'string' }, minItems: 1 });
  assert.deepEqual(schema.properties.b, { type: 'array', items: { type: 'string' } });
  assert.deepEqual(schema.properties.c, { type: ['number', 'null'] });
  assert.deepEqual(schema.required, ['a', 'b', 'c']);
});

test('converts image data URLs to base64 image blocks', () => {
  const block = imageBlockFromDataUrl('data:image/jpg;base64,AAA\nBBB');
  assert.deepEqual(block, {
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: 'AAABBB' }
  });
  assert.equal(imageBlockFromDataUrl('not-a-data-url'), null);
});
