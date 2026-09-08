const crypto = require('crypto');
const sharp = require('sharp');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const VIEWS = ['front', 'side', 'back'];
function normalizeCheckin(body = {}) {
  const day = body.day;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day) throw new Error('Choose a valid check-in date.');
  if (body.notes != null && (typeof body.notes !== 'string' || body.notes.length > 2000)) throw new Error('Notes must be 2,000 characters or fewer.');
  return { day, notes: (body.notes || '').trim() };
}
async function normalizePhoto(base64) {
  if (typeof base64 !== 'string' || base64.length > 12 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('Choose a photo smaller than 9 MB.');
  const input = Buffer.from(base64, 'base64');
  // Decode and re-encode; never retain EXIF, location, original filenames or animated frames.
  return sharp(input, { limitInputPixels: 40000000, animated: false }).rotate().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}
async function initCheckinDb(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS progress_checkins (
    id UUID PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), day DATE NOT NULL,
    notes TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, day));
    CREATE TABLE IF NOT EXISTS progress_photos (
    id UUID PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), checkin_id UUID NOT NULL REFERENCES progress_checkins(id),
    view TEXT NOT NULL CHECK(view IN ('front','side','back')), object_key TEXT NOT NULL, ready BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(checkin_id, view));`);
}
function createCheckinService(pool, { bucket = process.env.PROGRESS_PHOTOS_BUCKET, s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-2' }), sign = getSignedUrl } = {}) {
  const configured = () => { if (!bucket) throw new Error('Progress photo storage is not configured yet.'); };
  async function lock(userId, action) {
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [`checkins:${userId}`]);
      return await action(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`checkins:${userId}`]); client.release();
    }
  }
  async function removePhotos(client, userId, checkinId) {
    const { rows } = await client.query('SELECT object_key FROM progress_photos WHERE user_id=$1' + (checkinId ? ' AND checkin_id=$2' : ''), checkinId ? [userId, checkinId] : [userId]);
    if (rows.length) configured();
    for (const row of rows) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.object_key }));
  }
  return {
    lock,
    removePhotos,
    async list(userId, timezone, offset = 0) {
      const { rows } = await pool.query(`SELECT c.id, c.day::text, c.notes,
        (SELECT AVG(w.daily_weight)::float FROM (SELECT AVG(weight) daily_weight FROM weight_entries
          WHERE user_id=c.user_id AND deleted_at IS NULL AND (logged_at AT TIME ZONE $2)::date BETWEEN c.day-6 AND c.day
          GROUP BY (logged_at AT TIME ZONE $2)::date) w) AS "averageWeight",
        (SELECT COUNT(DISTINCT (logged_at AT TIME ZONE $2)::date)::int FROM weight_entries WHERE user_id=c.user_id AND deleted_at IS NULL AND (logged_at AT TIME ZONE $2)::date BETWEEN c.day-6 AND c.day) AS "weightDays",
        (SELECT json_build_object('valueCm',value_cm,'method',method,'day',(logged_at AT TIME ZONE $2)::date::text) FROM waist_entries WHERE user_id=c.user_id AND deleted_at IS NULL AND (logged_at AT TIME ZONE $2)::date BETWEEN c.day-6 AND c.day ORDER BY logged_at DESC,id DESC LIMIT 1) AS waist,
        COALESCE((SELECT json_agg(json_build_object('id',p.id,'view',p.view)) FROM progress_photos p WHERE p.checkin_id=c.id AND p.ready), '[]') AS photos
        FROM progress_checkins c WHERE c.user_id=$1 ORDER BY c.day DESC LIMIT 21 OFFSET $3`, [userId, timezone, Math.max(0, Number(offset) || 0)]);
      return { entries: rows.slice(0, 20), hasMore: rows.length > 20, photosConfigured: Boolean(bucket) };
    },
    async save(userId, body) {
      const v = normalizeCheckin(body);
      return lock(userId, async client => {
        const result = body.id
          ? await client.query('UPDATE progress_checkins SET notes=$3,updated_at=NOW() WHERE user_id=$1 AND id=$2 AND day=$4 RETURNING id', [userId,body.id,v.notes,v.day])
          : await client.query('INSERT INTO progress_checkins(id,user_id,day,notes) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,day) DO NOTHING RETURNING id', [crypto.randomUUID(),userId,v.day,v.notes]);
        if (!result.rows.length) throw new Error(body.id ? 'Check-in not found.' : 'A check-in already exists for this date. Edit it instead.');
        return result.rows[0];
      });
    },
    async putPhoto(userId, id, view, base64) {
      configured();
      if (!VIEWS.includes(view)) throw new Error('Choose front, side or back.');
      const data = await normalizePhoto(base64);
      return lock(userId, async client => {
        const owned = await client.query('SELECT id FROM progress_checkins WHERE id=$1 AND user_id=$2', [id, userId]);
        if (!owned.rows.length) throw new Error('Check-in not found.');
        const old = (await client.query('SELECT * FROM progress_photos WHERE checkin_id=$1 AND view=$2', [id, view])).rows[0];
        // Reuse the same opaque key so retries cannot create untracked objects.
        const photoId = old?.id || crypto.randomUUID();
        const key = old?.object_key || `progress/${crypto.randomUUID()}/${photoId}.jpg`;
        if (!old) await client.query('INSERT INTO progress_photos(id,user_id,checkin_id,view,object_key) VALUES($1,$2,$3,$4,$5)', [photoId,userId,id,view,key]);
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: 'image/jpeg', ServerSideEncryption: 'AES256', CacheControl: 'private, no-store' }));
        await client.query('UPDATE progress_photos SET ready=TRUE WHERE id=$1', [photoId]);
        return { id: photoId };
      });
    },
    async photoURL(userId, photoId) {
      configured();
      const row = (await pool.query('SELECT object_key FROM progress_photos WHERE id=$1 AND user_id=$2 AND ready', [photoId, userId])).rows[0];
      if (!row) throw new Error('Photo not found.');
      return { url: await sign(s3, new GetObjectCommand({ Bucket: bucket, Key: row.object_key }), { expiresIn: 60 }) };
    },
    async deletePhoto(userId, photoId) {
      return lock(userId, async client => {
        const row = (await client.query('SELECT object_key FROM progress_photos WHERE id=$1 AND user_id=$2', [photoId,userId])).rows[0];
        if (!row) return;
        configured();
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.object_key }));
        await client.query('DELETE FROM progress_photos WHERE id=$1 AND user_id=$2', [photoId,userId]);
      });
    },
    async delete(userId, id) {
      return lock(userId, async client => {
        await removePhotos(client,userId,id);
        await client.query('DELETE FROM progress_photos WHERE user_id=$1 AND checkin_id=$2', [userId,id]);
        await client.query('DELETE FROM progress_checkins WHERE user_id=$1 AND id=$2', [userId,id]);
      });
    }
  };
}
module.exports = { normalizeCheckin, normalizePhoto, initCheckinDb, createCheckinService };
