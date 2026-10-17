import crypto from 'node:crypto';
import { Router } from 'express';

import { authMiddleware } from '../auth.js';
import { db } from '../db.js';
import {
  computeLastDueAt,
  listUpcomingRuns,
  parseRecipientUsernames,
  CUSTOM_REMINDER_EVENT_TYPE,
} from '../utils/custom-reminder-scheduler.js';
import { enqueueInternalNotification } from '../utils/internal-notifications.js';

/**
 * Раздел «Напоминания»: пользовательские сообщения, которые userbot
 * автоматически отправляет команде по расписанию.
 *
 * Получатели — фиксированная команда (@ppofic, @rk0ff, @QuaiLLLL).
 * Telegram ID не хранится: каждый раз разрешается из карточки клиента
 * с тем же юзернеймом (схема как у сотрудников CRM).
 *
 * Доставка идёт через internal_notification_outbox: планировщик ставит
 * их в очередь, воркер повторяет при сбоях — здесь отправки не
 * выполняются, только управление напоминаниями.
 */

const remindersRouter = Router();

const BASE = '/api/admin/reminders';

const MESSAGE_MAX = 4000;
const TITLE_MAX = 120;

/** Команда: юзернеймы Telegram, доступные как получатели. */
const TEAM_USERNAMES = ['ppofic', 'rk0ff', 'quaillll'];

function id() {
  return `rem_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(String(value ?? ''));
  } catch {
    return fallback;
  }
}

function parseHourMinute(input) {
  const value = String(input ?? '').trim();
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function parseDate(input) {
  const value = String(input ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year
    || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}

/** Карточка клиента с этим юзернеймом: источник Telegram ID. */
function customerByUsername(username) {
  const normalized = String(username ?? '').trim().replace(/^@+/, '').toLowerCase();
  if (!normalized) return null;
  return db.prepare(`
    SELECT telegram_id, telegram_username, first_name, last_name
    FROM customers
    WHERE deleted_at IS NULL
      AND lower(ltrim(trim(COALESCE(telegram_username, '')), '@')) = ?
      AND telegram_id IS NOT NULL
    ORDER BY updated_at DESC, id DESC
  `).get(normalized) || null;
}

/** Участник команды: юзернейм + имя из карточки клиента, если есть. */
function teamMember(username) {
  const normalized = String(username ?? '').trim().replace(/^@+/, '');
  const customer = customerByUsername(normalized);
  return {
    username: normalized,
    telegram_ok: Boolean(customer),
    telegram_id: customer?.telegram_id || null,
    display_name: customer
      ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
      : null,
  };
}

function reminderRow(reminderId) {
  return db.prepare('SELECT * FROM custom_reminders WHERE id = ?').get(reminderId);
}

/** Человекочитаемое описание расписания для карточки. */
function scheduleLabel(reminder, { hour, minute, date } = {}) {
  const time = `${String(hour ?? reminder.schedule_hour).padStart(2, '0')}:${String(minute ?? reminder.schedule_minute).padStart(2, '0')}`;
  if (reminder.schedule_type === 'once') {
    return `Один раз ${date ?? reminder.once_date} в ${time}`;
  }
  const days = Number(reminder.interval_days);
  if (days === 1) return `Каждый день в ${time}`;
  return `Каждые ${days} дн. в ${time}`;
}

function publicReminder(reminder, { now = new Date() } = {}) {
  const usernames = parseRecipientUsernames(reminder.recipient_usernames);
  const members = usernames.map((username) => teamMember(username));
  const upcoming = listUpcomingRuns(reminder, { now, count: 2 });
  const lastDeliveries = usernames.length && reminder.last_due_key
    ? db.prepare(`
        SELECT status, sent_at, last_error
        FROM internal_notification_outbox
        WHERE unique_key LIKE ?
        ORDER BY created_at DESC
      `).all(`custom-reminder:${reminder.id}:${reminder.last_due_key}:%`)
    : [];
  const lastSent = lastDeliveries.find((row) => row.status === 'sent') || lastDeliveries[0] || null;
  return {
    id: reminder.id,
    title: reminder.title,
    message: reminder.message,
    schedule_type: reminder.schedule_type,
    schedule_hour: reminder.schedule_hour,
    schedule_minute: reminder.schedule_minute,
    interval_days: reminder.interval_days,
    once_date: reminder.once_date,
    enabled: Number(reminder.enabled) === 1,
    schedule_label: scheduleLabel(reminder),
    recipients: members.map((member) => ({
      username: member.username,
      display_name: member.display_name,
      telegram_ok: member.telegram_ok,
    })),
    recipients_ok: members.every((member) => member.telegram_ok),
    next_run_at: upcoming.length ? upcoming[0].toISOString() : null,
    next_runs: upcoming.map((item) => item.toISOString()),
    last_sent_at: reminder.last_enqueued_at,
    last_delivery_status: lastSent?.status || null,
    last_delivery_sent_at: lastSent?.sent_at || null,
    last_delivery_error: lastSent?.last_error || null,
    created_at: reminder.created_at,
    updated_at: reminder.updated_at,
  };
}

function validateReminderInput(body) {
  const title = String(body?.title ?? '').trim().slice(0, TITLE_MAX);
  if (!title) return { error: 'title_required' };
  const message = String(body?.message ?? '').trim().slice(0, MESSAGE_MAX);
  if (!message) return { error: 'message_required' };

  const time = parseHourMinute(body?.time);
  if (!time) return { error: 'invalid_time' };

  const scheduleType = String(body?.schedule_type || 'interval');
  if (!['interval', 'once'].includes(scheduleType)) return { error: 'invalid_schedule_type' };

  let intervalDays = null;
  let onceDate = null;
  if (scheduleType === 'interval') {
    const days = Number(body?.interval_days);
    if (!Number.isInteger(days) || days < 1 || days > 365) return { error: 'invalid_interval_days' };
    intervalDays = days;
  } else {
    const date = parseDate(body?.once_date);
    if (!date) return { error: 'invalid_once_date' };
    onceDate = body?.once_date;
  }

  const rawUsernames = Array.isArray(body?.recipient_usernames)
    ? body.recipient_usernames
    : (body?.recipient_usernames ? [body.recipient_usernames] : []);
  const usernames = [...new Set(
    rawUsernames
      .map((item) => String(item ?? '').trim().replace(/^@+/, ''))
      .filter(Boolean)
      .map((item) => item.toLowerCase()),
  )];
  if (!usernames.length) {
    return { error: 'recipients_required' };
  }
  const outside = usernames.find((item) => !TEAM_USERNAMES.includes(item));
  if (outside) {
    return { error: 'recipient_not_in_team' };
  }
  const missingCard = usernames.find((item) => !customerByUsername(item));
  if (missingCard) {
    return { error: 'recipient_not_found' };
  }

  return {
    title,
    message,
    schedule_type: scheduleType,
    schedule_hour: time.hour,
    schedule_minute: time.minute,
    interval_days: intervalDays,
    once_date: onceDate,
    recipient_usernames: usernames,
  };
}

// Список напоминаний
remindersRouter.get(BASE, authMiddleware, (req, res) => {
  try {
    const now = new Date();
    const rows = db.prepare(`
      SELECT * FROM custom_reminders
      ORDER BY enabled DESC, created_at DESC
    `).all();
    res.json({ reminders: rows.map((row) => publicReminder(row, { now })) });
  } catch (error) {
    console.error('[reminders] list error:', error);
    res.status(500).json({ error: 'failed' });
  }
});

// Участники команды, доступные как получатели
remindersRouter.get(`${BASE}/recipients`, authMiddleware, (req, res) => {
  try {
    res.json({
      recipients: TEAM_USERNAMES.map((username) => teamMember(username)),
    });
  } catch (error) {
    console.error('[reminders] recipients error:', error);
    res.status(500).json({ error: 'failed' });
  }
});

// Журнал доставок напоминаний (последние N записей outbox)
remindersRouter.get(`${BASE}/log`, authMiddleware, (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const reminderId = String(req.query.reminder_id || '').trim();
    const pattern = reminderId
      ? `custom-reminder:${reminderId}:%`
      : 'custom-reminder:%';
    const rows = db.prepare(`
      SELECT *
      FROM internal_notification_outbox
      WHERE event_type = ?
        AND unique_key LIKE ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(CUSTOM_REMINDER_EVENT_TYPE, pattern, limit);
    const titles = new Map(db.prepare(`
      SELECT id, title, message FROM custom_reminders
    `).all().map((row) => [row.id, row]));
    res.json({
      log: rows.map((row) => {
        const rowReminderId = (row.unique_key.match(/^custom-reminder:([^:]+):/) || [])[1] || null;
        const reminder = rowReminderId ? titles.get(rowReminderId) : null;
        return {
          id: row.id,
          unique_key: row.unique_key,
          reminder_id: rowReminderId,
          reminder_title: reminder?.title || null,
          message: parseJson(row.payload_json, {}).text || reminder?.message || null,
          recipient_telegram_id: row.recipient_telegram_id,
          recipient_username: row.recipient_username || null,
          status: row.status,
          attempts: row.attempts,
          sent_at: row.sent_at,
          last_error: row.last_error,
          created_at: row.created_at,
        };
      }),
    });
  } catch (error) {
    console.error('[reminders] log error:', error);
    res.status(500).json({ error: 'failed' });
  }
});

// Создание напоминания
remindersRouter.post(BASE, authMiddleware, (req, res) => {
  try {
    const input = validateReminderInput(req.body);
    if (input.error) {
      return res.status(400).json({ error: input.error });
    }
    const reminderId = id();
    const run = db.transaction(() => {
      db.prepare(`
        INSERT INTO custom_reminders (
          id, title, message, schedule_type, schedule_hour, schedule_minute,
          interval_days, once_date, recipient_usernames, enabled
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        reminderId,
        input.title,
        input.message,
        input.schedule_type,
        input.schedule_hour,
        input.schedule_minute,
        input.interval_days,
        input.once_date,
        JSON.stringify(input.recipient_usernames),
      );
      return reminderRow(reminderId);
    });
    const created = run();
    res.status(201).json({ reminder: publicReminder(created) });
  } catch (error) {
    console.error('[reminders] create error:', error);
    res.status(500).json({ error: 'failed' });
  }
});

// Обновление: поля расписания/текста или включение/выключение
remindersRouter.patch(`${BASE}/:id`, authMiddleware, (req, res) => {
  try {
    const current = reminderRow(req.params.id);
    if (!current) return res.status(404).json({ error: 'not_found' });

    // Тоггл включения: отдельный лёгкий сценарий
    if (req.body?.enabled !== undefined && Object.keys(req.body).length === 1) {
      const enabled = req.body.enabled === true || req.body.enabled === 1 ? 1 : 0;
      db.prepare(`
        UPDATE custom_reminders
        SET enabled = ?, updated_at = DATETIME('now')
        WHERE id = ?
      `).run(enabled, current.id);
      // Выключаем — гасим и незавершённые доставки, чтобы воркер не отправил
      if (!enabled) {
        db.prepare(`
          UPDATE internal_notification_outbox
          SET status = 'cancelled', updated_at = DATETIME('now')
          WHERE status IN ('pending', 'retry')
            AND unique_key LIKE ?
        `).run(`custom-reminder:${current.id}:%`);
      }
      return res.json({ reminder: publicReminder(reminderRow(current.id)) });
    }

    const input = validateReminderInput(req.body);
    if (input.error) {
      return res.status(400).json({ error: input.error });
    }
    db.prepare(`
      UPDATE custom_reminders
      SET title = ?, message = ?, schedule_type = ?, schedule_hour = ?,
          schedule_minute = ?, interval_days = ?, once_date = ?,
          recipient_usernames = ?, last_due_key = NULL, last_enqueued_at = NULL,
          updated_at = DATETIME('now')
      WHERE id = ?
    `).run(
      input.title,
      input.message,
      input.schedule_type,
      input.schedule_hour,
      input.schedule_minute,
      input.interval_days,
      input.once_date,
      JSON.stringify(input.recipient_usernames),
      current.id,
    );
    res.json({ reminder: publicReminder(reminderRow(current.id)) });
  } catch (error) {
    console.error('[reminders] update error:', error);
    res.status(500).json({ error: 'failed' });
  }
});

// Удаление: вместе с напоминанием гасим его незавершённые доставки
remindersRouter.delete(`${BASE}/:id`, authMiddleware, (req, res) => {
  try {
    const current = reminderRow(req.params.id);
    if (!current) return res.status(404).json({ error: 'not_found' });
    const run = db.transaction(() => {
      db.prepare(`
        UPDATE internal_notification_outbox
        SET status = 'cancelled', updated_at = DATETIME('now')
        WHERE status IN ('pending', 'retry')
          AND unique_key LIKE ?
      `).run(`custom-reminder:${current.id}:%`);
      db.prepare('DELETE FROM custom_reminders WHERE id = ?').run(current.id);
    });
    run();
    res.json({ ok: true });
  } catch (error) {
    console.error('[reminders] delete error:', error);
    res.status(500).json({ error: 'failed' });
  }
});

// Проверочная отправка прямо сейчас (без расписания)
remindersRouter.post(`${BASE}/:id/test`, authMiddleware, (req, res) => {
  try {
    const current = reminderRow(req.params.id);
    if (!current) return res.status(404).json({ error: 'not_found' });
    const usernames = parseRecipientUsernames(current.recipient_usernames);
    const stamp = Date.now();
    let sent = 0;
    let missing = 0;
    for (const username of usernames) {
      const customer = customerByUsername(username);
      if (!customer) {
        missing += 1;
        continue;
      }
      const uniqueKey = `custom-reminder:${current.id}:test:${stamp}:${username.toLowerCase()}`;
      const result = enqueueInternalNotification(db, {
        uniqueKey,
        eventType: CUSTOM_REMINDER_EVENT_TYPE,
        recipientTelegramId: customer.telegram_id,
        recipientUsername: customer.telegram_username || username,
        payload: {
          text: current.message,
          reminder_title: current.title,
        },
        now: new Date(),
      });
      if (result.enqueued) sent += 1;
    }
    if (!sent) {
      // Ни один получатель не доступен — у юзернеймов нет карточек клиентов.
      return res.status(400).json({ error: 'recipient_not_found' });
    }
    res.json({ ok: true, sent, missing });
  } catch (error) {
    console.error('[reminders] test send error:', error);
    res.status(500).json({ error: 'failed' });
  }
});

export { remindersRouter };
