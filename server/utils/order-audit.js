import { randomUUID } from 'node:crypto';

// Explicit allowlists: never persist request bodies, PINs, tokens or secrets.
const ORDER_FIELDS = [
  'status', 'customer_id', 'employee_id', 'delivery_type', 'delivery_address',
  'notes', 'phone', 'telegram_username', 'total_amount', 'discount_amount',
  'discount_percent', 'additional_cost', 'final_amount', 'profit',
  'payment_type', 'payment_account_id', 'paid_amount', 'paid_at',
  'payment_notes', 'card_amount_minor', 'cash_due_minor', 'completed_at',
  'stock_deducted', 'promo_code_id', 'promo_code_text', 'is_wholesale',
  'wholesale_tier_id', 'wholesale_tier_label', 'wholesale_min_amount',
  'needs_manager_action', 'manager_action_type', 'manager_action_note',
  'manager_action_resolved_at', 'assembled_by_employee_id', 'assembled_at',
  'issued_by_employee_id', 'issued_at', 'archived', 'cancelled_at',
];
const ITEM_FIELDS = [
  'product_id', 'variant_id', 'product_title', 'group_name',
  'base_product_id', 'base_product_title', 'variant_name', 'quantity',
  'price_per_unit', 'base_price_per_unit', 'catalog_discount_per_unit',
  'cost_per_unit', 'manual_discount_amount', 'loyalty_discount_amount',
  'loyalty_units_applied', 'discount_amount', 'total_price', 'total_cost',
];
const ACTOR_TYPES = new Set(['employee', 'admin', 'customer', 'system']);

function pick(row, fields) {
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
}

export function snapshotOrder(database, orderId) {
  const order = database.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  const items = database.prepare(
    'SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid ASC',
  ).all(orderId).map((row) => pick(row, ITEM_FIELDS));
  return { order: pick(order, ORDER_FIELDS), items };
}

// Callers must pass the result of the existing server-side actor recheck,
// not employee IDs or names from the browser payload.
export function verifiedRequestAuditActor(req, verifiedShiftActor = null) {
  if (verifiedShiftActor?.employeeId) {
    const shift = verifiedShiftActor.shift || {};
    const name = [shift.employee_first_name, shift.employee_last_name]
      .filter(Boolean).join(' ').trim();
    return {
      type: 'employee',
      id: String(verifiedShiftActor.employeeId),
      name: name || String(verifiedShiftActor.employeeId),
    };
  }
  if (req.telegramAuth?.source === 'insecure') {
    return {
      type: 'system', id: 'development-insecure',
      name: 'Локальный режим — личность не проверена',
    };
  }
  if (req.telegramAuth?.verified === true && req.telegramAuth?.telegramId) {
    const auth = req.telegramAuth;
    return {
      type: 'customer',
      id: String(auth.telegramId),
      name: [auth.firstName, auth.lastName].filter(Boolean).join(' ').trim()
        || String(auth.telegramUsername || auth.telegramId),
    };
  }
  if (req.user?.u || req.user?.username) {
    const username = String(req.user.u || req.user.username);
    return { type: 'admin', id: username, name: username };
  }
  throw new Error('order_audit_verified_actor_required');
}

function itemGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const key = JSON.stringify([item.product_id, item.variant_id]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  // Most orders have one row per product/variant. Sorting repeated rows by
  // their semantic contents avoids depending on regenerated order_item IDs.
  for (const rows of groups.values()) {
    rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return groups;
}

export function diffOrderSnapshots(before, after) {
  if (!after) throw new Error('order_audit_order_missing');
  if (!before) {
    return [{ type: 'order_created', field: null, before: null, after }];
  }
  const events = [];
  for (const field of ORDER_FIELDS) {
    if (JSON.stringify(before.order[field]) === JSON.stringify(after.order[field])) continue;
    events.push({
      type: field === 'status' ? 'status_changed' : 'order_field_changed',
      field,
      before: before.order[field],
      after: after.order[field],
    });
  }
  const oldGroups = itemGroups(before.items);
  const newGroups = itemGroups(after.items);
  const keys = new Set([...oldGroups.keys(), ...newGroups.keys()]);
  for (const key of keys) {
    const oldRows = oldGroups.get(key) || [];
    const newRows = newGroups.get(key) || [];
    for (let index = 0; index < Math.max(oldRows.length, newRows.length); index += 1) {
      const oldRow = oldRows[index];
      const newRow = newRows[index];
      const item = newRow || oldRow;
      const related = {
        product_id: item.product_id,
        variant_id: item.variant_id,
        product_title: item.product_title,
      };
      if (!oldRow || !newRow) {
        events.push({
          type: newRow ? 'item_added' : 'item_removed',
          field: null,
          before: oldRow || null,
          after: newRow || null,
          ...related,
        });
        continue;
      }
      for (const field of ITEM_FIELDS) {
        if (JSON.stringify(oldRow[field]) === JSON.stringify(newRow[field])) continue;
        const type = field === 'quantity' ? 'item_quantity_changed'
          : field === 'price_per_unit' ? 'item_price_changed'
          : ['manual_discount_amount', 'loyalty_discount_amount', 'discount_amount'].includes(field)
            ? 'item_discount_changed' : 'item_field_changed';
        events.push({
          type, field, before: oldRow[field], after: newRow[field], ...related,
        });
      }
    }
  }
  return events;
}

export function recordOrderAudit(database, {
  orderId, before, actor, source, operationId = randomUUID(),
}) {
  if (!database.inTransaction) throw new Error('order_audit_transaction_required');
  if (!ACTOR_TYPES.has(actor?.type) || !actor?.id || !actor?.name || !source) {
    throw new Error('order_audit_invalid_context');
  }
  const after = snapshotOrder(database, orderId);
  const events = diffOrderSnapshots(before, after);
  if (!events.length) return [];
  const occurredAt = new Date().toISOString();
  const insert = database.prepare(`
    INSERT INTO order_audit_events (
      id, order_id, operation_id, event_type, occurred_at,
      actor_type, actor_id, actor_name, source, field,
      product_id, variant_id, product_title, before_json, after_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const ids = [];
  for (const event of events) {
    const id = randomUUID();
    insert.run(
      id, orderId, operationId, event.type, occurredAt,
      actor.type, String(actor.id), String(actor.name), source, event.field,
      event.product_id || null, event.variant_id || null,
      event.product_title || null,
      JSON.stringify(event.before ?? null), JSON.stringify(event.after ?? null),
    );
    ids.push(id);
  }
  database.prepare(
    'UPDATE orders SET audit_revision = audit_revision + 1 WHERE id = ?',
  ).run(orderId);
  return ids;
}
