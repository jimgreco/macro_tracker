// HealthKit transport evidence is deliberately separate from user annotations.
const GRACE_MS = 72 * 60 * 60 * 1000;
function metadata(value) {
  if (!value || typeof value !== 'object') throw new Error('HealthKit source evidence is required.');
  const sourceName = String(value.sourceName || '').trim();
  const sourceBundleId = String(value.sourceBundleId || '').trim();
  const end = new Date(value.endedAt);
  if (!sourceName || sourceName.length > 150 || !/^[\w.-]{1,200}$/.test(sourceBundleId) || !Number.isFinite(end.getTime())) {
    throw new Error('Invalid HealthKit source evidence.');
  }
  const result = { sourceName, sourceBundleId, endedAt: end.toISOString() };
  for (const key of ['awakeSeconds', 'lightSleepSeconds', 'deepSleepSeconds', 'remSleepSeconds']) {
    if (value[key] != null) {
      const number = Number(value[key]);
      if (!Number.isFinite(number) || number < 0 || number > 86400) throw new Error('Invalid HealthKit duration.');
      result[key] = number;
    }
  }
  return result;
}
// Use the name actually reported by HKSourceRevision, never a guessed bundle id.
function isOura(value) { return /^oura(?: ring)?$/i.test(value?.sourceName || ''); }
function matchingEvent(row, document, kind) {
  if (!isOura(row.healthkit_metadata)) return false;
  const data = document.normalized_data || document.data || {};
  const start = Date.parse(kind === 'sleep' ? data.bedtimeStart : data.startDateTime);
  const end = Date.parse(kind === 'sleep' ? data.bedtimeEnd : data.endDateTime);
  const localStart = new Date(row.logged_at).getTime();
  const localEnd = Date.parse(row.healthkit_metadata.endedAt);
  const seconds = kind === 'sleep' ? data.totalSleepSeconds : data.durationSeconds;
  return Number.isFinite(start) && Number.isFinite(end) &&
    Math.abs(start - localStart) <= (kind === 'sleep' ? 15 : 5) * 60000 &&
    Math.abs(end - localEnd) <= (kind === 'sleep' ? 15 : 5) * 60000 &&
    Number.isFinite(seconds) && Math.abs(seconds - Number(row.duration_hours) * 3600) <= Math.max(300, seconds * 0.1);
}
function fallbackAllowed(connection, coveredDay, eventDay, now = Date.now()) {
  if (coveredDay && eventDay <= coveredDay) return false;
  return !connection || ['disconnected', 'reauthorization_required', 'permissions_required'].includes(connection.status) ||
    Boolean(connection.last_synced_at && now - new Date(connection.last_synced_at).getTime() > GRACE_MS);
}
async function initHealthReconciliation(pool) {
  for (const table of ['sleep_entries', 'workout_entries']) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS healthkit_metadata JSONB,
      ADD COLUMN IF NOT EXISTS oura_document_id TEXT,
      ADD COLUMN IF NOT EXISTS provider_day DATE,
      ADD COLUMN IF NOT EXISTS oura_ignored BOOLEAN NOT NULL DEFAULT FALSE`);
  }
  await pool.query(`ALTER TABLE sleep_entries ADD COLUMN IF NOT EXISTS wake_ups_annotated BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE oura_documents ADD COLUMN IF NOT EXISTS annotations JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS ignored_at TIMESTAMPTZ`);
  // Minimal transport coverage survives disconnect to prevent historical reimport.
  await pool.query(`CREATE TABLE IF NOT EXISTS health_transport_coverage (
    user_id TEXT NOT NULL, data_type TEXT NOT NULL, covered_day DATE NOT NULL,
    ignored_ids TEXT[] NOT NULL DEFAULT '{}', PRIMARY KEY (user_id, data_type))`);
  await pool.query(`ALTER TABLE health_transport_coverage ADD COLUMN IF NOT EXISTS ignored_ids TEXT[] NOT NULL DEFAULT '{}'`);
}
async function lock(client, userId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`health-transports:${userId}`]);
}
async function mergeDocument(client, userId, kind, document) {
  const table = kind === 'sleep' ? 'sleep_entries' : 'workout_entries';
  if (document.day) await client.query(`INSERT INTO health_transport_coverage (user_id,data_type,covered_day)
    VALUES ($1,$2,$3) ON CONFLICT (user_id,data_type) DO UPDATE
    SET covered_day = GREATEST(health_transport_coverage.covered_day, EXCLUDED.covered_day)`, [userId,kind,document.day]);
  await client.query(`UPDATE oura_documents SET ignored_at = COALESCE(ignored_at, NOW())
    WHERE user_id = $1 AND data_type = $2 AND provider_document_id = $3
    AND EXISTS (SELECT 1 FROM health_transport_coverage WHERE user_id = $1 AND data_type = $2 AND $3 = ANY(ignored_ids))`,
    [userId, kind, document.provider_document_id]);
  const candidates = await client.query(`SELECT * FROM ${table} WHERE user_id = $1 AND source = 'healthkit'
    AND (oura_document_id = $2 OR (oura_document_id IS NULL AND healthkit_metadata IS NOT NULL)) FOR UPDATE`,
  [userId, document.provider_document_id]);
  for (const row of candidates.rows) {
    if (row.oura_document_id !== document.provider_document_id && !matchingEvent(row, document, kind)) continue;
    // A pre-existing user deletion suppresses both transports, including reconnects.
    const ignored = row.oura_ignored || (row.deleted_at && !row.oura_document_id);
    const annotations = kind === 'sleep' ? { quality: row.quality, notes: row.notes, wakeUps: row.wake_ups_annotated ? row.wake_ups : null } : {};
    await client.query(`UPDATE oura_documents SET annotations = $4::jsonb || annotations,
      ignored_at = CASE WHEN $5 THEN COALESCE(ignored_at, NOW()) ELSE ignored_at END
      WHERE user_id = $1 AND data_type = $2 AND provider_document_id = $3`,
    [userId, kind, document.provider_document_id, JSON.stringify(annotations), Boolean(ignored)]);
    await client.query(`UPDATE ${table} SET oura_document_id = $3, provider_day = $4, oura_ignored = oura_ignored OR $5,
      deleted_at = COALESCE(deleted_at, NOW()) WHERE user_id = $1 AND id = $2`,
    [userId, row.id, document.provider_document_id, document.day, Boolean(ignored)]);
  }
  if (kind === 'workout') await projectWorkout(client, userId, document);
}
async function projectWorkout(client, userId, document) {
  const current = await client.query(`SELECT * FROM oura_documents WHERE user_id = $1 AND data_type = 'workout'
    AND provider_document_id = $2`, [userId, document.provider_document_id]);
  const canonical = current.rows[0];
  if (!canonical) return;
  const existing = await client.query(`SELECT * FROM workout_entries WHERE user_id = $1 AND source = 'oura' AND external_id = $2 FOR UPDATE`, [userId, document.provider_document_id]);
  const row = existing.rows[0];
  if (canonical.deleted_at || canonical.ignored_at || row?.oura_ignored) {
    if (row) await client.query('UPDATE workout_entries SET deleted_at = COALESCE(deleted_at, NOW()) WHERE id = $1', [row.id]);
    return;
  }
  const data = canonical.normalized_data;
  if (!(data.durationSeconds > 0) || !Number.isFinite(Date.parse(data.startDateTime))) return;
  const description = String(data.label || data.activity || 'Oura workout').slice(0, 500);
  const intensity = ['low', 'medium', 'high'].includes(data.intensity) ? data.intensity : 'medium';
  const values = [userId, description, intensity, data.durationSeconds / 3600, Math.max(0, Number(data.calories) || 0), data.startDateTime, document.provider_document_id];
  if (row) {
    await client.query(`UPDATE workout_entries SET description = $2,intensity = $3,duration_hours = $4,
      calories_burned = $5,logged_at = $6,deleted_at = NULL WHERE user_id = $1 AND source = 'oura' AND external_id = $7`, values);
  } else {
    await client.query(`INSERT INTO workout_entries(user_id,description,intensity,duration_hours,calories_burned,logged_at,source,external_id)
      VALUES($1,$2,$3,$4,$5,$6,'oura',$7)`, values);
  }
}
async function importHealthKit(pool, userId, kind, payload) {
  const evidence = metadata(payload.healthkitMetadata);
  const start = new Date(payload.loggedAt);
  const duration = Number(payload.durationHours);
  const externalId = String(payload.externalId || '').trim();
  if (!Number.isFinite(start.getTime()) || new Date(evidence.endedAt) <= start || !externalId || externalId.length > 255 ||
      !Number.isFinite(duration) || duration <= 0 || duration > 24) throw new Error('Invalid HealthKit session.');
  const table = kind === 'sleep' ? 'sleep_entries' : 'workout_entries';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lock(client, userId);
    // Source equality is required for interval revisions. Legacy rows can acquire
    // observed evidence only at a close start/duration match; never arbitrary overlap.
    const matches = await client.query(`SELECT * FROM ${table} WHERE user_id = $1 AND source = 'healthkit' AND
      (external_id = $2 OR ((healthkit_metadata->>'sourceBundleId' = $3 OR healthkit_metadata IS NULL)
       AND ABS(EXTRACT(EPOCH FROM (logged_at - $4::timestamptz))) <= 300
       AND ABS(duration_hours - $5) <= 0.25)) ORDER BY deleted_at NULLS LAST, id FOR UPDATE`,
    [userId, externalId, evidence.sourceBundleId, start, duration]);
    const prior = matches.rows.find(row => row.external_id === externalId) ||
      matches.rows.find(row => !row.deleted_at) || matches.rows[0];
    if (prior?.deleted_at) {
      // Attach the evidence even to legacy tombstones so a later direct backfill
      // can carry the deletion to its provider record.
      await client.query(`UPDATE ${table} SET healthkit_metadata = $3::jsonb WHERE user_id = $1 AND id = $2`,
        [userId, prior.id, JSON.stringify(evidence)]);
    } else if (prior) {
      await client.query(`UPDATE ${table} SET duration_hours = $3, logged_at = $4, external_id = $5,
        healthkit_metadata = $6::jsonb${kind === 'sleep' ? ', wake_ups = CASE WHEN wake_ups_annotated THEN wake_ups ELSE 0 END' : ''} WHERE user_id = $1 AND id = $2`,
      [userId, prior.id, duration, start, externalId, JSON.stringify(evidence)]);
    }
    const row = { ...prior, logged_at: start, duration_hours: duration, healthkit_metadata: evidence };
    let direct;
    let allowed = true;
    if (isOura(evidence)) {
      const docs = await client.query(`SELECT * FROM oura_documents WHERE user_id = $1 AND data_type = $2`, [userId, kind]);
      direct = docs.rows.find(document => matchingEvent(row, document, kind));
      const coverage = await client.query(`SELECT covered_day::text AS day FROM health_transport_coverage WHERE user_id = $1 AND data_type = $2`, [userId, kind]);
      const connection = await client.query('SELECT status, last_synced_at FROM oura_connections WHERE user_id = $1', [userId]);
      // The last covered provider day remains in transport tombstones after disconnect.
      const coveredDay = [...docs.rows.map(doc => doc.day ? new Date(doc.day).toISOString().slice(0, 10) : null), coverage.rows[0]?.day].filter(Boolean).sort().at(-1);
      const user = await client.query('SELECT timezone FROM users WHERE id = $1', [userId]);
      const eventDay = new Intl.DateTimeFormat('en-CA', { timeZone: user.rows[0]?.timezone || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(evidence.endedAt));
      allowed = fallbackAllowed(connection.rows[0], coveredDay, eventDay);
    }
    let id = prior?.id;
    if (!prior && (direct || allowed)) {
      const result = kind === 'sleep'
        ? await client.query(`INSERT INTO sleep_entries (user_id, duration_hours, wake_ups, logged_at, source, external_id, healthkit_metadata)
          VALUES ($1,$2,0,$3,'healthkit',$4,$5::jsonb) RETURNING id`, [userId,duration,start,externalId,JSON.stringify(evidence)])
        : await client.query(`INSERT INTO workout_entries (user_id,description,intensity,duration_hours,calories_burned,logged_at,source,external_id,healthkit_metadata)
          VALUES ($1,$2,$3,$4,$5,$6,'healthkit',$7,$8::jsonb) RETURNING id`,
        [userId,String(payload.description || 'Workout').slice(0,500),payload.intensity || 'medium',duration,Math.max(0,Number(payload.caloriesBurned)||0),start,externalId,JSON.stringify(evidence)]);
      id = result.rows[0].id;
    }
    if (direct) await mergeDocument(client, userId, kind, direct);
    await client.query('COMMIT');
    return { id: id ? Number(id) : null, created: !prior && allowed && !direct, updated: Boolean(prior && !prior.deleted_at), skipped: Boolean(direct || !allowed || prior?.deleted_at) };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
module.exports = { GRACE_MS, metadata, isOura, matchingEvent, fallbackAllowed, initHealthReconciliation, lock, mergeDocument, importHealthKit };
