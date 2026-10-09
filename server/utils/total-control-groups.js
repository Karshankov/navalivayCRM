/**
 * Собирает сводку по линейкам, отмеченным «Тотальным контролем».
 * Для товаров с вариантами считаем остатки вариантов, для остальных остаток товара.
 * Дочерние линейки входят в итог родительской линейки.
 */
export function buildTotalControlGroups(database) {
  const groups = database.prepare(`
    SELECT
      g.id,
      g.name,
      g.[order] AS sort_order,
      g.categoryId AS category_id,
      c.name AS category_name,
      CASE WHEN g.cover_image IS NOT NULL AND g.cover_image != '' THEN 1 ELSE 0 END AS has_cover_image
    FROM category_groups g
    LEFT JOIN categories c ON c.id = g.categoryId
    WHERE g.total_control = 1
    ORDER BY c.[order] ASC, g.[order] ASC, g.name COLLATE NOCASE ASC
  `).all();

  if (!groups.length) return [];

  const rows = database.prepare(`
    WITH RECURSIVE monitored(root_id, group_id) AS (
      SELECT id, id
      FROM category_groups
      WHERE total_control = 1

      UNION ALL

      SELECT monitored.root_id, child.id
      FROM category_groups child
      JOIN monitored ON child.parent_group_id = monitored.group_id
    )
    SELECT
      monitored.root_id,
      p.id AS product_id,
      NULL AS variant_id,
      COALESCE(NULLIF(TRIM(p.title), ''), 'Без названия') AS label,
      MAX(0, COALESCE(p.stock, 0)) AS stock
    FROM monitored
    JOIN products p ON p.groupId = monitored.group_id
    WHERE COALESCE(p.has_variants, 0) = 0

    UNION ALL

    SELECT
      monitored.root_id,
      p.id AS product_id,
      pv.id AS variant_id,
      CASE
        WHEN NULLIF(TRIM(pv.name), '') IS NULL THEN COALESCE(NULLIF(TRIM(p.title), ''), 'Без названия')
        ELSE COALESCE(NULLIF(TRIM(p.title), ''), 'Без названия') || ' · ' || TRIM(pv.name)
      END AS label,
      MAX(0, COALESCE(pv.stock, 0)) AS stock
    FROM monitored
    JOIN products p ON p.groupId = monitored.group_id
    JOIN product_variants pv ON pv.product_id = p.id
    WHERE COALESCE(p.has_variants, 0) = 1
  `).all();

  const itemsByGroup = new Map();
  for (const row of rows) {
    const items = itemsByGroup.get(row.root_id) || [];
    items.push({
      id: row.variant_id || row.product_id,
      productId: row.product_id,
      variantId: row.variant_id || null,
      label: row.label,
      stock: Number(row.stock || 0),
    });
    itemsByGroup.set(row.root_id, items);
  }

  return groups.map((group) => {
    const items = itemsByGroup.get(group.id) || [];
    items.sort((left, right) =>
      left.stock - right.stock ||
      left.label.localeCompare(right.label, 'ru', { numeric: true, sensitivity: 'base' }),
    );

    return {
      id: group.id,
      name: group.name,
      categoryId: group.category_id || null,
      categoryName: group.category_name || null,
      hasCoverImage: Boolean(group.has_cover_image),
      totalStock: items.reduce((sum, item) => sum + item.stock, 0),
      itemCount: items.length,
      items,
    };
  });
}
