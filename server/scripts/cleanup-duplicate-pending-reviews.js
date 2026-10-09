/**
 * Удаляет дубли pending-отзывов: оставляет самый ранний на пару
 * (customer_id, order_id, group_id).
 *
 * Usage:
 *   node server/scripts/cleanup-duplicate-pending-reviews.js
 *   node server/scripts/cleanup-duplicate-pending-reviews.js --dry-run
 */
import { initDb, db } from '../db.js';

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

initDb();

const dryRun = hasFlag('dry-run');

const groups = db.prepare(`
  SELECT customer_id, order_id, group_id, COUNT(*) AS cnt
  FROM product_reviews
  WHERE status = 'pending'
  GROUP BY customer_id, order_id, group_id
  HAVING cnt > 1
`).all();

if (!groups.length) {
  console.log('[cleanup-duplicate-pending-reviews] Дублей pending нет.');
  process.exit(0);
}

console.log(`[cleanup-duplicate-pending-reviews] Найдено групп с дублями: ${groups.length}`);

const toDelete = [];

for (const group of groups) {
  const rows = db.prepare(`
    SELECT pr.id, pr.created_at, o.order_number, cg.name AS group_name, c.telegram_username
    FROM product_reviews pr
    JOIN orders o ON o.id = pr.order_id
    JOIN category_groups cg ON cg.id = pr.group_id
    LEFT JOIN customers c ON c.id = pr.customer_id
    WHERE pr.customer_id = ? AND pr.order_id = ? AND pr.group_id = ? AND pr.status = 'pending'
    ORDER BY pr.created_at ASC, pr.rowid ASC
  `).all(group.customer_id, group.order_id, group.group_id);

  const keep = rows[0];
  const extras = rows.slice(1);
  console.log(`  keep: ${keep.id} (@${keep.telegram_username || '?'} заказ #${keep.order_number} ${keep.group_name})`);
  for (const row of extras) {
    console.log(`  delete: ${row.id} (${row.created_at})`);
    toDelete.push(row.id);
  }
}

if (dryRun) {
  console.log(`\n[dry-run] Будет удалено: ${toDelete.length}`);
  process.exit(0);
}

const tx = db.transaction((ids) => {
  const del = db.prepare('DELETE FROM product_reviews WHERE id = ?');
  for (const id of ids) del.run(id);
});

tx(toDelete);
console.log(`\n[cleanup-duplicate-pending-reviews] Удалено дублей: ${toDelete.length}`);