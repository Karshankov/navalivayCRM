import crypto from 'crypto';
import { db } from '../db.js';

export const DEFAULT_PICKUP_CELL_CAPACITY = 50;
export const MAX_PICKUP_CELL_CAPACITY = 100;

function pickupCellError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function getPickupCellCapacity() {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = 'pickup_cell_capacity'`)
    .get();
  const value = Number(row?.value);
  return Number.isInteger(value) && value >= 1 && value <= MAX_PICKUP_CELL_CAPACITY
    ? value
    : DEFAULT_PICKUP_CELL_CAPACITY;
}

export function getActivePickupCellAssignment(orderId) {
  if (!orderId) return null;
  return (
    db
      .prepare(
        `SELECT id, order_id, cell_number, assigned_at
           FROM order_pickup_cell_assignments
          WHERE order_id = ? AND released_at IS NULL
          LIMIT 1`,
      )
      .get(String(orderId)) || null
  );
}

export function getLatestPickupCellAssignment(orderId) {
  if (!orderId) return null;
  return (
    db.prepare(
      `SELECT id, order_id, cell_number, assigned_at, released_at, release_reason
         FROM order_pickup_cell_assignments
        WHERE order_id = ?
        ORDER BY assigned_at DESC, rowid DESC
        LIMIT 1`,
    ).get(String(orderId)) || null
  );
}

export function assignLowestAvailablePickupCell(orderId) {
  const existing = getActivePickupCellAssignment(orderId);
  if (existing) return existing;

  const capacity = getPickupCellCapacity();
  const occupied = new Set(
    db
      .prepare(
        `SELECT cell_number
           FROM order_pickup_cell_assignments
          WHERE released_at IS NULL
            AND cell_number BETWEEN 1 AND ?`,
      )
      .all(capacity)
      .map((row) => Number(row.cell_number)),
  );
  let cellNumber = null;
  for (let candidate = 1; candidate <= capacity; candidate += 1) {
    if (!occupied.has(candidate)) {
      cellNumber = candidate;
      break;
    }
  }
  if (!cellNumber) {
    throw pickupCellError('pickup_cells_full', 'Свободных ячеек нет');
  }

  // Новая сборка того же заказа должна получить собственный цикл уведомления.
  db.prepare(
    `DELETE FROM pending_notifications
      WHERE order_id = ? AND template_event = 'order_assembled'`,
  ).run(String(orderId));

  const id = `pca_${crypto.randomUUID()}`;
  db.prepare(
    `INSERT INTO order_pickup_cell_assignments (id, order_id, cell_number)
     VALUES (?, ?, ?)`,
  ).run(id, String(orderId), cellNumber);

  return getActivePickupCellAssignment(orderId);
}

export function releaseActivePickupCell(orderId, reason) {
  if (!orderId) return null;
  const active = getActivePickupCellAssignment(orderId);
  if (!active) return null;
  db.prepare(
    `UPDATE order_pickup_cell_assignments
        SET released_at = DATETIME('now'), release_reason = ?
      WHERE id = ? AND released_at IS NULL`,
  ).run(reason || null, active.id);
  db.prepare(
    `UPDATE pending_notifications
        SET status = 'cancelled', updated_at = DATETIME('now')
      WHERE order_id = ?
        AND template_event IN ('order_accepted', 'order_assembled')
        AND status = 'pending'`,
  ).run(String(orderId));
  return active;
}

export function restartPickupCellAssignmentCycle(orderId, reason) {
  const tx = db.transaction(() => {
    const active = getActivePickupCellAssignment(orderId);
    if (!active) return assignLowestAvailablePickupCell(orderId);

    releaseActivePickupCell(orderId, reason || 'assignment_cycle_restarted');
    const id = `pca_${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO order_pickup_cell_assignments (id, order_id, cell_number)
       VALUES (?, ?, ?)`,
    ).run(id, String(orderId), Number(active.cell_number));
    return getActivePickupCellAssignment(orderId);
  });
  return tx.immediate();
}

export function listPickupCells() {
  const capacity = getPickupCellCapacity();
  const rows = db
    .prepare(
      `SELECT
         a.id AS assignment_id,
         a.cell_number,
         a.assigned_at,
         o.id AS order_id,
         o.order_number,
         o.status,
         COALESCE(NULLIF(TRIM(c.first_name || ' ' || COALESCE(c.last_name, '')), ''),
                  NULLIF(TRIM(COALESCE(o.telegram_username, c.telegram_username)), ''),
                  'Без имени') AS customer_name
       FROM order_pickup_cell_assignments a
       JOIN orders o ON o.id = a.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE a.released_at IS NULL
       ORDER BY a.cell_number ASC`,
    )
    .all();
  const byNumber = new Map(rows.map((row) => [Number(row.cell_number), row]));
  const cells = [];
  for (let number = 1; number <= capacity; number += 1) {
    const occupied = byNumber.get(number);
    cells.push(
      occupied
        ? { number, occupied: true, ...occupied }
        : { number, occupied: false },
    );
  }
  return {
    capacity,
    occupied: rows.length,
    available: Math.max(0, capacity - rows.length),
    cells,
  };
}

export function setPickupCellCapacity(rawCapacity) {
  const capacity = Number(rawCapacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_PICKUP_CELL_CAPACITY) {
    throw pickupCellError(
      'invalid_pickup_cell_capacity',
      'Количество ячеек должно быть целым числом от 1 до 100',
    );
  }
  const blocked = db
    .prepare(
      `SELECT cell_number, order_id
         FROM order_pickup_cell_assignments
        WHERE released_at IS NULL AND cell_number > ?
        ORDER BY cell_number ASC
        LIMIT 1`,
    )
    .get(capacity);
  if (blocked) {
    const error = pickupCellError(
      'pickup_cell_capacity_in_use',
      `Ячейка ${blocked.cell_number} занята`,
    );
    error.cell_number = Number(blocked.cell_number);
    error.order_id = blocked.order_id;
    throw error;
  }
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('pickup_cell_capacity', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(capacity));
  return listPickupCells();
}
