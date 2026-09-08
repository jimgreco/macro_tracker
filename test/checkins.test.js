const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { normalizeCheckin, normalizePhoto, createCheckinService } = require('../src/checkins');

test('check-in dates and notes reject invalid input', () => {
  assert.equal(normalizeCheckin({day:'2027-06-11'}).day,'2027-06-11');
  for (const day of ['2027-02-30','bad','2027-13-11',null]) assert.throws(()=>normalizeCheckin({day}));
  assert.throws(()=>normalizeCheckin({day:'2027-06-11',notes:'a'.repeat(2001)}));
});
test('photo normalization strips metadata and bounds image dimensions', async () => {
  const input = await sharp({create:{width:2200,height:2200,channels:3,background:'#123456'}}).jpeg().withMetadata({orientation:6}).toBuffer();
  const photo = await normalizePhoto(input.toString('base64'));
  const info = await sharp(photo).metadata();
  assert.equal(info.format,'jpeg'); assert.ok(info.width<=1800); assert.ok(info.height<=1800);
  assert.equal(info.exif,undefined); assert.equal(info.orientation,undefined);
  await assert.rejects(normalizePhoto('not-an-image'));
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
