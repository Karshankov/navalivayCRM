import { db } from '../db.js';

/**
 * П.4: фильтры витрины — профиль категории и крепость линейки.
 *   categories.storefront_filters_profile — none | liquids | snus_plates
 *   category_groups.strength_tier — very_strong | strong | light | NULL
 *   category_groups.waive_strength_tier — waiver для контроля заполненности
 */
export function migrateStorefrontFilters() {
  const catCols = db.prepare('PRAGMA table_info(categories)').all();
  const catNames = new Set(catCols.map((c) => c.name));

  if (!catNames.has('storefront_filters_profile')) {
    db.exec(
      "ALTER TABLE categories ADD COLUMN storefront_filters_profile TEXT NOT NULL DEFAULT 'none';",
    );
    console.log('[migration] Added categories.storefront_filters_profile');
  }

  const groupCols = db.prepare('PRAGMA table_info(category_groups)').all();
  const groupNames = new Set(groupCols.map((c) => c.name));

  if (!groupNames.has('strength_tier')) {
    db.exec('ALTER TABLE category_groups ADD COLUMN strength_tier TEXT;');
    console.log('[migration] Added category_groups.strength_tier');
  }
  if (!groupNames.has('waive_strength_tier')) {
    db.exec(
      'ALTER TABLE category_groups ADD COLUMN waive_strength_tier INTEGER NOT NULL DEFAULT 0;',
    );
    console.log('[migration] Added category_groups.waive_strength_tier');
  }

  const liquidRows = db
    .prepare(
      `SELECT id, slug, name, display_mode, storefront_filters_profile
         FROM categories
        WHERE storefront_filters_profile = 'none'`,
    )
    .all();

  const liquidStmt = db.prepare(
    `UPDATE categories SET storefront_filters_profile = 'liquids' WHERE id = ?`,
  );
  const snusStmt = db.prepare(
    `UPDATE categories SET storefront_filters_profile = 'snus_plates' WHERE id = ?`,
  );

  for (const row of liquidRows) {
    const slug = String(row.slug || '').toLowerCase();
    const name = String(row.name || '').toLowerCase();
    const displayMode = String(row.display_mode || '').toLowerCase();

    const isSnus =
      slug.includes('snus') ||
      slug.includes('snyus') ||
      slug.includes('plastin') ||
      name.includes('снюс') ||
      name.includes('пластин');

    if (isSnus) {
      snusStmt.run(row.id);
      continue;
    }

    const isLiquid =
      displayMode === 'liquid' ||
      slug.includes('liquid') ||
      slug.includes('liq') ||
      slug.includes('salt') ||
      slug.includes('zhidk') ||
      slug.includes('juice') ||
      name.includes('жидк') ||
      name.includes('солев');

    if (isLiquid) {
      liquidStmt.run(row.id);
    }
  }
}