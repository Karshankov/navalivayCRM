import crypto from 'crypto';
import { db } from '../db.js';

const EARLY_ASSIGNMENT_BACKFILL_KEY = 'pickup_cells_early_assignment_backfill_v1';

export function migratePickupCells() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_pickup_cell_assignments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      cell_number INTEGER NOT NULL CHECK (cell_number BETWEEN 1 AND 100),
      assigned_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      released_at TEXT,
      release_reason TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_pickup_cells_one_active_cell
      ON order_pickup_cell_assignments(cell_number)
      WHERE released_at IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_pickup_cells_one_active_order
      ON order_pickup_cell_assignments(order_id)
      WHERE released_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_pickup_cells_order_history
      ON order_pickup_cell_assignments(order_id, assigned_at DESC);
  `);

  db.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES ('pickup_cell_capacity', '50')`,
  ).run();

  const alreadyBackfilled = db
    .prepare(`SELECT 1 FROM settings WHERE key = ? LIMIT 1`)
    .get(EARLY_ASSIGNMENT_BACKFILL_KEY);
  if (alreadyBackfilled) return;

  const backfill = db.transaction(() => {
    const capacityRow = db
      .prepare(`SELECT value FROM settings WHERE key = 'pickup_cell_capacity'`)
      .get();
    const capacity = Math.max(1, Math.min(100, Number(capacityRow?.value) || 50));
    const occupied = new Set(
      db.prepare(
        `SELECT cell_number
           FROM order_pickup_cell_assignments
          WHERE released_at IS NULL`,
      ).all().map((row) => Number(row.cell_number)),
    );
    const orders = db.prepare(
      `SELECT o.id
         FROM orders o
        WHERE o.status = 'new'
          AND NOT EXISTS (
            SELECT 1
              FROM order_pickup_cell_assignments a
             WHERE a.order_id = o.id AND a.released_at IS NULL
          )
        ORDER BY o.created_at ASC, o.rowid ASC`,
    ).all();

    for (const order of orders) {
      let cellNumber = null;
      for (let candidate = 1; candidate <= capacity; candidate += 1) {
        if (!occupied.has(candidate)) {
          cellNumber = candidate;
          break;
        }
      }
      if (!cellNumber) {
        const error = new Error(
          'Недостаточно свободных ячеек для существующих новых заказов',
        );
        error.code = 'pickup_cells_full';
        throw error;
      }
      db.prepare(
        `INSERT INTO order_pickup_cell_assignments (id, order_id, cell_number)
         VALUES (?, ?, ?)`,
      ).run(`pca_${crypto.randomUUID()}`, order.id, cellNumber);
      occupied.add(cellNumber);
    }

    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, DATETIME('now'))`,
    ).run(EARLY_ASSIGNMENT_BACKFILL_KEY);
  });

  backfill.immediate();
}
