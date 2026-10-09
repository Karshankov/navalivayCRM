import { db } from '../db.js';

/**
 * Adds category_groups.parked_order — сохраняет "замороженную" позицию группы,
 * когда все её товары уходят в out-of-stock.
 *
 * Поведение:
 *   - группа становится пустой (totalStock = 0) и parked_order IS NULL
 *       → parked_order := текущий [order] (фиксируем позицию)
 *   - группа снова непустая и parked_order IS NOT NULL
 *       → [order] := parked_order (со сдвигом соседей на +1), parked_order := NULL
 *   - админский reorder игнорирует линейки с parked_order IS NOT NULL
 *     (их позиция "заморожена", и двигать их нельзя без возврата в наличие)
 *
 * Работает параллельно с existing empty_since (он хранит *дату* ухода в простой,
 * parked_order — *позицию*). Разные поля, разная семантика, друг другу не мешают.
 */
export function migrateParkedOrderToGroups() {
  try {
    const columns = db.prepare(`PRAGMA table_info(category_groups)`).all();
    const hasParkedOrderColumn = columns.some((col) => col.name === 'parked_order');

    if (!hasParkedOrderColumn) {
      db.exec(`
        ALTER TABLE category_groups
        ADD COLUMN parked_order INTEGER DEFAULT NULL;
      `);
      console.log('[migration] Added parked_order to category_groups table');

      // Bootstrap: все группы, которые сейчас пустые (totalStock = 0 с учётом дочерних),
      // сразу замораживаются на своих текущих [order]. Это нужно, чтобы существующие
      // "серые" линейки не уехали в конец списка при ближайшем реордере админа, пока
      // новая логика только активируется.
      const rows = db.prepare(`
        SELECT
          g.id,
          g.[order] AS current_order,
          COALESCE(SUM(
            CASE
              WHEN p.has_variants = 1 THEN (SELECT COALESCE(SUM(pv.stock), 0) FROM product_variants pv WHERE pv.product_id = p.id)
              ELSE COALESCE(p.stock, 0)
            END
          ), 0) AS totalStock
        FROM category_groups g
        LEFT JOIN products p ON p.groupId = g.id
        GROUP BY g.id
      `).all();

      const stmt = db.prepare('UPDATE category_groups SET parked_order = ? WHERE id = ?');
      const tx = db.transaction(() => {
        let frozen = 0;
        rows.forEach((row) => {
          if (Number(row.totalStock) === 0) {
            stmt.run(Number(row.current_order ?? 0), row.id);
            frozen += 1;
          }
        });
        console.log(`[migration] Bootstrap: parked_order set for ${frozen} empty groups`);
      });
      tx();
    }

    console.log('[migration] parked_order column check complete');
  } catch (error) {
    console.error('[migration] Failed to add parked_order column:', error);
    throw error;
  }
}
