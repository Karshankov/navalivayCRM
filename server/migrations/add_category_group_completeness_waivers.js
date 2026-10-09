import { db } from '../db.js';

/**
 * Постоянные waiver-флаги для контроля заполненности линеек (п.3):
 *   waive_description — описание/крепость (meta_value) не требуется
 *   waive_min_stock   — минимальный остаток не требуется
 *   waive_wholesale   — оптовые цены не требуются
 */
export function migrateCategoryGroupCompletenessWaivers() {
  const cols = db.prepare('PRAGMA table_info(category_groups)').all();
  const names = new Set(cols.map((c) => c.name));

  if (!names.has('waive_description')) {
    db.exec(
      'ALTER TABLE category_groups ADD COLUMN waive_description INTEGER NOT NULL DEFAULT 0;',
    );
    console.log('[migration] Added category_groups.waive_description');
  }
  if (!names.has('waive_min_stock')) {
    db.exec(
      'ALTER TABLE category_groups ADD COLUMN waive_min_stock INTEGER NOT NULL DEFAULT 0;',
    );
    console.log('[migration] Added category_groups.waive_min_stock');
  }
  if (!names.has('waive_wholesale')) {
    db.exec(
      'ALTER TABLE category_groups ADD COLUMN waive_wholesale INTEGER NOT NULL DEFAULT 0;',
    );
    console.log('[migration] Added category_groups.waive_wholesale');
  }
}