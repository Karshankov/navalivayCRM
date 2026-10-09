import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TMP_DB = path.resolve(__dirname, `./.tmp-crm-polling-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;
process.env.BOT_TOKEN = '*********************';

const { db, initDb } = await import('../db.js');
initDb();

const { buildCrmOrderPollSummary } = await import('../utils/crm-order-polling.js');

const results = { passed: 0, failed: 0 };
function assert(condition, msg, details = '') {
  if (condition) {
    results.passed++;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed++;
    console.log(`  FAIL: ${msg}${details ? ` — ${details}` : ''}`);
  }
}

console.log('\n=== CRM poll summary returns lightweight IDs and latest activity ===');
{
  db.exec(`DELETE FROM orders;`);
  db.exec(`DELETE FROM customers;`);

  db.prepare(`INSERT INTO customers (id, telegram_id, first_name) VALUES ('c1', '1001', 'A')`).run();
  db.prepare(`INSERT INTO customers (id, telegram_id, first_name) VALUES ('c2', '1002', 'B')`).run();

  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, archived, needs_manager_action, created_at, updated_at)
    VALUES ('o_old', 1, 'c1', 'new', 0, 0, '2026-06-01 10:00:00', '2026-06-01 10:00:00')
  `).run();
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, archived, needs_manager_action, created_at, updated_at)
    VALUES ('o_new', 2, 'c2', 'new', 0, 1, '2026-06-01 11:00:00', '2026-06-01 12:00:00')
  `).run();
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, archived, needs_manager_action, created_at, updated_at)
    VALUES ('o_done', 3, 'c2', 'completed', 0, 1, '2026-06-01 09:00:00', '2026-06-01 13:00:00')
  `).run();
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, archived, needs_manager_action, created_at, updated_at)
    VALUES ('o_arch', 4, 'c1', 'new', 1, 1, '2026-06-01 14:00:00', '2026-06-01 14:00:00')
  `).run();

  const summary = buildCrmOrderPollSummary({ db, newLimit: 10, actionLimit: 10 });
  assert(JSON.stringify(summary.newOrderIds) === JSON.stringify(['o_new', 'o_old']), 'newOrderIds ordered by recency and skip archived');
  assert(JSON.stringify(summary.actionRequiredIds) === JSON.stringify(['o_done', 'o_new']), 'actionRequiredIds ordered by latest activity');
  assert(summary.latestOrderActivityAt === '2026-06-01 13:00:00', 'latestOrderActivityAt reflects newest active order update');
}

console.log('\n=== CRM poll summary includes pending review count ===');
{
  const group = db.prepare('SELECT id FROM category_groups LIMIT 1').get();
  db.exec('DELETE FROM product_reviews;');
  db.prepare(`
    INSERT INTO product_reviews (
      id, customer_id, order_id, group_id, rating, body_text, quick_tag_ids, status, created_at, updated_at
    ) VALUES ('pr1', 'c1', 'o_old', ?, 5, 'Хороший товар, всё понравилось!', '[]', 'pending', '2026-06-01 10:00:00', '2026-06-01 10:00:00')
  `).run(group.id);
  db.prepare(`
    INSERT INTO product_reviews (
      id, customer_id, order_id, group_id, rating, body_text, quick_tag_ids, status, created_at, updated_at
    ) VALUES ('pr2', 'c2', 'o_new', ?, 4, 'Нормальный товар, но есть нюансы.', '[]', 'approved', '2026-06-01 10:00:00', '2026-06-01 10:00:00')
  `).run(group.id);

  const summary = buildCrmOrderPollSummary({ db });
  assert(summary.pendingReviewCount === 1, 'pendingReviewCount counts only pending reviews');
}

console.log('\n=== CRM poll summary includes latest monthly draw ===');
{
  db.exec('DELETE FROM review_monthly_draw_winners;');
  db.exec('DELETE FROM review_monthly_draws;');

  db.prepare(`
    INSERT INTO review_monthly_draws (id, period_key, drawn_at, status)
    VALUES ('draw_old', '2026-05', '2026-05-31 21:00:00', 'completed')
  `).run();
  db.prepare(`
    INSERT INTO review_monthly_draws (id, period_key, drawn_at, status)
    VALUES ('draw_new', '2026-06', '2026-06-30 21:00:00', 'completed')
  `).run();
  db.prepare(`
    INSERT INTO review_monthly_draw_winners (
      id, draw_id, seat_number, customer_id, review_id, created_at
    ) VALUES ('win1', 'draw_new', 1, 'c1', NULL, '2026-06-30 21:00:00')
  `).run();
  db.prepare(`
    INSERT INTO review_monthly_draw_winners (
      id, draw_id, seat_number, customer_id, review_id, created_at
    ) VALUES ('win2', 'draw_new', 2, 'c2', NULL, '2026-06-30 21:00:00')
  `).run();

  const summary = buildCrmOrderPollSummary({ db });
  assert(summary.latestMonthlyDraw?.id === 'draw_new', 'latestMonthlyDraw picks newest draw');
  assert(summary.latestMonthlyDraw?.period_key === '2026-06', 'latestMonthlyDraw returns period_key');
  assert(summary.latestMonthlyDraw?.winner_count === 2, 'latestMonthlyDraw counts active winners');
}

console.log('\n=== Adversarial: bot_message_log order lookup uses dedicated index ===');
{
  const planRows = db.prepare(`
    EXPLAIN QUERY PLAN
    SELECT json_extract(meta, '$.order_id') AS order_id, meta, id
    FROM bot_message_log
    WHERE direction = 'out'
      AND json_extract(meta, '$.order_id') IN ('o1', 'o2', 'o3')
    ORDER BY id DESC
  `).all();

  const planText = planRows.map((row) => Object.values(row).join('|')).join('\n');
  assert(
    planText.includes('idx_bot_message_log_direction_order_lookup'),
    'notify lookup uses expression index instead of full scan',
    planText,
  );
}

console.log('\n=== Adversarial: action-required poll uses composite orders index ===');
{
  const planRows = db.prepare(`
    EXPLAIN QUERY PLAN
    SELECT id
    FROM orders
    WHERE archived = 0
      AND needs_manager_action = 1
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 200
  `).all();

  const planText = planRows.map((row) => Object.values(row).join('|')).join('\n');
  assert(
    planText.includes('idx_orders_archived_manager_action_updated'),
    'action-required poll uses composite order index',
    planText,
  );
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
