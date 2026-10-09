import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DB = path.resolve(__dirname, `.tmp-pickup-cells-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;
process.env.BOT_TOKEN = '*********************';

const { db, initDb } = await import('../db.js');
initDb();
const {
  assignLowestAvailablePickupCell,
  getActivePickupCellAssignment,
  getPickupCellCapacity,
  listPickupCells,
  releaseActivePickupCell,
  restartPickupCellAssignmentCycle,
  setPickupCellCapacity,
} = await import('../utils/pickup-cells.js');
const { buildCrmOrdersSearch } = await import('../utils/crm-order-search.js');
const {
  prepareStatusNotification,
  upsertStatusTemplate,
} = await import('../utils/business-bot.js');
const { hasAutoNotifyBeenSent } = await import('../utils/auto-notify-retry.js');
const { migratePickupCells } = await import('../migrations/add_pickup_cells.js');

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`  OK: ${message}`);
  } else {
    failed += 1;
    console.log(`  FAIL: ${message}`);
  }
}

db.prepare(
  `INSERT INTO customers (id, telegram_id, telegram_username, first_name, total_orders, bot_verified_at)
   VALUES ('cell_customer', '10001', 'cell_customer', 'Клиент', 1, DATETIME('now'))`,
).run();

function addOrder(id, number, status = 'new') {
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount)
     VALUES (?, ?, 'cell_customer', ?, 10, 10)`,
  ).run(id, number, status);
}

for (let i = 1; i <= 7; i += 1) addOrder(`cell_o${i}`, 7000 + i);

console.log('\n=== capacity and lowest free assignment ===');
assert(getPickupCellCapacity() === 50, 'default capacity is 50');
setPickupCellCapacity(3);
const first = db.transaction(() => assignLowestAvailablePickupCell('cell_o1'))();
const second = db.transaction(() => assignLowestAvailablePickupCell('cell_o2'))();
assert(first.cell_number === 1 && second.cell_number === 2, 'assigns lowest free cells');
assert(
  assignLowestAvailablePickupCell('cell_o1').id === first.id,
  'repeat assignment for same order is idempotent',
);

console.log('\n=== release, reuse and full capacity ===');
releaseActivePickupCell('cell_o1', 'test_release');
const reused = db.transaction(() => assignLowestAvailablePickupCell('cell_o3'))();
const third = db.transaction(() => assignLowestAvailablePickupCell('cell_o4'))();
assert(reused.cell_number === 1 && third.cell_number === 3, 'released number is reused first');
let fullError = null;
try {
  db.transaction(() => assignLowestAvailablePickupCell('cell_o5'))();
} catch (error) {
  fullError = error;
}
assert(fullError?.code === 'pickup_cells_full', 'full capacity returns pickup_cells_full');
assert(getActivePickupCellAssignment('cell_o5') === null, 'full failure leaves order unassigned');

console.log('\n=== capacity decrease protection ===');
let capacityError = null;
try {
  setPickupCellCapacity(2);
} catch (error) {
  capacityError = error;
}
assert(capacityError?.code === 'pickup_cell_capacity_in_use', 'cannot remove occupied upper cell');
assert(getPickupCellCapacity() === 3, 'failed decrease keeps old capacity');
assert(listPickupCells().occupied === 3, 'map reports occupied cells');

console.log('\n=== transaction rollback and uniqueness ===');
releaseActivePickupCell('cell_o4', 'make_space');
try {
  db.transaction(() => {
    assignLowestAvailablePickupCell('cell_o5');
    throw new Error('rollback');
  })();
} catch {
  // expected
}
assert(getActivePickupCellAssignment('cell_o5') === null, 'outer transaction rolls assignment back');
let uniqueError = null;
try {
  db.prepare(
    `INSERT INTO order_pickup_cell_assignments (id, order_id, cell_number)
     VALUES ('duplicate_cell', 'cell_o6', 1)`,
  ).run();
} catch (error) {
  uniqueError = error;
}
assert(Boolean(uniqueError), 'database rejects two active orders in one cell');
let duplicateOrderError = null;
try {
  db.prepare(
    `INSERT INTO order_pickup_cell_assignments (id, order_id, cell_number)
     VALUES ('duplicate_order', 'cell_o2', 3)`,
  ).run();
} catch (error) {
  duplicateOrderError = error;
}
assert(Boolean(duplicateOrderError), 'database rejects two active cells for one order');

console.log('\n=== search and mandatory customer message ===');
const search = buildCrmOrdersSearch({ searchTerm: '1', pickupCellCapacity: 3 });
assert(search.mode === 'pickup_cell_exact' && search.params[0] === 1, 'short number searches exact cell');
const orderSearch = buildCrmOrdersSearch({ searchTerm: '7001', pickupCellCapacity: 3 });
assert(orderSearch.mode === 'order_number_prefix', 'full number still searches order');
const hashOrderSearch = buildCrmOrdersSearch({ searchTerm: '#7001', pickupCellCapacity: 3 });
assert(
  hashOrderSearch.mode === 'order_number_prefix' && hashOrderSearch.params[0] === '7001%',
  'order number with # searches the same permanent order number',
);
const shortHashOrderSearch = buildCrmOrdersSearch({ searchTerm: '#1', pickupCellCapacity: 3 });
assert(
  shortHashOrderSearch.mode === 'order_number_prefix' && shortHashOrderSearch.params[0] === '1%',
  'leading # explicitly distinguishes an order number from a cell number',
);

db.prepare(`UPDATE orders SET status = 'in_progress' WHERE id = 'cell_o7'`).run();
const oldOrderRows = db.prepare(`
  SELECT o.id
  FROM orders o
  WHERE ${buildCrmOrdersSearch({ searchTerm: '#7007', pickupCellCapacity: 3 }).whereClause}
`).all(...buildCrmOrdersSearch({ searchTerm: '#7007', pickupCellCapacity: 3 }).params);
assert(
  oldOrderRows.length === 1 && oldOrderRows[0].id === 'cell_o7' && getActivePickupCellAssignment('cell_o7') === null,
  'old assembled order without a cell is still found by #order number',
);

const activeCellRows = db.prepare(`
  SELECT o.id
  FROM orders o
  WHERE ${search.whereClause}
`).all(...search.params);
assert(
  activeCellRows.length === 1 && activeCellRows[0].id === 'cell_o3',
  'bare short number finds only the current order in that active cell',
);
db.prepare(`UPDATE orders SET status = 'in_progress' WHERE id = 'cell_o3'`).run();
upsertStatusTemplate('order_assembled', {
  title: 'Собран',
  body: 'Ваш заказ готов.',
  is_active: 1,
});
const prepared = prepareStatusNotification({ orderId: 'cell_o3', event: 'order_assembled' });
assert(
  prepared.ok &&
    prepared.text.endsWith('заказ №1.') &&
    !/ячейк/i.test(prepared.text),
  'ready message always contains customer order number without internal wording',
);
upsertStatusTemplate('order_assembled', {
  title: 'Собран',
  body: 'Заказ №{order_number} готов.',
  is_active: 1,
});
const preparedWithNumber = prepareStatusNotification({
  orderId: 'cell_o3',
  event: 'order_assembled',
});
assert(
  preparedWithNumber.ok &&
    (preparedWithNumber.text.match(/заказ №1/gi) || []).length === 1,
  'ready message does not duplicate the customer order number from template',
);

console.log('\n=== notification cycle follows current assignment ===');
db.prepare(
  `INSERT INTO bot_message_log
     (chat_id, direction, message_type, template_kind, template_event, text, meta)
   VALUES ('10001', 'out', 'status', 'status', 'order_assembled', 'sent', ?)`,
).run(JSON.stringify({
  order_id: 'cell_o3',
  outcome: 'sent',
  pickup_cell_assignment_id: reused.id,
}));
assert(hasAutoNotifyBeenSent('cell_o3', 'order_assembled'), 'current assignment is deduplicated');
releaseActivePickupCell('cell_o3', 'modified');
const nextCycle = assignLowestAvailablePickupCell('cell_o3');
assert(nextCycle.id !== reused.id, 'reassembly creates a new assignment cycle');
assert(!hasAutoNotifyBeenSent('cell_o3', 'order_assembled'), 'old message does not block new assignment message');
const restartedCycle = restartPickupCellAssignmentCycle('cell_o3', 'customer_modification_resolved');
assert(
  restartedCycle.cell_number === nextCycle.cell_number && restartedCycle.id !== nextCycle.id,
  'accepted customer changes keep the physical cell but start a new notify cycle',
);
releaseActivePickupCell('cell_o3', 'issued');
const stale = prepareStatusNotification({ orderId: 'cell_o3', event: 'order_assembled' });
assert(!stale.ok && stale.reason === 'pickup_cell_inactive', 'released cell cannot produce stale ready message');

console.log('\n=== all 50 cells ===');
db.prepare(
  `UPDATE order_pickup_cell_assignments
      SET released_at = DATETIME('now'), release_reason = 'reset_for_50'
    WHERE released_at IS NULL`,
).run();
setPickupCellCapacity(50);
for (let i = 8; i <= 51; i += 1) addOrder(`cell_o${i}`, 7000 + i);
let lastOfFifty = null;
for (let i = 1; i <= 50; i += 1) {
  lastOfFifty = assignLowestAvailablePickupCell(`cell_o${i}`);
}
assert(lastOfFifty?.cell_number === 50, 'fills cells 1 through 50');
let fiftyFullError = null;
try {
  assignLowestAvailablePickupCell('cell_o51');
} catch (error) {
  fiftyFullError = error;
}
assert(fiftyFullError?.code === 'pickup_cells_full', '51st assembled order is rejected');

console.log('\n=== one-time backfill for existing new orders ===');
db.prepare(`UPDATE orders SET status = 'delivered'`).run();
db.prepare(
  `UPDATE order_pickup_cell_assignments
      SET released_at = COALESCE(released_at, DATETIME('now'))
    WHERE released_at IS NULL`,
).run();
db.prepare(`DELETE FROM settings WHERE key = 'pickup_cells_early_assignment_backfill_v1'`).run();
setPickupCellCapacity(5);
db.prepare(
  `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, created_at)
   VALUES ('backfill_old', 8001, 'cell_customer', 'new', 10, 10, '2026-01-01 10:00:00'),
          ('backfill_new', 8002, 'cell_customer', 'new', 10, 10, '2026-01-02 10:00:00'),
          ('backfill_legacy', 8003, 'cell_customer', 'in_progress', 10, 10, '2026-01-03 10:00:00')`,
).run();
migratePickupCells();
assert(
  getActivePickupCellAssignment('backfill_old')?.cell_number === 1 &&
    getActivePickupCellAssignment('backfill_new')?.cell_number === 2,
  'existing new orders receive cells oldest first',
);
assert(
  getActivePickupCellAssignment('backfill_legacy') === null,
  'legacy assembled order stays without a cell',
);

try {
  db.close();
} catch {
  // noop
}
for (const file of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // noop
  }
}

console.log(`\n=== pickup-cells.test.js: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
