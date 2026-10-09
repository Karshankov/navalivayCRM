import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DB = path.resolve(__dirname, `./.tmp-crm-kanban-board-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;
process.env.BOT_TOKEN = '*********************';

const { db, initDb } = await import('../db.js');
initDb();

const {
  buildKanbanBoardSync,
  KANBAN_BOARD_SQL_FILTER,
  fetchEnrichedOrdersByIds,
} = await import('../utils/crm-kanban-board.js');

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

console.log('\n=== Kanban board filter excludes delivered/completed ===');
{
  db.exec('DELETE FROM orders; DELETE FROM customers;');
  db.prepare(`INSERT INTO customers (id, telegram_id, first_name) VALUES ('c1', '1', 'A')`).run();
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, archived, needs_manager_action, created_at, updated_at)
    VALUES ('o_new', 1, 'c1', 'new', 0, 0, '2026-06-03 10:00:00', '2026-06-03 10:00:00')
  `).run();
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, archived, needs_manager_action, created_at, updated_at)
    VALUES ('o_prog', 2, 'c1', 'in_progress', 0, 0, '2026-06-03 10:01:00', '2026-06-03 10:01:00')
  `).run();
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, archived, needs_manager_action, created_at, updated_at)
    VALUES ('o_done', 3, 'c1', 'delivered', 0, 0, '2026-06-03 10:02:00', '2026-06-03 10:02:00')
  `).run();

  const boardIds = db
    .prepare(`SELECT o.id FROM orders o WHERE ${KANBAN_BOARD_SQL_FILTER}`)
    .all()
    .map((r) => r.id);
  assert(
    JSON.stringify(boardIds.sort()) === JSON.stringify(['o_new', 'o_prog']),
    'board filter keeps only kanban-relevant active orders',
    JSON.stringify(boardIds),
  );
}

console.log('\n=== board-sync: changed + removed since timestamp ===');
{
  db.exec('DELETE FROM orders; DELETE FROM customers;');
  db.prepare(`INSERT INTO customers (id, telegram_id, first_name) VALUES ('c1', '1', 'A')`).run();
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, archived, needs_manager_action, created_at, updated_at)
    VALUES ('o_stay', 1, 'c1', 'new', 0, 0, '2026-06-03 10:00:00', '2026-06-03 10:00:00')
  `).run();
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, archived, needs_manager_action, created_at, updated_at)
    VALUES ('o_move', 2, 'c1', 'in_progress', 0, 0, '2026-06-03 10:00:00', '2026-06-03 10:05:00')
  `).run();
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, archived, needs_manager_action, created_at, updated_at)
    VALUES ('o_gone', 3, 'c1', 'delivered', 0, 0, '2026-06-03 10:00:00', '2026-06-03 10:06:00')
  `).run();

  const sync = buildKanbanBoardSync({ db, since: '2026-06-03 10:04:00' });
  assert(
    sync.changedOrderIds.includes('o_move') && !sync.changedOrderIds.includes('o_stay'),
    'changedOrderIds only orders updated after since',
    JSON.stringify(sync.changedOrderIds),
  );
  assert(
    sync.removedOrderIds.includes('o_gone'),
    'removedOrderIds includes orders that left kanban (delivered/completed/archived)',
    JSON.stringify(sync.removedOrderIds),
  );
  assert(
    sync.boardOrderIds.includes('o_stay') && sync.boardOrderIds.includes('o_move'),
    'boardOrderIds lists current kanban orders',
    JSON.stringify(sync.boardOrderIds),
  );
}

console.log('\n=== fetchEnrichedOrdersByIds returns items and card permission for batch ===');
{
  db.exec('DELETE FROM order_items; DELETE FROM orders; DELETE FROM customers;');
  db.prepare(`INSERT INTO customers (id, telegram_id, first_name) VALUES ('c1', '1', 'A')`).run();
  db.prepare(`
    INSERT INTO card_payment_accounts
      (telegram_id, telegram_username, enabled, monthly_limit_minor, max_order_minor)
    VALUES ('1', 'a', 1, 100000, 4500)
  `).run();
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, archived, total_amount, final_amount, created_at, updated_at)
    VALUES ('o1', 1, 'c1', 'new', 0, 10, 10, '2026-06-03 10:00:00', '2026-06-03 10:00:00')
  `).run();
  db.prepare(`
    INSERT INTO order_items (id, order_id, product_title, quantity, price_per_unit, total_price)
    VALUES ('oi1', 'o1', 'Item', 1, 10, 10)
  `).run();

  const rows = fetchEnrichedOrdersByIds({ db, orderIds: ['o1'] });
  assert(rows.length === 1 && rows[0].id === 'o1', 'batch fetch returns requested order');
  assert(Array.isArray(rows[0].items) && rows[0].items.length === 1, 'batch fetch attaches items');
  assert(rows[0].customer_card_payment_enabled === 1, 'batch fetch includes enabled card-payment permission');
}

console.log('\n=== enrichment includes customer_notes ===');
{
  db.exec('DELETE FROM order_items; DELETE FROM orders; DELETE FROM customers;');
  db.prepare(
    `INSERT INTO customers (id, telegram_id, first_name, notes) VALUES ('c1', '1', 'A', '  Менеджерская  ')`,
  ).run();
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, archived, total_amount, final_amount, created_at, updated_at)
    VALUES ('o1', 1, 'c1', 'new', 0, 10, 10, '2026-06-03 10:00:00', '2026-06-03 10:00:00')
  `).run();
  const rows = fetchEnrichedOrdersByIds({ db, orderIds: ['o1'] });
  assert(rows[0]?.customer_notes === 'Менеджерская', 'customer_notes trimmed');
}

try {
  db.close();
} catch {
  /* noop */
}
for (const file of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
  try {
    fs.unlinkSync(file);
  } catch {
    /* noop */
  }
}

console.log(`\n=== crm-kanban-board.test.js: ${results.passed} passed, ${results.failed} failed ===`);
if (results.failed > 0) process.exit(1);
