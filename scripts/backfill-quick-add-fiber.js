// Apply a reviewed, account-scoped JSON plan. Dry run unless --apply is supplied.
// Uses only saved_items; historical entries and other nutrients are never rewritten.
const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { fiberValue, fiberSummary, scaleFiber } = require('../src/fiber');
const fields = ['id', 'name', 'quantity', 'unit', 'calories', 'protein', 'carbs', 'fat', 'components', 'source', 'sourceDetail'];
function snapshot(row) {
  return Object.fromEntries(fields.map(key => [key, row[key] ?? (key === 'components' ? [] : null)]));
}
async function applyPlan(client, plan, apply = false) {
  if (plan.version !== 1 || !plan.userId || !Array.isArray(plan.items) || !plan.items.length) throw new Error('Invalid plan');
  if (new Set(plan.items.map(x => x.before.id)).size !== plan.items.length) throw new Error('Duplicate item IDs');
  let updated = 0, unchanged = 0;
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    for (const item of [...plan.items].sort((a,b)=>a.before.id-b.before.id)) {
      const result = await client.query(`SELECT id::int, name, quantity, unit, calories, protein, carbs, fat,
        COALESCE(components, '[]'::jsonb) AS components, source, source_detail AS "sourceDetail", fiber
        FROM saved_items WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`, [plan.userId,item.before.id]);
      const current = result.rows[0];
      if (!current) throw new Error('Item missing or not owned by this account');
      const fiber = fiberValue(item.fiber);
      if (fiber == null || !item.basis) throw new Error('Each backfill requires a value and recorded basis');
      const components = item.components || [];
      if (components.length !== (item.before.components || []).length) throw new Error('Component count changed');
      const withoutFiber = components.map(({fiber, ...component}) => component);
      if (!isDeepStrictEqual(withoutFiber, item.before.components || [])) throw new Error('Only component fiber may change');
      if (components.length && scaleFiber(fiberSummary(components).fiber, item.before.quantity) !== fiber) throw new Error('Component fiber total mismatch');
      const sourceDetail = [item.before.sourceDetail, `fiber_estimate:${plan.date}`].filter(Boolean).join(' | ');
      if (sourceDetail.length > 255) throw new Error('Source detail too long');
      const expectedAfter = {...snapshot(item.before), components, sourceDetail};
      if (current.fiber === fiber && isDeepStrictEqual(snapshot(current), expectedAfter)) { unchanged++; continue; }
      if (current.fiber != null || !isDeepStrictEqual(snapshot(current),snapshot(item.before))) throw new Error('Saved item changed since plan; refresh review before writing');
      await client.query('UPDATE saved_items SET fiber=$1, components=$2::jsonb, source_detail=$3 WHERE user_id=$4 AND id=$5 AND deleted_at IS NULL',
        [fiber, components.length ? JSON.stringify(components) : null, sourceDetail, plan.userId, current.id]);
      updated++;
    }
    if (plan.target) {
      if (plan.target.macro !== 'fiber' || plan.target.value !== 30 || !/^\d{4}-\d{2}-\d{2}$/.test(plan.target.effectiveDate)) throw new Error('Invalid fiber target');
      const targets = await client.query("SELECT target FROM macro_targets WHERE user_id=$1 AND macro='fiber' AND effective_date=$2::date FOR UPDATE", [plan.userId, plan.target.effectiveDate]);
      if (targets.rows.length && Number(targets.rows[0].target) !== 30) throw new Error('Fiber target changed; review before overwriting');
      await client.query("INSERT INTO macro_targets (user_id, macro, target, effective_date, updated_at) VALUES ($1, 'fiber', 30, $2::date, NOW()) ON CONFLICT DO NOTHING", [plan.userId, plan.target.effectiveDate]);
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return { applied: apply, updated, unchanged };
  } catch(error) { await client.query('ROLLBACK'); throw error; }
}
async function main() {
 const args=process.argv.slice(2), path=args.find(arg=>arg!=='--apply');
 if (!path || args.some(arg=>arg!==path && arg!=='--apply') || !process.env.FIBER_BACKFILL_DATABASE_URL) throw new Error('Usage: FIBER_BACKFILL_DATABASE_URL=... node scripts/backfill-quick-add-fiber.js reviewed-plan.json [--apply]');
 const plan=JSON.parse(fs.readFileSync(path,'utf8'));
 const pool=new (require('pg').Pool)({connectionString:process.env.FIBER_BACKFILL_DATABASE_URL});
 const client=await pool.connect();
 try { console.log(JSON.stringify(await applyPlan(client,plan,args.includes('--apply')))); }
 finally { client.release();await pool.end(); }
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1});
module.exports={applyPlan,snapshot};
