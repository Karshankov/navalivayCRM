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

// Final design palette (см. docs/wheel + Figma). bg_color может быть как
// сплошным hex, так и CSS gradient-строкой — фронт прокидывает его в
// `background:` для пилюль и карточек. Для border-цвета карточек фронт
// извлекает первый hex (см. WheelPrizeCard.vue::extractFirstHex), потому
// что CSS border-color не принимает gradient.
const DEFAULT_RARITIES = [
  {
    code: "nothing",
    label: "Ничего",
    bg_color: "#8D8D8D",
    text_color: "#FFFFFF",
    sort_order: 0,
    is_elite: 0,
    chance_percent: 0,
  },
  {
    code: "common",
    label: "Обычный",
    bg_color: "#0095FF",
    text_color: "#FFFFFF",
    sort_order: 10,
    is_elite: 0,
    chance_percent: 30,
  },
  {
    code: "rare",
    label: "Редкий",
    bg_color:
      "linear-gradient(90.94deg, #644CFF 0.8%, #3D25DA 313.06%)",
    text_color: "#FFFFFF",
    sort_order: 20,
    is_elite: 0,
    chance_percent: 12,
  },
  {
    code: "mythic",
    label: "Мифический",
    bg_color:
      "linear-gradient(90.94deg, #A603F2 0.8%, #7201A7 313.06%)",
    text_color: "#FFFFFF",
    sort_order: 30,
    is_elite: 0,
    chance_percent: 8,
  },
  {
    code: "legendary",
    label: "Легендарный",
    bg_color:
      "linear-gradient(90.94deg, #F502A4 0.8%, #8F0160 313.06%)",
    text_color: "#FFFFFF",
    sort_order: 40,
    is_elite: 0,
    chance_percent: 6,
  },
  {
    code: "epic",
    label: "Эпический",
    bg_color: "#F50302",
    text_color: "#FFFFFF",
    sort_order: 50,
    is_elite: 0,
    chance_percent: 4,
  },
  {
    code: "valuable",
    label: "Ценный",
    bg_color: "#FFAB00",
    text_color: "#FFFFFF",
    sort_order: 60,
    is_elite: 1,
    chance_percent: 0,
  },
];

const DEFAULT_SETTINGS = {
  spin_byn_retail: "40",
  spin_byn_wholesale: "200",
  pity_threshold: "3",
  default_promo_validity_days: "90",
  feed_size: "30",
  elite_rarities_json: JSON.stringify(["valuable"]),
  wheel_access_usernames_json: JSON.stringify([]),
};

export function migrateWheelPrizes() {
  try {
    if (!tableExists("wheel_rarities")) {
      db.exec(`
        CREATE TABLE wheel_rarities (
          code TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          bg_color TEXT NOT NULL,
          text_color TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_elite INTEGER NOT NULL DEFAULT 0,
          chance_percent REAL NOT NULL DEFAULT 0,
          valuable_pool_size INTEGER NOT NULL DEFAULT 5,
          valuable_threshold_byn REAL NOT NULL DEFAULT 300
        );
      `);
    }
    const rarityColumns = db
      .prepare("PRAGMA table_info(wheel_rarities)")
      .all()
      .map((column) => column.name);
    if (!rarityColumns.includes("chance_percent")) {
      db.exec(
        "ALTER TABLE wheel_rarities ADD COLUMN chance_percent REAL NOT NULL DEFAULT 0",
      );
    }
    if (!rarityColumns.includes("valuable_pool_size")) {
      db.exec(
        "ALTER TABLE wheel_rarities ADD COLUMN valuable_pool_size INTEGER NOT NULL DEFAULT 5",
      );
    }
    if (!rarityColumns.includes("valuable_threshold_byn")) {
      db.exec(
        "ALTER TABLE wheel_rarities ADD COLUMN valuable_threshold_byn REAL NOT NULL DEFAULT 300",
      );
    }

    if (!tableExists("wheel_prizes")) {
      db.exec(`
        CREATE TABLE wheel_prizes (
          id TEXT PRIMARY KEY,
          rarity_code TEXT NOT NULL REFERENCES wheel_rarities(code),
          title TEXT NOT NULL,
          description TEXT,
          image_url TEXT,
          weight REAL NOT NULL DEFAULT 1,
          max_total INTEGER NOT NULL DEFAULT 0,
          issued_count INTEGER NOT NULL DEFAULT 0,
          is_for_retail INTEGER NOT NULL DEFAULT 1,
          is_for_wholesale INTEGER NOT NULL DEFAULT 0,
          promo_template_id TEXT REFERENCES promo_codes(id) ON DELETE SET NULL,
          promo_validity_days INTEGER NOT NULL DEFAULT 90,
          epic_pool_size INTEGER NOT NULL DEFAULT 5,
          epic_pool_threshold_byn REAL NOT NULL DEFAULT 300,
          is_active INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
        );
        CREATE INDEX idx_wheel_prizes_rarity ON wheel_prizes(rarity_code);
        CREATE INDEX idx_wheel_prizes_active ON wheel_prizes(is_active);
      `);
    }

    if (!tableExists("wheel_customer_balances")) {
      db.exec(`
        CREATE TABLE wheel_customer_balances (
          customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
          spins_available INTEGER NOT NULL DEFAULT 0,
          accumulated_retail_byn REAL NOT NULL DEFAULT 0,
          accumulated_wholesale_byn REAL NOT NULL DEFAULT 0,
          consecutive_nothing INTEGER NOT NULL DEFAULT 0,
          last_synced_order_id TEXT,
          last_updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
        );
      `);
    }

    if (!tableExists("wheel_spins")) {
      db.exec(`
        CREATE TABLE wheel_spins (
          id TEXT PRIMARY KEY,
          customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          prize_id TEXT NOT NULL REFERENCES wheel_prizes(id),
          rarity_code TEXT NOT NULL,
          is_wholesale INTEGER NOT NULL DEFAULT 0,
          generated_promo_code_id TEXT REFERENCES promo_codes(id) ON DELETE SET NULL,
          generated_promo_code TEXT,
          promo_valid_until TEXT,
          is_epic_release INTEGER NOT NULL DEFAULT 0,
          is_pity_release INTEGER NOT NULL DEFAULT 0,
          seed_for_animation INTEGER NOT NULL,
          spun_at TEXT NOT NULL DEFAULT (DATETIME('now')),
          prize_used_at TEXT
        );
        CREATE INDEX idx_wheel_spins_customer ON wheel_spins(customer_id, spun_at DESC);
        CREATE INDEX idx_wheel_spins_promo ON wheel_spins(generated_promo_code_id);
        CREATE INDEX idx_wheel_spins_feed ON wheel_spins(spun_at DESC, rarity_code);
      `);
    }

    // Audit trail for probability investigations. `wheel_spins` stores
    // the final outcome; this table stores the decision context agents
    // need later: configured chances, effective chances after availability
    // filters, random roll metadata, and whether the spin bypassed normal
    // probability through pity/valuable/fallback logic. Keep payloads as
    // JSON TEXT so we can evolve analysis fields without repeated schema
    // churn, and do not store promo codes or Telegram auth secrets here.
    if (!tableExists("wheel_spin_audit")) {
      db.exec(`
        CREATE TABLE wheel_spin_audit (
          id TEXT PRIMARY KEY,
          spin_id TEXT NOT NULL REFERENCES wheel_spins(id) ON DELETE CASCADE,
          customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          decision_type TEXT NOT NULL,
          selected_rarity_code TEXT,
          selected_prize_id TEXT,
          is_wholesale INTEGER NOT NULL DEFAULT 0,
          is_pity_release INTEGER NOT NULL DEFAULT 0,
          is_epic_release INTEGER NOT NULL DEFAULT 0,
          configured_chances_json TEXT NOT NULL,
          effective_chances_json TEXT NOT NULL,
          availability_json TEXT NOT NULL,
          rng_json TEXT NOT NULL,
          balance_before_json TEXT NOT NULL,
          outcome_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
        );
        CREATE INDEX idx_wheel_spin_audit_created_at ON wheel_spin_audit(created_at);
        CREATE INDEX idx_wheel_spin_audit_rarity ON wheel_spin_audit(selected_rarity_code, created_at);
        CREATE INDEX idx_wheel_spin_audit_customer ON wheel_spin_audit(customer_id, created_at);
      `);
    }

    if (!tableExists("wheel_epic_pools")) {
      db.exec(`
        CREATE TABLE wheel_epic_pools (
          id TEXT PRIMARY KEY,
          prize_id TEXT NOT NULL REFERENCES wheel_prizes(id) ON DELETE CASCADE,
          pool_size INTEGER NOT NULL,
          threshold_byn REAL NOT NULL,
          qualified_customers_json TEXT NOT NULL DEFAULT '[]',
          is_active INTEGER NOT NULL DEFAULT 1,
          released_to_customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
          opened_at TEXT NOT NULL DEFAULT (DATETIME('now')),
          closed_at TEXT
        );
        CREATE INDEX idx_wheel_epic_pools_prize ON wheel_epic_pools(prize_id, is_active);
      `);
    }

    if (!tableExists("wheel_rarity_pools")) {
      db.exec(`
        CREATE TABLE wheel_rarity_pools (
          id TEXT PRIMARY KEY,
          rarity_code TEXT NOT NULL REFERENCES wheel_rarities(code) ON DELETE CASCADE,
          pool_size INTEGER NOT NULL,
          threshold_byn REAL NOT NULL,
          qualified_customers_json TEXT NOT NULL DEFAULT '[]',
          is_active INTEGER NOT NULL DEFAULT 1,
          released_to_customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
          opened_at TEXT NOT NULL DEFAULT (DATETIME('now')),
          closed_at TEXT
        );
        CREATE INDEX idx_wheel_rarity_pools_rarity ON wheel_rarity_pools(rarity_code, is_active);
      `);
    }

    if (!tableExists("wheel_settings")) {
      db.exec(`
        CREATE TABLE wheel_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
        );
      `);
    }

    // B3: idempotency journal for spin accrual. PRIMARY KEY = order_id
    // ensures each delivered order can credit spins exactly once. Older
    // installations that still have stale `last_synced_order_id` data on
    // wheel_customer_balances are unaffected — both columns coexist and
    // accrual now relies solely on the ledger.
    if (!tableExists("wheel_balance_ledger")) {
      db.exec(`
        CREATE TABLE wheel_balance_ledger (
          order_id TEXT PRIMARY KEY,
          customer_id TEXT NOT NULL,
          amount_byn REAL NOT NULL,
          spins_added INTEGER NOT NULL,
          is_wholesale INTEGER NOT NULL DEFAULT 0,
          accrued_at TEXT NOT NULL DEFAULT (DATETIME('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_wheel_balance_ledger_customer
          ON wheel_balance_ledger(customer_id);
      `);
    }

    // S3: mark wheel template promo codes so validatePromoCode can reject
    // direct customer application of the template. Existing rows default
    // to 0; CRM updates the flag explicitly via prize creation.
    const promoColumns = db
      .prepare("PRAGMA table_info(promo_codes)")
      .all()
      .map((column) => column.name);
    if (!promoColumns.includes("is_wheel_template")) {
      db.exec(
        "ALTER TABLE promo_codes ADD COLUMN is_wheel_template INTEGER NOT NULL DEFAULT 0",
      );
    }
    // S2-N1: each child promo generated by the wheel is owned by exactly
    // one customer. Without this binding the code behaves like a bearer
    // token — anyone who sees it can apply it. The validator is updated
    // to enforce ownership when this column is set.
    if (!promoColumns.includes("wheel_owner_customer_id")) {
      db.exec(
        "ALTER TABLE promo_codes ADD COLUMN wheel_owner_customer_id TEXT",
      );
    }

    // C1-CR backfill: every promo_codes row that is currently referenced
    // as a wheel prize template must carry is_wheel_template=1, otherwise
    // the validatePromoCode guard in promo-code-service.js silently
    // accepts the template code at checkout. Idempotent: the WHERE clause
    // is safe to re-run on every boot.
    db.exec(`
      UPDATE promo_codes
      SET is_wheel_template = 1
      WHERE is_wheel_template = 0
        AND id IN (
          SELECT promo_template_id
          FROM wheel_prizes
          WHERE promo_template_id IS NOT NULL
        )
    `);
    // Q6: customer-facing consent for live-feed PII display.
    //
    // Without explicit consent we cannot show first_name + Telegram
    // photo of the winner in the public live feed. The customer
    // confirms (or declines) once — via WheelConsentModal on first
    // visit, or the toggle on the retail Profile page.
    //
    // wheel_feed_consent values:
    //   0 = declined or not yet asked → exclude from feed
    //   1 = accepted → include in feed
    //
    // wheel_feed_consent_at is set the first time the customer answers
    // (either way) so the modal does not pop up again.
    const customerColumns = db
      .prepare("PRAGMA table_info(customers)")
      .all()
      .map((column) => column.name);
    if (!customerColumns.includes("wheel_feed_consent")) {
      db.exec(
        "ALTER TABLE customers ADD COLUMN wheel_feed_consent INTEGER NOT NULL DEFAULT 0",
      );
    }
    if (!customerColumns.includes("wheel_feed_consent_at")) {
      db.exec("ALTER TABLE customers ADD COLUMN wheel_feed_consent_at TEXT");
    }

    // P1: idempotency key for /api/wheel/spin. Stored on the spin row
    // so a retried POST with the same key returns the original spin
    // payload instead of consuming a second spin. Compound UNIQUE on
    // (customer_id, idempotency_key) keeps the namespace per-customer.
    const spinColumns = db
      .prepare("PRAGMA table_info(wheel_spins)")
      .all()
      .map((column) => column.name);
    if (!spinColumns.includes("idempotency_key")) {
      db.exec("ALTER TABLE wheel_spins ADD COLUMN idempotency_key TEXT");
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_wheel_spins_idempotency
      ON wheel_spins(customer_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL
    `);
  } catch (error) {
    console.error("[migration] Failed to create wheel tables:", error);
    throw error;
  }
}

export function seedDefaultWheelData() {
  try {
    const insertRarity = db.prepare(`
      INSERT OR IGNORE INTO wheel_rarities (
        code, label, bg_color, text_color, sort_order, is_elite,
        chance_percent, valuable_pool_size, valuable_threshold_byn
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const rarity of DEFAULT_RARITIES) {
      insertRarity.run(
        rarity.code,
        rarity.label,
        rarity.bg_color,
        rarity.text_color,
        rarity.sort_order,
        rarity.is_elite,
        rarity.chance_percent,
        5,
        300,
      );
    }

    // Backfill chance defaults for older installs that only had prize-level weights.
    for (const rarity of DEFAULT_RARITIES) {
      const row = db
        .prepare(
          `SELECT code, chance_percent
           FROM wheel_rarities
           WHERE code = ?`,
        )
        .get(rarity.code);
      if (!row) continue;
      const currentChance = Number(row.chance_percent || 0);
      if (currentChance > 0 || rarity.code === "nothing" || rarity.code === "valuable") continue;
      const aggregated = db
        .prepare(
          `SELECT COALESCE(SUM(weight), 0) AS total
           FROM wheel_prizes
           WHERE rarity_code = ?`,
        )
        .get(rarity.code);
      const nextChance = Number(aggregated?.total || 0) > 0
        ? Number(aggregated.total)
        : Number(rarity.chance_percent || 0);
      db.prepare(
        `UPDATE wheel_rarities
         SET chance_percent = ?,
             valuable_pool_size = COALESCE(NULLIF(valuable_pool_size, 0), 5),
             valuable_threshold_byn = COALESCE(NULLIF(valuable_threshold_byn, 0), 300)
         WHERE code = ?`,
      ).run(nextChance, rarity.code);
    }

    const insertSetting = db.prepare(`
      INSERT OR IGNORE INTO wheel_settings (key, value, updated_at)
      VALUES (?, ?, DATETIME('now'))
    `);

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      insertSetting.run(key, value);
    }

    const startCollectingExists = db
      .prepare("SELECT value FROM wheel_settings WHERE key = 'start_collecting_at'")
      .get();
    if (!startCollectingExists) {
      // Initial seed: write in SQLite "YYYY-MM-DD HH:MM:SS" so lexicographic
      // comparison against orders.completed_at / created_at (also written
      // via DATETIME('now')) works as expected. Previously this used
      // new Date().toISOString() which produced an ISO string — making any
      // real order created via DATETIME('now') compare as "less than" the
      // ISO timestamp and silently skip accrual.
      db.prepare(
        `INSERT INTO wheel_settings (key, value, updated_at)
         VALUES ('start_collecting_at', DATETIME('now'), DATETIME('now'))`,
      ).run();
    } else {
      // Backfill: if the existing value is in ISO format ("2026-05-17T..."),
      // rewrite it as the SQLite-friendly form. We can do it inline because
      // both representations are unambiguous and we never lose precision
      // (orders never carry sub-second resolution either).
      const raw = String(startCollectingExists.value || "").trim();
      if (raw && /T/.test(raw)) {
        const normalized = raw
          .replace("T", " ")
          .replace(/\.\d+Z?$/, "")
          .replace(/Z$/, "");
        db.prepare(
          `UPDATE wheel_settings
           SET value = ?, updated_at = DATETIME('now')
           WHERE key = 'start_collecting_at'`,
        ).run(normalized);
      }
    }
  } catch (error) {
    console.error("[migration] Failed to seed wheel defaults:", error);
    throw error;
  }
}
