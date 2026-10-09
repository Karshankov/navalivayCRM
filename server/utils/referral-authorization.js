import { db } from '../db.js';
import {
  createBlock,
  getActiveBlockForCustomerId,
  normalizeUsername,
} from './customer-blocks.js';

export const REFERRAL_MAX_ATTEMPTS = 3;
export const AUTHORIZATION_FAILED_REASON = 'Авторизация не пройдена';
const USERNAME_RE = /^[a-zA-Z0-9_]{5,32}$/;

export function isReferralAuthorizationEnabled() {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'referral_authorization_enabled'")
    .get();
  return String(row?.value || '0') === '1';
}

export function setReferralAuthorizationEnabled(enabled) {
  db.transaction(() => {
    // Пока выключатель был отключён, люди могли оформить заказ по старому
    // сценарию. К моменту включения они уже являются существующими клиентами:
    // разрешаем им доступ и сообщения так же, как старой базе при миграции.
    if (enabled) {
      db.prepare(`
        UPDATE customers
        SET access_authorization_source = 'legacy',
            updated_at = DATETIME('now')
        WHERE access_authorized_at IS NOT NULL
          AND access_authorization_source = 'feature_disabled'
          AND EXISTS (
            SELECT 1 FROM orders o
            WHERE o.customer_id = customers.id
              AND o.status IN ('completed', 'delivered')
          )
      `).run();
    }
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('referral_authorization_enabled', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(enabled ? '1' : '0');
  }).immediate();
  return enabled;
}

export function isCustomerAccessAuthorized(customerOrId) {
  if (!customerOrId) return false;
  const customer = typeof customerOrId === 'object'
    ? customerOrId
    : db.prepare('SELECT * FROM customers WHERE id = ?').get(String(customerOrId));
  const hasIssuedOrder = customer?.id
    ? Boolean(db.prepare(`
        SELECT 1 FROM orders
        WHERE customer_id = ? AND status IN ('completed', 'delivered')
        LIMIT 1
      `).get(customer.id))
    : false;
  // При выключенной функции заказ сохраняется как разрешённый на будущее,
  // но старый порядок сообщений остаётся прежним: до выдачи заказа бот молчит.
  // Выданный заказ всегда достаточен, независимо от старого источника.
  if (hasIssuedOrder) return true;
  if (customer?.access_authorization_source === 'feature_disabled') return false;
  // До запуска новой авторизации менеджер мог явно подтвердить клиента через
  // старую bot-верификацию даже без выданного заказа. Такой клиент остаётся
  // «своим». Одного legacy-флага недостаточно: ранняя тестовая миграция могла
  // ошибочно поставить его пустой записи.
  if (customer?.access_authorization_source === 'legacy') {
    return Boolean(customer.access_authorized_at && customer.bot_verified_at);
  }
  if (customer?.access_authorized_at) return true;
  // Страховка для нестандартной старой базы с повреждённым маркером миграции.
  return isReferralAuthorizationEnabled() && hasIssuedOrder;
}

export function getReferralAuthorizationStatus(telegramId) {
  const enabled = isReferralAuthorizationEnabled();
  if (!telegramId) {
    return { enabled, required: enabled, attempts_used: 0, attempts_remaining: 3 };
  }
  const customer = db
    .prepare(`
      SELECT id, access_authorized_at, access_authorization_source, bot_verified_at
      FROM customers WHERE telegram_id = ?
    `)
    .get(String(telegramId));
  const state = db
    .prepare('SELECT * FROM referral_auth_states WHERE telegram_id = ?')
    .get(String(telegramId));
  const attemptsUsed = Math.max(0, Math.min(3, Number(state?.attempts_used || 0)));
  const authorized = Boolean(isCustomerAccessAuthorized(customer) || state?.status === 'authorized');
  const blocked = state?.status === 'blocked' || attemptsUsed >= REFERRAL_MAX_ATTEMPTS;
  return {
    enabled,
    required: enabled && !authorized && !blocked,
    authorized,
    blocked,
    attempts_used: attemptsUsed,
    attempts_remaining: Math.max(0, REFERRAL_MAX_ATTEMPTS - attemptsUsed),
  };
}

export function getReferralOrderCreationGate(telegramId) {
  const status = getReferralAuthorizationStatus(telegramId);
  if (!status.enabled || status.authorized) {
    return { allowed: true, reason: null, status };
  }
  return {
    allowed: false,
    reason: status.blocked ? 'authorization_failed' : 'authorization_required',
    status,
  };
}

export function getActiveInviteBan(customerId) {
  if (!customerId) return null;
  return db.prepare(`
    SELECT * FROM customer_invite_bans
    WHERE customer_id = ? AND active = 1
    ORDER BY banned_at DESC, id DESC
    LIMIT 1
  `).get(String(customerId)) || null;
}

export function listDisallowedInviterUsernames() {
  return db.prepare(`
    SELECT username, added_at, added_by
    FROM referral_disallowed_inviter_usernames
    ORDER BY username COLLATE NOCASE ASC
  `).all();
}

export function addDisallowedInviterUsernames(rawUsernames, addedBy = null) {
  if (!Array.isArray(rawUsernames)) {
    throw Object.assign(new Error('usernames_must_be_array'), { code: 'usernames_must_be_array' });
  }
  if (rawUsernames.length === 0 || rawUsernames.length > 100) {
    throw Object.assign(new Error('usernames_count_invalid'), { code: 'usernames_count_invalid' });
  }

  const usernames = [...new Set(rawUsernames.map(normalizeUsername))];
  if (usernames.some((username) => !username || !USERNAME_RE.test(username))) {
    throw Object.assign(new Error('username_invalid'), { code: 'username_invalid' });
  }
  const conflicting = usernames.find((username) => {
    const active = db.prepare(`
      SELECT 1
      FROM customer_invite_bans ib
      JOIN customers c ON c.id = ib.customer_id
      WHERE ib.active = 1 AND c.telegram_username = ? COLLATE NOCASE
    `).get(username);
    const pending = db.prepare(`
      SELECT 1 FROM pending_customer_invite_bans
      WHERE telegram_username = ? COLLATE NOCASE
    `).get(username);
    return active || pending;
  });
  if (conflicting) {
    throw Object.assign(new Error('username_has_invite_ban'), {
      code: 'username_has_invite_ban',
      username: conflicting,
    });
  }

  const insert = db.prepare(`
    INSERT INTO referral_disallowed_inviter_usernames (username, added_by)
    VALUES (?, ?)
    ON CONFLICT(username) DO NOTHING
  `);
  db.transaction(() => {
    for (const username of usernames) insert.run(username, addedBy || null);
  }).immediate();
  return listDisallowedInviterUsernames();
}

export function removeDisallowedInviterUsername(rawUsername) {
  const username = normalizeUsername(rawUsername);
  if (!username || !USERNAME_RE.test(username)) return false;
  return db.prepare(`
    DELETE FROM referral_disallowed_inviter_usernames WHERE username = ? COLLATE NOCASE
  `).run(username).changes > 0;
}

export function isDisallowedInviterUsername(rawUsername) {
  const username = normalizeUsername(rawUsername);
  if (!username) return false;
  return Boolean(db.prepare(`
    SELECT 1 FROM referral_disallowed_inviter_usernames
    WHERE username = ? COLLATE NOCASE
  `).get(username));
}

/** Чистая проверка. Никаких Telegram-вызовов и списания попыток. */
export function inspectInviter({ telegramId, telegramUsername, rawUsername }) {
  if (typeof rawUsername !== 'string' || /^\s*@@/.test(rawUsername)) {
    return { ok: false, code: 'referral_username_invalid', consumesAttempt: true };
  }
  const username = normalizeUsername(rawUsername);
  if (!username || !USERNAME_RE.test(username)) {
    return { ok: false, code: 'referral_username_invalid', consumesAttempt: true };
  }
  const candidates = db.prepare(`
    SELECT id, telegram_id, telegram_username, deleted_at,
           access_authorized_at, access_authorization_source, bot_verified_at
    FROM customers
    WHERE telegram_username = ? COLLATE NOCASE
      AND deleted_at IS NULL
    ORDER BY updated_at DESC, id DESC
  `).all(username);

  if (candidates.some((candidate) => getActiveInviteBan(candidate.id))) {
    return { ok: false, code: 'referral_inviter_forbidden', consumesAttempt: true };
  }
  const pendingInviteBan = db.prepare(`
    SELECT 1 FROM pending_customer_invite_bans
    WHERE telegram_username = ? COLLATE NOCASE
  `).get(username);
  if (pendingInviteBan) {
    return { ok: false, code: 'referral_inviter_forbidden', consumesAttempt: true };
  }
  if (candidates.length > 1) {
    return { ok: false, code: 'referral_username_ambiguous', consumesAttempt: false };
  }
  if (isDisallowedInviterUsername(username)) {
    return { ok: false, code: 'referral_inviter_reserved', consumesAttempt: false };
  }
  if (candidates.length === 0) {
    return { ok: false, code: 'referral_inviter_not_eligible', consumesAttempt: true };
  }

  const inviter = candidates[0];
  const requesterUsername = normalizeUsername(telegramUsername);
  if (
    String(inviter.telegram_id || '') === String(telegramId || '') ||
    (requesterUsername && normalizeUsername(inviter.telegram_username) === requesterUsername)
  ) {
    return { ok: false, code: 'referral_self_invite', consumesAttempt: true };
  }

  const hasIssuedOrder = db.prepare(`
    SELECT 1 FROM orders
    WHERE customer_id = ? AND status IN ('completed', 'delivered')
    LIMIT 1
  `).get(inviter.id);
  const isVerifiedLegacy = inviter.access_authorization_source === 'legacy'
    && inviter.access_authorized_at
    && inviter.bot_verified_at;
  if (!hasIssuedOrder && !isVerifiedLegacy) {
    return { ok: false, code: 'referral_inviter_not_eligible', consumesAttempt: true };
  }

  if (getActiveBlockForCustomerId(inviter.id)) {
    return { ok: false, code: 'referral_inviter_blocked', consumesAttempt: false };
  }
  return { ok: true, username, inviter };
}

function ensureUnauthorizedCustomer(identity) {
  const telegramId = String(identity.telegramId || '');
  let customer = db.prepare('SELECT * FROM customers WHERE telegram_id = ?').get(telegramId);
  if (customer) return customer;
  const id = `cust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO customers (
      id, telegram_id, telegram_username, first_name, last_name,
      first_visit_at, last_visit_at, total_orders, total_spent
    ) VALUES (?, ?, ?, ?, ?, DATETIME('now'), DATETIME('now'), 0, 0)
  `).run(
    id,
    telegramId,
    normalizeUsername(identity.telegramUsername),
    identity.firstName || null,
    identity.lastName || null,
  );
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
}

export function recordReferralOutcome({ identity, rawUsername, result }) {
  const telegramId = String(identity?.telegramId || '');
  if (!telegramId) throw new Error('telegram_id_required');
  const submitted = normalizeUsername(rawUsername);

  if (!result?.consumesAttempt) {
    db.prepare(`
      INSERT INTO referral_auth_events (
        telegram_id, submitted_username, outcome, attempt_number
      ) VALUES (?, ?, ?, NULL)
    `).run(telegramId, submitted, result?.code || 'technical_error');
    return getReferralAuthorizationStatus(telegramId);
  }

  const recordConsumedAttempt = () => {
    const current = db
      .prepare('SELECT * FROM referral_auth_states WHERE telegram_id = ?')
      .get(telegramId);
    const authorizationCustomer = db
      .prepare('SELECT * FROM customers WHERE telegram_id = ?')
      .get(telegramId);
    const alreadyAuthorized = current?.status === 'authorized'
      || isCustomerAccessAuthorized(authorizationCustomer);
    if (alreadyAuthorized) {
      db.prepare(`
        INSERT INTO referral_auth_events (
          telegram_id, customer_id, submitted_username, outcome, attempt_number
        ) VALUES (?, ?, ?, 'ignored_after_authorization', NULL)
      `).run(telegramId, current?.customer_id || null, submitted);
      return getReferralAuthorizationStatus(telegramId);
    }

    // Между предварительной проверкой API и записью результата менеджер мог
    // заблокировать клиента. Повторно проверяем это уже под IMMEDIATE-транзакцией:
    // обычный бан не должен превращать третью ошибку в неснимаемый auth-бан.
    const existingCustomer = current?.customer_id
      ? db.prepare('SELECT id FROM customers WHERE id = ?').get(current.customer_id)
      : authorizationCustomer;
    const activeCustomerBlock = existingCustomer
      ? getActiveBlockForCustomerId(existingCustomer.id)
      : null;
    if (activeCustomerBlock) {
      db.prepare(`
        INSERT INTO referral_auth_events (
          telegram_id, customer_id, submitted_username, outcome, attempt_number
        ) VALUES (?, ?, ?, 'customer_blocked_during_authorization', NULL)
      `).run(telegramId, existingCustomer.id, submitted);
      return {
        ...getReferralAuthorizationStatus(telegramId),
        customer_blocked: true,
      };
    }

    const nextAttempts = Math.min(3, Number(current?.attempts_used || 0) + 1);
    const blocked = nextAttempts >= REFERRAL_MAX_ATTEMPTS;
    let customerId = current?.customer_id || null;

    if (blocked) {
      const customer = ensureUnauthorizedCustomer(identity);
      customerId = customer.id;
      const active = getActiveBlockForCustomerId(customer.id);
      if (!active) {
        createBlock({
          customer_id: customer.id,
          reason: AUTHORIZATION_FAILED_REASON,
          blocked_by: 'system',
          block_until: null,
          block_type: 'authorization_failed',
        });
      }
    }

    db.prepare(`
      INSERT INTO referral_auth_states (
        telegram_id, customer_id, attempts_used, status, last_error_code,
        last_username, blocked_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, DATETIME('now'))
      ON CONFLICT(telegram_id) DO UPDATE SET
        customer_id = excluded.customer_id,
        attempts_used = excluded.attempts_used,
        status = excluded.status,
        last_error_code = excluded.last_error_code,
        last_username = excluded.last_username,
        blocked_at = excluded.blocked_at,
        updated_at = DATETIME('now')
    `).run(
      telegramId,
      customerId,
      nextAttempts,
      blocked ? 'blocked' : 'pending',
      result.code,
      submitted,
      blocked ? new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '') : null,
    );
    db.prepare(`
      INSERT INTO referral_auth_events (
        telegram_id, customer_id, submitted_username, outcome, attempt_number
      ) VALUES (?, ?, ?, ?, ?)
    `).run(telegramId, customerId, submitted, result.code, nextAttempts);
    return getReferralAuthorizationStatus(telegramId);
  };
  if (db.inTransaction) return recordConsumedAttempt();
  return db.transaction(recordConsumedAttempt).immediate();
}

export function markReferralAuthorized({ customerId, telegramId, inviter, submittedUsername, orderId }) {
  const username = normalizeUsername(submittedUsername);
  db.prepare(`
    UPDATE customers
    SET access_authorized_at = COALESCE(access_authorized_at, DATETIME('now')),
        access_authorization_source = 'referral',
        updated_at = DATETIME('now')
    WHERE id = ?
  `).run(customerId);
  db.prepare(`
    INSERT INTO customer_referrals (
      invitee_customer_id, inviter_customer_id, inviter_username_snapshot,
      submitted_username, first_order_id
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(invitee_customer_id) DO NOTHING
  `).run(customerId, inviter.id, normalizeUsername(inviter.telegram_username) || username, username, orderId);
  db.prepare(`
    INSERT INTO referral_auth_states (
      telegram_id, customer_id, attempts_used, status, last_error_code,
      last_username, blocked_at, updated_at
    ) VALUES (?, ?, 0, 'authorized', NULL, ?, NULL, DATETIME('now'))
    ON CONFLICT(telegram_id) DO UPDATE SET
      customer_id = excluded.customer_id,
      status = 'authorized',
      last_error_code = NULL,
      last_username = excluded.last_username,
      blocked_at = NULL,
      updated_at = DATETIME('now')
  `).run(String(telegramId), customerId, username);
  db.prepare(`
    INSERT INTO referral_auth_events (
      telegram_id, customer_id, submitted_username, outcome, attempt_number, inviter_customer_id
    ) VALUES (?, ?, ?, 'authorized', NULL, ?)
  `).run(String(telegramId), customerId, username, inviter.id);
  // Отправка выполняется воркером после фиксации транзакции. PRIMARY KEY по
  // customer_id не даёт повторному запросу авторизации прислать второй /Прайс.
  db.prepare(`
    INSERT OR IGNORE INTO referral_welcome_notifications (
      customer_id, telegram_id, status, attempts, next_attempt_at
    ) VALUES (?, ?, 'pending', 0, DATETIME('now'))
  `).run(customerId, String(telegramId));
}

export function authorizeCustomerWithoutReferral(customerId, source = 'staff') {
  if (!customerId) return;
  const normalizedSource = ['referral', 'staff', 'legacy', 'feature_disabled'].includes(source)
    ? source
    : 'staff';
  db.prepare(`
    UPDATE customers
    SET access_authorized_at = COALESCE(access_authorized_at, DATETIME('now')),
        access_authorization_source = CASE
          WHEN access_authorization_source = 'referral' OR ? = 'referral' THEN 'referral'
          WHEN access_authorization_source = 'staff' OR ? = 'staff' THEN 'staff'
          WHEN access_authorization_source = 'legacy' OR ? = 'legacy' THEN 'legacy'
          ELSE 'feature_disabled'
        END,
        updated_at = DATETIME('now')
    WHERE id = ?
  `).run(normalizedSource, normalizedSource, normalizedSource, String(customerId));
}

function resolveCustomerForAdmin({ customerId, telegramUsername }) {
  if (customerId) {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL')
      .get(String(customerId));
    if (!customer) throw Object.assign(new Error('customer_not_found'), { code: 'customer_not_found' });
    return customer;
  }
  const username = normalizeUsername(telegramUsername);
  if (!username || !USERNAME_RE.test(username)) {
    throw Object.assign(new Error('username_invalid'), { code: 'username_invalid' });
  }
  const matches = db.prepare(`
    SELECT * FROM customers
    WHERE telegram_username = ? COLLATE NOCASE AND deleted_at IS NULL
  `).all(username);
  if (matches.length > 1) {
    throw Object.assign(new Error('username_ambiguous'), { code: 'username_ambiguous' });
  }
  return matches[0] || null;
}

export function grantStaffAccess({ customerId, telegramUsername, grantedBy }) {
  const username = normalizeUsername(telegramUsername);
  const customer = resolveCustomerForAdmin({ customerId, telegramUsername });
  if (!customer) {
    const result = db.prepare(`
      INSERT INTO pending_staff_access_grants (telegram_username, granted_by)
      VALUES (?, ?)
      ON CONFLICT(telegram_username) DO UPDATE SET granted_by = excluded.granted_by
    `).run(username, grantedBy || null);
    const pending = db.prepare(`
      SELECT * FROM pending_staff_access_grants
      WHERE telegram_username = ? COLLATE NOCASE
    `).get(username);
    return { kind: 'pending', grant: pending, created: result.changes > 0 };
  }

  return db.transaction(() => {
    const hasReferral = Boolean(db.prepare(`
      SELECT 1 FROM customer_referrals WHERE invitee_customer_id = ?
    `).get(customer.id));
    if (hasReferral || customer.access_authorization_source === 'referral') {
      return { kind: 'active', customer, already_authorized: true, source: 'referral' };
    }
    if (isCustomerAccessAuthorized(customer)) {
      return {
        kind: 'active',
        customer,
        already_authorized: true,
        source: customer.access_authorization_source || 'issued_order',
      };
    }

    db.prepare(`
      UPDATE customer_blocks
      SET active = 0,
          unblocked_at = DATETIME('now'),
          unblocked_by = ?,
          unblock_reason = 'staff_access_granted'
      WHERE customer_id = ? AND active = 1 AND block_type = 'authorization_failed'
    `).run(grantedBy || null, customer.id);

    db.prepare(`
      UPDATE customers
      SET access_authorized_at = COALESCE(access_authorized_at, DATETIME('now')),
          access_authorization_source = 'staff',
          access_authorized_by = ?,
          updated_at = DATETIME('now')
      WHERE id = ?
    `).run(grantedBy || null, customer.id);

    if (customer.telegram_id) {
      db.prepare(`
        INSERT INTO referral_auth_states (
          telegram_id, customer_id, attempts_used, status, last_error_code,
          last_username, blocked_at, updated_at
        ) VALUES (?, ?, 0, 'authorized', NULL, NULL, NULL, DATETIME('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET
          customer_id = excluded.customer_id,
          attempts_used = 0,
          status = 'authorized',
          last_error_code = NULL,
          last_username = NULL,
          blocked_at = NULL,
          updated_at = DATETIME('now')
      `).run(String(customer.telegram_id), customer.id);
      db.prepare(`
        INSERT INTO referral_auth_events (
          telegram_id, customer_id, outcome, attempt_number, performed_by
        ) VALUES (?, ?, 'authorized_by_staff', NULL, ?)
      `).run(String(customer.telegram_id), customer.id, grantedBy || null);
    }
    db.prepare(`
      DELETE FROM pending_staff_access_grants
      WHERE telegram_username = ? COLLATE NOCASE
    `).run(normalizeUsername(customer.telegram_username));
    return {
      kind: 'active',
      customer: db.prepare('SELECT * FROM customers WHERE id = ?').get(customer.id),
      already_authorized: customer.access_authorization_source === 'staff',
      source: 'staff',
    };
  }).immediate();
}

export function activatePendingStaffAccess(identity) {
  const username = normalizeUsername(identity?.telegramUsername);
  const telegramId = String(identity?.telegramId || '');
  if (!username || !telegramId) return null;
  const pending = db.prepare(`
    SELECT * FROM pending_staff_access_grants
    WHERE telegram_username = ? COLLATE NOCASE
  `).get(username);
  if (!pending) return null;
  const customer = ensureUnauthorizedCustomer(identity);
  db.prepare(`
    UPDATE customers
    SET telegram_username = ?, first_name = COALESCE(?, first_name),
        last_name = COALESCE(?, last_name), updated_at = DATETIME('now')
    WHERE id = ?
  `).run(username, identity.firstName || null, identity.lastName || null, customer.id);
  const result = grantStaffAccess({
    customerId: customer.id,
    grantedBy: pending.granted_by || 'admin',
  });
  activatePendingInviteBanForCustomer({ id: customer.id, telegram_username: username });
  return result;
}

export function listStaffAccessGrants() {
  const active = db.prepare(`
    SELECT c.id AS customer_id, c.telegram_id, c.telegram_username, c.first_name, c.last_name,
           c.access_authorized_at, c.access_authorized_by,
           CASE WHEN EXISTS (
             SELECT 1 FROM orders o
             WHERE o.customer_id = c.id AND o.status IN ('completed', 'delivered')
           ) THEN 1 ELSE 0 END AS has_issued_order
    FROM customers c
    WHERE c.deleted_at IS NULL AND c.access_authorization_source = 'staff'
    ORDER BY c.access_authorized_at DESC
  `).all();
  const pending = db.prepare(`
    SELECT id, telegram_username, granted_by, created_at
    FROM pending_staff_access_grants ORDER BY created_at DESC
  `).all();
  return { active, pending };
}

export function revokeStaffAccess(customerId, revokedBy) {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL')
    .get(String(customerId));
  if (!customer) throw Object.assign(new Error('customer_not_found'), { code: 'customer_not_found' });
  if (customer.access_authorization_source !== 'staff') {
    throw Object.assign(new Error('not_staff_authorized'), { code: 'not_staff_authorized' });
  }
  const permanent = db.prepare(`
    SELECT 1 FROM orders WHERE customer_id = ? AND status IN ('completed', 'delivered') LIMIT 1
  `).get(customer.id);
  if (permanent) throw Object.assign(new Error('access_is_permanent'), { code: 'access_is_permanent' });
  return db.transaction(() => {
    db.prepare(`
      UPDATE customers
      SET access_authorized_at = NULL, access_authorization_source = NULL,
          access_authorized_by = NULL, updated_at = DATETIME('now')
      WHERE id = ?
    `).run(customer.id);
    if (customer.telegram_id) {
      db.prepare(`
        UPDATE referral_auth_states
        SET attempts_used = 0, status = 'pending', last_error_code = NULL,
            last_username = NULL, blocked_at = NULL, updated_at = DATETIME('now')
        WHERE telegram_id = ?
      `).run(String(customer.telegram_id));
      db.prepare(`
        INSERT INTO referral_auth_events (telegram_id, customer_id, outcome, performed_by)
        VALUES (?, ?, 'staff_authorization_revoked', ?)
      `).run(String(customer.telegram_id), customer.id, revokedBy || null);
    }
    return true;
  }).immediate();
}

export function removePendingStaffAccess(id) {
  return db.prepare('DELETE FROM pending_staff_access_grants WHERE id = ?').run(Number(id)).changes > 0;
}

/** Запоминает первый заказ авторизованного новичка независимо от канала создания. */
export function attachFirstOrderToReferral(customerId, orderId) {
  if (!customerId || !orderId) return false;
  return db.transaction(() => {
    db.prepare(`
      UPDATE orders
      SET access_authorization_source = (
        SELECT access_authorization_source FROM customers WHERE id = ?
      )
      WHERE id = ? AND access_authorization_source IS NULL
    `).run(String(customerId), String(orderId));
    const result = db.prepare(`
      UPDATE customer_referrals
      SET first_order_id = ?
      WHERE invitee_customer_id = ? AND first_order_id IS NULL
    `).run(String(orderId), String(customerId));
    return result.changes > 0;
  }).immediate();
}

function inviteBanId() {
  return `invite_ban_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createInviteBan({ customerId, reason, bannedBy }) {
  const customer = db.prepare('SELECT id, telegram_username FROM customers WHERE id = ? AND deleted_at IS NULL').get(String(customerId));
  if (!customer) throw Object.assign(new Error('customer_not_found'), { code: 'customer_not_found' });
  if (isDisallowedInviterUsername(customer.telegram_username)) {
    throw Object.assign(new Error('username_reserved'), { code: 'username_reserved' });
  }
  if (getActiveInviteBan(customer.id)) throw Object.assign(new Error('already_invite_banned'), { code: 'already_invite_banned' });
  const normalizedReason = String(reason || '').trim();
  if (normalizedReason.length > 1000) {
    throw Object.assign(new Error('reason_too_long'), { code: 'reason_too_long' });
  }
  const id = inviteBanId();
  db.prepare(`
    INSERT INTO customer_invite_bans (id, customer_id, reason, banned_by)
    VALUES (?, ?, ?, ?)
  `).run(id, customer.id, normalizedReason || null, bannedBy || null);
  return db.prepare('SELECT * FROM customer_invite_bans WHERE id = ?').get(id);
}

export function createInviteBanByUsername({ telegramUsername, reason, bannedBy }) {
  const username = normalizeUsername(telegramUsername);
  if (!username || !USERNAME_RE.test(username)) {
    throw Object.assign(new Error('username_invalid'), { code: 'username_invalid' });
  }
  if (isDisallowedInviterUsername(username)) {
    throw Object.assign(new Error('username_reserved'), { code: 'username_reserved' });
  }
  const customer = resolveCustomerForAdmin({ telegramUsername: username });
  if (customer) return { kind: 'active', ban: createInviteBan({ customerId: customer.id, reason, bannedBy }) };
  const normalizedReason = String(reason || '').trim();
  if (normalizedReason.length > 1000) {
    throw Object.assign(new Error('reason_too_long'), { code: 'reason_too_long' });
  }
  try {
    const result = db.prepare(`
      INSERT INTO pending_customer_invite_bans (telegram_username, reason, banned_by)
      VALUES (?, ?, ?)
    `).run(username, normalizedReason || null, bannedBy || null);
    return {
      kind: 'pending',
      ban: db.prepare('SELECT * FROM pending_customer_invite_bans WHERE id = ?').get(result.lastInsertRowid),
    };
  } catch (error) {
    if (error?.code?.startsWith('SQLITE_CONSTRAINT')) {
      throw Object.assign(new Error('already_invite_banned'), { code: 'already_invite_banned' });
    }
    throw error;
  }
}

export function activatePendingInviteBanForCustomer(customer) {
  const username = normalizeUsername(customer?.telegram_username);
  if (!customer?.id || !username) return null;
  const pending = db.prepare(`
    SELECT * FROM pending_customer_invite_bans
    WHERE telegram_username = ? COLLATE NOCASE
  `).get(username);
  if (!pending) return null;
  try {
    const ban = createInviteBan({
      customerId: customer.id,
      reason: pending.reason,
      bannedBy: pending.banned_by,
    });
    db.prepare('DELETE FROM pending_customer_invite_bans WHERE id = ?').run(pending.id);
    return ban;
  } catch (error) {
    if (error.code === 'already_invite_banned') {
      db.prepare('DELETE FROM pending_customer_invite_bans WHERE id = ?').run(pending.id);
      return getActiveInviteBan(customer.id);
    }
    throw error;
  }
}

export function removeInviteBan(id, { unbannedBy, reason } = {}) {
  const result = db.prepare(`
    UPDATE customer_invite_bans
    SET active = 0, unbanned_at = DATETIME('now'), unbanned_by = ?, unban_reason = ?
    WHERE id = ? AND active = 1
  `).run(unbannedBy || null, String(reason || '').trim() || null, String(id));
  return result.changes > 0;
}

export function listInviteBans() {
  const active = db.prepare(`
    SELECT ib.*, c.telegram_id, c.telegram_username, c.first_name, c.last_name
    FROM customer_invite_bans ib
    JOIN customers c ON c.id = ib.customer_id
    WHERE ib.active = 1
    ORDER BY ib.banned_at DESC
  `).all();
  const pending = db.prepare(`
    SELECT id, telegram_username, reason, banned_by, created_at
    FROM pending_customer_invite_bans
    ORDER BY created_at DESC
  `).all();
  return { active, pending };
}

export function removePendingInviteBan(id) {
  return db.prepare('DELETE FROM pending_customer_invite_bans WHERE id = ?').run(Number(id)).changes > 0;
}

export function listReferralAuthorizations() {
  return db.prepare(`
    SELECT
      ras.*,
      c.telegram_username,
      c.first_name,
      c.last_name,
      c.access_authorized_at,
      c.access_authorization_source,
      c.access_authorized_by,
      cr.inviter_customer_id,
      COALESCE(NULLIF(TRIM(ic.telegram_username), ''), cr.inviter_username_snapshot) AS inviter_username,
      CASE WHEN EXISTS (
        SELECT 1 FROM orders o
        WHERE o.customer_id = c.id AND o.status IN ('completed', 'delivered')
      ) THEN 1 ELSE 0 END AS has_issued_order
    FROM referral_auth_states ras
    LEFT JOIN customers c ON c.telegram_id = ras.telegram_id
    LEFT JOIN customer_referrals cr ON cr.invitee_customer_id = c.id
    LEFT JOIN customers ic ON ic.id = cr.inviter_customer_id
    ORDER BY ras.updated_at DESC
  `).all();
}
