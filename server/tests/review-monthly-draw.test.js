/**
 * Monthly review draw tests.
 * Run: node server/tests/review-monthly-draw.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-review-draw-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'test';

const { initDb, db } = await import('../db.js');
const {
  listEligibleDrawEntries,
  pickWeightedWinners,
  runMonthlyReviewDraw,
  rerollDrawSeat,
  getReviewPeriodKey,
} = await import('../utils/review-monthly-draw.js');

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

function seedApprovedReviews() {
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
     VALUES ('grp1', 'cat1', 'grp1', 'Group', 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, createdAt)
     VALUES ('prod1', 'cat1', 'grp1', 'Item', 10, '', 5, DATETIME('now'))`,
  ).run();

  for (let i = 1; i <= 3; i += 1) {
    db.prepare(
      `INSERT INTO customers (id, telegram_id, telegram_username, first_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, DATETIME('now'), DATETIME('now'))`,
    ).run(`cust${i}`, `${i}${i}${i}`, `user${i}`, `User${i}`);
  }

  for (let i = 1; i <= 3; i += 1) {
    db.prepare(
      `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, 'delivered', 10, 10, DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
    ).run(`ord${i}`, 1000 + i, `cust${i}`);
    db.prepare(
      `INSERT INTO order_items (id, order_id, product_id, product_title, quantity, price_per_unit, total_price, total_cost)
       VALUES (?, ?, 'prod1', 'Item', 1, 10, 10, 4)`,
    ).run(`oi${i}`, `ord${i}`);
  }

  db.prepare(`
    INSERT INTO product_reviews (
      id, customer_id, order_id, group_id, rating, body_text, quick_tag_ids,
      status, created_at, updated_at, approved_at
    ) VALUES ('rev1', 'cust1', 'ord1', 'grp1', 5, 'Длинный отзыв номер один для теста', '[]', 'approved', DATETIME('now'), DATETIME('now'), DATETIME('now'))
  `).run();
  db.prepare(`
    INSERT INTO product_reviews (
      id, customer_id, order_id, group_id, rating, body_text, quick_tag_ids,
      status, created_at, updated_at, approved_at
    ) VALUES ('rev2a', 'cust2', 'ord2', 'grp1', 4, 'Длинный отзыв номер два для теста', '[]', 'approved', DATETIME('now'), DATETIME('now'), DATETIME('now'))
  `).run();
  db.prepare(`
    INSERT INTO product_reviews (
      id, customer_id, order_id, group_id, rating, body_text, quick_tag_ids,
      status, created_at, updated_at, approved_at
    ) VALUES ('rev2b', 'cust2', 'ord2', 'grp1', 3, 'Длинный отзыв номер три для теста', '[]', 'approved', DATETIME('now'), DATETIME('now'), DATETIME('now'))
  `).run();
}

console.log('\n=== review-monthly-draw ===\n');

console.log('--- period key uses Minsk calendar month ---');
{
  const { getTimeZoneDateParts } = await import('../utils/business-time.js');
  const juneEvening = new Date('2026-06-21T20:27:00+03:00');
  const parts = getTimeZoneDateParts(juneEvening);
  ok(parts.month === 6 && parts.year === 2026, 'fixture is June 21 2026 in Minsk');

  const originalDate = Date;
  global.Date = class extends originalDate {
    constructor(...args) {
      if (args.length === 0) {
        super(juneEvening.getTime());
        return;
      }
      super(...args);
    }
    static now() {
      return juneEvening.getTime();
    }
  };

  try {
    ok(getReviewPeriodKey(0) === '2026-06', 'June evening maps to 2026-06, not previous month UTC');
  } finally {
    global.Date = originalDate;
  }
}

console.log('\n--- weighted tickets ---');
{
  seedApprovedReviews();
  const periodKey = getReviewPeriodKey(0);
  const tickets = listEligibleDrawEntries(periodKey);
  const cust2Tickets = tickets.filter((t) => t.customer_id === 'cust2').length;
  const cust1Tickets = tickets.filter((t) => t.customer_id === 'cust1').length;
  ok(cust1Tickets === 1, 'cust1 has one ticket');
  ok(cust2Tickets === 2, 'cust2 has two tickets');
}

console.log('\n--- one seat per customer ---');
{
  const tickets = [
    { customer_id: 'a', review_id: 'r1' },
    { customer_id: 'a', review_id: 'r1' },
    { customer_id: 'b', review_id: 'r2' },
    { customer_id: 'c', review_id: 'r3' },
  ];
  const winners = pickWeightedWinners(tickets, 5, () => 0);
  ok(winners.length === 3, 'unique customers only');
  ok(new Set(winners.map((w) => w.customer_id)).size === winners.length, 'no duplicate customers');
}

console.log('\n--- run draw + reroll ---');
{
  seedApprovedReviews();
  const periodKey = getReviewPeriodKey(0);
  const draw = runMonthlyReviewDraw({ periodKey, seatCount: 1, rng: () => 0 });
  ok(draw?.winners?.length === 1, 'draw produced winner');

  const seat = draw.winners[0].seat_number;
  const rerolled = rerollDrawSeat(draw.id, seat, { rng: () => 0 });
  ok(rerolled.winners.length === 1, 'reroll keeps one active winner');
  ok(rerolled.winners[0].customer_id !== draw.winners[0].customer_id, 'reroll replaced winner');
}

console.log(`\nDone: ${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);