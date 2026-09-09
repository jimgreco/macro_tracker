// Deterministic presentation only. This contract must never be used as AI input.
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const round = value => value == null ? null : Math.round(value * 10) / 10;
const metrics = [
  ['totalSleepSeconds', 'Asleep', 'h', 3600], ['timeInBedSeconds', 'Time in bed', 'h', 3600],
  ['lightSleepSeconds', 'Light / core sleep', 'h', 3600], ['deepSleepSeconds', 'Deep sleep', 'h', 3600],
  ['remSleepSeconds', 'REM sleep', 'h', 3600], ['awakeSeconds', 'Awake duration', 'min', 60],
  ['efficiency', 'Efficiency', '%', 1], ['latencySeconds', 'Sleep latency', 'min', 60],
  ['averageHrv', 'Average HRV', 'ms', 1], ['averageHeartRate', 'Average sleeping heart rate', 'bpm', 1],
  ['lowestHeartRate', 'Lowest sleeping heart rate', 'bpm', 1], ['averageBreath', 'Respiratory rate', '/min', 1],
  ['restlessPeriods', 'Restless periods', '', 1]
];
function buildRecovery({ documents = [], status = {}, targetHours = 8, timezone = 'America/New_York', days = 7, now = new Date(), appEntries = [] }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const startDay = new Date(Date.parse(`${today}T12:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
  const daily = (type, day) => documents.find(doc => doc.dataType === type && doc.day === day)?.data || {};
  const sessions = documents.filter(doc => doc.dataType === 'sleep' && doc.day >= startDay && doc.day <= today)
    .filter(doc => number(doc.data.totalSleepSeconds) > 0 && Number.isFinite(Date.parse(doc.data.bedtimeStart)))
    .map(doc => {
      const data = doc.data;
      const score = number(daily('daily_sleep', doc.day).score);
      const readiness = number(daily('daily_readiness', doc.day).score);
      const fields = metrics.flatMap(([key, label, unit, divisor]) => number(data[key]) == null ? [] :
        [{ id: key, label, value: round(data[key] / divisor), unit }]);
      for (const [prefix, record] of [['Sleep', daily('daily_sleep', doc.day)], ['Readiness', daily('daily_readiness', doc.day)]]) {
        for (const [key, value] of Object.entries(record.contributors || {})) {
          if (number(value) != null) fields.push({ id: `${prefix}-${key}`, label: `${prefix}: ${key.replaceAll('_', ' ')}`, value, unit: '' });
        }
      }
      return { id: doc.providerDocumentId, day: doc.day, startedAt: data.bedtimeStart, endedAt: data.bedtimeEnd || null,
        type: data.type || 'sleep', durationHours: round(data.totalSleepSeconds / 3600), score, readiness,
        hrv: number(data.averageHrv), heartRate: number(data.averageHeartRate), source: 'Oura Cloud',
        syncedAt: doc.syncedAt, fields, annotations: doc.annotations || {} };
    }).sort((a,b) => b.day.localeCompare(a.day) || b.startedAt.localeCompare(a.startedAt));
  // One primary sleep per provider day supplies trend physiology; naps add to duration only.
  const primary = [...new Set(sessions.map(session => session.day))].map(day =>
    sessions.filter(session => session.day === day && !['rest', 'nap', 'late_nap'].includes(session.type))
      .sort((a,b) => b.durationHours - a.durationHours)[0]).filter(Boolean);
  const trend = (id, label, unit, valueFor) => {
    const values = primary.map(valueFor).filter(value => value != null);
    const recent = primary.slice(0, 3).map(valueFor).filter(value => value != null);
    const previous = primary.slice(3, 6).map(valueFor).filter(value => value != null);
    const delta = recent.length === 3 && previous.length === 3 ? round(mean(recent) - mean(previous)) : null;
    return { id, label, unit, value: round(mean(values)), count: values.length,
      direction: delta == null ? 'Not enough nights for direction' : delta === 0 ? 'Stable' : delta > 0 ? 'Higher' : 'Lower', delta };
  };
  const trends = [trend('duration', 'Average primary sleep', 'h', row => row.durationHours),
    trend('score', 'Sleep score', '', row => row.score), trend('readiness', 'Readiness', '', row => row.readiness),
    trend('hrv', 'Average HRV', 'ms', row => row.hrv), trend('heartRate', 'Sleeping heart rate', 'bpm', row => row.heartRate)];
  const bedtimeMinutes = primary.map(row => {
    // Preserve the provider timestamp offset across travel; midnight is circular.
    const match = /T(\d{2}):(\d{2})/.exec(row.startedAt);
    if (!match) return null;
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    return minutes < 720 ? minutes + 1440 : minutes;
  }).filter(value => value != null);
  const averageBedtime = mean(bedtimeMinutes);
  trends.push({ id: 'timing', label: 'Bedtime variability', unit: 'min', count: bedtimeMinutes.length,
    value: bedtimeMinutes.length >= 3 ? round(mean(bedtimeMinutes.map(value => Math.abs(value - averageBedtime)))) : null,
    direction: 'Average distance from your usual local bedtime', delta: null });
  const accepted = sessions.map(row => ({ start: Date.parse(row.startedAt), end: Date.parse(row.endedAt) || Date.parse(row.startedAt) + row.durationHours * 3600000, day: row.day, hours: row.durationHours }));
  for (const entry of appEntries) {
    const start = Date.parse(entry.loggedAt), hours = Number(entry.durationHours);
    const end = Date.parse(entry.healthkitMetadata?.endedAt) || start + hours * 3600000;
    if (!Number.isFinite(start) || !Number.isFinite(hours) || accepted.some(row => row.start < end && row.end > start)) continue;
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(start));
    if (day >= startDay && day <= today) accepted.push({ start, end, day, hours });
  }
  const totals = new Map();
  for (const row of accepted) totals.set(row.day, (totals.get(row.day) || 0) + row.hours);
  const latest = primary[0] || sessions[0] || null;
  const lastSync = status.lastSyncedAt || null;
  return { source: 'Oura Cloud', timezone, days, targetHours, allowsAINarration: false,
    connectionState: status.state || 'disconnected', lastSyncedAt: lastSync,
    freshness: !lastSync ? 'Not synced' : now.getTime() - Date.parse(lastSync) > 72 * 3600000 ? 'Stale — sync your ring' : 'Synced to Oura Cloud',
    latest, sessions, trends,
    bedtimeGuidance: latest ? daily('sleep_time', latest.day).recommendation || null : null,
    dailyTotals: [...totals].sort(([a],[b]) => a.localeCompare(b)).map(([day,totalHours]) => ({ day, totalHours: round(totalHours), targetHours })) };
}
module.exports = { buildRecovery };
