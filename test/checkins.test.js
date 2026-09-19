const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { normalizeCheckin, normalizePhoto, createCheckinService } = require('../src/checkins');

let database;
before(async () => {
  if (!process.env.TEST_DATABASE_URL) return;
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  try { database = require('../src/db'); await database.initDb(); }
  finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
after(async () => { if (database) await database.getPool().end(); });

test('check-in dates and notes reject invalid input', () => {
  assert.equal(normalizeCheckin({day:'2027-06-11'}).day,'2027-06-11');
  for (const day of ['2027-02-30','bad','2027-13-11',null]) assert.throws(()=>normalizeCheckin({day}));
  assert.throws(()=>normalizeCheckin({day:'2027-06-11',notes:'a'.repeat(2001)}));
  assert.throws(()=>normalizeCheckin({day:'2027-06-11',waist:{readings:[33],unit:'in',method:'navel_relaxed',time:'25:30'}}));
  assert.throws(()=>normalizeCheckin({day:'2027-06-11',waist:{readings:[],unit:'in',method:'navel_relaxed',time:'08:30'}}));
  const combined = normalizeCheckin({day:'2027-06-11',waist:{readings:[33,33.4],unit:'in',method:'navel_relaxed',time:'08:30'}});
  assert.deepEqual(combined.waist.readings,[33,33.4]);
  assert.ok(Math.abs(combined.waist.valueCm-84.328)<0.001);
});
test('photo normalization strips metadata and bounds image dimensions', async () => {
  const input = await sharp({create:{width:2200,height:2200,channels:3,background:'#123456'}}).jpeg().withMetadata({orientation:6}).toBuffer();
  const photo = await normalizePhoto(input.toString('base64'));
  const info = await sharp(photo).metadata();
  assert.equal(info.format,'jpeg'); assert.ok(info.width<=1800); assert.ok(info.height<=1800);
  assert.equal(info.exif,undefined); assert.equal(info.orientation,undefined);
  await assert.rejects(normalizePhoto('not-an-image'));
});

test('combined check-ins save and edit waist atomically, isolate accounts and retain deletion tombstones', {skip:!process.env.TEST_DATABASE_URL}, async()=>{
  const {Pool}=require('pg'); const crypto=require('crypto');
  const {createWaistStore}=require('../src/waist');
  const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});
  const owner=`combined-${crypto.randomUUID()}`;
  const service=createCheckinService(pool,{s3:{},bucket:''});
  const waistStore=createWaistStore(pool);
  const waist={readings:[33,33.4],unit:'in',method:'navel_relaxed',notes:'Relaxed',time:'23:45'};
  try {
    await pool.query('INSERT INTO users(id,name,email,provider) VALUES($1,$2,$3,$4)',[owner,'Test',`${owner}@example.test`,'local-dev']);
    await assert.rejects(service.save(owner,{day:'2026-09-08',notes:'Must roll back',waist},'Invalid/Timezone'));
    assert.equal((await service.list(owner,'America/New_York')).entries.length,0);
    assert.equal((await waistStore.listWaistEntries(owner)).entries.length,0);

    const createId=crypto.randomUUID();
    const saved=await service.save(owner,{createId,day:'2026-09-08',notes:'Combined',waist},'America/New_York');
    assert.equal(saved.id,createId);
    let entry=(await service.list(owner,'America/New_York')).entries[0];
    const waistID=entry.waistEntry.id;
    assert.deepEqual(entry.waistEntry.readings,[33,33.4]);
    assert.equal(entry.waistEntry.time,'23:45');
    assert.equal(new Date(entry.waistEntry.loggedAt).toISOString(),'2026-09-09T03:45:00.000Z');
    assert.equal((await waistStore.listWaistEntries(owner,{unlinked:true})).entries.length,0);
    await assert.rejects(service.save('other',{id:saved.id,day:entry.day,notes:'Foreign',waist}));
    await service.save(owner,{id:saved.id,day:entry.day,notes:'Edited',waist:{...waist,readings:[84],unit:'cm',method:'midpoint_relaxed'}});
    entry=(await service.list(owner,'America/New_York')).entries[0];
    assert.equal(entry.waistEntry.id,waistID);
    assert.deepEqual(entry.waistEntry.readings,[84]);
    assert.equal(entry.waistEntry.method,'midpoint_relaxed');
    await service.save(owner,{id:saved.id,day:entry.day,notes:'Older client edit'});
    assert.equal((await service.list(owner,'America/New_York')).entries[0].waistEntry.id,waistID);
    await service.save(owner,{id:saved.id,day:entry.day,notes:'Remove reading',waist:null});
    assert.equal((await service.list(owner,'America/New_York')).entries[0].waistEntry,null);
    assert.ok((await pool.query('SELECT deleted_at FROM waist_entries WHERE id=$1',[waistID])).rows[0].deleted_at);
    await service.save(owner,{id:saved.id,day:entry.day,notes:'New reading',waist});
    const replacement=(await service.list(owner,'America/New_York')).entries[0].waistEntry;
    assert.notEqual(replacement.id,waistID);
    const legacy=await waistStore.saveWaistEntry(owner,{...waist,loggedAt:'2026-09-07T12:00:00Z'});
    assert.deepEqual((await waistStore.listWaistEntries(owner,{unlinked:true})).entries.map(row=>row.id),[legacy.id]);
    await service.delete(owner,saved.id);
    assert.ok((await pool.query('SELECT deleted_at FROM waist_entries WHERE id=$1',[replacement.id])).rows[0].deleted_at);
    assert.equal((await waistStore.listWaistEntries(owner)).entries.length,1);
  } finally {
    await pool.query('DELETE FROM progress_photos WHERE user_id=$1',[owner]);
    await pool.query('DELETE FROM progress_checkins WHERE user_id=$1',[owner]);
    await pool.query('DELETE FROM waist_entries WHERE user_id=$1',[owner]);
    await pool.query('DELETE FROM users WHERE id=$1',[owner]);
    await pool.end();
  }
});
test('foreign photos never receive signed URLs', async () => {
  let signed=false;
  const pool={query:async(sql,values)=>{assert.deepEqual(values,['photo-id','owner']);assert.match(sql,/user_id=\$2 AND ready/);return {rows:[]};}};
  const service=createCheckinService(pool,{bucket:'private',s3:{},sign:async()=>{signed=true;}});
  await assert.rejects(service.photoURL('owner','photo-id'));
  assert.equal(signed,false);
});
test('photo deletion retains retryable records when S3 fails', async () => {
  const sql=[]; const client={query:async(q)=>{sql.push(q);return {rows:q.startsWith('SELECT object_key')?[{object_key:'opaque'}]:[]};},release(){}};
  const service=createCheckinService({connect:async()=>client},{bucket:'private',s3:{send:async()=>{throw new Error('offline');}}});
  await assert.rejects(service.deletePhoto('owner','id'));
  assert.equal(sql.some(q=>q.startsWith('DELETE')),false);
  assert.ok(sql.at(-1).includes('pg_advisory_unlock'));
});
test('photo URLs expire after a minute and use the owned object only', async () => {
  const service=createCheckinService({query:async()=>({rows:[{object_key:'progress/opaque.jpg'}]})},{bucket:'private',s3:{},sign:async(_s3,command,options)=>{assert.equal(command.input.Key,'progress/opaque.jpg');assert.equal(options.expiresIn,60);return 'https://signed.example';}});
  assert.deepEqual(await service.photoURL('owner','id'),{url:'https://signed.example'});
});
test('seven-day evidence weights each recorded day equally and edits stay owner-scoped', {skip:!process.env.TEST_DATABASE_URL}, async()=>{
  const {Pool}=require('pg');const crypto=require('crypto');const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});
  const owner=`checkin-${crypto.randomUUID()}`;
  const service=createCheckinService(pool,{s3:{},bucket:''});
  try {
    await pool.query('INSERT INTO users(id,name,email,provider) VALUES($1,$2,$3,$4)',[owner,'Test','checkin@example.test','local-dev']);
    await pool.query("INSERT INTO weight_entries(user_id,weight,logged_at) VALUES($1,180,'2026-09-07T12:00:00Z'),($1,184,'2026-09-07T14:00:00Z'),($1,178,'2026-09-08T12:00:00Z')",[owner]);
    const saved=await service.save(owner,{day:'2026-09-08',notes:'Original'});
    await assert.rejects(service.save(owner,{day:'2026-09-08',notes:'Accidental overwrite'}));
    await assert.rejects(service.save('other',{id:saved.id,day:'2026-09-08',notes:'Foreign edit'}));
    await service.save(owner,{id:saved.id,day:'2026-09-08',notes:'Corrected'});
    const list=await service.list(owner,'America/New_York');assert.equal(list.entries[0].averageWeight,180);assert.equal(list.entries[0].weightDays,2);assert.equal(list.entries[0].notes,'Corrected');
    await service.delete(owner,saved.id);assert.equal((await service.list(owner,'America/New_York')).entries.length,0);
  }finally{await pool.query('DELETE FROM progress_photos WHERE user_id=$1',[owner]);await pool.query('DELETE FROM progress_checkins WHERE user_id=$1',[owner]);await pool.query('DELETE FROM weight_entries WHERE user_id=$1',[owner]);await pool.query('DELETE FROM users WHERE id=$1',[owner]);await pool.end();}
});
