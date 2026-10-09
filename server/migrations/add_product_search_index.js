import { db } from '../db.js';

export function migrateProductSearchIndex() {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS product_search_index USING fts5(
      item_id UNINDEXED,
      product_id UNINDEXED,
      variant_id UNINDEXED,
      is_variant UNINDEXED,
      category_id UNINDEXED,
      group_id UNINDEXED,
      title,
      searchable_text,
      normalized_text,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TABLE IF NOT EXISTS product_search_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}
