import { db } from '../db.js';
import { toSqliteUtcString } from './business-time.js';

const STOREFRONT_OVERFETCH_MAX = 100;

function toSqliteDate(date) {
  return toSqliteUtcString(date);
}

function collectGroupSubtreeIds(groupId) {
  const rootId = String(groupId);
  const ids = new Set([rootId]);
  const queue = [rootId];

  while (queue.length > 0) {
    const current = queue.shift();
    const children = db
      .prepare('SELECT id FROM category_groups WHERE parent_group_id = ?')
      .all(current);
    for (const child of children) {
      const childId = String(child.id);
      if (!ids.has(childId)) {
        ids.add(childId);
        queue.push(childId);
      }
    }
  }

  return [...ids];
}

function countInStockProductsInGroups(groupIds) {
  if (!groupIds.length) return 0;

  const placeholders = groupIds.map(() => '?').join(',');
  const row = db
    .prepare(
      `
      SELECT COUNT(DISTINCT p.id) AS total
      FROM products p
      WHERE p.groupId IN (${placeholders})
        AND (
          (COALESCE(p.has_variants, 0) = 0 AND (p.stock IS NULL OR p.stock > 0))
          OR
          (COALESCE(p.has_variants, 0) = 1 AND EXISTS (
            SELECT 1 FROM product_variants pv
            WHERE pv.product_id = p.id
              AND (pv.stock IS NULL OR pv.stock > 0)
          ))
        )
    `,
    )
    .get(...groupIds);

  return Number(row?.total ?? 0);
}

/**
 * Линейка доступна на витрине, если в ней или в подлинейках есть товар в наличии.
 * Совпадает с логикой productCount / totalProductCount в /api/categories.
 */
export function isGroupAvailableOnStorefront(groupId) {
  const id = String(groupId);
  if (!id || id === 'no_group') return false;

  const group = db.prepare('SELECT id FROM category_groups WHERE id = ?').get(id);
  if (!group) return false;

  return countInStockProductsInGroups(collectGroupSubtreeIds(id)) > 0;
}

function mapTopSalesRow(row, rank) {
  return {
    groupId: String(row.group_id),
    groupName: row.group_name,
    categoryId: row.category_id ? String(row.category_id) : null,
    rank,
    totalQuantity: Number(row.total_quantity ?? 0),
    totalRevenue: Number(row.total_revenue ?? 0),
    totalProfit: Number(row.total_profit ?? 0),
    hasCoverImage: Boolean(row.has_cover_image),
  };
}

function applyStorefrontAvailabilityFilter(rows, safeLimit, candidateLimit) {
  const availableRows = rows.filter((row) =>
    isGroupAvailableOnStorefront(row.group_id),
  );

  const hasMore = availableRows.length > safeLimit || rows.length > candidateLimit;

  const items = availableRows
    .slice(0, safeLimit)
    .map((row, index) => mapTopSalesRow(row, index + 1));

  return { items, hasMore };
}

/**
 * Топ линеек по продажам за период (paid_at, completed/delivered).
 * Логика совпадает с CRM dashboard topProducts.
 *
 * Про обложку: в подзапрос идёт только признак «картинка есть», а не сама
 * картинка. Наружу из mapTopSalesRow всё равно уходит булево hasCoverImage, а
 * обложки лежат в базе строкой base64 по 50 килобайт. Раньше тут стоял
 * g.cover_image с последующим MAX(cover_image), и движок тащил эти строки через
 * каждую позицию заказа: замер на 10 300 позициях дал 3333 мс против 32 мс, то
 * есть в сто раз дольше. На двух ядрах с ограничением по памяти запрос за год
 * переставал возвращаться вовсе и блокировал весь процесс, вместе с выдачей
 * каталога. Не возвращайте сюда саму обложку.
 */
export function queryTopSalesGroups({
  start,
  end,
  categoryId = null,
  sortBy = 'quantity',
  limit = 5,
  search = '',
  onlyStorefrontAvailable = false,
} = {}) {
  if (!start || !end) {
    const err = new Error('period_required');
    err.code = 'period_required';
    throw err;
  }

  const paidAtFilter = `o.paid_at >= '${toSqliteDate(start)}' AND o.paid_at < '${toSqliteDate(end)}'`;
  const topOrderBy = sortBy === 'quantity' ? 'total_quantity DESC' : 'total_profit DESC';
  const safeLimit = Number.isFinite(Number(limit))
    ? Math.min(Math.max(Math.trunc(Number(limit)), 1), 1000)
    : 5;
  const safeSearch =
    typeof search === 'string' ? search.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`) : '';

  const candidateLimit = onlyStorefrontAvailable
    ? Math.min(Math.max(safeLimit * 10, safeLimit + 5), STOREFRONT_OVERFETCH_MAX)
    : safeLimit;

  const categoryClause = categoryId ? 'AND g.categoryId = ?' : '';
  const params = [];
  if (categoryId) {
    params.push(String(categoryId));
  }
  const sqlLimit = onlyStorefrontAvailable ? candidateLimit + 1 : safeLimit + 1;
  params.push(safeSearch, safeSearch, sqlLimit);

  const rows = db
    .prepare(
      `
      WITH order_totals AS (
        SELECT order_id, SUM(total_price) AS items_subtotal
        FROM order_items
        GROUP BY order_id
      ),
      item_totals AS (
        SELECT
          oi.quantity AS quantity,
          oi.total_price AS total_price,
          oi.total_cost AS total_cost,
          COALESCE(g.id, 'no_group') AS group_id,
          COALESCE(g.name, 'Без линейки') AS group_name,
          CASE WHEN g.cover_image IS NOT NULL AND g.cover_image != '' THEN 1 ELSE 0 END AS has_cover_image,
          g.categoryId AS category_id,
          CASE
            WHEN COALESCE(ot.items_subtotal, 0) > 0
            THEN (COALESCE(ot.items_subtotal, 0) - COALESCE(o.final_amount, ot.items_subtotal)) / COALESCE(ot.items_subtotal, 0)
            ELSE 0
          END AS order_discount_ratio
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN order_totals ot ON ot.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN category_groups g ON g.id = p.groupId
        WHERE o.status IN ('completed', 'delivered')
          AND o.paid_at IS NOT NULL
          AND ${paidAtFilter}
          ${categoryClause}
      )
      SELECT
        group_id,
        group_name,
        MAX(has_cover_image) AS has_cover_image,
        MAX(category_id) AS category_id,
        SUM(quantity) as total_quantity,
        SUM(total_price - (total_price * order_discount_ratio)) as total_revenue,
        SUM((total_price - (total_price * order_discount_ratio)) - total_cost) as total_profit
      FROM item_totals
      WHERE group_id != 'no_group'
        AND (? = '' OR LOWER(group_name) LIKE '%' || LOWER(?) || '%' ESCAPE '\\')
      GROUP BY group_id, group_name
      ORDER BY ${topOrderBy}
      LIMIT ?
    `,
    )
    .all(...params);

  if (onlyStorefrontAvailable) {
    return applyStorefrontAvailabilityFilter(rows, safeLimit, candidateLimit);
  }

  const hasMore = rows.length > safeLimit;
  const items = rows.slice(0, safeLimit).map((row, index) => mapTopSalesRow(row, index + 1));

  return { items, hasMore };
}