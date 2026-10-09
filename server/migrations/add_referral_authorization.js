import { db } from '../db.js';

export function migrateReferralAuthorization() {
  db.transaction(() => {
    const customerColumns = db.prepare('PRAGMA table_info(customers)').all();
    const names = new Set(customerColumns.map((column) => column.name));

    if (!names.has('access_authorized_at')) {
      db.exec('ALTER TABLE customers ADD COLUMN access_authorized_at TEXT');
    }
    if (!names.has('access_authorization_source')) {
      db.exec('ALTER TABLE customers ADD COLUMN access_authorization_source TEXT');
    }
    if (!names.has('access_authorized_by')) {
      db.exec('ALTER TABLE customers ADD COLUMN access_authorized_by TEXT');
    }

    const orderColumns = db.prepare('PRAGMA table_info(orders)').all();
    const orderNames = new Set(orderColumns.map((column) => column.name));
    if (!orderNames.has('access_authorization_source')) {
      db.exec('ALTER TABLE orders ADD COLUMN access_authorization_source TEXT');
    }

    db.exec(`
    CREATE TABLE IF NOT EXISTS referral_auth_states (
      telegram_id TEXT PRIMARY KEY,
      customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
      attempts_used INTEGER NOT NULL DEFAULT 0 CHECK(attempts_used BETWEEN 0 AND 3),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'authorized', 'blocked')),
      last_error_code TEXT,
      last_username TEXT,
      blocked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    CREATE TABLE IF NOT EXISTS referral_auth_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT NOT NULL,
      customer_id TEXT,
      submitted_username TEXT,
      outcome TEXT NOT NULL,
      attempt_number INTEGER,
      inviter_customer_id TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_referral_auth_events_telegram
      ON referral_auth_events(telegram_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS customer_referrals (
      invitee_customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      inviter_customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
      inviter_username_snapshot TEXT NOT NULL,
      submitted_username TEXT NOT NULL,
      first_order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
      authorized_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_customer_referrals_inviter
      ON customer_referrals(inviter_customer_id, authorized_at DESC);

    CREATE TABLE IF NOT EXISTS customer_invite_bans (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      reason TEXT,
      banned_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      banned_by TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      unbanned_at TEXT,
      unbanned_by TEXT,
      unban_reason TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_invite_bans_one_active
      ON customer_invite_bans(customer_id) WHERE active = 1;

    CREATE TABLE IF NOT EXISTS referral_disallowed_inviter_usernames (
      username TEXT PRIMARY KEY COLLATE NOCASE,
      added_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      added_by TEXT
    );

    CREATE TABLE IF NOT EXISTS pending_customer_invite_bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      reason TEXT,
      banned_by TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );

    CREATE TABLE IF NOT EXISTS pending_staff_access_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      granted_by TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
    );
    `);

    const eventColumns = new Set(
      db.prepare('PRAGMA table_info(referral_auth_events)').all().map((column) => column.name),
    );
    if (!eventColumns.has('performed_by')) {
      db.exec('ALTER TABLE referral_auth_events ADD COLUMN performed_by TEXT');
    }

    // На выкладке автоматически пропускаем только тех, у кого уже есть хотя
    // бы один выданный заказ. Остальные записи должны увидеть окно.
    // v2 также исправляет базы, где ранняя локальная версия успела ошибочно
    // пометить legacy всех клиентов подряд.
    const orderBackfillDone = db.prepare(`
      SELECT 1 FROM settings
      WHERE key = 'referral_authorization_order_backfill_v2_done'
    `).get();
    if (!orderBackfillDone) {
      // Новая авторизация важнее ошибочного legacy-источника ранней версии.
      db.prepare(`
        UPDATE customers
        SET access_authorized_at = COALESCE(access_authorized_at, DATETIME('now')),
            access_authorization_source = 'referral'
        WHERE EXISTS (
          SELECT 1 FROM customer_referrals cr
          WHERE cr.invitee_customer_id = customers.id
        ) OR EXISTS (
          SELECT 1 FROM referral_auth_states ras
          WHERE ras.customer_id = customers.id AND ras.status = 'authorized'
        )
      `).run();

      db.prepare(`
        UPDATE customers
        SET access_authorized_at = NULL,
            access_authorization_source = NULL
        WHERE access_authorization_source = 'legacy'
          AND NOT EXISTS (
            SELECT 1 FROM orders o
            WHERE o.customer_id = customers.id
              AND o.status IN ('completed', 'delivered')
          )
          AND NOT EXISTS (
            SELECT 1 FROM customer_referrals cr
            WHERE cr.invitee_customer_id = customers.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM referral_auth_states ras
            WHERE ras.customer_id = customers.id AND ras.status = 'authorized'
          )
      `).run();

      db.prepare(`
        UPDATE customers
        SET access_authorized_at = COALESCE(access_authorized_at, DATETIME('now')),
            access_authorization_source = CASE
              WHEN access_authorization_source = 'feature_disabled'
                OR access_authorization_source IS NULL THEN 'legacy'
              ELSE access_authorization_source
            END
        WHERE EXISTS (
          SELECT 1 FROM orders o
          WHERE o.customer_id = customers.id
            AND o.status IN ('completed', 'delivered')
        )
      `).run();
      db.prepare(`
        INSERT INTO settings (key, value)
        VALUES ('referral_authorization_legacy_backfill_done', '1')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run();
      db.prepare(`
        INSERT INTO settings (key, value)
        VALUES ('referral_authorization_order_backfill_v2_done', '1')
      `).run();
    }

    // До новой реферальной схемы bot_verified_at был явным подтверждением
    // менеджера. Эти клиенты уже считались «своими», поэтому сохраняем им
    // доступ и право приглашать даже при отсутствии выданного заказа.
    // Отдельный маркер не позволяет будущей bot-верификации задним числом
    // превратить нового referral-клиента в пригласившего.
    if (names.has('bot_verified_at')) {
      const verifiedLegacyBackfillDone = db.prepare(`
        SELECT 1 FROM settings
        WHERE key = 'referral_authorization_verified_legacy_backfill_v1_done'
      `).get();
      if (!verifiedLegacyBackfillDone) {
        db.prepare(`
          UPDATE customers
          SET access_authorized_at = COALESCE(access_authorized_at, bot_verified_at, DATETIME('now')),
              access_authorization_source = CASE
                WHEN access_authorization_source IS NULL
                  OR access_authorization_source = 'feature_disabled'
                  OR access_authorization_source = 'legacy' THEN 'legacy'
                ELSE access_authorization_source
              END
          WHERE bot_verified_at IS NOT NULL
            AND deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM customer_referrals cr
              WHERE cr.invitee_customer_id = customers.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM referral_auth_states ras
              WHERE ras.customer_id = customers.id AND ras.status = 'authorized'
            )
        `).run();
        db.prepare(`
          INSERT INTO settings (key, value)
          VALUES ('referral_authorization_verified_legacy_backfill_v1_done', '1')
        `).run();
      }
    }

    db.prepare(`
      INSERT INTO settings (key, value)
      VALUES ('referral_authorization_enabled', ?)
      ON CONFLICT(key) DO NOTHING
    `).run(process.env.REFERRAL_AUTHORIZATION_ENABLED === '1' ? '1' : '0');

    db.prepare(`
      INSERT INTO settings (key, value)
      VALUES ('invite_ban_reason_templates', ?)
      ON CONFLICT(key) DO NOTHING
    `).run(JSON.stringify([
      'Приглашает незнакомых людей',
      'Подозрительная активность',
      'Нарушение правил приглашения',
    ]));
  }).immediate();
}
