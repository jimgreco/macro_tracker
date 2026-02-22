const OpenAI = require('openai');

function hasApiKey() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function parseFallback(text, consumedAt, hasImage = false) {
  return {
    consumedAt,
    mealName: 'Uncategorized',
    items: [
      {
        itemName: text || (hasImage ? 'Meal from photo' : 'Unspecified meal item'),
        quantity: 1,
        unit: 'serving',
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        confidence: 'low'
      }
    ],
    notes: hasImage
      ? 'OpenAI API key missing. Added a placeholder item from your meal photo/text with 0 macros.'
      : 'OpenAI API key missing. Added raw text as a placeholder item with 0 macros.'
  };
}

async function parseMealText({ text, consumedAt, imageDataUrl }) {
  const normalizedText = String(text || '').trim();
  const hasImage = Boolean(imageDataUrl);

  if (!normalizedText && !hasImage) {
    throw new Error('Meal text or a meal photo is required.');
  }

  if (!hasApiKey()) {
    return parseFallback(normalizedText, consumedAt, hasImage);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const userContent = [
    {
      type: 'input_text',
      text: `ConsumedAt: ${consumedAt}\nMeal description: ${normalizedText || '(none provided)'}`
    }
  ];

  if (hasImage) {
    userContent.push({
      type: 'input_image',
      image_url: imageDataUrl,
      detail: 'high'
    });
  }

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    input: [
      {
        role: 'system',
        content:
          'You extract nutrition logs from user input that may include meal text, a meal photo, or both. Return strict JSON only. Break meals into itemized foods with estimated macros per consumed amount. Use grams for protein/carbs/fat and kcal for calories. Prefer practical food units from user language (egg, bottle, can, slice, cup, serving) over tiny base units like 1 ml or 1 g when a practical unit is implied. If the user says a fractional container (like half bottle), keep quantity fractional with that container unit (quantity 0.5, unit bottle). If uncertain, provide best estimate and confidence. If text and photo conflict, use the text as primary and photo as supporting context.'
      },
      {
        role: 'user',
        content: userContent
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'meal_parse',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['consumedAt', 'mealName', 'items', 'notes'],
          properties: {
            consumedAt: { type: 'string' },
            mealName: { type: 'string' },
            notes: { type: 'string' },
            items: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'itemName',
                  'quantity',
                  'unit',
                  'calories',
                  'protein',
                  'carbs',
                  'fat',
                  'confidence'
                ],
                properties: {
                  itemName: { type: 'string' },
                  quantity: { type: 'number' },
                  unit: { type: 'string' },
                  calories: { type: 'number' },
                  protein: { type: 'number' },
                  carbs: { type: 'number' },
                  fat: { type: 'number' },
                  confidence: {
                    type: 'string',
                    enum: ['high', 'medium', 'low']
                  }
                }
              }
            }
          }
        },
        strict: true
      }
    }
  });

  const content = response.output_text || '{}';
  const parsed = JSON.parse(content);

  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new Error('Unable to parse meal items from input.');
  }

  return parsed;
}

module.exports = {
  parseMealText
};
