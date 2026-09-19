const METHODS = new Set(['navel_relaxed', 'midpoint_relaxed']);

function normalizeWaist(payload = {}) {
  const { unit, method, readings, loggedAt } = payload;
  if (!['in', 'cm'].includes(unit)) throw new Error('Choose inches or centimeters.');
  if (!METHODS.has(method)) throw new Error('Choose a measurement method.');
  if (!Array.isArray(readings) || readings.length < 1 || readings.length > 2
      || readings.some(v => typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v * (unit === 'in' ? 2.54 : 1) > 400)) {
    throw new Error('Enter one or two positive waist readings (up to 400 cm).');
  }
  if (typeof loggedAt !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(loggedAt) || !Number.isFinite(Date.parse(loggedAt))) {
    throw new Error('Enter a valid measurement date and time with timezone.');
  }
  if (payload.notes != null && (typeof payload.notes !== 'string' || payload.notes.length > 300)) {
    throw new Error('Notes must be 300 characters or fewer.');
  }
  return { unit, method, readings, loggedAt, notes: (payload.notes || '').trim(),
    valueCm: readings.reduce((a, b) => a + b, 0) / readings.length * (unit === 'in' ? 2.54 : 1) };
}

async function initWaistDb(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS waist_entries (
    id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
    readings JSONB NOT NULL, unit TEXT NOT NULL CHECK (unit IN ('in','cm')),
    method TEXT NOT NULL CHECK (method IN ('navel_relaxed','midpoint_relaxed')),
    value_cm NUMERIC NOT NULL CHECK (value_cm > 0 AND value_cm <= 400),
    notes TEXT NOT NULL DEFAULT '', logged_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS idx_waist_user_logged ON waist_entries(user_id, logged_at DESC, id DESC);`);
}

function createWaistStore(pool) {
  return {
    async saveWaistEntry(userId, payload, id = null) {
      const v = normalizeWaist(payload);
      const values = [userId, JSON.stringify(v.readings), v.unit, v.method, v.valueCm, v.notes, v.loggedAt];
      const result = id == null
        ? await pool.query(`INSERT INTO waist_entries(user_id, readings, unit, method, value_cm, notes, logged_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, values)
        : await pool.query(`UPDATE waist_entries SET readings=$2, unit=$3, method=$4, value_cm=$5, notes=$6,
            logged_at=$7, updated_at=NOW() WHERE user_id=$1 AND id=$8 AND deleted_at IS NULL RETURNING id`, [...values, id]);
      return result.rows.length ? { id: Number(result.rows[0].id) } : null;
    },
    async deleteWaistEntry(userId, id) {
      const result = await pool.query('UPDATE waist_entries SET deleted_at=NOW(), updated_at=NOW() WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL', [userId, id]);
      return result.rowCount;
    },
    async listWaistEntries(userId, { timezone = 'America/New_York', offset = 0, unlinked = false } = {}) {
      const skip = (Number.isFinite(Number(offset)) ? Math.max(0, Math.floor(Number(offset))) : 0);
      const result = await pool.query(`SELECT id, readings, unit, method, value_cm AS "valueCm", notes,
        logged_at AS "loggedAt", (logged_at AT TIME ZONE $2)::date::text AS day
        FROM waist_entries WHERE user_id=$1 AND deleted_at IS NULL
        ${unlinked ? 'AND NOT EXISTS (SELECT 1 FROM progress_checkins c WHERE c.user_id=waist_entries.user_id AND c.waist_entry_id=waist_entries.id)' : ''}
        ORDER BY logged_at DESC, id DESC LIMIT 51 OFFSET $3`, [userId, timezone, skip]);
      return { entries: result.rows.slice(0, 50).map(r => ({ ...r, id: Number(r.id), valueCm: Number(r.valueCm) })), hasMore: result.rows.length > 50 };
    }
  };
}
module.exports = { normalizeWaist, initWaistDb, createWaistStore };
