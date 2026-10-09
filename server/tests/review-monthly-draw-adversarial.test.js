/**
 * Monthly review draw — adversarial tests (fraud / edge cases).
 * Run: node server/tests/review-monthly-draw-adversarial.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-review-draw-adv-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'test';

const { initDb, db } = await import('../db.js');
const {
  listEligibleDrawEntries,
  pickWeightedWinners,
  runMonthlyReviewDraw,
  rerollDrawSeat,
  getReviewPeriodKey,
  resolveDrawPeriodBounds,
} = await import('../utils/review-monthly-draw.js');
const { getTimeZoneDateParts } = await import('../utils/business-time.js');

initDb();

const results = { passed: 0, failed: 0 };
function ok(cond, msg) {
  if (cond) {
    results.passed++;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

function expectThrows(fn, code, msg) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  ok(thrown?.code === code, `${msg} — got ${thrown?.code || 'none'}`);
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

function seedReviews({ reviewCountByCustomer = { cust1: 1 }, optOutCustomers = [] } = {}) {
  db.exec('DELETE FROM review_monthly_draw_winners;');
  db.exec('DELETE FROM review_monthly_draws;');
  db.exec('DELETE FROM product_reviews;');
  db.exec('DELETE FROM order_items;');
  db.exec('DELETE FROM orders;');
  db.exec('DELETE FROM products;');
  db.exec('DELETE FROM category_groups;');
  db.exec('DELETE FROM categories;');
  db.exec('DELETE FROM customers;');

  db.prepare(
    `INSERT INTO categories (id, slug, name, [order], hide_empty)
     VALUES ('cat1', 'cat1', 'Cat', 1, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp1', 'cat1', 'grp1', 'G', 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, createdAt)
     VALUES ('prod1', 'cat1', 'grp1', 'Item', 10, '', 5, DATETIME('now'))`,
  ).run();

  let orderNum = 1000;
  let customerIdx = 0;
  for (const [customerId, count] of Object.entries(reviewCountByCustomer)) {
    customerIdx += 1;
    const optOut = optOutCustomers.includes(customerId) ? 1 : 0;
    const telegramId = String(9_000_000 + customerIdx);
    db.prepare(
      `INSERT INTO customers (id, telegram_id, telegram_username, first_name, reviews_opt_out, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, DATETIME('now'), DATETIME('now'))`,
    ).run(customerId, telegramId, customerId, customerId, optOut);

    for (let i = 0; i < count; i += 1) {
      orderNum += 1;
      const orderId = `ord_${customerId}_${i}`;
      db.prepare(
        `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'delivered', 10, 10, DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
      ).run(orderId, orderNum, customerId);
      db.prepare(
        `INSERT INTO product_reviews (
          id, customer_id, order_id, group_id, rating, body_text, quick_tag_ids,
          status, created_at, updated_at, approved_at
        ) VALUES (?, ?, ?, 'grp1', 5, 'Длинный одобренный отзыв для розыгрыша', '[]', 'approved', DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
      ).run(`rev_${customerId}_${i}`, customerId, orderId);
    }
  }
}

console.log('\n=== review-monthly-draw adversarial ===\n');

console.log('--- A1: opt-out customer excluded from pool ---');
{
  seedReviews({
    reviewCountByCustomer: { cust1: 3, cust2: 1 },
    optOutCustomers: ['cust1'],
  });
  const tickets = listEligibleDrawEntries(getReviewPeriodKey(0));
  ok(tickets.every((t) => t.customer_id !== 'cust1'), 'opt-out excluded');
  ok(tickets.length === 1, 'only cust2 ticket');
}

console.log('--- A2: one customer cannot win two seats ---');
{
  seedReviews({ reviewCountByCustomer: { whale: 10, small: 1 } });
  const tickets = listEligibleDrawEntries(getReviewPeriodKey(0));
  const winners = pickWeightedWinners(tickets, 5, () => 0);
  const unique = new Set(winners.map((w) => w.customer_id));
  ok(winners.length === unique.size, 'unique winners');
  ok(winners.length === 2, 'both customers max once each');
}

console.log('--- A3: duplicate draw blocked ---');
{
  seedReviews({ reviewCountByCustomer: { cust1: 1 } });
  const periodKey = getReviewPeriodKey(0);
  runMonthlyReviewDraw({ periodKey, seatCount: 1, rng: () => 0 });
  expectThrows(
    () => runMonthlyReviewDraw({ periodKey, seatCount: 1, rng: () => 0 }),
    'draw_already_exists',
    'duplicate draw rejected',
  );
}

console.log('--- A4: reroll invalid seat ---');
{
  seedReviews({ reviewCountByCustomer: { cust1: 1, cust2: 1 } });
  const draw = runMonthlyReviewDraw({ periodKey: `adv-${Date.now()}`, seatCount: 1, rng: () => 0 });
  expectThrows(
    () => rerollDrawSeat(draw.id, 99, { rng: () => 0 }),
    'seat_not_found',
    'invalid seat rejected',
  );
}

console.log('--- A5: empty pool draw yields zero winners ---');
{
  seedReviews({ reviewCountByCustomer: {} });
  const draw = runMonthlyReviewDraw({ periodKey: `empty-${Date.now()}`, seatCount: 5, rng: () => 0 });
  ok(draw.winners.length === 0, 'no winners when pool empty');
}

console.log('--- R1: more reviews increases ticket weight not seat count ---');
{
  seedReviews({ reviewCountByCustomer: { cust1: 5, cust2: 1 } });
  const tickets = listEligibleDrawEntries(getReviewPeriodKey(0));
  ok(tickets.filter((t) => t.customer_id === 'cust1').length === 5, 'cust1 has 5 tickets');
  const draw = runMonthlyReviewDraw({ periodKey: `weight-${Date.now()}`, seatCount: 2, rng: () => 0 });
  const cust1Wins = draw.winners.filter((w) => w.customer_id === 'cust1').length;
  ok(cust1Wins <= 1, 'cust1 wins at most one seat');
}

console.log('--- A6: June 21 evening maps to 2026-06, not UTC May ---');
{
  const juneEvening = '2026-06-21T20:27:00+03:00';
  withMockedNow(juneEvening, () => {
    const parts = getTimeZoneDateParts(new Date());
    ok(parts.month === 6 && parts.year === 2026, 'fixture is June in Minsk');
    ok(getReviewPeriodKey(0) === '2026-06', 'manual launch on June 21 uses June period');
  });
}

console.log('--- A7: June 1 midnight Minsk still maps to June ---');
{
  withMockedNow('2026-06-01T00:30:00+03:00', () => {
    ok(getReviewPeriodKey(0) === '2026-06', 'month start edge uses Minsk calendar month');
  });
}

console.log('--- A8: January and year rollover stay correct ---');
{
  withMockedNow('2026-01-15T12:00:00+03:00', () => {
    ok(getReviewPeriodKey(0) === '2026-01', 'January period key');
  });
  withMockedNow('2025-12-31T23:30:00+03:00', () => {
    ok(getReviewPeriodKey(0) === '2025-12', 'last minutes of December stay December');
  });
}

console.log('--- A9: mid-month manual run stores current month, not previous ---');
{
  seedReviews({ reviewCountByCustomer: { cust1: 1 } });
  // Сценарий исторический: не оставляем дату отзыва зависимой от реального
  // месяца, в котором запущен тест.
  db.prepare(`
    UPDATE product_reviews
    SET created_at = '2026-06-15T10:00:00.000Z',
        updated_at = '2026-06-15T10:00:00.000Z',
        approved_at = '2026-06-15T10:00:00.000Z'
  `).run();
  withMockedNow('2026-06-21T20:27:00+03:00', () => {
    const periodKey = getReviewPeriodKey(0);
    const draw = runMonthlyReviewDraw({ periodKey, seatCount: 1, rng: () => 0 });
    ok(draw.period_key === '2026-06', 'draw row stores June, not May');
    ok(draw.winners.length === 1, 'June draw still picks winners');
  });
}

console.log('--- A10: current-month pool excludes previous-month approved reviews ---');
{
  seedReviews({ reviewCountByCustomer: {} });
  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, first_name, reviews_opt_out, created_at, updated_at)
     VALUES ('may_only', '9001', 'may_only', 'May', 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, completed_at, created_at, updated_at)
     VALUES ('ord_may', 5001, 'may_only', 'delivered', 10, 10, DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO product_reviews (
      id, customer_id, order_id, group_id, rating, body_text, quick_tag_ids,
      status, created_at, updated_at, approved_at
    ) VALUES ('rev_may', 'may_only', 'ord_may', 'grp1', 5, 'Майский одобренный отзыв для границы', '[]', 'approved', '2026-05-20T10:00:00.000Z', '2026-05-20T10:00:00.000Z', '2026-05-20T10:00:00.000Z')`,
  ).run();

  withMockedNow('2026-06-21T20:27:00+03:00', () => {
    const tickets = listEligibleDrawEntries(getReviewPeriodKey(0));
    ok(tickets.length === 0, 'May-approved review excluded from June pool');
    const bounds = resolveDrawPeriodBounds('2026-06');
    ok(bounds.startIso < bounds.endIso, 'June bounds are ordered');
  });
}

console.log('--- A11: pending and rejected reviews never enter draw pool ---');
{
  seedReviews({ reviewCountByCustomer: {} });
  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, first_name, reviews_opt_out, created_at, updated_at)
     VALUES ('mixed', '9002', 'mixed', 'Mixed', 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, completed_at, created_at, updated_at)
     VALUES ('ord_mix', 5002, 'mixed', 'delivered', 10, 10, DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
  ).run();
  const nowIso = '2026-06-15T10:00:00.000Z';
  db.prepare(
    `INSERT INTO product_reviews (
      id, customer_id, order_id, group_id, rating, body_text, quick_tag_ids,
      status, created_at, updated_at, approved_at
    ) VALUES ('rev_pending', 'mixed', 'ord_mix', 'grp1', 5, 'Отзыв на модерации не должен участвовать', '[]', 'pending', ?, ?, NULL)`,
  ).run(nowIso, nowIso);
  db.prepare(
    `INSERT INTO product_reviews (
      id, customer_id, order_id, group_id, rating, body_text, quick_tag_ids,
      status, created_at, updated_at, approved_at
    ) VALUES ('rev_rejected', 'mixed', 'ord_mix', 'grp1', 2, 'Отклонённый отзыв не должен участвовать', '[]', 'rejected', ?, ?, NULL)`,
  ).run(nowIso, nowIso);

  withMockedNow('2026-06-21T20:27:00+03:00', () => {
    const tickets = listEligibleDrawEntries(getReviewPeriodKey(0));
    ok(tickets.length === 0, 'pending/rejected reviews excluded from draw');
  });
}

console.log('--- A12: historical May draw can still be resolved explicitly ---');
{
  seedReviews({ reviewCountByCustomer: { cust1: 1 } });
  db.prepare(
    `UPDATE product_reviews
     SET approved_at = '2026-05-20T10:00:00.000Z', created_at = '2026-05-20T10:00:00.000Z'
     WHERE customer_id = 'cust1'`,
  ).run();

  withMockedNow('2026-06-21T20:27:00+03:00', () => {
    const mayTickets = listEligibleDrawEntries('2026-05');
    ok(mayTickets.length === 1, 'explicit May period still finds May-approved review');
    const juneTickets = listEligibleDrawEntries('2026-06');
    ok(juneTickets.length === 0, 'same review not counted in June period');
  });
}

console.log(`\nDone: ${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);
