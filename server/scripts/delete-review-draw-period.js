/**
 * Delete a monthly review draw by period_key (winners cascade via explicit delete).
 *
 * Usage:
 *   node server/scripts/delete-review-draw-period.js 2026-05
 *   node server/scripts/delete-review-draw-period.js 2026-05 --dry-run
 */
import { initDb, db } from '../db.js';

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const periodKey = process.argv[2];
if (!periodKey || periodKey.startsWith('--')) {
  console.error('Usage: node server/scripts/delete-review-draw-period.js <period_key> [--dry-run]');
  process.exit(1);
}

const dryRun = hasFlag('dry-run');
initDb();

const draws = db.prepare(
  'SELECT id, period_key, drawn_at, status FROM review_monthly_draws WHERE period_key = ?',
).all(periodKey);

if (!draws.length) {
  console.log(`[delete-review-draw-period] Нет розыгрыша за ${periodKey}`);
  process.exit(0);
}

const winnerCount = db.prepare(`
  SELECT COUNT(*) AS n
  FROM review_monthly_draw_winners
  WHERE draw_id IN (SELECT id FROM review_monthly_draws WHERE period_key = ?)
`).get(periodKey).n;

console.log('[delete-review-draw-period] Найдено:');
console.log(JSON.stringify({ periodKey, draws, winnerCount }, null, 2));

if (dryRun) {
  console.log('[dry-run] Изменения не применены.');
  process.exit(0);
}

const result = db.transaction(() => {
  const winners = db.prepare(`
    DELETE FROM review_monthly_draw_winners
    WHERE draw_id IN (SELECT id FROM review_monthly_draws WHERE period_key = ?)
  `).run(periodKey).changes;
  const drawsDeleted = db.prepare(
    'DELETE FROM review_monthly_draws WHERE period_key = ?',
  ).run(periodKey).changes;
  return { winners, drawsDeleted };
})();

console.log('[delete-review-draw-period] Удалено:');
console.log(JSON.stringify(result, null, 2));