const OpenAI = require('openai');
const { toFile } = require('openai/uploads');
const { normalizeMealParse } = require('./meal-normalizer');

function parseImageDataUrl(imageDataUrl) {
  const match = String(imageDataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
  if (!match) {
    return null;
  }
  return {
    mimeType: String(match[1] || '').toLowerCase(),
    base64Payload: String(match[2] || '').replace(/\s+/g, '')
  };
}

function extensionFromMimeType(mimeType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
  };
  return map[String(mimeType || '').toLowerCase()] || 'jpg';
}

async function parseMealText({ text, consumedAt, imageDataUrl, imageDataUrls }) {
  const normalizedText = String(text || '').trim();
  const normalizedImageDataUrls = [
    ...(Array.isArray(imageDataUrls) ? imageDataUrls : []),
    ...(imageDataUrl ? [imageDataUrl] : [])
  ].filter(Boolean);
  const hasImage = normalizedImageDataUrls.length > 0;

  if (!normalizedText && !hasImage) {
    throw new Error('Meal text or a meal photo is required.');
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const userContent = [
    {
      type: 'input_text',
      text: `ConsumedAt: ${consumedAt}\nMeal description: ${normalizedText || '(none provided)'}`
    }
  ];

  const uploadedImageFileIds = [];
  if (hasImage) {
    for (const [index, dataUrl] of normalizedImageDataUrls.entries()) {
      const parsedDataUrl = parseImageDataUrl(dataUrl);
      if (!parsedDataUrl) {
        throw new Error('Invalid image data. Please reselect the photo and try again.');
      }

      const imageBuffer = Buffer.from(parsedDataUrl.base64Payload, 'base64');
      const extension = extensionFromMimeType(parsedDataUrl.mimeType);
      const imageFile = await toFile(imageBuffer, `meal-photo-${index + 1}.${extension}`, { type: parsedDataUrl.mimeType });
      const uploaded = await client.files.create({
        file: imageFile,
        purpose: 'vision'
      });
      const uploadedImageFileId = String(uploaded.id || '');
      uploadedImageFileIds.push(uploadedImageFileId);
      userContent.push({
        type: 'input_image',
        file_id: uploadedImageFileId,
        detail: 'high'
      });
    }
  }

  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      input: [
        {
          role: 'system',
          content:
            'You extract nutrition logs from user input that may include meal text, one or more meal photos/screenshots, or both. Return strict JSON only. Break meals into itemized foods with estimated macros per consumed amount. Use grams for protein/carbs/fat and kcal for calories. Prefer practical food units from user language (egg, bottle, can, slice, cup, serving) over tiny base units like 1 ml or 1 g when a practical unit is implied. If the user says a fractional container (like half bottle), keep quantity fractional with that container unit (quantity 0.5, unit bottle). For repeated multi-item meal sets, put the repetition on mealQuantity and make each component describe one meal unit: for "2 pancakes and 2 syrup", return mealQuantity 2, mealUnit "serving", one pancake item with quantity 1, and one syrup item with quantity 1, with item macros for one pancake and one syrup. If the user only lists one food, keep the count on the item. If uncertain, provide best estimate and confidence. If text and photos conflict, use the text as primary and photos as supporting context. When estimating macros, be conservative and err on the higher end -- it is better to slightly overestimate calories and macros than to underestimate them. For cooked meals, assume they were prepared with a reasonable amount of oil or butter and include that in the macro estimates. For mealName, generate a short descriptive name for the overall meal (e.g. "Lentil Soup", "Chicken Caesar Salad", "Breakfast Burrito") -- do not just echo the user\'s raw input; clean it up into a proper, concise meal title.'
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
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['consumedAt', 'mealName', 'mealQuantity', 'mealUnit', 'items', 'notes'],
            properties: {
              consumedAt: { type: 'string' },
              mealName: { type: 'string' },
              mealQuantity: { type: 'number' },
              mealUnit: { type: 'string' },
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
          }
        }
      }
    });

    const content = response.output_text || '{}';
    const parsed = normalizeMealParse(JSON.parse(content), { text });

    if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
      throw new Error('Unable to parse meal items from input.');
    }

    return parsed;
  } finally {
    for (const uploadedImageFileId of uploadedImageFileIds) {
      if (uploadedImageFileId) {
        try {
          await client.files.del(uploadedImageFileId);
        } catch (_error) {
          // Best-effort cleanup.
        }
      }
    }
  }
}


function normalizeWorkoutDescription(text) {
  return String(text || '')
    .replace(/\bwork\s*out\b/gi, 'workout')
    .replace(/\b(?:high|low|medium|moderate|intense|intensity|vigorous|light|easy|recovery|hiit)\b/gi, ' ')
    .replace(/\b(?:workout|training|session)\b/gi, ' ')
    .replace(/\bof\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWorkoutIntensity(intensity, fallback = 'medium') {
  const normalized = String(intensity || '').trim().toLowerCase();
  if (['low', 'medium', 'high'].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function sanitizeWorkoutParse(parsed) {
  const description = normalizeWorkoutDescription(parsed.description || '') || 'General';
  const intensity = normalizeWorkoutIntensity(parsed.intensity);
  let durationHours = Number(parsed.durationHours);
  durationHours = Math.max(0.1, Math.min(12, durationHours));
  durationHours = Math.round(durationHours * 100) / 100;
  const caloriesBurned = Math.max(0, Math.round(Number(parsed.caloriesBurned || 0)));
  return { description, intensity, durationHours, caloriesBurned };
}

async function parseWorkoutText({ text }) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) {
    throw new Error('Workout text is required.');
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    input: [
      {
        role: 'system',
        content: 'You extract structured workout logs from natural language. Return strict JSON only. Infer description, intensity, total duration in hours, and estimated calories burned. Allowed intensity values are low, medium, high. Use medium if not provided. Parse minute inputs correctly (e.g., 45 min = 0.75 hours). Keep durationHours realistic between 0.1 and 12. Description should be only the activity/focus and must omit intensity words plus generic words like workout, training, or session. When estimating calories burned, be conservative and err on the lower end — it is better to slightly underestimate calories burned than to overestimate them.'
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: normalizedText }]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'workout_parse',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['description', 'intensity', 'durationHours', 'caloriesBurned'],
          properties: {
            description: { type: 'string' },
            intensity: { type: 'string', enum: ['low', 'medium', 'high'] },
            durationHours: { type: 'number' },
            caloriesBurned: { type: 'number' }
          }
        }
      }
    }
  });

  const content = response.output_text || '{}';
  let parsed = {};
  try {
    parsed = JSON.parse(content);
  } catch (_error) {
    parsed = {};
  }

  return sanitizeWorkoutParse(parsed);
}

module.exports = {
  parseMealText,
  parseWorkoutText,
  normalizeMealParse
};
