import { db } from "../db.js";

function tableExists(table) {
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
      )
      .get(table),
  );
}

function columnExists(table, column) {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`)
      .get(column),
  );
}

const DEFAULT_CATEGORIES = [
  {
    id: "loyalty_liquids",
    key: "liquids",
    threshold: 10,
    discountAmount: 10,
    title: "Жидкости и снюс",
    description: "За каждые 10 покупок можно применить скидку 10 BYN",
    sortOrder: 10,
  },
  {
    id: "loyalty_disposables",
    key: "disposables",
    threshold: 5,
    discountAmount: 15,
    title: "Одноразки",
    description: "За каждые 5 покупок можно применить скидку 15 BYN",
    sortOrder: 20,
  },
  {
    id: "loyalty_devices",
    key: "devices",
    threshold: 4,
    discountAmount: 25,
    title: "Устройства",
    description: "За каждые 4 покупки можно применить скидку 25 BYN",
    sortOrder: 30,
  },
];

const DEFAULT_CATEGORY_MAPPING_RULES = [
  {
    loyaltyCategoryId: "loyalty_liquids",
    candidates: [
      "c_liquids_salt",
      "c_liquids_freebase",
      "zhidkosti",
      "Жидкости",
      "Liquids",
      "snyus-i-plastiny",
      "Снюс и пластины",
      "Снюс",
      "Snus",
    ],
  },
  {
    loyaltyCategoryId: "loyalty_disposables",
    candidates: [
      "c_disposables",
      "odnorazki",
      "Одноразки",
      "Disposables",
    ],
  },
  {
    loyaltyCategoryId: "loyalty_devices",
    candidates: [
      "c_pods",
      "ustrojstva",
      "Устройства",
      "Devices",
    ],
  },
];

function normalizeComparable(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
}

function collectDefaultCategoryMappings() {
  const categories = db
    .prepare("SELECT id, slug, name FROM categories")
    .all()
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      comparable: new Set(
        [row.id, row.slug, row.name]
          .map((value) => normalizeComparable(value))
          .filter(Boolean),
      ),
    }));

  const mappings = [];

  for (const rule of DEFAULT_CATEGORY_MAPPING_RULES) {
    const candidates = new Set(
      rule.candidates
        .map((value) => normalizeComparable(value))
        .filter(Boolean),
    );

    for (const category of categories) {
      const matches = [...category.comparable].some((value) => candidates.has(value));
      if (!matches) {
        continue;
      }

      mappings.push({
        loyaltyCategoryId: rule.loyaltyCategoryId,
        categoryId: category.id,
      });
    }
  }

  return mappings;
}

export function migrateLoyaltyTables() {
  try {
    if (!tableExists("loyalty_categories")) {
      db.exec(`
        CREATE TABLE loyalty_categories (
          id TEXT PRIMARY KEY,
          key TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
        );

        CREATE TABLE loyalty_category_settings (
          loyalty_category_id TEXT PRIMARY KEY REFERENCES loyalty_categories(id) ON DELETE CASCADE,
          threshold INTEGER NOT NULL,
          discount_amount REAL NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
        );

        CREATE TABLE loyalty_category_mappings (
          id TEXT PRIMARY KEY,
          loyalty_category_id TEXT NOT NULL REFERENCES loyalty_categories(id) ON DELETE CASCADE,
          category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
          group_id TEXT REFERENCES category_groups(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
          CHECK (
            (category_id IS NOT NULL AND group_id IS NULL)
            OR (category_id IS NULL AND group_id IS NOT NULL)
          )
        );
        CREATE INDEX idx_loyalty_mapping_category ON loyalty_category_mappings(category_id);
        CREATE INDEX idx_loyalty_mapping_group ON loyalty_category_mappings(group_id);
        CREATE INDEX idx_loyalty_mapping_category_ref ON loyalty_category_mappings(loyalty_category_id);

        CREATE TABLE customer_loyalty_balances (
          customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          loyalty_category_id TEXT NOT NULL REFERENCES loyalty_categories(id) ON DELETE CASCADE,
          balance INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (DATETIME('now')),
          PRIMARY KEY (customer_id, loyalty_category_id)
        );

        CREATE TABLE customer_loyalty_ledger (
          id TEXT PRIMARY KEY,
          customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          loyalty_category_id TEXT NOT NULL REFERENCES loyalty_categories(id) ON DELETE CASCADE,
          order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
          order_item_id TEXT REFERENCES order_items(id) ON DELETE SET NULL,
          reason TEXT NOT NULL,
          delta INTEGER NOT NULL,
          balance_after INTEGER NOT NULL,
          note TEXT,
          created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
        );
        CREATE INDEX idx_customer_loyalty_ledger_customer ON customer_loyalty_ledger(customer_id, created_at DESC);
        CREATE INDEX idx_customer_loyalty_ledger_order ON customer_loyalty_ledger(order_id);

        CREATE TABLE order_loyalty_redemptions (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
          customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
          loyalty_category_id TEXT NOT NULL REFERENCES loyalty_categories(id) ON DELETE CASCADE,
          units_applied INTEGER NOT NULL DEFAULT 0,
          threshold_snapshot INTEGER NOT NULL,
          discount_per_unit_snapshot REAL NOT NULL,
          stamps_spent INTEGER NOT NULL,
          discount_total REAL NOT NULL,
          created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
        );
        CREATE INDEX idx_order_loyalty_redemptions_order ON order_loyalty_redemptions(order_id);
        CREATE INDEX idx_order_loyalty_redemptions_item ON order_loyalty_redemptions(order_item_id);
      `);
    }

    if (!columnExists("order_items", "manual_discount_amount")) {
      db.prepare(
        "ALTER TABLE order_items ADD COLUMN manual_discount_amount REAL NOT NULL DEFAULT 0",
      ).run();
    }

    if (!columnExists("order_items", "loyalty_discount_amount")) {
      db.prepare(
        "ALTER TABLE order_items ADD COLUMN loyalty_discount_amount REAL NOT NULL DEFAULT 0",
      ).run();
    }

    if (!columnExists("order_items", "loyalty_units_applied")) {
      db.prepare(
        "ALTER TABLE order_items ADD COLUMN loyalty_units_applied INTEGER NOT NULL DEFAULT 0",
      ).run();
    }

    db.exec(`
      UPDATE order_items
      SET manual_discount_amount = COALESCE(discount_amount, 0)
      WHERE manual_discount_amount IS NULL OR manual_discount_amount = 0;

      UPDATE order_items
      SET loyalty_discount_amount = COALESCE(loyalty_discount_amount, 0)
      WHERE loyalty_discount_amount IS NULL;

      UPDATE order_items
      SET loyalty_units_applied = COALESCE(loyalty_units_applied, 0)
      WHERE loyalty_units_applied IS NULL;
    `);
  } catch (error) {
    console.error("[migration] Failed to create loyalty tables:", error);
    throw error;
  }
}

export function seedDefaultLoyaltyData() {
  try {
    const insertCategory = db.prepare(`
      INSERT OR IGNORE INTO loyalty_categories (id, key)
      VALUES (?, ?)
    `);

    const insertSettings = db.prepare(`
      INSERT OR IGNORE INTO loyalty_category_settings (
        loyalty_category_id, threshold, discount_amount, title, description, sort_order, active
      ) VALUES (?, ?, ?, ?, ?, ?, 1)
    `);

    for (const category of DEFAULT_CATEGORIES) {
      insertCategory.run(category.id, category.key);
      insertSettings.run(
        category.id,
        category.threshold,
        category.discountAmount,
        category.title,
        category.description,
        category.sortOrder,
      );
    }

    const existingMappings = db
      .prepare(
        `
        SELECT loyalty_category_id, category_id
        FROM loyalty_category_mappings
        WHERE category_id IS NOT NULL
      `,
      )
      .all();

    const mappedCategoryIds = new Set(
      existingMappings.map((row) => String(row.category_id || "")).filter(Boolean),
    );
    const existingPairs = new Set(
      existingMappings
        .map((row) => {
          const loyaltyCategoryId = String(row.loyalty_category_id || "");
          const categoryId = String(row.category_id || "");
          return loyaltyCategoryId && categoryId
            ? `${loyaltyCategoryId}::${categoryId}`
            : "";
        })
        .filter(Boolean),
    );

    const defaultMappings = collectDefaultCategoryMappings();

    const insertMapping = db.prepare(`
      INSERT INTO loyalty_category_mappings (id, loyalty_category_id, category_id, group_id)
      VALUES (?, ?, ?, NULL)
    `);

    for (const mapping of defaultMappings) {
      const pairKey = `${mapping.loyaltyCategoryId}::${mapping.categoryId}`;
      if (existingPairs.has(pairKey) || mappedCategoryIds.has(mapping.categoryId)) {
        continue;
      }

      insertMapping.run(
        `loyalty_map_seed_${mapping.loyaltyCategoryId}_${mapping.categoryId}`,
        mapping.loyaltyCategoryId,
        mapping.categoryId,
      );
      existingPairs.add(pairKey);
      mappedCategoryIds.add(mapping.categoryId);
    }
  } catch (error) {
    console.error("[migration] Failed to seed loyalty defaults:", error);
    throw error;
  }
}
