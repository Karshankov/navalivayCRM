/**
 * Customer notes — заметки о клиентах (п.2 Кости).
 * Adversarial + regression tests.
 *
 * Запуск: node server/tests/customer-notes.test.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DB = path.resolve(__dirname, `./.tmp-customer-notes-${Date.now()}.db`);
process.env.DATABASE_FILE = TMP_DB;

const { db, initDb } = await import('../db.js');
initDb();

const {
  upsertCustomerNote,
  clearCustomerNote,
  activatePendingNotesForCustomer,
  touchKanbanOrdersForCustomer,
  sanitizeCustomerNote,
  getPendingNoteForUsername,
  listPendingCustomerNotes,
  serializePendingNote,
  MAX_CUSTOMER_NOTE_LENGTH,
} = await import('../utils/customer-notes.js');
const { migratePendingCustomerNotes } = await import('../migrations/add_pending_customer_notes.js');
const { activatePendingBansForCustomer } = await import('../utils/customer-blocks.js');
const { enrichOrdersWithRelations, fetchOrderRowsByIds } = await import('../utils/crm-order-enrichment.js');
const { buildKanbanBoardSync } = await import('../utils/crm-kanban-board.js');

const results = { passed: 0, failed: 0 };
function assertEq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    results.passed++;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed++;
    console.log(`  FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assert(cond, msg) {
  assertEq(Boolean(cond), true, msg);
}

function resetDb() {
  db.exec('DELETE FROM pending_customer_notes;');
  db.exec('DELETE FROM orders;');
  db.exec('DELETE FROM order_items;');
  db.exec('DELETE FROM customers;');
}

function makeCustomer({ id, telegram_id, telegram_username, notes = null }) {
  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, notes, first_visit_at, total_orders, total_spent)
     VALUES (?, ?, ?, ?, DATETIME('now'), 0, 0)`,
  ).run(id, telegram_id, telegram_username || null, notes);
}

let orderSeq = 9000;
function makeOrder({ id, customer_id, status = 'new', archived = 0, needs_manager_action = 0 }) {
  orderSeq += 1;
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, archived, needs_manager_action, total_amount, final_amount, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 10, 10, '2026-06-10 10:00:00', '2026-06-10 10:00:00')`,
  ).run(id, orderSeq, customer_id, status, archived, needs_manager_action);
}

console.log('\n=== A1: unknown username → pending ===');
resetDb();
{
  const r = upsertCustomerNote({ telegram_username: 'newbie_user', notes: 'Ждём заказ' });
  assertEq(r.kind, 'pending', 'kind=pending');
  assertEq(getPendingNoteForUsername('newbie_user')?.notes, 'Ждём заказ', 'pending stored');
}

console.log('\n=== A2: existing username case-insensitive → active ===');
resetDb();
makeCustomer({ id: 'c1', telegram_id: '1', telegram_username: 'Alice' });
{
  const r = upsertCustomerNote({ telegram_username: 'ALICE', notes: 'Постоянный клиент' });
  assertEq(r.kind, 'active', 'kind=active');
  const row = db.prepare('SELECT notes FROM customers WHERE id = ?').get('c1');
  assertEq(row.notes, 'Постоянный клиент', 'notes saved');
}

console.log('\n=== A3: activate pending on new customer ===');
resetDb();
upsertCustomerNote({ telegram_username: 'rk0ff', notes: 'Проактивная заметка' });
makeCustomer({ id: 'c_rk', telegram_id: '99', telegram_username: 'rk0ff' });
{
  const applied = activatePendingNotesForCustomer({ id: 'c_rk', telegram_username: 'rk0ff' });
  assertEq(applied, 1, 'applied=1');
  const row = db.prepare('SELECT notes FROM customers WHERE id = ?').get('c_rk');
  assertEq(row.notes, 'Проактивная заметка', 'note applied');
  assertEq(getPendingNoteForUsername('rk0ff'), null, 'pending cleared');
}

console.log('\n=== A4: pending skipped when customer already has notes ===');
resetDb();
upsertCustomerNote({ telegram_username: 'busy', notes: 'Pending текст' });
makeCustomer({ id: 'c_busy', telegram_id: '2', telegram_username: 'busy', notes: 'Уже есть' });
{
  const applied = activatePendingNotesForCustomer({ id: 'c_busy', telegram_username: 'busy' });
  assertEq(applied, 0, 'not applied');
  const row = db.prepare('SELECT notes FROM customers WHERE id = ?').get('c_busy');
  assertEq(row.notes, 'Уже есть', 'original kept');
  assertEq(getPendingNoteForUsername('busy'), null, 'pending removed');
}

console.log('\n=== A5: whitespace notes → clear ===');
resetDb();
makeCustomer({ id: 'c_clear', telegram_id: '3', telegram_username: 'clear_me', notes: 'Текст' });
{
  const r = upsertCustomerNote({ customer_id: 'c_clear', notes: '   ' });
  assertEq(r.kind, 'active', 'kind=active');
  assertEq(r.notes, null, 'notes=null');
}

console.log('\n=== A6: note too long → throw ===');
resetDb();
{
  let threw = false;
  try {
    sanitizeCustomerNote('x'.repeat(MAX_CUSTOMER_NOTE_LENGTH + 1));
  } catch (err) {
    threw = err.code === 'note_too_long';
  }
  assert(threw, 'note_too_long thrown');
}

console.log('\n=== A7: invalid username → throw ===');
resetDb();
{
  let empty = false;
  let percent = false;
  try {
    upsertCustomerNote({ telegram_username: '', notes: 'x' });
  } catch (err) {
    empty = err.code === 'invalid_telegram_username';
  }
  try {
    upsertCustomerNote({ telegram_username: 'bad%name', notes: 'x' });
  } catch (err) {
    percent = err.code === 'invalid_telegram_username';
  }
  assert(empty, 'empty username rejected');
  assert(percent, '% in username rejected');
}

console.log('\n=== A8: touch only kanban-relevant orders ===');
resetDb();
makeCustomer({ id: 'c_touch', telegram_id: '4', telegram_username: 'touch' });
makeOrder({ id: 'o_kanban', customer_id: 'c_touch', status: 'new' });
makeOrder({ id: 'o_done', customer_id: 'c_touch', status: 'delivered' });
const beforeKanban = db.prepare('SELECT updated_at FROM orders WHERE id = ?').get('o_kanban').updated_at;
const beforeDone = db.prepare('SELECT updated_at FROM orders WHERE id = ?').get('o_done').updated_at;
{
  const touched = touchKanbanOrdersForCustomer('c_touch');
  assertEq(touched, 1, 'one order touched');
  const afterKanban = db.prepare('SELECT updated_at FROM orders WHERE id = ?').get('o_kanban').updated_at;
  const afterDone = db.prepare('SELECT updated_at FROM orders WHERE id = ?').get('o_done').updated_at;
  assert(afterKanban > beforeKanban, 'kanban order bumped');
  assertEq(afterDone, beforeDone, 'delivered untouched');
}

console.log('\n=== A9: second pending for same username replaces first ===');
resetDb();
{
  upsertCustomerNote({ telegram_username: 'dup_user', notes: 'Первая' });
  upsertCustomerNote({ telegram_username: 'dup_user', notes: 'Вторая' });
  const pending = getPendingNoteForUsername('dup_user');
  assertEq(pending?.notes, 'Вторая', 'latest wins');
  const count = db.prepare('SELECT COUNT(*) AS n FROM pending_customer_notes WHERE telegram_username = ? COLLATE NOCASE').get('dup_user').n;
  assertEq(count, 1, 'single pending row');
}

console.log('\n=== A10: customer_id takes precedence ===');
resetDb();
makeCustomer({ id: 'c_prio', telegram_id: '5', telegram_username: 'prio' });
{
  const r = upsertCustomerNote({
    customer_id: 'c_prio',
    telegram_username: 'other_user',
    notes: 'По id',
  });
  assertEq(r.kind, 'active', 'active by id');
  assertEq(r.customer.id, 'c_prio', 'correct customer');
}

console.log('\n=== A11: XSS payload stored as plain text ===');
resetDb();
makeCustomer({ id: 'c_xss', telegram_id: '6', telegram_username: 'xss' });
{
  const payload = '<script>alert(1)</script>';
  upsertCustomerNote({ customer_id: 'c_xss', notes: payload });
  const row = db.prepare('SELECT notes FROM customers WHERE id = ?').get('c_xss');
  assertEq(row.notes, payload, 'stored verbatim');
}

console.log('\n=== A12: clear pending by pending_id ===');
resetDb();
{
  const created = upsertCustomerNote({ telegram_username: 'pending_del', notes: 'x' });
  const r = clearCustomerNote({ pending_id: created.pending.id });
  assertEq(r.kind, 'pending_removed', 'removed');
  assertEq(getPendingNoteForUsername('pending_del'), null, 'gone');
}

console.log('\n=== A13: pending for old username not activated after rename ===');
resetDb();
upsertCustomerNote({ telegram_username: 'old_name', notes: 'Старая' });
makeCustomer({ id: 'c_renamed', telegram_id: '7', telegram_username: 'new_name' });
{
  const applied = activatePendingNotesForCustomer({ id: 'c_renamed', telegram_username: 'new_name' });
  assertEq(applied, 0, 'not applied');
  assert(getPendingNoteForUsername('old_name') !== null, 'old pending remains');
}

console.log('\n=== R2: enrichment exposes customer_notes, keeps order.notes ===');
resetDb();
makeCustomer({ id: 'c_enr', telegram_id: '8', telegram_username: 'enr', notes: 'Внутренняя' });
makeOrder({ id: 'o_enr', customer_id: 'c_enr' });
db.prepare(`UPDATE orders SET notes = ? WHERE id = ?`).run('Комментарий покупателя', 'o_enr');
{
  const rows = fetchOrderRowsByIds(db, ['o_enr']);
  const enriched = enrichOrdersWithRelations(db, rows);
  assertEq(enriched[0].customer_notes, 'Внутренняя', 'customer_notes set');
  assertEq(enriched[0].notes, 'Комментарий покупателя', 'order.notes intact');
}

console.log('\n=== R3: activatePendingBans still works ===');
resetDb();
{
  const { createBlock } = await import('../utils/customer-blocks.js');
  createBlock({ telegram_username: 'ban_user', reason: 'test', block_until: null });
  makeCustomer({ id: 'c_ban', telegram_id: '10', telegram_username: 'ban_user' });
  const n = activatePendingBansForCustomer({ id: 'c_ban', telegram_username: 'ban_user' });
  assertEq(n, 1, 'ban activated');
}

console.log('\n=== R5: board-sync picks up order after note touch ===');
resetDb();
makeCustomer({ id: 'c_sync', telegram_id: '11', telegram_username: 'sync' });
makeOrder({ id: 'o_sync', customer_id: 'c_sync', status: 'new' });
const since = '2026-06-10 10:00:00';
upsertCustomerNote({ customer_id: 'c_sync', notes: 'Обновили' });
{
  const sync = buildKanbanBoardSync({ db, since });
  assert(sync.changedOrderIds.includes('o_sync'), 'o_sync in changedOrderIds');
}

console.log('\n=== A14: note exactly at max length accepted ===');
resetDb();
makeCustomer({ id: 'c_max', telegram_id: '12', telegram_username: 'maxlen' });
{
  const note = 'а'.repeat(MAX_CUSTOMER_NOTE_LENGTH);
  const sanitized = sanitizeCustomerNote(note);
  assertEq(sanitized.length, MAX_CUSTOMER_NOTE_LENGTH, 'max length kept');
  upsertCustomerNote({ customer_id: 'c_max', notes: note });
  const row = db.prepare('SELECT notes FROM customers WHERE id = ?').get('c_max');
  assertEq(row.notes.length, MAX_CUSTOMER_NOTE_LENGTH, 'saved at boundary');
}

console.log('\n=== A15: unicode emoji and cyrillic preserved ===');
resetDb();
makeCustomer({ id: 'c_uni', telegram_id: '13', telegram_username: 'uni' });
{
  const note = 'Клиент 🎉 из Минска — важно!';
  upsertCustomerNote({ customer_id: 'c_uni', notes: note });
  const row = db.prepare('SELECT notes FROM customers WHERE id = ?').get('c_uni');
  assertEq(row.notes, note, 'unicode preserved');
}

console.log('\n=== A16: multiline notes preserved ===');
resetDb();
makeCustomer({ id: 'c_ml', telegram_id: '14', telegram_username: 'multiline' });
{
  const note = 'Строка 1\nСтрока 2\r\nСтрока 3';
  upsertCustomerNote({ customer_id: 'c_ml', notes: note });
  const row = db.prepare('SELECT notes FROM customers WHERE id = ?').get('c_ml');
  assertEq(row.notes, note, 'newlines preserved');
}

console.log('\n=== A17: active save clears pending for same username ===');
resetDb();
upsertCustomerNote({ telegram_username: 'will_clear', notes: 'Pending' });
makeCustomer({ id: 'c_wc', telegram_id: '15', telegram_username: 'will_clear' });
{
  assert(getPendingNoteForUsername('will_clear') !== null, 'pending exists before');
  upsertCustomerNote({ customer_id: 'c_wc', notes: 'Active note' });
  assertEq(getPendingNoteForUsername('will_clear'), null, 'pending cleared on active save');
}

console.log('\n=== A18: second activate is idempotent ===');
resetDb();
upsertCustomerNote({ telegram_username: 'idem_user', notes: 'Once' });
makeCustomer({ id: 'c_idem', telegram_id: '16', telegram_username: 'idem_user' });
{
  const first = activatePendingNotesForCustomer({ id: 'c_idem', telegram_username: 'idem_user' });
  const second = activatePendingNotesForCustomer({ id: 'c_idem', telegram_username: 'idem_user' });
  assertEq(first, 1, 'first apply');
  assertEq(second, 0, 'second no-op');
  const row = db.prepare('SELECT notes FROM customers WHERE id = ?').get('c_idem');
  assertEq(row.notes, 'Once', 'notes unchanged');
}

console.log('\n=== A19: activate skipped without telegram_username ===');
resetDb();
upsertCustomerNote({ telegram_username: 'no_tg', notes: 'Pending' });
makeCustomer({ id: 'c_no_tg', telegram_id: '17', telegram_username: null });
{
  const applied = activatePendingNotesForCustomer({ id: 'c_no_tg', telegram_username: null });
  assertEq(applied, 0, 'not applied');
  assert(getPendingNoteForUsername('no_tg') !== null, 'pending remains');
}

console.log('\n=== A20: clear by telegram_username for existing customer ===');
resetDb();
makeCustomer({ id: 'c_clr_u', telegram_id: '18', telegram_username: 'clr_by_u', notes: 'Удалить' });
{
  const r = clearCustomerNote({ telegram_username: 'clr_by_u' });
  assertEq(r.kind, 'active', 'cleared via username');
  assertEq(r.notes, null, 'notes null');
}

console.log('\n=== A21: customer_not_found on bad customer_id ===');
resetDb();
{
  let threw = false;
  try {
    upsertCustomerNote({ customer_id: 'missing-id', notes: 'x' });
  } catch (err) {
    threw = err.code === 'customer_not_found';
  }
  assert(threw, 'customer_not_found thrown');
}

console.log('\n=== A22: multiple pending rows — latest wins on activate ===');
resetDb();
{
  db.prepare(
    `INSERT INTO pending_customer_notes (telegram_username, notes, created_at)
     VALUES ('multi_p', 'Старая', '2026-06-01 10:00:00')`,
  ).run();
  db.prepare(
    `INSERT INTO pending_customer_notes (telegram_username, notes, created_at)
     VALUES ('multi_p', 'Новая', '2026-06-02 10:00:00')`,
  ).run();
  makeCustomer({ id: 'c_multi', telegram_id: '19', telegram_username: 'multi_p' });
  const applied = activatePendingNotesForCustomer({ id: 'c_multi', telegram_username: 'multi_p' });
  assertEq(applied, 1, 'applied');
  const row = db.prepare('SELECT notes FROM customers WHERE id = ?').get('c_multi');
  assertEq(row.notes, 'Новая', 'latest pending applied');
  const left = db.prepare('SELECT COUNT(*) AS n FROM pending_customer_notes WHERE telegram_username = ?').get('multi_p').n;
  assertEq(left, 0, 'all pending removed');
}

console.log('\n=== A23: @username normalized on save ===');
resetDb();
makeCustomer({ id: 'c_at', telegram_id: '20', telegram_username: 'at_user' });
{
  upsertCustomerNote({ telegram_username: '@AT_USER', notes: 'Нормализация' });
  const row = db.prepare('SELECT notes FROM customers WHERE id = ?').get('c_at');
  assertEq(row.notes, 'Нормализация', 'saved via @username');
}

console.log('\n=== A24: touch in_progress and cancelled orders ===');
resetDb();
makeCustomer({ id: 'c_st', telegram_id: '21', telegram_username: 'statuses' });
makeOrder({ id: 'o_prog', customer_id: 'c_st', status: 'in_progress' });
makeOrder({ id: 'o_canc', customer_id: 'c_st', status: 'cancelled' });
const beforeProg = db.prepare('SELECT updated_at FROM orders WHERE id = ?').get('o_prog').updated_at;
const beforeCanc = db.prepare('SELECT updated_at FROM orders WHERE id = ?').get('o_canc').updated_at;
{
  const touched = touchKanbanOrdersForCustomer('c_st');
  assertEq(touched, 2, 'two orders touched');
  assert(
    db.prepare('SELECT updated_at FROM orders WHERE id = ?').get('o_prog').updated_at > beforeProg,
    'in_progress bumped',
  );
  assert(
    db.prepare('SELECT updated_at FROM orders WHERE id = ?').get('o_canc').updated_at > beforeCanc,
    'cancelled bumped',
  );
}

console.log('\n=== A25: archived orders not touched ===');
resetDb();
makeCustomer({ id: 'c_arch', telegram_id: '22', telegram_username: 'arch' });
makeOrder({ id: 'o_arch', customer_id: 'c_arch', status: 'new', archived: 1 });
const beforeArch = db.prepare('SELECT updated_at FROM orders WHERE id = ?').get('o_arch').updated_at;
{
  const touched = touchKanbanOrdersForCustomer('c_arch');
  assertEq(touched, 0, 'archived skipped');
  assertEq(
    db.prepare('SELECT updated_at FROM orders WHERE id = ?').get('o_arch').updated_at,
    beforeArch,
    'archived unchanged',
  );
}

console.log('\n=== A26: more invalid username shapes rejected ===');
resetDb();
{
  const cases = ['user-name', 'user.name', 'a'.repeat(33), 'has space'];
  let rejected = 0;
  for (const username of cases) {
    try {
      upsertCustomerNote({ telegram_username: username, notes: 'x' });
    } catch (err) {
      if (err.code === 'invalid_telegram_username') rejected++;
    }
  }
  assertEq(rejected, cases.length, 'all invalid usernames rejected');
}

console.log('\n=== R1: customer/me SELECT does not expose notes ===');
resetDb();
makeCustomer({ id: 'c_pub', telegram_id: 'secret_tid', telegram_username: 'pub', notes: 'Секрет' });
{
  const customer = db.prepare(`
    SELECT id, telegram_id, telegram_username, first_name, last_name,
           phone, total_orders, total_spent, photo_url, photo_updated_at,
           created_at
    FROM customers WHERE telegram_id = ?
  `).get('secret_tid');
  assert(customer !== undefined, 'customer found');
  assertEq('notes' in customer, false, 'notes field absent from public SELECT');
}

console.log('\n=== R4: enrichment nullifies whitespace-only customer notes ===');
resetDb();
makeCustomer({ id: 'c_ws', telegram_id: '23', telegram_username: 'ws', notes: '   ' });
makeOrder({ id: 'o_ws', customer_id: 'c_ws' });
{
  const rows = fetchOrderRowsByIds(db, ['o_ws']);
  const enriched = enrichOrdersWithRelations(db, rows);
  assertEq(enriched[0].customer_notes, null, 'whitespace-only → null');
}

console.log('\n=== R6: order without customer_id → customer_notes null ===');
resetDb();
{
  orderSeq += 1;
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, archived, total_amount, final_amount, created_at, updated_at)
     VALUES ('o_nocust', ?, NULL, 'new', 0, 10, 10, '2026-06-10 10:00:00', '2026-06-10 10:00:00')`,
  ).run(orderSeq);
  const rows = fetchOrderRowsByIds(db, ['o_nocust']);
  const enriched = enrichOrdersWithRelations(db, rows);
  assertEq(enriched[0].customer_notes, null, 'no customer → null notes');
}

console.log('\n=== R7: two orders same customer share one note ===');
resetDb();
makeCustomer({ id: 'c_two', telegram_id: '24', telegram_username: 'two_ord', notes: 'Общая' });
makeOrder({ id: 'o_a', customer_id: 'c_two', status: 'new' });
makeOrder({ id: 'o_b', customer_id: 'c_two', status: 'in_progress' });
{
  const rows = fetchOrderRowsByIds(db, ['o_a', 'o_b']);
  const enriched = enrichOrdersWithRelations(db, rows);
  assertEq(enriched[0].customer_notes, 'Общая', 'order A note');
  assertEq(enriched[1].customer_notes, 'Общая', 'order B same note');
}

console.log('\n=== R8: listPendingCustomerNotes respects limit ===');
resetDb();
{
  for (let i = 0; i < 5; i += 1) {
    upsertCustomerNote({ telegram_username: `lim_${i}`, notes: `n${i}` });
  }
  const listed = listPendingCustomerNotes({ limit: 3 });
  assertEq(listed.length, 3, 'limit=3');
  const capped = listPendingCustomerNotes({ limit: 9999 });
  assertEq(capped.length, 5, 'limit capped at row count');
  const floored = listPendingCustomerNotes({ limit: 0 });
  assertEq(floored.length, 5, 'invalid limit defaults to min 1');
}

console.log('\n=== R9: serializePendingNote shape ===');
resetDb();
{
  const created = upsertCustomerNote({ telegram_username: 'ser_user', notes: 'Тест', created_by: 'admin' });
  const serialized = serializePendingNote(created.pending);
  assertEq(serialized.kind, 'pending', 'kind');
  assertEq(serialized.telegram_username, 'ser_user', 'username');
  assertEq(serialized.notes, 'Тест', 'notes');
  assertEq(serialized.created_by, 'admin', 'created_by');
  assert(typeof serialized.id === 'number', 'id is number');
  assert(serialized.created_at !== null, 'created_at set');
  assertEq(serializePendingNote(null), null, 'null in → null out');
}

console.log('\n=== R10: migration idempotent ===');
{
  const before = db.prepare(
    "SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name LIKE '%pending_customer_notes%' ORDER BY name",
  ).all().map((r) => r.name);
  migratePendingCustomerNotes();
  migratePendingCustomerNotes();
  const after = db.prepare(
    "SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name LIKE '%pending_customer_notes%' ORDER BY name",
  ).all().map((r) => r.name);
  assertEq(after, before, 'schema unchanged after double migrate');
  upsertCustomerNote({ telegram_username: 'mig_ok', notes: 'after migrate' });
  assert(getPendingNoteForUsername('mig_ok') !== null, 'table still usable');
}

console.log('\n=== A27: needs_manager_action bumps non-kanban status ===');
resetDb();
makeCustomer({ id: 'c_nma', telegram_id: '25', telegram_username: 'nma' });
makeOrder({ id: 'o_nma', customer_id: 'c_nma', status: 'delivered', needs_manager_action: 1 });
const beforeNma = db.prepare('SELECT updated_at FROM orders WHERE id = ?').get('o_nma').updated_at;
{
  const touched = touchKanbanOrdersForCustomer('c_nma');
  assertEq(touched, 1, 'delivered with flag touched');
  assert(
    db.prepare('SELECT updated_at FROM orders WHERE id = ?').get('o_nma').updated_at > beforeNma,
    'updated_at bumped',
  );
}

console.log('\n=== A28: pending_cleared for unknown username ===');
resetDb();
{
  const r = upsertCustomerNote({ telegram_username: 'ghost_only', notes: '   ' });
  assertEq(r.kind, 'pending_cleared', 'pending_cleared');
}

console.log('\n=== A29: notes trimmed on save ===');
resetDb();
makeCustomer({ id: 'c_trim', telegram_id: '26', telegram_username: 'trim' });
{
  upsertCustomerNote({ customer_id: 'c_trim', notes: '  пробелы  ' });
  const row = db.prepare('SELECT notes FROM customers WHERE id = ?').get('c_trim');
  assertEq(row.notes, 'пробелы', 'trimmed');
}

console.log('\n=== A30: SQL-like username does not insert row ===');
resetDb();
{
  let threw = false;
  try {
    upsertCustomerNote({ telegram_username: "'; DROP TABLE customers; --", notes: 'x' });
  } catch (err) {
    threw = err.code === 'invalid_telegram_username';
  }
  assert(threw, 'injection username rejected');
  const customers = db.prepare('SELECT COUNT(*) AS n FROM customers').get().n;
  assertEq(customers, 0, 'customers table intact');
}

console.log('\n=== A31: overwrite active note replaces text ===');
resetDb();
makeCustomer({ id: 'c_ow', telegram_id: '27', telegram_username: 'overwrite' });
{
  upsertCustomerNote({ customer_id: 'c_ow', notes: 'Первая' });
  upsertCustomerNote({ customer_id: 'c_ow', notes: 'Вторая' });
  const row = db.prepare('SELECT notes FROM customers WHERE id = ?').get('c_ow');
  assertEq(row.notes, 'Вторая', 'latest wins');
}

console.log('\n=== R11: order.notes separate from customer_notes ===');
resetDb();
makeCustomer({ id: 'c_sep', telegram_id: '28', telegram_username: 'sep', notes: 'Внутр.' });
makeOrder({ id: 'o_sep', customer_id: 'c_sep' });
db.prepare('UPDATE orders SET notes = ? WHERE id = ?').run('Комментарий покупателя', 'o_sep');
{
  const rows = fetchOrderRowsByIds(db, ['o_sep']);
  const enriched = enrichOrdersWithRelations(db, rows);
  assertEq(enriched[0].customer_notes, 'Внутр.', 'customer_notes');
  assertEq(enriched[0].notes, 'Комментарий покупателя', 'order.notes');
}

console.log('\n=== R12: clear pending via DELETE helper by username ===');
resetDb();
upsertCustomerNote({ telegram_username: 'clr_pend', notes: 'x' });
{
  const r = clearCustomerNote({ telegram_username: 'clr_pend' });
  assertEq(r.kind, 'pending_cleared', 'cleared');
  assertEq(getPendingNoteForUsername('clr_pend'), null, 'gone');
}

try {
  db.close();
} catch {}
for (const p of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
  try { fs.unlinkSync(p); } catch {}
}

console.log(`\n=== Total: ${results.passed} passed, ${results.failed} failed ===`);
if (results.failed > 0) process.exit(1);