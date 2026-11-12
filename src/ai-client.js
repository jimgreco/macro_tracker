const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_AI_MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  'maxItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength'
]);

function getAiModel() {
  return process.env.ANTHROPIC_MODEL || DEFAULT_AI_MODEL;
}

function hasAiApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Claude structured outputs reject numeric/string length constraints and array
// minItems above 1. Callers already clamp/slice results, so drop them here.
function toClaudeSchema(schema) {
  if (Array.isArray(schema)) {
    return schema.map(toClaudeSchema);
  }
  if (!schema || typeof schema !== 'object') {
    return schema;
  }
  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) {
      continue;
    }
    if (key === 'minItems' && Number(value) > 1) {
      continue;
    }
    result[key] = toClaudeSchema(value);
  }
  return result;
}

function imageBlockFromDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
  if (!match) {
    return null;
  }
  let mediaType = String(match[1] || '').toLowerCase();
  if (mediaType === 'image/jpg') {
    mediaType = 'image/jpeg';
  }
  return {
    type: 'image',
    source: { type: 'base64', media_type: mediaType, data: String(match[2] || '').replace(/\s+/g, '') }
  };
}

/**
 * Sends one structured-output request to Claude and returns the parsed JSON object.
 * `content` is a string or an array of Anthropic content blocks.
 */
async function createStructuredJson({ system, content, schema, effort = 'medium', maxTokens = 16000 }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.beta.messages.create({
    model: getAiModel(),
    max_tokens: maxTokens,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content }],
    output_config: {
      effort,
      format: { type: 'json_schema', schema: toClaudeSchema(schema) }
    }
  });

  if (response.stop_reason === 'refusal') {
    const category = response.stop_details?.category || 'unspecified';
    throw new Error(`AI request was declined (${category}).`);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('AI response was cut off before it finished.');
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  return JSON.parse(text || '{}');
}

module.exports = {
  DEFAULT_AI_MODEL,
  getAiModel,
  hasAiApiKey,
  toClaudeSchema,
  imageBlockFromDataUrl,
  createStructuredJson
};
