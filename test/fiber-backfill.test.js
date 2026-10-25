const test=require('node:test');
const assert=require('node:assert/strict');
const {applyPlan}=require('../scripts/backfill-quick-add-fiber');
test('backfill dry run, replay, stale records and ownership fail safely', async()=>{
 const before={id:1,name:'Beans',quantity:1,unit:'cup',calories:200,protein:12,carbs:35,fat:1,components:[],source:'manual',sourceDetail:null};
 const plan={version:1,userId:'owner',date:'2026-10-25',items:[{before,fiber:12,components:[],basis:'estimate'}]};
 const calls=[];
 let current={...before,fiber:null};
 const client={query:async(sql,values)=>{
  calls.push(sql);
  if(sql.startsWith('SELECT')) {assert.equal(values[0],'owner');return {rows:current?[current]:[]};}
  return {rows:[]};
 }};
 assert.deepEqual(await applyPlan(client,plan),{applied:false,updated:1,unchanged:0});
 assert.equal(calls.at(-1),'ROLLBACK');
 current={...before,sourceDetail:'fiber_estimate:2026-10-25',fiber:12};
 assert.deepEqual(await applyPlan(client,plan,true),{applied:true,updated:0,unchanged:1});
 current={...before,name:'Edited',fiber:null};
 await assert.rejects(applyPlan(client,plan,true),/changed/);
 assert.equal(calls.at(-1),'ROLLBACK');
 current=null;
 await assert.rejects(applyPlan(client,plan,true),/not owned/);
});
