import { db } from '../db.js';

/**
 * Разовая чистка денежных хвостов.
 *
 * Себестоимость и прибыль считались делением и писались в базу без округления,
 * поэтому там осели значения вида 11.399999999999999. Хвост тянулся дальше:
 * себестоимость в прибыль заказа, прибыль в сумму за день, и на дашборде
 * появлялись подписи в 16 знаков после запятой. Сама причина закрыта
 * округлением при записи (server/utils/money.js), здесь приводим в порядок то,
 * что уже накопилось.
 *
 * Округление до копеек: суммы в BYN и RUB меньше копейки не бывают, так что
 * значения не искажаются, только отбрасывается мусорный хвост.
 */
const MONEY_COLUMNS = [
  ['products', 'cost_price'],
  ['orders', 'profit'],
  ['orders', 'final_amount'],
  ['orders', 'total_amount'],
  ['order_items', 'cost_per_unit'],
  ['order_items', 'price_per_unit'],
  ['order_items', 'total_price'],
  ['procurement_items', 'cost_per_unit'],
  ['pos_sales', 'price'],
  ['pos_sales', 'cost_price'],
  ['pos_sales', 'profit'],
];

function tableExists(table) {
  return Boolean(
    db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
    ).get(table),
  );
}

function columnExists(table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column);
}

export function migrateRoundMoneyColumns() {
  const settingKey = 'money_columns_rounded_v1';
  const done = db
    .prepare('SELECT 1 FROM settings WHERE key = ? LIMIT 1')
    .get(settingKey);
  if (done) return;

  let total = 0;
  db.transaction(() => {
    for (const [table, column] of MONEY_COLUMNS) {
      if (!tableExists(table) || !columnExists(table, column)) continue;
      const result = db.prepare(`
        UPDATE ${table}
        SET ${column} = ROUND(${column}, 2)
        WHERE ${column} IS NOT NULL AND ${column} <> ROUND(${column}, 2)
      `).run();
      if (result.changes) {
        total += result.changes;
        console.log(`[migration] Округлено ${table}.${column}: ${result.changes}`);
      }
    }
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, DATETIME('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(settingKey);
  }).immediate();

  console.log(`[migration] Денежные хвосты убраны, строк исправлено: ${total}`);
}
