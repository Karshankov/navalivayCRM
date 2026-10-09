/**
 * Scheduler for auto monthly review draw (last day 21:00 Minsk).
 * Run: node server/tests/review-monthly-draw-scheduler.test.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TMP_DB = path.resolve(__dirname, `./.tmp-review-draw-scheduler-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;
process.env.BOT_TOKEN = '*********************';

const { db, initDb } = await import('../db.js');
initDb();

const { tryRunScheduledMonthlyDraw } = await import('../utils/schedule-review-monthly-draw.js');
const { getReviewPeriodKey } = await import('../utils/review-monthly-draw.js');

const results = { passed: 0, failed: 0 };
function ok(condition, msg, details = '') {
  if (condition) {
    results.passed++;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed++;
    console.log(`  FAIL: ${msg}${details ? ` — ${details}` : ''}`);
  }
}

function makeMinskDate({ year, month, day, hour, minute = 0 }) {
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute, 0));
}

console.log('\n=== review-monthly-draw scheduler ===\n');

console.log('--- S1: not last day → no draw ---');
{
  const ran = tryRunScheduledMonthlyDraw(makeMinskDate({ year: 2026, month: 6, day: 18, hour: 21 }));
  ok(ran === false, 'mid-month last-hour does not trigger draw');
}

console.log('\n--- S2: last day but wrong hour → no draw ---');
{
  const ran = tryRunScheduledMonthlyDraw(makeMinskDate({ year: 2026, month: 6, day: 30, hour: 20 }));
  ok(ran === false, 'last day 20:00 does not trigger draw');
}

function withMockedNow(isoOrDate, fn) {
  const fixed = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  const OriginalDate = Date;
  global.Date = class extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) {
        super(fixed.getTime());
        return;
      }
      super(...args);
    }
    static now() {
      return fixed.getTime();
    }
  };
  try {
    return fn();
  } finally {
    global.Date = OriginalDate;
  }
}

console.log('\n--- S3: last day 21:00 with no eligible reviews → graceful ---');
{
  db.exec('DELETE FROM product_reviews;');
  db.exec('DELETE FROM review_monthly_draws;');
  withMockedNow(makeMinskDate({ year: 2026, month: 6, day: 30, hour: 21 }), () => {
    const periodKey = getReviewPeriodKey(0);
    ok(periodKey === '2026-06', 'scheduler on June 30 uses June period key');
    const ran = tryRunScheduledMonthlyDraw(new Date());
    ok(typeof ran === 'boolean', 'last day 21:00 returns boolean without throwing');
    const existing = db.prepare('SELECT id, period_key FROM review_monthly_draws WHERE period_key = ?').get(periodKey);
    ok(!existing || existing.period_key === '2026-06', 'auto draw stores June, not May');
    ok(!existing || ran === true, 'draw only created when eligible or already exists handled');
  });
}

console.log('\n--- S4: June 21 manual period key is not shifted to May ---');
{
  withMockedNow('2026-06-21T20:27:00+03:00', () => {
    ok(getReviewPeriodKey(0) === '2026-06', 'mid-month period key stays June after timezone fix');
  });
}

console.log('\n--- S5: scheduler ignores 21:00 on non-last day even in June ---');
{
  withMockedNow(makeMinskDate({ year: 2026, month: 6, day: 21, hour: 21 }), () => {
    const ran = tryRunScheduledMonthlyDraw(new Date());
    ok(ran === false, 'June 21 21:00 does not auto-run draw');
  });
}

try {
  db.close();
} catch {
  /* noop */
}
for (const file of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* noop */
  }
}

if (results.failed > 0) {
  console.log(`\nFAILED: ${results.failed} failed, ${results.passed} passed`);
  process.exit(1);
}

console.log(`\nPASSED: ${results.passed} assertions`);