import { db } from '../db.js';

/**
 * Скидки каталога: на линейку, на товар и на отдельный вкус.
 *
 * Цену со скидкой держим ОТДЕЛЬНО от `products.priceRub` и
 * `product_variants.price_rub` намеренно. На сравнении проданной цены с
 * каталожной построена блокировка бонусов (`isPositionSalePriceReduced` в
 * loyalty.js): позиция, проданная дешевле каталога, не даёт штамп. Если писать
 * скидку прямо в цену товара, эта проверка ослепнет, и за скидочный товар снова
 * начнут копиться бонусы, причём молча и при зелёных тестах.
 *
 * Одна таблица на все три уровня вместо колонок в трёх местах: правила выбора
 * цены и срока живут в одном месте, и добавить четвёртый уровень потом можно
 * без новой миграции.
 */
export function migrateCatalogDiscounts() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_discounts (
      scope TEXT NOT NULL CHECK (scope IN ('group', 'product', 'variant')),
      target_id TEXT NOT NULL,
      price_byn REAL NOT NULL CHECK (price_byn >= 0),
      -- Последний день действия по календарю магазина, формат YYYY-MM-DD.
      -- Пусто означает «без срока», такую скидку снимают руками.
      until_date TEXT,
      created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      updated_at TEXT NOT NULL DEFAULT (DATETIME('now')),
      PRIMARY KEY (scope, target_id)
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_catalog_discounts_target
      ON catalog_discounts(target_id);
  `);
}
