import { db } from '../db.js';
import {
  BUSINESS_TIME_ZONE,
  getUtcDateForTimeZoneLocalTime,
  getTimeZoneDateParts,
} from './business-time.js';
import { enqueueInternalNotification } from './internal-notifications.js';

/**
 * Планировщик триггеров выручки (раздел «Финансы»).
 *
 * Два вида триггеров:
 *
 * 1) Одноразовые (создаются в модалке «Триггер выручки»): порог достигнут —
 *    уведомления, триггер гаснет навсегда. Проверяются часто (раз в минуту),
 *    чтобы срабатывали сразу.
 *
 * 2) Системный повторяющийся (SYSTEM_TRIGGER_ID, порог из настроек
 *    revenue_system_threshold, по умолчанию 2500): проверяется раз в сутки
 *    около 11:20 по Минску. Пока баланс «Выручки» ≥ порога — уведомление
 *    приходит КАЖДЫЙ день (порог пройден, закупка не сделана — напомнить
 *    снова). После закупки/списания баланс падает ниже — молчим, копим
 *    заново. Полностью автоматический: после срабатывания одноразового
 *    триггера с тем же порогом система сама заводит системный триггер
 *    с теми же получателями.
 *
 * Идемпотентность суточной проверки: уникальный ключ уведомления содержит
 * дату (календарный день по Минску) — повторные тики в тот же день не
 * дублируют отправку. Простой сервера в 11:20 не страшен: первый же тик
 * после включения, попадающий в окно дня (до 23:59), догонит проверку.
 */

export const REVENUE_TRIGGER_INTERVAL_MS = 60_000;
export const REVENUE_TRIGGER_EVENT_TYPE = 'revenue.trigger';
export const SYSTEM_TRIGGER_ID = 'system_revenue_notify';
export const SYSTEM_TRIGGER_THRESHOLD_KEY = 'revenue_system_threshold';
export const DEFAULT_SYSTEM_THRESHOLD = 2500;

/** Счёт «Выручка»: ищем по имени, с fallback на дефолтную кассу. */
export function findRevenueAccount(database = db) {
  const row = database
    .prepare("SELECT id, name, balance FROM cash_accounts WHERE active = 1 AND name = 'Выручка' COLLATE NOCASE ORDER BY created_at ASC LIMIT 1")
    .get();
  if (row) return row;
  const fallback = database
    .prepare('SELECT id, name, balance FROM cash_accounts WHERE active = 1 AND is_default = 1')
    .get();
  return fallback || null;
}

/** recipient_usernames (JSON) → массив строк. */
export function parseRecipientUsernames(value) {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Порог системного триггера из настроек (или дефолт). */
export function getSystemThreshold(database = db) {
  const row = database
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(SYSTEM_TRIGGER_THRESHOLD_KEY);
  const value = Number(row?.value);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_SYSTEM_THRESHOLD;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** 'YYYY-MM-DD' календарного дня по Минску. */
function minskDayKey(date) {
  const parts = getTimeZoneDateParts(date, BUSINESS_TIME_ZONE);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function toSqliteUtc(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function resolveRecipients(target, usernames) {
  const resolved = [];
  for (const username of usernames) {
    const customer = target.prepare(`
      SELECT telegram_id, telegram_username
      FROM customers
      WHERE deleted_at IS NULL
        AND lower(ltrim(trim(COALESCE(telegram_username, '')), '@')) = ?
        AND telegram_id IS NOT NULL
      ORDER BY updated_at DESC, id DESC
    `).get(String(username).toLowerCase());
    if (customer) {
      resolved.push({ username, telegramId: customer.telegram_id, telegramUsername: customer.telegram_username || username });
    } else {
      console.error('[revenue-trigger] recipient not found in customers:', username);
    }
  }
  return resolved;
}

function enqueueNotifications(target, { recipients, uniqueKeyPrefix, text, payload, now }) {
  let enqueued = 0;
  for (const recipient of recipients) {
    const result = enqueueInternalNotification(target, {
      uniqueKey: `${uniqueKeyPrefix}:${recipient.telegramId}`,
      eventType: REVENUE_TRIGGER_EVENT_TYPE,
      recipientTelegramId: recipient.telegramId,
      recipientUsername: recipient.telegramUsername,
      payload: { text, ...payload },
      now,
    });
    if (result.enqueued) enqueued += 1;
  }
  return enqueued;
}

/** Существует ли уже системный триггер? */
export function getSystemTrigger(target) {
  return target
    .prepare('SELECT * FROM revenue_triggers WHERE id = ?')
    .get(SYSTEM_TRIGGER_ID) || null;
}

/**
 * Заводит/обновляет системный повторяющийся триггер с теми же получателями.
 * Вызывается после срабатывания одноразового триггера.
 */
export function ensureSystemTrigger(target, usernames, { now = new Date() } = {}) {
  if (!usernames.length) return;
  const existing = getSystemTrigger(target);
  if (existing) {
    // Обновляем получателей (последнее решение админа важнее).
    target.prepare(`
      UPDATE revenue_triggers
      SET recipient_usernames = ?, updated_at = DATETIME('now')
      WHERE id = ?
    `).run(JSON.stringify(usernames), SYSTEM_TRIGGER_ID);
    return;
  }
  target.prepare(`
    INSERT INTO revenue_triggers (id, threshold_amount, recipient_usernames, enabled, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      recipient_usernames = excluded.recipient_usernames,
      updated_at = DATETIME('now')
  `).run(
    SYSTEM_TRIGGER_ID,
    getSystemThreshold(target),
    JSON.stringify(usernames),
    toSqliteUtc(now),
    toSqliteUtc(now),
  );
}

/**
 * Разовая проверка одноразовых триггеров: баланс ≥ порога → уведомления,
 * триггер гаснет, система заводит повторяющийся триггер с теми же
 * получателями (автоматизация «уведомлять каждый день при ≥ порога»).
 */
export function checkRevenueTriggers(database = db, { now = new Date() } = {}) {
  const target = requireDatabase(database);
  const account = findRevenueAccount(target);
  if (!account) return { checked: 0, enqueued: 0, triggered: [] };

  const triggers = target
    .prepare('SELECT * FROM revenue_triggers WHERE enabled = 1 AND id != ?')
    .all(SYSTEM_TRIGGER_ID);
  if (!triggers.length) return { checked: 0, enqueued: 0, triggered: [] };

  const balance = Number(account.balance || 0);
  let enqueued = 0;
  const triggeredIds = [];

  for (const trigger of triggers) {
    const threshold = Number(trigger.threshold_amount);
    if (!Number.isFinite(threshold) || balance < threshold) continue;

    const usernames = parseRecipientUsernames(trigger.recipient_usernames);
    const recipients = resolveRecipients(target, usernames);
    enqueued += enqueueNotifications(target, {
      recipients,
      uniqueKeyPrefix: `revenue-trigger:${trigger.id}`,
      text: `Выручка достигла ${balance.toFixed(2)} BYN — порог ${threshold.toFixed(2)} BYN пройден.`,
      payload: { threshold, balance, account_name: account.name },
      now,
    });

    // Гасим одноразовый триггер и заводим системный повторяющийся
    // с теми же получателями — уведомления продолжат приходить каждый
    // день, пока баланс ≥ порога (см. runDailySystemCheck).
    target.prepare(`
      UPDATE revenue_triggers
      SET enabled = 0,
          triggered_at = ?,
          triggered_balance = ?,
          last_checked_at = ?,
          updated_at = DATETIME('now')
      WHERE id = ?
    `).run(toSqliteUtc(now), balance, toSqliteUtc(now), trigger.id);

    ensureSystemTrigger(target, usernames, { now });
    triggeredIds.push(trigger.id);
  }

  return { checked: triggers.length, enqueued, triggered: triggeredIds };
}

/**
 * Суточная проверка системного триггера: баланс ≥ порога → уведомление.
 * Идемпотентна в пределах дня (ключ содержит календарную дату Минска).
 * Возвращает счётчики и признак «уже отправляли сегодня».
 */
export function runDailySystemCheck(database = db, { now = new Date() } = {}) {
  const target = requireDatabase(database);
  const systemTrigger = getSystemTrigger(target);
  if (!systemTrigger || Number(systemTrigger.enabled) !== 1) {
    return { active: false, balance: null, threshold: null, enqueued: 0, alreadyNotifiedToday: false };
  }

  const account = findRevenueAccount(target);
  if (!account) {
    return { active: true, balance: null, threshold: null, enqueued: 0, alreadyNotifiedToday: false };
  }

  const balance = Number(account.balance || 0);
  const threshold = Number(systemTrigger.threshold_amount);
  const todayKey = minskDayKey(now);

  // Уже уведомляли сегодня? (last_checked_at — UTC 'YYYY-MM-DD HH:MM:SS')
  const lastChecked = systemTrigger.last_checked_at
    ? new Date(String(systemTrigger.last_checked_at).replace(' ', 'T') + 'Z')
    : null;
  const alreadyToday = lastChecked
    && Number.isFinite(lastChecked.getTime())
    && minskDayKey(lastChecked) === todayKey;

  if (balance < threshold) {
    // Ниже порога (закупка сделана или ещё копим) — молчим, цикл
    // перезапустится сам, когда снова наберётся.
    target.prepare(`
      UPDATE revenue_triggers
      SET last_checked_at = ?, updated_at = DATETIME('now')
      WHERE id = ?
    `).run(toSqliteUtc(now), SYSTEM_TRIGGER_ID);
    return { active: true, balance, threshold, enqueued: 0, alreadyNotifiedToday: false };
  }

  if (alreadyToday) {
    return { active: true, balance, threshold, enqueued: 0, alreadyNotifiedToday: true };
  }

  const usernames = parseRecipientUsernames(systemTrigger.recipient_usernames);
  const recipients = resolveRecipients(target, usernames);
  const enqueued = enqueueNotifications(target, {
    recipients,
    uniqueKeyPrefix: `revenue-daily:${todayKey}`,
    text: `Выручка: ${balance.toFixed(2)} BYN — пора делать закупку (порог ${threshold.toFixed(2)} BYN).`,
    payload: { threshold, balance, account_name: account.name, daily: true },
    now,
  });

  target.prepare(`
    UPDATE revenue_triggers
    SET last_checked_at = ?, updated_at = DATETIME('now')
    WHERE id = ?
  `).run(toSqliteUtc(now), SYSTEM_TRIGGER_ID);

  return { active: true, balance, threshold, enqueued, alreadyNotifiedToday: false };
}

/** Пора ли сегодня запускать суточную проверку (11:20+ по Минску)? */
export function isDailyCheckDue(database = db, { now = new Date() } = {}) {
  const target = requireDatabase(database);
  const systemTrigger = getSystemTrigger(target);
  if (!systemTrigger) return false;

  const parts = getTimeZoneDateParts(now, BUSINESS_TIME_ZONE);
  const todayKey = minskDayKey(now);
  const minutesNow = parts.hour * 60 + parts.minute;
  if (minutesNow < 11 * 60 + 20) return false; // ещё не 11:20

  const lastChecked = systemTrigger.last_checked_at
    ? new Date(String(systemTrigger.last_checked_at).replace(' ', 'T') + 'Z')
    : null;
  if (!lastChecked || !Number.isFinite(lastChecked.getTime())) return true;
  return minskDayKey(lastChecked) !== todayKey;
}

function requireDatabase(database) {
  if (!database?.prepare || !database?.transaction) {
    throw new TypeError('database_required');
  }
  return database;
}

let timer = null;

export function startRevenueTriggerScheduler(database = db, {
  intervalMs = REVENUE_TRIGGER_INTERVAL_MS,
  nowProvider = () => new Date(),
} = {}) {
  requireDatabase(database);
  if (timer) return timer;

  const run = () => {
    try {
      // Одноразовые триггеры: срабатывают сразу после изменения баланса.
      checkRevenueTriggers(database, { now: nowProvider() });
      // Системный суточный: раз в день около 11:20 (первый тик после
      // 11:20 в ещё не проверенный день; при простое сервера догоняет).
      if (isDailyCheckDue(database, { now: nowProvider() })) {
        runDailySystemCheck(database, { now: nowProvider() });
      }
    } catch (error) {
      console.error('[revenue-trigger] check failed:', error?.message || error);
    }
  };

  // Первая проверка сразу после старта: одноразовые могли быть достигнуты
  // за время простоя, суточный — догоняется этим же тиком.
  run();
  timer = setInterval(run, intervalMs);
  return timer;
}

export function _stopRevenueTriggerSchedulerForTests() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
