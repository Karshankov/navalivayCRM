import { db } from '../db.js';

/**
 * Ядро логики блокировок клиентов.
 *
 * Сценарии:
 *   - Существующий клиент → запись в `customer_blocks` с реальным `customer_id`.
 *   - Превентивный бан по @username (клиента ещё нет) → запись в `pending_customer_bans`.
 *     При первом контакте этого клиента (см. `activatePendingBansForCustomer`)
 *     pending переносится в `customer_blocks` и удаляется из pending.
 *
 * Срок блокировки:
 *   - `block_until = NULL` → бессрочно.
 *   - `block_until = ISO datetime` → активна пока DATETIME('now') < block_until.
 *
 * `active = 1` это «вручную не снят». Истечение по сроку проверяется
 * выражением SQL (см. `ACTIVE_BLOCK_PREDICATE`).
 */

/**
 * Унифицированный SQL-предикат «блок реально активен сейчас».
 * Используется во всех проверочных запросах, чтобы не дублировать логику.
 */
export const ACTIVE_BLOCK_PREDICATE =
  "active = 1 AND (block_until IS NULL OR block_until > DATETIME('now'))";

/**
 * SQL-предикат «pending бан ещё не истёк» (для pending_customer_bans,
 * у которых нет колонки `active` — они «активны» пока существуют).
 */
export const PENDING_ACTIVE_PREDICATE =
  "(block_until IS NULL OR block_until > DATETIME('now'))";

/**
 * Преобразует `{ unit, value }` в ISO datetime для `block_until`.
 *   - unit === 'forever' → null (бессрочно)
 *   - 'minutes' / 'hours' / 'days' → DATETIME('now') + value
 * Бросает Error на неизвестный unit или невалидное value.
 */
export function computeBlockUntil({ unit, value } = {}) {
  if (unit === 'forever' || unit === undefined || unit === null) {
    return null;
  }
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error('invalid_block_value');
  }
  const ms = (() => {
    switch (unit) {
      case 'minutes':
        return v * 60 * 1000;
      case 'hours':
        return v * 60 * 60 * 1000;
      case 'days':
        return v * 24 * 60 * 60 * 1000;
      default:
        throw new Error('invalid_block_unit');
    }
  })();
  return toSqliteUtcString(new Date(Date.now() + ms));
}

function toSqliteUtcString(date) {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/**
 * Возвращает «голую» @username без префикса @, в lowercase. Пусто → null.
 */
export function normalizeUsername(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^@+/, '');
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

/**
 * Ищет активный блок для клиента по его внутреннему ID.
 * Возвращает запись или null.
 */
export function getActiveBlockForCustomerId(customerId) {
  if (!customerId) return null;
  return (
    db
      .prepare(
        `SELECT * FROM customer_blocks
         WHERE customer_id = ?
           AND ${ACTIVE_BLOCK_PREDICATE}
         ORDER BY blocked_at DESC
         LIMIT 1`,
      )
      .get(String(customerId)) ?? null
  );
}

/**
 * Поиск активного блока по telegram_id (через customers.telegram_id).
 * Возвращает блок или null.
 */
export function getActiveBlockForTelegramId(telegramId) {
  if (!telegramId) return null;
  const customer = db
    .prepare('SELECT id FROM customers WHERE telegram_id = ?')
    .get(String(telegramId));
  if (!customer) return null;
  return getActiveBlockForCustomerId(customer.id);
}

/**
 * Поиск «pending» бана по @username (для клиентов, которых ещё нет в БД).
 * Pending не имеют поля active — записи живут пока их не активирует
 * `activatePendingBansForCustomer`. Берём самую свежую (если их несколько).
 *
 * Сравнение через `COLLATE NOCASE` (а не LOWER(...)) — чтобы планировщик
 * мог использовать `idx_pending_bans_username` (LOWER на колонке отключает
 * индекс).
 */
export function getPendingBanForUsername(username) {
  const u = normalizeUsername(username);
  if (!u) return null;
  return (
    db
      .prepare(
        `SELECT * FROM pending_customer_bans
         WHERE telegram_username = ? COLLATE NOCASE
           AND ${PENDING_ACTIVE_PREDICATE}
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(u) ?? null
  );
}

/**
 * Создаёт блок. Универсальная точка входа из админских endpoint'ов.
 *
 * Логика выбора таблицы:
 *   1) Передан `customer_id` → пишем в customer_blocks.
 *   2) Передан `telegram_username` и в БД есть customer с таким username
 *      (case-insensitive) → пишем в customer_blocks для этого customer.id.
 *   3) Передан `telegram_username` и customer не найден → создаём
 *      pending_customer_bans (превентивный бан).
 *
 * Возвращает: { kind: 'active'|'pending', block } где block — созданная запись.
 * Бросает Error('already_blocked') если у клиента уже есть активный блок.
 */
export function createBlock({
  customer_id,
  telegram_username,
  block_until,
  reason,
  blocked_by,
  block_type = 'delivery',
}) {
  // Сценарий 1: явный customer_id
  if (customer_id) {
    const exists = db
      .prepare('SELECT id FROM customers WHERE id = ?')
      .get(String(customer_id));
    if (!exists) {
      const err = new Error('customer_not_found');
      err.code = 'customer_not_found';
      throw err;
    }
    return insertCustomerBlock({
      customer_id: String(customer_id),
      block_until,
      reason,
      blocked_by,
      block_type,
    });
  }

  // Сценарий 2/3: вход по @username
  const username = normalizeUsername(telegram_username);
  if (!username) {
    throw new Error('customer_id_or_telegram_username_required');
  }

  const existingCustomer = db
    .prepare(
      'SELECT id FROM customers WHERE telegram_username = ? COLLATE NOCASE LIMIT 1',
    )
    .get(username);

  if (existingCustomer) {
    return insertCustomerBlock({
      customer_id: existingCustomer.id,
      block_until,
      reason,
      blocked_by,
      block_type,
    });
  }

  // Pending — клиент ещё не появлялся
  const result = db
    .prepare(
      `INSERT INTO pending_customer_bans (telegram_username, block_until, reason, created_by)
       VALUES (?, ?, ?, ?)`,
    )
    .run(username, block_until ?? null, reason ?? null, blocked_by ?? null);
  const inserted = db
    .prepare('SELECT * FROM pending_customer_bans WHERE id = ?')
    .get(result.lastInsertRowid);
  return { kind: 'pending', block: inserted };
}

function generateBlockId() {
  return `block_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Вставка блока с защитой от race condition. Логика:
 *   - Транзакция: пред-проверка + INSERT идут атомарно
 *   - Дополнительная страховка через partial UNIQUE index
 *     (`idx_customer_blocks_one_active`): если параллельный конкурент
 *     успеет первым, наш INSERT упадёт с SQLITE_CONSTRAINT — мы это
 *     ловим и возвращаем `already_blocked` с текущим существующим блоком.
 */
function insertCustomerBlock({ customer_id, block_until, reason, blocked_by, block_type = 'delivery' }) {
  const customerIdStr = String(customer_id);
  let inserted = null;

  const tx = db.transaction(() => {
    // Pavel 11.05.2026: «блокировка снялась, но повторно заблокать не могу».
    // Причина — partial UNIQUE индекс idx_customer_blocks_one_active работает
    // по `WHERE active = 1`, не учитывая block_until. Истёкший блок с
    // active=1 (никто его автоматически не снимает) занимает «слот», и
    // новый INSERT падает с SQLITE_CONSTRAINT_UNIQUE → код возвращает
    // already_blocked. Лечим: ДО pre-check'а гасим истёкшие блоки этого
    // клиента (active=0 + unblocked_at=now + reason='auto-expired').
    // Атомарно внутри той же транзакции, чтобы между expire и INSERT не
    // успел вклиниться параллельный bid.
    db.prepare(
      `UPDATE customer_blocks
         SET active = 0,
             unblocked_at = DATETIME('now'),
             unblocked_by = 'system',
             unblock_reason = 'auto-expired'
       WHERE customer_id = ?
         AND active = 1
         AND block_until IS NOT NULL
         AND block_until <= DATETIME('now')`,
    ).run(customerIdStr);

    const existing = getActiveBlockForCustomerId(customerIdStr);
    if (existing) {
      const err = new Error('already_blocked');
      err.code = 'already_blocked';
      err.existing = existing;
      throw err;
    }
    const blockId = generateBlockId();
    db.prepare(
      `INSERT INTO customer_blocks (id, customer_id, block_type, block_until, reason, blocked_by, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    ).run(
      blockId,
      customerIdStr,
      block_type,
      block_until ?? null,
      reason ?? null,
      blocked_by ?? null,
    );
    inserted = db
      .prepare('SELECT * FROM customer_blocks WHERE id = ?')
      .get(blockId);
  });

  try {
    tx();
  } catch (err) {
    // SQLITE_CONSTRAINT (от UNIQUE индекса) — race condition в параллели.
    // Превращаем в наш стандартный already_blocked.
    if (err && (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE/i.test(err.message))) {
      const wrap = new Error('already_blocked');
      wrap.code = 'already_blocked';
      wrap.existing = getActiveBlockForCustomerId(customerIdStr);
      throw wrap;
    }
    throw err;
  }

  return { kind: 'active', block: inserted };
}

/**
 * Возвращает блок по его ID (любой статус — active/0, истёкший/нет).
 */
export function getCustomerBlockById(blockId) {
  if (!blockId) return null;
  return db.prepare('SELECT * FROM customer_blocks WHERE id = ?').get(String(blockId)) ?? null;
}

/**
 * Снимает активный блок. Заполняет unblock-поля для аудита.
 * Возвращает обновлённую запись или null если блок не найден / уже снят.
 */
export function unblockCustomerBlock(blockId, { unblocked_by, unblock_reason } = {}) {
  if (!blockId) return null;
  const id = String(blockId);
  return db.transaction(() => {
    const result = db
      .prepare(
      `UPDATE customer_blocks
       SET active = 0,
           unblocked_at = DATETIME('now'),
           unblocked_by = ?,
           unblock_reason = ?
       WHERE id = ? AND active = 1`,
    )
      .run(unblocked_by ?? null, unblock_reason ?? null, id);
    if (result.changes === 0) return null;
    const updated = db.prepare('SELECT * FROM customer_blocks WHERE id = ?').get(id);
    if (updated?.block_type === 'authorization_failed') {
      const customer = db
        .prepare('SELECT telegram_id FROM customers WHERE id = ?')
        .get(updated.customer_id);
      if (customer?.telegram_id) {
        db.prepare(`
        INSERT INTO referral_auth_states (
          telegram_id, customer_id, attempts_used, status, last_error_code,
          last_username, blocked_at, updated_at
        ) VALUES (?, ?, 0, 'pending', NULL, NULL, NULL, DATETIME('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET
          customer_id = excluded.customer_id,
          attempts_used = 0,
          status = 'pending',
          last_error_code = NULL,
          last_username = NULL,
          blocked_at = NULL,
          updated_at = DATETIME('now')
        `).run(String(customer.telegram_id), updated.customer_id);
      }
    }
    return updated;
  })();
}

/**
 * Удаляет pending бан (без аудит-записи — pending не «снимают», их отменяют).
 */
export function deletePendingBan(pendingId) {
  if (!pendingId) return false;
  const result = db
    .prepare('DELETE FROM pending_customer_bans WHERE id = ?')
    .run(Number(pendingId));
  return result.changes > 0;
}

/**
 * При первом контакте клиента (upsertPublicCustomer) проверяем — есть ли
 * pending-бан по его @username. Если есть — переносим в customer_blocks
 * (с реальным customer_id, через `insertCustomerBlock`, чтобы получить
 * правильный generated id и пройти все валидации) и удаляем pending.
 *
 * Если у клиента уже есть активный блок — pending **не удаляется** (мы его
 * не теряем, чтобы был аудит-след). Логируем это как warning — это сигнал
 * что админ создал второй бан в обход уже существующего.
 *
 * Возвращает количество активированных банов.
 */
export function activatePendingBansForCustomer(customer) {
  if (!customer || !customer.id) return 0;
  const username = normalizeUsername(customer.telegram_username);
  if (!username) return 0;

  const pendings = db
    .prepare(
      `SELECT * FROM pending_customer_bans
       WHERE telegram_username = ? COLLATE NOCASE`,
    )
    .all(username);

  if (pendings.length === 0) return 0;

  let activated = 0;
  for (const p of pendings) {
    try {
      insertCustomerBlock({
        customer_id: customer.id,
        block_until: p.block_until,
        reason: p.reason,
        blocked_by: p.created_by,
      });
      activated += 1;
      // Pending конвертирован — удаляем
      db.prepare('DELETE FROM pending_customer_bans WHERE id = ?').run(p.id);
    } catch (err) {
      if (err && err.code === 'already_blocked') {
        // У клиента уже есть активный блок — оставляем pending как есть
        // (для аудита: видно, что админ дублировал бан). Менеджер сможет
        // вручную удалить pending через DELETE /api/admin/crm/blocks/:id.
        console.warn(
          `[customer-blocks] pending #${p.id} for @${username} not activated — customer ${customer.id} already has active block`,
        );
      } else {
        // Прочие ошибки — пробрасываем (может быть проблема с БД)
        throw err;
      }
    }
  }
  return activated;
}

/**
 * Удобный сериализатор блока для API-ответов.
 * Унифицирует представление активных и pending блоков.
 */
export function serializeBlock(block, kind = 'active') {
  if (!block) return null;
  if (kind === 'pending') {
    return {
      id: block.id,
      kind: 'pending',
      telegram_username: block.telegram_username,
      block_until: block.block_until ?? null,
      reason: block.reason ?? null,
      blocked_at: block.created_at,
      blocked_by: block.created_by ?? null,
    };
  }
  return {
    id: block.id,
    kind: 'active',
    customer_id: block.customer_id,
    block_until: block.block_until ?? null,
    reason: block.reason ?? null,
    blocked_at: block.blocked_at,
    blocked_by: block.blocked_by ?? null,
    unblocked_at: block.unblocked_at ?? null,
    unblocked_by: block.unblocked_by ?? null,
    unblock_reason: block.unblock_reason ?? null,
  };
}
