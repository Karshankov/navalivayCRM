import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { migrateOrderAudit } from '../migrations/add_order_audit.js';
import { snapshotOrder, recordOrderAudit, verifiedRequestAuditActor } from '../utils/order-audit.js';

const admin = { type: 'admin', id: 'test-admin', name: 'test-admin' };
function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE orders (
      id TEXT PRIMARY KEY, status TEXT, discount_amount REAL DEFAULT 0,
      discount_percent REAL DEFAULT 0, additional_cost REAL DEFAULT 0,
      final_amount REAL DEFAULT 100, profit REAL DEFAULT 40
    );
    CREATE TABLE order_items (
      id TEXT PRIMARY KEY, order_id TEXT REFERENCES orders(id), product_id TEXT,
      variant_id TEXT, product_title TEXT, quantity REAL, price_per_unit REAL,
      manual_discount_amount REAL DEFAULT 0, loyalty_discount_amount REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0, total_price REAL, cost_per_unit REAL, total_cost REAL
    );
  `);
  migrateOrderAudit(db);
  db.prepare("INSERT INTO orders (id, status) VALUES ('o1', 'new')").run();
  db.prepare(`INSERT INTO order_items
    (id, order_id, product_id, product_title, quantity, price_per_unit, total_price, cost_per_unit, total_cost)
    VALUES ('i1', 'o1', 'p1', 'Product', 2, 50, 100, 30, 60)`).run();
  return db;
}
function events(db) {
  return db.prepare('SELECT * FROM order_audit_events ORDER BY sequence').all();
}
function mutate(db, callback) {
  return db.transaction(() => {
    const before = snapshotOrder(db, 'o1');
    callback();
    return recordOrderAudit(db, { orderId: 'o1', before, actor: admin, source: 'test' });
  }).immediate();
}

test('migration is repeatable and fabricates no historical events', () => {
  const db = fixture();
  try {
    migrateOrderAudit(db);
    assert.equal(events(db).length, 0);
    assert.equal(db.prepare("SELECT audit_revision FROM orders WHERE id = 'o1'").get().audit_revision, 0);
  } finally { db.close(); }
});

test('creation records one complete allowlisted snapshot', () => {
  const db = fixture();
  try {
    db.transaction(() => recordOrderAudit(db, {
      orderId: 'o1', before: null, actor: admin, source: 'test.create',
    })).immediate();
    const [event] = events(db);
    assert.equal(event.event_type, 'order_created');
    assert.equal(JSON.parse(event.after_json).items[0].quantity, 2);
    assert.equal(event.actor_id, 'test-admin');
    assert.match(event.occurred_at, /^\d{4}-\d{2}-\d{2}T.*\.\d{3}Z$/);
    assert.equal(JSON.parse(event.before_json), null);
  } finally { db.close(); }
});

test('quantity, price, discounts and surcharge retain separate before/after values', () => {
  const db = fixture();
  try {
    mutate(db, () => {
      db.exec("UPDATE orders SET discount_amount = 5, discount_percent = 10, additional_cost = 7 WHERE id = 'o1'");
      db.exec("UPDATE order_items SET quantity = 3, price_per_unit = 45, manual_discount_amount = 4 WHERE id = 'i1'");
    });
    const rows = events(db);
    for (const field of ['discount_amount', 'discount_percent', 'additional_cost', 'quantity', 'price_per_unit', 'manual_discount_amount']) {
      assert.ok(rows.some((event) => event.field === field), field);
    }
    const quantity = rows.find((event) => event.field === 'quantity');
    assert.equal(quantity.event_type, 'item_quantity_changed');
    assert.equal(JSON.parse(quantity.before_json), 2);
    assert.equal(JSON.parse(quantity.after_json), 3);
    assert.equal(quantity.product_id, 'p1');
    assert.equal(new Set(rows.map((event) => event.operation_id)).size, 1);
    assert.equal(new Set(rows.map((event) => event.occurred_at)).size, 1);
  } finally { db.close(); }
});

test('item addition and removal preserve related product data', () => {
  const db = fixture();
  try {
    mutate(db, () => {
      db.exec("DELETE FROM order_items WHERE id = 'i1'");
      db.exec(`INSERT INTO order_items
        (id, order_id, product_id, variant_id, product_title, quantity, price_per_unit)
        VALUES ('i2', 'o1', 'p2', 'v2', 'Variant', 1, 20)`);
    });
    assert.ok(events(db).some((event) => event.event_type === 'item_removed' && event.product_id === 'p1'));
    assert.ok(events(db).some((event) => event.event_type === 'item_added' && event.variant_id === 'v2'));
  } finally { db.close(); }
});

test('unchanged retry and regenerated row IDs create no duplicate events', () => {
  const db = fixture();
  try {
    mutate(db, () => db.exec("UPDATE orders SET status = 'in_progress' WHERE id = 'o1'"));
    const initial = events(db).length;
    mutate(db, () => {
      db.exec("UPDATE orders SET status = 'in_progress' WHERE id = 'o1'");
      db.exec("UPDATE order_items SET id = 'regenerated' WHERE id = 'i1'");
    });
    assert.equal(events(db).length, initial);
    assert.equal(db.prepare("SELECT audit_revision FROM orders WHERE id = 'o1'").get().audit_revision, 1);
  } finally { db.close(); }
});

test('failed mutation rolls back order and journal together', () => {
  const db = fixture();
  try {
    assert.throws(() => db.transaction(() => {
      const before = snapshotOrder(db, 'o1');
      db.exec("UPDATE orders SET status = 'cancelled' WHERE id = 'o1'");
      recordOrderAudit(db, { orderId: 'o1', before, actor: admin, source: 'test' });
      throw new Error('forced failure');
    }).immediate(), /forced failure/);
    assert.equal(events(db).length, 0);
    assert.equal(db.prepare("SELECT status, audit_revision FROM orders WHERE id = 'o1'").get().status, 'new');
    db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON order_audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
    assert.throws(() => mutate(db, () => db.exec("UPDATE orders SET status = 'cancelled' WHERE id = 'o1'")), /audit unavailable/);
    assert.equal(db.prepare("SELECT status FROM orders WHERE id = 'o1'").get().status, 'new');
  } finally { db.close(); }
});

test('audit writes require a transaction and a valid actor', () => {
  const db = fixture();
  try {
    const before = snapshotOrder(db, 'o1');
    assert.throws(() => recordOrderAudit(db, { orderId: 'o1', before, actor: admin, source: 'test' }), /transaction_required/);
    assert.throws(() => db.transaction(() => recordOrderAudit(db, {
      orderId: 'o1', before, actor: { type: 'browser', id: 'fake', name: 'fake' }, source: 'test',
    })).immediate(), /invalid_context/);
  } finally { db.close(); }
});

test('request body cannot override the verified admin or employee', () => {
  const req = { user: { u: 'real-admin' }, body: { actor_id: 'fake', actor_employee_id: 'fake', actor_pin: 'secret' } };
  assert.deepEqual(verifiedRequestAuditActor(req), { type: 'admin', id: 'real-admin', name: 'real-admin' });
  assert.deepEqual(verifiedRequestAuditActor(req, {
    employeeId: 'real-employee', shift: { employee_first_name: 'Real', employee_last_name: 'Employee' },
  }), { type: 'employee', id: 'real-employee', name: 'Real Employee' });
  assert.throws(() => verifiedRequestAuditActor({ body: req.body }), /verified_actor_required/);
});
