import { db } from "../db.js";

/**
 * Тарифы карточных лимитов: два самостоятельных лимита.
 *
 * Раньше тариф хранил одно поле limit_minor (трактовалось как месячный лимит).
 * Теперь тариф задаёт оба лимита аккаунта, которые применяются при одобрении
 * заявки или ручной смене тарифа менеджером:
 *   - monthly_limit_minor — месячный лимит клиента
 *   - per_order_limit_minor — лимит одного заказа
 *
 * Стартовые значения для существующих тарифов: monthly_limit_minor = старый
 * limit_minor; per_order_limit = 45 BYN (стандартный дефолт аккаунта).
 *
 * card_payment_accounts.tariff_id — какой тариф сейчас применён к аккаунту
 * (NULL = стандартные лимиты 250/45, тариф не выбран).
 */
export function migrateCardPaymentTariffLimits() {
  const tariffColumns = db.prepare("PRAGMA table_info(card_payment_tariffs)").all();
  const hasMonthly = tariffColumns.some((c) => c.name === "monthly_limit_minor");
  const hasPerOrder = tariffColumns.some((c) => c.name === "per_order_limit_minor");

  if (!hasMonthly || !hasPerOrder) {
    if (!hasMonthly) {
      db.exec("ALTER TABLE card_payment_tariffs ADD COLUMN monthly_limit_minor INTEGER;");
    }
    if (!hasPerOrder) {
      db.exec("ALTER TABLE card_payment_tariffs ADD COLUMN per_order_limit_minor INTEGER;");
    }
    db.exec(`
      UPDATE card_payment_tariffs
      SET
        monthly_limit_minor = COALESCE(monthly_limit_minor, limit_minor),
        per_order_limit_minor = COALESCE(per_order_limit_minor, 4500);
    `);
  }

  const accountColumns = db.prepare("PRAGMA table_info(card_payment_accounts)").all();
  if (!accountColumns.some((c) => c.name === "tariff_id")) {
    db.exec(`
      ALTER TABLE card_payment_accounts
        ADD COLUMN tariff_id TEXT REFERENCES card_payment_tariffs(id) ON DELETE SET NULL;
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_card_payment_accounts_tariff
      ON card_payment_accounts(tariff_id);
  `);
  console.log("[migration] Card payment tariff limits migration completed successfully");
}
