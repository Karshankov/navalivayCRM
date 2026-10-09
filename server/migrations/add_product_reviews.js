import { db } from '../db.js';

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function migrateProductReviews() {
  try {
    const exists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='product_reviews'
    `).get();

    if (!exists) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS product_reviews (
          id TEXT PRIMARY KEY,
          customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          order_item_id TEXT REFERENCES order_items(id) ON DELETE SET NULL,
          group_id TEXT NOT NULL REFERENCES category_groups(id) ON DELETE CASCADE,
          category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
          purchased_variant_id TEXT,
          purchased_variant_name TEXT,
          rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
          body_text TEXT NOT NULL,
          quick_tag_ids TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
          is_anonymous INTEGER NOT NULL DEFAULT 0,
          manager_reply TEXT,
          manager_replied_at TEXT,
          created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
          updated_at TEXT NOT NULL DEFAULT (DATETIME('now')),
          approved_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_product_reviews_group ON product_reviews(group_id);
        CREATE INDEX IF NOT EXISTS idx_product_reviews_customer ON product_reviews(customer_id);
        CREATE INDEX IF NOT EXISTS idx_product_reviews_order ON product_reviews(order_id);
        CREATE INDEX IF NOT EXISTS idx_product_reviews_status ON product_reviews(status);
        CREATE INDEX IF NOT EXISTS idx_product_reviews_created ON product_reviews(created_at);
      `);
    }

    const quickTagsExists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='review_quick_tags'
    `).get();

    if (!quickTagsExists) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS review_quick_tags (
          id TEXT PRIMARY KEY,
          category_key TEXT NOT NULL,
          star_rating INTEGER NOT NULL CHECK (star_rating >= 1 AND star_rating <= 5),
          label TEXT NOT NULL,
          insert_text TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
          updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_review_quick_tags_lookup
          ON review_quick_tags(category_key, star_rating, is_active);
      `);
    }

    const settingsExists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='review_settings'
    `).get();

    if (!settingsExists) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS review_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        INSERT OR IGNORE INTO review_settings (key, value) VALUES ('cooldown_days', '90');
        INSERT OR IGNORE INTO review_settings (key, value) VALUES ('lottery_hint_text', 'В конце месяца разыгрываем 5 подарков среди оставивших отзывы');
        INSERT OR IGNORE INTO review_settings (key, value) VALUES ('dev_test_mode', '0');
        INSERT OR IGNORE INTO review_settings (key, value) VALUES ('qa_active', '0');
        INSERT OR IGNORE INTO review_settings (key, value) VALUES ('qa_usernames', '[]');
        INSERT OR IGNORE INTO review_settings (key, value) VALUES ('manager_display_name', 'Manager Rezonsky');
        INSERT OR IGNORE INTO review_settings (key, value) VALUES ('manager_avatar_url', '/favicon.png');
      `);
    }

    db.exec(`
      INSERT OR IGNORE INTO review_settings (key, value) VALUES ('qa_active', '0');
      INSERT OR IGNORE INTO review_settings (key, value) VALUES ('qa_usernames', '[]');
    `);

    const drawsExists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='review_monthly_draws'
    `).get();

    if (!drawsExists) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS review_monthly_draws (
          id TEXT PRIMARY KEY,
          period_key TEXT NOT NULL UNIQUE,
          drawn_at TEXT NOT NULL DEFAULT (DATETIME('now')),
          status TEXT NOT NULL DEFAULT 'completed'
        );
        CREATE TABLE IF NOT EXISTS review_monthly_draw_winners (
          id TEXT PRIMARY KEY,
          draw_id TEXT NOT NULL REFERENCES review_monthly_draws(id) ON DELETE CASCADE,
          seat_number INTEGER NOT NULL CHECK (seat_number >= 1 AND seat_number <= 5),
          customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          review_id TEXT REFERENCES product_reviews(id) ON DELETE SET NULL,
          is_invalidated INTEGER NOT NULL DEFAULT 0,
          rerolled_from_winner_id TEXT,
          created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
          UNIQUE(draw_id, seat_number)
        );
        CREATE INDEX IF NOT EXISTS idx_review_draw_winners_draw ON review_monthly_draw_winners(draw_id);
      `);
    }

    ensureColumn('customers', 'reviews_opt_out', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn('customers', 'reviews_prefer_anonymous', 'INTEGER NOT NULL DEFAULT 0');
  } catch (error) {
    console.error('[migration] Product reviews migration failed:', error);
    throw error;
  }
}