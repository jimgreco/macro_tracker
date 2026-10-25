const test = require('node:test');
const assert = require('node:assert/strict');
const { fiberValue, scaleFiber, fiberSummary } = require('../src/fiber');
const { normalizeMealParse, scaleMealUnitRows } = require('../src/meal-normalizer');
const { applyFoodCorrectionToItem } = require('../src/food-correction');
test('fiber distinguishes zero from absent and validates values', () => {
  for (const v of [undefined, null, '']) assert.equal(fiberValue(v), null);
  assert.equal(fiberValue(0), 0);
  for (const v of [-1, NaN, Infinity, 5001, true, [], {}]) assert.throws(() => fiberValue(v));
  assert.equal(scaleFiber(null, 2), null);
  assert.equal(scaleFiber(3.4, 0.5), 1.7);
  assert.deepEqual(fiberSummary([{fiber: 0}, {fiber: null}, {fiber: 4}]), {fiber: null, fiberKnownGrams: 4, fiberKnownCount: 2, fiberItemCount: 3});
  assert.equal(fiberSummary([{fiber: 0}]).fiber, 0);
  assert.equal(fiberSummary([]).fiber, null);
});
test('fiber scales through parsed repeated meals without inventing missing fiber', () => {
 const parsed = normalizeMealParse({mealQuantity: 2, items: [{itemName:'Bread', quantity:2, fiber:6}, {itemName:'Eggs', quantity:2, fiber:0}]});
 assert.deepEqual(parsed.items.map(x=>x.fiber), [3,0]);
 assert.deepEqual(scaleMealUnitRows(parsed.items, 2).map(x=>x.fiber),[6,0]);
 assert.equal(normalizeMealParse({items:[{itemName:'Unknown',quantity:1}]}).items[0].fiber,null);
});
test('remembered corrections preserve evidence when legacy correction lacks fiber', () => {
 const item={itemName:'Bread',source:'ai_text',quantity:2,unit:'slice',fiber:4};
 const correction={quantity:1,unit:'slice',fiber:null};
 assert.equal(applyFoodCorrectionToItem(item,correction).fiber,4);
 assert.equal(applyFoodCorrectionToItem(item,{...correction,fiber:1.5}).fiber,3);
});

test('Postgres fiber lifecycle, ownership, legacy edits, coverage, target history and export', {skip: !process.env.TEST_DATABASE_URL}, async () => {
 process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
 const db=require('../src/db');
 const userId='fiber-'+require('node:crypto').randomUUID();
 try {
  await require('./helpers/database').initializeTestSchema(db);
  await db.upsertUser({id:userId,provider:'local-dev',providerUserId:userId,email:'fiber@example.test',name:'Fiber test'});
  const item={name:'Beans',itemName:'Beans',quantity:1,unit:'cup',calories:200,protein:12,carbs:35,fat:1,fiber:12,consumedAt:new Date().toISOString()};
  await db.setMacroTarget(userId, 'fiber', 30);
  assert.equal((await db.getMacroTargets(userId)).fiber, 30);
  assert.equal((await db.getMacroTargetHistory(userId)).at(-1).targets.fiber, 30);
  const id=await db.addSavedItem(userId,item);
  await db.updateSavedItem(userId,id,{...item,fiber:undefined}); // explicit omitted-like request below
  await db.updateSavedItem(userId,id,item);
  const legacy={...item};delete legacy.fiber;
  await db.updateSavedItem(userId,id,legacy);
  assert.equal((await db.listSavedItems(userId))[0].fiber,12);
  assert.equal(await db.quickAddFromSaved('wrong-account',id,1,item.consumedAt),null);
  const logged=await db.quickAddFromSaved(userId,id,0.5,item.consumedAt);
  assert.equal(logged.fiber,6);
  let dash=await db.getDashboard(userId);
  assert.equal(dash.currentDayTotals.fiber,6);
  const entry=dash.entries[0];
  await db.updateEntry(userId,entry.id,{...legacy,itemName:'Beans',quantity:0.5,consumedAt:item.consumedAt});
  dash=await db.getDashboard(userId);
  assert.equal(dash.entries[0].fiber,6);
  await db.addEntries(userId,[legacy]);
  dash=await db.getDashboard(userId,undefined,{limit:1});
  assert.equal(dash.currentDayTotals.fiber,null);
  assert.equal(dash.currentDayTotals.fiberKnownGrams,6);
  assert.equal(dash.currentDayTotals.fiberKnownCount,1);
  assert.equal(dash.currentDayTotals.fiberItemCount,2);
  const {rows}=await db.getPool().query('SELECT fiber FROM food_corrections WHERE user_id=$1',[userId]);
  assert.equal(rows[0].fiber,6);
  const exportData=await db.exportUserData(userId);
  assert.ok(JSON.stringify(exportData).includes('"fiber":6'));
  await db.updateEntry(userId,entry.id,{...legacy,fiber:0,consumedAt:item.consumedAt});
  dash=await db.getDashboard(userId);
  assert.equal(dash.entries.find(x=>x.id===entry.id).fiber,0);
  const meal=await db.addSavedItem(userId,{...item,name:'Beans and egg',components:[{...item,fiber:3},{...item,itemName:'Egg',fiber:0}]});
  await db.updateSavedItem(userId,meal,{...legacy,name:'Beans and egg',components:[{...legacy,quantity:2},{...legacy,itemName:'Egg'}]});
  assert.equal((await db.listSavedItems(userId)).find(x=>x.id===meal).fiber,6);
  const mealLog=await db.quickAddFromSaved(userId,meal,2,item.consumedAt);
  assert.equal(mealLog.fiber,12);
  assert.deepEqual(mealLog.components.map(x=>x.fiber),[12,0]);
 } finally {await db.deleteUserAccount(userId);await db.getPool().end();}
});
