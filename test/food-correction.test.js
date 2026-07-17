const test = require('node:test');
const assert = require('node:assert/strict');
const { applyFoodCorrectionToItem } = require('../src/food-correction');
const { scaleMealUnitRows } = require('../src/meal-normalizer');

const twoEggCorrection = {
  correction_key: 'eggs',
  item_name: 'Eggs',
  quantity: 2,
  unit: 'eggs',
  calories: 140,
  protein: 12,
  carbs: 1,
  fat: 10
};

test('remembered corrections scale to the requested item quantity', () => {
  const corrected = applyFoodCorrectionToItem({
    itemName: 'Eggs',
    quantity: 1,
    unit: 'egg',
    calories: 90,
    protein: 7,
    carbs: 1,
    fat: 6,
    source: 'ai_text'
  }, twoEggCorrection);

  assert.equal(corrected.quantity, 1);
  assert.equal(corrected.calories, 70);
  assert.equal(corrected.protein, 6);
  assert.equal(corrected.fat, 5);
  assert.equal(corrected.source, 'food_correction');
});

test('meal quantity scales a corrected per-meal-unit row exactly once', () => {
  const correctedUnit = applyFoodCorrectionToItem({
    itemName: 'Eggs',
    quantity: 1,
    unit: 'egg',
    calories: 90,
    protein: 7,
    carbs: 1,
    fat: 6,
    source: 'ai_text'
  }, twoEggCorrection);
  const [consumed] = scaleMealUnitRows([correctedUnit], 2);

  assert.equal(consumed.quantity, 2);
  assert.equal(consumed.calories, 140);
  assert.equal(consumed.protein, 12);
  assert.equal(consumed.fat, 10);
});

test('remembered corrections do not rewrite trusted quick-add quantities', () => {
  const quickAdd = {
    itemName: 'Eggs',
    quantity: 1,
    unit: 'egg',
    calories: 70,
    protein: 6,
    carbs: 0.5,
    fat: 5,
    source: 'quick_add'
  };

  assert.deepEqual(applyFoodCorrectionToItem(quickAdd, twoEggCorrection), quickAdd);
});

test('remembered corrections do not cross incompatible measurement units', () => {
  const weighedItem = {
    itemName: 'Eggs',
    quantity: 100,
    unit: 'g',
    calories: 143,
    protein: 13,
    carbs: 1,
    fat: 10,
    source: 'ai_text'
  };

  assert.deepEqual(applyFoodCorrectionToItem(weighedItem, twoEggCorrection), weighedItem);
});
