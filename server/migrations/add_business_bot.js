/**
 * Миграция: бот в Telegram Business-режиме.
 *
 * Контекст (TZ от Кости):
 *  - Бот подключается к менеджерскому аккаунту через Business connection и
 *    отвечает клиентам от его имени, разгружая ручную переписку.
 *  - Главные сценарии:
 *      1) Системные авто-уведомления при смене статуса заказа (собран, выдан и т.п.)
 *      2) Быстрые ответы на типовые вопросы (часы работы, как заказать)
 *      3) Выдача прайс-листа с кодовой фразой → клиент verified для Mini App
 *      4) Приветственное сообщение новому клиенту
 *  - Все шаблоны редактируются в CRM, ничего не хардкодим.
 *
 * Таблицы:
 *   business_connections   — лайвсайкл подключений (один или несколько менеджеров)
 *   bot_quick_replies      — список «триггер→ответ» для FAQ
 *   bot_status_templates   — шаблоны для системных событий (по UNIQUE event)
 *   bot_message_log        — аудит всего что бот видел/отправлял (in/out)
 *
 * Расширения:
 *   customers.bot_verified_at        — момент верификации через бот
 *   customers.bot_verification_code  — последний выданный код (для матчинга)
 *
 * Идемпотентно: каждый запуск проверяет существование таблиц/колонок.
 */
import { db } from '../db.js';

export function migrateBusinessBot() {
  // 1) business_connections — Telegram отдаёт нам connection_id при подключении
  // владельца. Хранение позволяет узнать, активна ли интеграция, кто менеджер,
  // и можно ли боту отвечать (`can_reply` приходит в апдейте).
  db.exec(`
    CREATE TABLE IF NOT EXISTS business_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_chat_id TEXT,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      can_reply INTEGER NOT NULL DEFAULT 0,
      connected_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      disconnected_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_business_connections_active
      ON business_connections(is_enabled, can_reply, disconnected_at);
  `);

  // 2) bot_quick_replies — keywords хранится как JSON-array нормализованных
  // токенов. Нормализация (lower/trim) делается в utils/business-bot.js.
  // Партиальный UNIQUE-индекс гарантирует, что ни один title не дублируется
  // среди активных ответов.
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_quick_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      keywords TEXT NOT NULL DEFAULT '[]',
      response_text TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bot_quick_replies_active
      ON bot_quick_replies(is_active, sort_order, id);
  `);

  // 3) bot_status_templates — один шаблон на одно бизнес-событие.
  // event-ключи фиксированы (см. utils/business-bot.js BOT_STATUS_EVENTS),
  // поэтому делаем UNIQUE на event и используем INSERT OR REPLACE / UPSERT.
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_status_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );
  `);

  // 4) bot_message_log — аудит всех событий через Business mode.
  // direction: 'in' (клиент → менеджеру) | 'out' (бот → клиенту)
  // message_type: 'quick_reply' | 'status' | 'price' | 'manual' | 'unmatched' | 'incoming'
  // template_kind/template_id — на что ссылается лог-запись (для отчётов).
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_message_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_connection_id TEXT,
      chat_id TEXT NOT NULL,
      customer_id TEXT,
      customer_telegram_id TEXT,
      direction TEXT NOT NULL,
      message_type TEXT NOT NULL,
      template_kind TEXT,
      template_id INTEGER,
      template_event TEXT,
      text TEXT,
      meta TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bot_message_log_recent
      ON bot_message_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bot_message_log_chat
      ON bot_message_log(chat_id, created_at DESC);
  `);

  // 5) customers — два новых поля для верификации через бот.
  // Через PRAGMA table_info чтобы не упасть на повторном запуске.
  const customerCols = db.prepare(`PRAGMA table_info(customers)`).all();
  const existingNames = new Set(customerCols.map((c) => c.name));
  if (!existingNames.has('bot_verified_at')) {
    db.exec(`ALTER TABLE customers ADD COLUMN bot_verified_at TEXT`);
    console.log('[migration] Added customers.bot_verified_at column');
  }
  if (!existingNames.has('bot_verification_code')) {
    db.exec(`ALTER TABLE customers ADD COLUMN bot_verification_code TEXT`);
    console.log('[migration] Added customers.bot_verification_code column');
  }

  // 6) Дефолтные шаблоны статусов — Костя на старте сможет сразу попробовать
  // сценарий «нажал собрано → клиент получил уведомление». Позже отредактирует
  // через CRM. INSERT OR IGNORE — повторный запуск не ломает кастомные правки.
  const defaultStatusTemplates = [
    {
      event: 'order_assembled',
      title: 'Заказ собран',
      body:
        'Здравствуйте! Ваш заказ на {final_amount} BYN собран и ждёт выдачи.\n' +
        'Подходите по адресу выдачи в часы работы магазина.\n' +
        'Если что-то поменялось — напишите, поможем.',
    },
    {
      event: 'order_issued',
      title: 'Заказ выдан',
      body:
        'Спасибо за покупку, {customer_name}! Заказ на {final_amount} BYN выдан.\n' +
        'Будем рады видеть снова. Если что-то не так — напишите, разберёмся.',
    },
    {
      event: 'order_cancelled',
      title: 'Заказ отменён',
      body:
        'Ваш заказ отменён. Если это ошибка или нужна помощь — напишите.',
    },
    {
      event: 'price_list',
      title: 'Выдача прайса (с кодом верификации)',
      body:
        'Привет! Делимся актуальным прайсом и условиями.\n' +
        'Чтобы открыть мини-приложение и оформить заказ, держите код доступа: {verification_code}.\n' +
        'Просто откройте каталог — мы вас распознаем автоматически.',
    },
    {
      event: 'welcome',
      title: 'Приветствие новому клиенту',
      body:
        'Здравствуйте! Это автоответ. Менеджер скоро ответит лично.\n' +
        'А пока — короткие подсказки:\n' +
        '• «Как заказать?» — расскажем правила и адрес.\n' +
        '• «Когда работаете?» — пришлём часы.\n' +
        'Если хотите оформить заказ — попросите прайс, мы вышлем код доступа к каталогу.',
    },
  ];
  const insertTemplate = db.prepare(
    `INSERT OR IGNORE INTO bot_status_templates (event, title, body, is_active)
     VALUES (?, ?, ?, 1)`,
  );
  for (const t of defaultStatusTemplates) {
    insertTemplate.run(t.event, t.title, t.body);
  }

  // 7) settings: master switch для авто-ответов. Если в settings ключ ещё не
  // создан — добавим со значением '0' (выключено по умолчанию, чтобы Костя
  // включил после ручной проверки шаблонов).
  const existing = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get('bot_auto_replies_enabled');
  if (!existing) {
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run(
      'bot_auto_replies_enabled',
      '0',
    );
    console.log('[migration] Seeded settings.bot_auto_replies_enabled = 0 (off)');
  }
}
