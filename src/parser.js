const { createStructuredJson, imageBlockFromDataUrl } = require('./ai-client');
const { normalizeMealParse } = require('./meal-normalizer');
const { capConservativeWorkoutCalories } = require('./workout-calories');

const WORKOUT_PARSE_SYSTEM_PROMPT = [
  'You turn a short, informal workout note into a structured log for a fitness tracker. The user is usually trying to lose fat, and the calories you estimate are credited back to their daily food budget, so an overestimate lets them eat more than they burned.',
  '',
  'Fields:',
  '- description: only the activity or focus (e.g. "Legs", "5k run and pushups"). Omit intensity words and generic words like workout, training, or session.',
  '- intensity: low, medium, or high. Use medium if the note does not say or imply otherwise.',
  '- durationHours: total elapsed time across every activity mentioned, in hours (45 min = 0.75). If no time is given, use a typical duration for that activity. Keep it realistic, between 0.1 and 12.',
  '- caloriesBurned: active exercise calories only.',
  '',
  'Calories burned:',
  '- Count active exercise calories only: calories above resting metabolism, not total calories, basal calories, or resting calories for elapsed clock time.',
  '- If the user gives both active and total calories, use active calories. If they only give total calories, do not copy the total; make a conservative active-calorie estimate from activity, duration, and intensity.',
  '- Be conservative and err on the lower end. Slightly underestimating active calories burned is better than overestimating them.',
  '- For strength training, weightlifting, resistance training, bodybuilding, or body-part workouts, assume elapsed duration includes normal rest periods between sets unless the user clearly says circuit, HIIT, supersets, or minimal rest.',
  '- For low/light or medium/moderate intensity strength training, average calorie burn over the full session including those rests; do not treat every minute as continuous lifting.'
].join('\n');

const MEAL_PARSE_SYSTEM_PROMPT = [
  'You turn what a user ate into an itemized nutrition log for a macro tracker. Input is meal text, one or more meal photos or screenshots, or both. If text and photos conflict, the text wins and photos are supporting context.',
  '',
  'Estimating amounts:',
  '- Report calories (kcal) and protein, carbs, fat, and fiber (grams) for the amount actually eaten.',
  '- The user is usually tracking toward a fat-loss goal, and under-counting quietly stalls progress. When unsure, err on the higher end: slightly overestimating calories and macros is better than underestimating them.',
  '- Cooked dishes usually contain oil or butter; include a reasonable amount in the estimate.',
  '- If a photo shows a nutrition label, copy its values exactly for the serving size, scaled to the amount eaten. Do not adjust label values upward.',
  '- For chain restaurants and branded products, use the published nutrition when you know it.',
  '- Fiber is part of carbohydrate; do not add its calories again. Estimate fiber from the food and portion; use null only when you truly cannot estimate it, never 0 for missing data.',
  '',
  'Items, quantities, and units:',
  '- Break the meal into separate foods.',
  '- Prefer practical units from the user\'s language (egg, bottle, can, slice, cup, serving) over tiny base units like 1 ml or 1 g.',
  '- Keep fractional containers fractional: "half a bottle" is quantity 0.5, unit bottle.',
  '- For a repeated multi-item set, put the repetition on mealQuantity and describe one set in the items. "2 pancakes and 2 syrup" is mealQuantity 2, mealUnit "serving", one pancake item with quantity 1 and one syrup item with quantity 1, with macros for one pancake and one syrup. If the user lists only one food, keep the count on the item.',
  '',
  'Other fields:',
  '- confidence per item: high when the food and amount are stated or read from a label; medium when the food is clear but the portion or preparation is estimated; low when the food itself is a guess.',
  '- mealName: a short, clean title for the whole meal (e.g. "Lentil Soup", "Chicken Caesar Salad", "Breakfast Burrito"), not an echo of the raw input.',
  '- notes: one or two sentences on the main assumptions (portion sizes, cooking fat, which label was read). Leave it empty when nothing was assumed.',
  '- consumedAt: return the ConsumedAt value you were given.'
].join('\n');

const MEAL_PARSE_SCHEMA = {
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
          'fiber',
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
          fiber: { type: ['number', 'null'] },
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low']
          }
        }
      }
    }
  }
};

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

  const userContent = [
    {
      type: 'text',
      text: `ConsumedAt: ${consumedAt}\nMeal description: ${normalizedText || '(none provided)'}`
    }
  ];

  for (const dataUrl of normalizedImageDataUrls) {
    const imageBlock = imageBlockFromDataUrl(dataUrl);
    if (!imageBlock) {
      throw new Error('Invalid image data. Please reselect the photo and try again.');
    }
    userContent.push(imageBlock);
  }

  const parsedJson = await createStructuredJson({
    system: MEAL_PARSE_SYSTEM_PROMPT,
    content: userContent,
    schema: MEAL_PARSE_SCHEMA
  });

  const parsed = normalizeMealParse(parsedJson, { text });
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new Error('Unable to parse meal items from input.');
  }

  return parsed;
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

function sanitizeWorkoutParse(parsed, sourceText = '') {
  const description = normalizeWorkoutDescription(parsed.description || '') || 'General';
  const intensity = normalizeWorkoutIntensity(parsed.intensity);
  let durationHours = Number(parsed.durationHours);
  durationHours = Math.max(0.1, Math.min(12, durationHours));
  durationHours = Math.round(durationHours * 100) / 100;
  const caloriesBurned = capConservativeWorkoutCalories({
    sourceText,
    description,
    intensity,
    durationHours,
    caloriesBurned: parsed.caloriesBurned
  });
  return { description, intensity, durationHours, caloriesBurned };
}

async function parseWorkoutText({ text }) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) {
    throw new Error('Workout text is required.');
  }

  let parsed = {};
  try {
    parsed = await createStructuredJson({
      system: WORKOUT_PARSE_SYSTEM_PROMPT,
      content: normalizedText,
      effort: 'low',
      maxTokens: 4000,
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
    });
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    parsed = {};
  }

  return sanitizeWorkoutParse(parsed, normalizedText);
}

module.exports = {
  parseMealText,
  parseWorkoutText,
  normalizeMealParse
};
