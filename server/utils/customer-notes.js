import { db } from '../db.js';
import { normalizeUsername } from './customer-blocks.js';
export const MAX_CUSTOMER_NOTE_LENGTH = 2000;

const USERNAME_RE = /^[a-z0-9_]{1,32}$/;

/**
 * @param {unknown} raw
 * @returns {string|null}
 */
export function sanitizeCustomerNote(raw) {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_CUSTOMER_NOTE_LENGTH) {
    const err = new Error('note_too_long');
    err.code = 'note_too_long';
    throw err;
  }
  return trimmed;
}

/**
 * @param {unknown} raw
 */
export function assertValidNoteUsername(raw) {
  const username = normalizeUsername(raw);
  if (!username || !USERNAME_RE.test(username)) {
    const err = new Error('invalid_telegram_username');
    err.code = 'invalid_telegram_username';
    throw err;
  }
  return username;
}

function deletePendingNotesForUsername(username) {
  const u = normalizeUsername(username);
  if (!u) return 0;
  return db
    .prepare(
      `DELETE FROM pending_customer_notes WHERE telegram_username = ? COLLATE NOCASE`,
    )
    .run(u).changes;
}

/**
 * @param {string} customerId
 */
export function touchKanbanOrdersForCustomer(customerId) {
  if (!customerId) return 0;
  const result = db
    .prepare(
      `UPDATE orders
          SET updated_at = DATETIME('now')
        WHERE customer_id = ?
          AND archived = 0
          AND (needs_manager_action = 1 OR status IN ('new', 'in_progress', 'cancelled'))`,
    )
    .run(String(customerId));
  return result.changes;
}

/**
 * @param {unknown} username
 */
export function getPendingNoteForUsername(username) {
  const u = normalizeUsername(username);
  if (!u) return null;
  return (
    db
      .prepare(
        `SELECT * FROM pending_customer_notes
          WHERE telegram_username = ? COLLATE NOCASE
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
      )
      .get(u) ?? null
  );
}

export function listPendingCustomerNotes({ limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  return db
    .prepare(
      `SELECT * FROM pending_customer_notes
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
    )
    .all(safeLimit);
}

function setCustomerNotes(customerId, notes) {
  db.prepare(
    `UPDATE customers
        SET notes = ?, updated_at = DATETIME('now')
      WHERE id = ?`,
  ).run(notes, String(customerId));
  touchKanbanOrdersForCustomer(customerId);
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(String(customerId));
}

/**
 * @param {object} args
 * @param {string} [args.customer_id]
 * @param {string} [args.telegram_username]
 * @param {unknown} args.notes
 * @param {string|null} [args.created_by]
 */
export function upsertCustomerNote({
  customer_id,
  telegram_username,
  notes,
  created_by = null,
} = {}) {
  const sanitized = sanitizeCustomerNote(notes);

  if (customer_id) {
    const customer = db
      .prepare('SELECT * FROM customers WHERE id = ?')
      .get(String(customer_id));
    if (!customer) {
      const err = new Error('customer_not_found');
      err.code = 'customer_not_found';
      throw err;
    }
    const updated = setCustomerNotes(customer.id, sanitized);
    if (customer.telegram_username) {
      deletePendingNotesForUsername(customer.telegram_username);
    }
    return {
      kind: 'active',
      notes: sanitized,
      customer: updated,
    };
  }

  const username = assertValidNoteUsername(telegram_username);

  const existingCustomer = db
    .prepare(
      `SELECT id, telegram_username FROM customers
        WHERE telegram_username = ? COLLATE NOCASE
        LIMIT 1`,
    )
    .get(username);

  if (existingCustomer) {
    return upsertCustomerNote({
      customer_id: existingCustomer.id,
      notes: sanitized,
      created_by,
    });
  }

  if (sanitized === null) {
    const removed = deletePendingNotesForUsername(username);
    return { kind: 'pending_cleared', removed };
  }

  deletePendingNotesForUsername(username);
  const result = db
    .prepare(
      `INSERT INTO pending_customer_notes (telegram_username, notes, created_by)
       VALUES (?, ?, ?)`,
    )
    .run(username, sanitized, created_by);

  const pending = db
    .prepare('SELECT * FROM pending_customer_notes WHERE id = ?')
    .get(result.lastInsertRowid);

  return { kind: 'pending', notes: sanitized, pending };
}

/**
 * @param {object} args
 * @param {string} [args.customer_id]
 * @param {string} [args.telegram_username]
 * @param {number|string} [args.pending_id]
 */
export function clearCustomerNote({
  customer_id,
  telegram_username,
  pending_id,
} = {}) {
  if (pending_id !== undefined && pending_id !== null) {
    const result = db
      .prepare('DELETE FROM pending_customer_notes WHERE id = ?')
      .run(Number(pending_id));
    return { kind: 'pending_removed', removed: result.changes > 0 };
  }

  return upsertCustomerNote({ customer_id, telegram_username, notes: null });
}

/**
 * При первом контакте клиента переносим pending-заметку в customers.notes,
 * только если поле пустое.
 *
 * @param {{ id: string, telegram_username?: string|null }} customer
 */
export function activatePendingNotesForCustomer(customer) {
  if (!customer?.id) return 0;
  const username = normalizeUsername(customer.telegram_username);
  if (!username) return 0;

  const pendings = db
    .prepare(
      `SELECT * FROM pending_customer_notes
        WHERE telegram_username = ? COLLATE NOCASE
        ORDER BY created_at DESC, id DESC`,
    )
    .all(username);

  if (pendings.length === 0) return 0;

  const row = db
    .prepare('SELECT notes FROM customers WHERE id = ?')
    .get(String(customer.id));
  const hasNotes = Boolean(String(row?.notes || '').trim());

  let applied = 0;
  const noteToApply = pendings[0];

  if (!hasNotes && noteToApply?.notes?.trim()) {
    setCustomerNotes(customer.id, noteToApply.notes.trim());
    applied = 1;
  } else if (hasNotes) {
    console.warn(
      `[customer-notes] pending for @${username} skipped — customer ${customer.id} already has notes`,
    );
  }

  for (const p of pendings) {
    db.prepare('DELETE FROM pending_customer_notes WHERE id = ?').run(p.id);
  }

  return applied;
}

export function serializePendingNote(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    kind: 'pending',
    telegram_username: row.telegram_username,
    notes: row.notes,
    created_by: row.created_by ?? null,
    created_at: row.created_at ?? null,
  };
}