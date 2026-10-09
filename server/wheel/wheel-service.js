import { db } from "../db.js";
import { randomUUID } from "node:crypto";
import { getUtcDateForTimeZoneLocalTime, toSqliteUtcString } from "../utils/business-time.js";
import { normalizeTelegramUsername } from "../loyalty.js";

const SPIN_ID_PREFIX = "ws";
const PROMO_ID_PREFIX = "wpp";
const POOL_ID_PREFIX = "wep";
const SPIN_AUDIT_ID_PREFIX = "wsa";
const PROMO_CODE_PREFIX = "WHEEL";
const DEFAULT_SETTINGS = {
  spin_byn_retail: 40,
  spin_byn_wholesale: 200,
  pity_threshold: 3,
  default_promo_validity_days: 90,
  feed_size: 30,
  start_collecting_at: null,
  elite_rarities_json: ["valuable"],
  wheel_access_usernames_json: [],
};

function generateId(prefix) {
  // crypto.randomUUID is available in Node 14.17+/16+/18+. Stable, collision-safe.
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/**
 * P3: structured event logging for the wheel module.
 *
 * Format follows the userbot logging convention (see
 * docs/userbot-logging.md): one line of JSON per event with `ev` and
 * `ts` always present, plus event-specific fields. Journald keeps
 * full lines, so a recent `./ops/prod.sh logs api` snapshot can be
 * filtered by the `wheel_` prefix.
 *
 * Why structured: free-form `console.warn` strings drift across
 * commits and are hard to aggregate. Structured events let us answer
 * questions like "how many epic releases this week" with `jq` instead
 * of regex.
 */
function logWheelEvent(ev, data = {}) {
  try {
    const line = JSON.stringify({
      ev: `wheel_${ev}`,
      ts: new Date().toISOString(),
      ...data,
    });
    // eslint-disable-next-line no-console
    console.log(line);
  } catch (error) {
    // JSON.stringify can throw on circular refs from accidental object
    // references in `data`. Fall back to a tag-only line so we never
    // suppress the event entirely.
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ev: `wheel_${ev}`, ts: new Date().toISOString(), log_error: String(error?.message || error) }));
  }
}

function generatePromoCode() {
  const random = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `${PROMO_CODE_PREFIX}-${random}`;
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJson(value, fallback) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn("[wheel] parseJson failed", error?.message || error);
    return fallback;
  }
}

function jsonForAudit(value, fallback = {}) {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
}

function normalizeWheelAccessUsernamesList(value) {
  const current = Array.isArray(value) ? value : [];
  return [...new Set(
    current
      .map((entry) => normalizeTelegramUsername(entry))
      .filter(Boolean)
      .map((entry) => entry.toLowerCase()),
  )];
}

function isMeaningfulSettingValue(value) {
  if (value === null || value === undefined) return false;
  const str = String(value).trim();
  if (!str) return false;
  if (str.toLowerCase() === "null") return false;
  if (str.toLowerCase() === "undefined") return false;
  return true;
}

function toSqliteDateTime(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str || str.toLowerCase() === "null") return null;

  // S2-N5: when the input looks like a "naked" datetime-local string from
  // the CRM (`YYYY-MM-DDTHH:MM` with no timezone suffix), interpret it
  // as Minsk-local time and convert to UTC. This matches how every
  // other date-aware field in the project is handled (loyalty rules,
  // promo dates) and avoids the previous behaviour where the backend
  // accepted whatever the browser produced via .toISOString() — which
  // depended on the staff member's local OS timezone.
  const naked = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (naked) {
    const [, year, month, day, hour, minute, second] = naked;
    const utc = getUtcDateForTimeZoneLocalTime(
      Number(year),
      Number(month),
      Number(day),
      Number(hour),
      Number(minute),
      Number(second || 0),
    );
    return toSqliteUtcString(utc);
  }

  if (str.includes("T")) {
    // Strings carrying an explicit timezone (e.g. ISO with `Z` suffix or
    // `+03:00` offset) are already UTC-equivalent; just normalize to
    // SQLite shape.
    return str.replace("T", " ").replace(/\.\d+Z?$/, "").replace(/Z$/, "");
  }
  return str;
}

/**
 * Read all wheel settings as a typed object. Missing rows fall back to
 * DEFAULT_SETTINGS, so the rest of the codebase never has to special-case
 * a partially seeded wheel_settings table.
 */
export function getWheelSettings() {
  const rows = db.prepare("SELECT key, value FROM wheel_settings").all();
  const map = new Map(rows.map((row) => [row.key, row.value]));

  return {
    spin_byn_retail: safeNumber(
      map.get("spin_byn_retail"),
      DEFAULT_SETTINGS.spin_byn_retail,
    ),
    spin_byn_wholesale: safeNumber(
      map.get("spin_byn_wholesale"),
      DEFAULT_SETTINGS.spin_byn_wholesale,
    ),
    pity_threshold: Math.max(
      1,
      Math.floor(
        safeNumber(map.get("pity_threshold"), DEFAULT_SETTINGS.pity_threshold),
      ),
    ),
    default_promo_validity_days: Math.max(
      1,
      Math.floor(
        safeNumber(
          map.get("default_promo_validity_days"),
          DEFAULT_SETTINGS.default_promo_validity_days,
        ),
      ),
    ),
    feed_size: Math.max(
      1,
      Math.floor(safeNumber(map.get("feed_size"), DEFAULT_SETTINGS.feed_size)),
    ),
    start_collecting_at: isMeaningfulSettingValue(map.get("start_collecting_at"))
      ? toSqliteDateTime(map.get("start_collecting_at"))
      : DEFAULT_SETTINGS.start_collecting_at,
    elite_rarities: parseJson(
      map.get("elite_rarities_json"),
      DEFAULT_SETTINGS.elite_rarities_json,
    ),
    wheel_access_usernames: normalizeWheelAccessUsernamesList(
      parseJson(
        map.get("wheel_access_usernames_json"),
        DEFAULT_SETTINGS.wheel_access_usernames_json,
      ),
    ),
  };
}

export function updateWheelSettings(partial) {
  const allowed = [
    ["spin_byn_retail", (v) => String(safeNumber(v, DEFAULT_SETTINGS.spin_byn_retail))],
    [
      "spin_byn_wholesale",
      (v) => String(safeNumber(v, DEFAULT_SETTINGS.spin_byn_wholesale)),
    ],
    [
      "pity_threshold",
      (v) =>
        String(
          Math.max(1, Math.floor(safeNumber(v, DEFAULT_SETTINGS.pity_threshold))),
        ),
    ],
    [
      "default_promo_validity_days",
      (v) =>
        String(
          Math.max(
            1,
            Math.floor(
              safeNumber(v, DEFAULT_SETTINGS.default_promo_validity_days),
            ),
          ),
        ),
    ],
    ["feed_size", (v) => String(Math.max(1, Math.floor(safeNumber(v, DEFAULT_SETTINGS.feed_size))))],
    [
      "start_collecting_at",
      (v) => {
        // Always normalize to SQLite "YYYY-MM-DD HH:MM:SS" format. Frontend
        // historically sent ISO strings (with `T` and trailing Z), and SQLite
        // stamps written via DATETIME('now') use the space-separated form.
        // Lexicographic comparison only works when both sides match.
        const normalized = toSqliteDateTime(v);
        return normalized || "";
      },
    ],
    [
      "elite_rarities_json",
      (v) =>
        JSON.stringify(
          Array.isArray(v) ? v.map((entry) => String(entry || "")).filter(Boolean) : [],
        ),
    ],
    [
      "wheel_access_usernames_json",
      (v) =>
        JSON.stringify(
          normalizeWheelAccessUsernamesList(v),
        ),
    ],
  ];

  const upsert = db.prepare(`
    INSERT INTO wheel_settings (key, value, updated_at)
    VALUES (?, ?, DATETIME('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = DATETIME('now')
  `);

  const tx = db.transaction(() => {
    for (const [key, transform] of allowed) {
      // Accept either canonical key ("elite_rarities_json") or the public
      // alias without the _json suffix ("elite_rarities").
      const aliasKey = key.replace("_json", "");
      const present =
        Object.prototype.hasOwnProperty.call(partial || {}, aliasKey) ||
        Object.prototype.hasOwnProperty.call(partial || {}, key);
      if (!present) continue;

      const raw = Object.prototype.hasOwnProperty.call(partial || {}, aliasKey)
        ? partial[aliasKey]
        : partial[key];

      // For start_collecting_at specifically: don't overwrite an existing
      // value with the literal string "null"/empty — that used to make the
      // accrual logic compare against the string "null" and silently drop
      // every order. If admin really wants to clear the marker, they should
      // explicitly send the empty string and we store it as empty.
      if (key === "start_collecting_at" && !isMeaningfulSettingValue(raw)) {
        upsert.run(key, "");
        continue;
      }

      upsert.run(key, transform(raw));
    }
  });

  tx();
  return getWheelSettings();
}

export function validateRarityRulePayload(rarityCode, payload = {}) {
  const errors = [];
  const code = String(rarityCode || "").trim();
  if (!code) errors.push("rarity_code_required");

  const rarity = code
    ? db.prepare("SELECT code FROM wheel_rarities WHERE code = ?").get(code)
    : null;
  if (code && !rarity) errors.push("rarity_unknown");

  if (Object.prototype.hasOwnProperty.call(payload, "chance_percent")) {
    const chance = Number(payload.chance_percent);
    if (!Number.isFinite(chance) || chance < 0 || chance > 100) {
      errors.push("chance_percent_invalid");
    }
    if (code === "valuable" && chance !== 0) {
      errors.push("valuable_chance_must_be_zero");
    }
    if (code === "nothing" && chance !== 0) {
      errors.push("nothing_chance_is_derived");
    }
    if (!["valuable", "nothing"].includes(code) && Number.isFinite(chance)) {
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(chance_percent), 0) AS total
           FROM wheel_rarities
           WHERE code NOT IN ('valuable', 'nothing') AND code != ?`,
        )
        .get(code);
      if (safeNumber(row?.total, 0) + chance > 100) {
        errors.push("chance_sum_exceeds_100");
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "valuable_pool_size")) {
    const size = Number(payload.valuable_pool_size);
    if (!Number.isFinite(size) || size < 1 || !Number.isInteger(size)) {
      errors.push("valuable_pool_size_invalid");
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "valuable_threshold_byn")) {
    const threshold = Number(payload.valuable_threshold_byn);
    if (!Number.isFinite(threshold) || threshold < 1) {
      errors.push("valuable_threshold_byn_invalid");
    }
  }

  return { errors };
}

export function updateRarityRule(rarityCode, payload = {}) {
  const code = String(rarityCode || "").trim();
  const existing = db.prepare("SELECT * FROM wheel_rarities WHERE code = ?").get(code);
  if (!existing) return null;

  const nextChance = code === "valuable" || code === "nothing"
    ? 0
    : Math.max(0, Math.min(100, safeNumber(payload.chance_percent, existing.chance_percent)));
  const nextPoolSize = code === "valuable"
    ? Math.max(1, Math.floor(safeNumber(payload.valuable_pool_size, existing.valuable_pool_size || 5)))
    : Number(existing.valuable_pool_size || 5);
  const nextThreshold = code === "valuable"
    ? Math.max(1, safeNumber(payload.valuable_threshold_byn, existing.valuable_threshold_byn || 300))
    : Number(existing.valuable_threshold_byn || 300);

  db.prepare(
    `UPDATE wheel_rarities
     SET chance_percent = ?,
         valuable_pool_size = ?,
         valuable_threshold_byn = ?
     WHERE code = ?`,
  ).run(nextChance, nextPoolSize, nextThreshold, code);

  return db
    .prepare(
      `SELECT code, label, bg_color AS bgColor, text_color AS textColor,
              sort_order AS sortOrder, is_elite AS isElite,
              chance_percent AS chancePercent,
              valuable_pool_size AS valuablePoolSize,
              valuable_threshold_byn AS valuableThresholdByn
       FROM wheel_rarities
       WHERE code = ?`,
    )
    .get(code);
}

export function getWheelAccessState(telegramUsername, settings = getWheelSettings()) {
  const allowlist = Array.isArray(settings.wheel_access_usernames)
    ? settings.wheel_access_usernames
        .map((entry) => normalizeTelegramUsername(entry))
        .filter(Boolean)
        .map((entry) => entry.toLowerCase())
    : [];
  const normalizedUsername = normalizeTelegramUsername(telegramUsername).toLowerCase();
  const isLimited = allowlist.length > 0;
  const isAllowed = !isLimited || (normalizedUsername && allowlist.includes(normalizedUsername));
  return {
    is_limited: isLimited,
    is_allowed: Boolean(isAllowed),
  };
}

export function listRarities() {
  return db
    .prepare(
      `SELECT code, label, bg_color AS bgColor, text_color AS textColor,
              sort_order AS sortOrder, is_elite AS isElite,
              chance_percent AS chancePercent,
              valuable_pool_size AS valuablePoolSize,
              valuable_threshold_byn AS valuableThresholdByn
       FROM wheel_rarities
       ORDER BY sort_order ASC`,
    )
    .all();
}

function loadActivePrizesForCustomer({ isWholesale }) {
  const flagColumn = isWholesale ? "is_for_wholesale" : "is_for_retail";

  return db
    .prepare(
      `SELECT p.*,
              pc.code AS promo_code,
              pc.description AS promo_description,
              pc.customer_description AS promo_customer_description,
              pc.manager_description AS promo_manager_description
       FROM wheel_prizes p
       LEFT JOIN promo_codes pc ON pc.id = p.promo_template_id
       WHERE p.is_active = 1
         AND p.${flagColumn} = 1
       ORDER BY p.sort_order ASC, p.created_at ASC`,
    )
    .all();
}

function loadAllActivePrizes() {
  return db
    .prepare(
      `SELECT p.*,
              pc.code AS promo_code,
              pc.description AS promo_description,
              pc.customer_description AS promo_customer_description,
              pc.manager_description AS promo_manager_description
       FROM wheel_prizes p
       LEFT JOIN promo_codes pc ON pc.id = p.promo_template_id
       WHERE p.is_active = 1
       ORDER BY p.sort_order ASC, p.created_at ASC`,
    )
    .all();
}

export function prizeDisplayTitle(prize) {
  if (!prize) return "";
  if (String(prize.rarity_code || "") === "nothing") {
    return String(prize.title || "").trim() || "Ничего";
  }
  const promoTitle = String(prize.promo_description || "").trim();
  const customerText = String(prize.promo_customer_description || "").trim();
  return (
    promoTitle ||
    customerText ||
    String(prize.title || "").trim() ||
    String(prize.promo_code || "").trim() ||
    "Приз"
  );
}

export function prizeDisplayDescription(prize) {
  if (!prize) return null;
  if (String(prize.rarity_code || "") === "nothing") {
    return String(prize.description || "").trim() || null;
  }
  const title = prizeDisplayTitle(prize).trim();
  const promoTitle = String(prize.promo_description || "").trim();
  const customerText = String(prize.promo_customer_description || "").trim();
  const storedDescription = String(prize.description || "").trim();

  if (promoTitle && customerText) {
    return customerText;
  }

  if (storedDescription && storedDescription.toLowerCase() !== title.toLowerCase()) {
    return storedDescription;
  }

  if (customerText && customerText.toLowerCase() !== title.toLowerCase()) {
    return customerText;
  }

  return null;
}

function prizeDisplayFieldsFromSpinJoin(row) {
  return {
    rarity_code: row.rarity_code ?? row.prize_rarity_code ?? null,
    title: row.title ?? row.prize_title_stored ?? row.prize_title ?? "",
    description: row.description ?? row.prize_description_stored ?? row.prize_description ?? null,
    promo_description: row.promo_description ?? null,
    promo_customer_description: row.promo_customer_description ?? null,
    promo_code: row.promo_template_code ?? null,
  };
}

export function spinPrizeDisplayTitle(row) {
  if (String(row?.rarity_code || "") === "nothing") {
    return "Без выигрыша";
  }
  return prizeDisplayTitle(prizeDisplayFieldsFromSpinJoin(row));
}

export function spinPrizeDisplayDescription(row) {
  if (String(row?.rarity_code || "") === "nothing") {
    return null;
  }
  return prizeDisplayDescription(prizeDisplayFieldsFromSpinJoin(row));
}

function resolvePrizeStorageText(payload = {}, existing = null) {
  const templateId = payload.promo_template_id ?? existing?.promo_template_id ?? null;
  if (!templateId) {
    return {
      title: String(payload.title ?? existing?.title ?? "").trim() || "Ничего",
      description: payload.description ?? existing?.description ?? null,
    };
  }
  const template = db
    .prepare(
      `SELECT code, description, customer_description
       FROM promo_codes
       WHERE id = ?`,
    )
    .get(templateId);
  const promoTitle = String(template?.description || "").trim();
  const customerText = String(template?.customer_description || "").trim();
  const title =
    promoTitle ||
    customerText ||
    String(payload.title ?? existing?.title ?? "").trim() ||
    String(template?.code || "").trim() ||
    "Приз";
  const description = promoTitle ? customerText || null : null;
  return { title, description };
}

function getPromoTemplateAvailability(templateId) {
  if (!templateId) return false;
  const template = db
    .prepare(
      `SELECT id, active, wheel_owner_customer_id
       FROM promo_codes
       WHERE id = ?`,
    )
    .get(templateId);
  if (!template) return false;
  if (Number(template.active || 0) !== 1) return false;
  if (template.wheel_owner_customer_id) return false;
  return true;
}

function getPrizeIssueLimit(prize) {
  if (!prize) return 0;
  if (String(prize.rarity_code || "") === "nothing") {
    return Number(prize.max_total || 0);
  }
  if (!prize.promo_template_id) return 0;
  const template = db
    .prepare("SELECT max_uses FROM promo_codes WHERE id = ?")
    .get(prize.promo_template_id);
  return Math.max(0, Math.floor(safeNumber(template?.max_uses, 0)));
}

function isPrizeExhausted(prize) {
  const limit = getPrizeIssueLimit(prize);
  return limit > 0 && Number(prize.issued_count || 0) >= limit;
}

function isPrizeAvailableForContext(prize, { isWholesale }) {
  if (!prize || !Number(prize.is_active || 0)) return false;
  if (isWholesale ? Number(prize.is_for_wholesale || 0) !== 1 : Number(prize.is_for_retail || 0) !== 1) {
    return false;
  }
  if (isPrizeExhausted(prize)) return false;
  if (String(prize.rarity_code || "") === "nothing") return true;
  return getPromoTemplateAvailability(prize.promo_template_id);
}

function groupPrizesByRarity(prizes, context) {
  const map = new Map();
  for (const prize of prizes) {
    if (context && !isPrizeAvailableForContext(prize, context)) continue;
    const key = String(prize.rarity_code || "");
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(prize);
  }
  return map;
}

function effectiveWeight(prize) {
  if (!prize || !Number(prize.is_active || 0)) return 0;
  const weight = Number(prize.weight || 0);
  if (weight <= 0) return 0;
  if (isPrizeExhausted(prize)) return 0;
  return weight;
}

function pickWeightedRandom(prizes, rng = Math.random) {
  const weights = prizes.map((prize) => effectiveWeight(prize));
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return null;

  const target = rng() * total;
  let acc = 0;
  for (let i = 0; i < prizes.length; i += 1) {
    acc += weights[i];
    if (target <= acc) {
      return prizes[i];
    }
  }
  return prizes[prizes.length - 1];
}

function pickUniformRandom(entries, rng = Math.random, audit = null) {
  if (!Array.isArray(entries) || !entries.length) return null;
  const roll = rng();
  const index = Math.min(entries.length - 1, Math.floor(roll * entries.length));
  if (audit) {
    audit.roll = roll;
    audit.index = index;
    audit.total_entries = entries.length;
  }
  return entries[index];
}

function pickWeightedEntry(entries, getWeight, rng = Math.random, audit = null) {
  const weights = entries.map((entry) => Math.max(0, Number(getWeight(entry) || 0)));
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return null;

  const roll = rng();
  const target = roll * total;
  let acc = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const from = acc;
    acc += weights[i];
    if (target <= acc) {
      if (audit) {
        audit.roll = roll;
        audit.target = target;
        audit.total_weight = total;
        audit.selected_index = i;
        audit.buckets = entries.map((entry, index) => {
          const bucketFrom = weights.slice(0, index).reduce((sum, w) => sum + w, 0);
          return {
            index,
            kind: entry.kind || null,
            rarity_code: entry.rarity?.code || entry.rarity_code || null,
            weight: weights[index],
            from: bucketFrom,
            to: bucketFrom + weights[index],
          };
        });
        audit.selected_bucket = {
          index: i,
          kind: entries[i].kind || null,
          rarity_code: entries[i].rarity?.code || entries[i].rarity_code || null,
          weight: weights[i],
          from,
          to: acc,
        };
      }
      return entries[i];
    }
  }
  if (audit) {
    audit.roll = roll;
    audit.target = target;
    audit.total_weight = total;
    audit.selected_index = entries.length - 1;
  }
  return entries[entries.length - 1];
}

function getCustomerProfitSince(customerId, sinceIso) {
  if (!customerId) return 0;
  const sinceSqlite = toSqliteDateTime(sinceIso) || "1970-01-01 00:00:00";
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(profit), 0) AS total
       FROM orders
       WHERE customer_id = ?
         AND status = 'delivered'
         AND COALESCE(completed_at, created_at) >= ?`,
    )
    .get(customerId, sinceSqlite);
  return safeNumber(row?.total, 0);
}

function ensureCustomerBalance(customerId) {
  const existing = db
    .prepare("SELECT * FROM wheel_customer_balances WHERE customer_id = ?")
    .get(customerId);
  if (existing) return existing;

  db.prepare(
    `INSERT INTO wheel_customer_balances (
      customer_id, spins_available, accumulated_retail_byn,
      accumulated_wholesale_byn, consecutive_nothing, last_updated_at
    ) VALUES (?, 0, 0, 0, 0, DATETIME('now'))`,
  ).run(customerId);

  return db
    .prepare("SELECT * FROM wheel_customer_balances WHERE customer_id = ?")
    .get(customerId);
}

/**
 * Add ledger BYN to a customer balance and convert it into spins
 * according to wheel_settings thresholds.
 *
 * Idempotency: enforced by INSERT OR IGNORE into wheel_balance_ledger
 * (PRIMARY KEY = order_id). If the row already exists, the function
 * returns { accrued: false, reason: "already_synced" } without touching
 * the balance. This survives recompute-customer reruns, double PATCH,
 * race conditions, etc.
 */
export function accrueWheelSpinsForOrder(orderId) {
  if (!orderId) return { accrued: false, reason: "missing_order_id" };

  const order = db
    .prepare(
      `SELECT id, customer_id, status, final_amount, total_amount,
              is_wholesale, completed_at, created_at
       FROM orders WHERE id = ?`,
    )
    .get(orderId);

  if (!order) return { accrued: false, reason: "order_not_found" };
  if (!order.customer_id) return { accrued: false, reason: "no_customer" };
  // Architecturally, only `delivered` triggers wheel accrual (see
  // docs/wheel-architecture.md). `completed` is a transitional CRM state
  // before the order is physically issued; it must not feed the wheel.
  if (order.status !== "delivered") {
    return { accrued: false, reason: "status_not_final" };
  }

  const settings = getWheelSettings();
  const startCollectingAt = settings.start_collecting_at;
  // Both sides are normalized to SQLite "YYYY-MM-DD HH:MM:SS" format so a
  // lexicographic comparison is safe. orders.completed_at/created_at are
  // already in that format because they are written via DATETIME('now') or
  // CURRENT_TIMESTAMP. start_collecting_at comes from getWheelSettings()
  // which forces the same shape.
  const orderDate = order.completed_at || order.created_at;
  if (
    startCollectingAt &&
    orderDate &&
    String(orderDate) < String(startCollectingAt)
  ) {
    return { accrued: false, reason: "before_release" };
  }

  const isWholesale = Number(order.is_wholesale || 0) === 1;
  // Скидочные позиции копят прокрутки наравне с обычными, и это решение
  // владельца, а не недосмотр. Бонусная карта устроена наоборот: там позиция со
  // скидкой не копит и не тратит штампы. Не выравнивайте одно по другому.
  const amount = Math.max(
    0,
    safeNumber(order.final_amount, safeNumber(order.total_amount, 0)),
  );
  if (amount <= 0) return { accrued: false, reason: "zero_amount" };

  const threshold = isWholesale
    ? settings.spin_byn_wholesale
    : settings.spin_byn_retail;
  if (threshold <= 0) return { accrued: false, reason: "threshold_zero" };

  ensureCustomerBalance(order.customer_id);

  const accumulatedColumn = isWholesale
    ? "accumulated_wholesale_byn"
    : "accumulated_retail_byn";

  const tx = db.transaction(() => {
    // Idempotency journal: PRIMARY KEY enforces "one accrual per order_id".
    // If this row already exists, INSERT OR IGNORE leaves changes === 0 and
    // we exit cleanly. This replaces the old `last_synced_order_id` check
    // which was unsafe when orders were processed out of order.
    const ledgerInsert = db
      .prepare(
        `INSERT OR IGNORE INTO wheel_balance_ledger
         (order_id, customer_id, amount_byn, spins_added, is_wholesale, accrued_at)
         VALUES (?, ?, ?, 0, ?, DATETIME('now'))`,
      )
      .run(orderId, order.customer_id, amount, isWholesale ? 1 : 0);

    if (ledgerInsert.changes === 0) {
      return { spinsAdded: 0, remaining: null, alreadySynced: true };
    }

    const fresh = db
      .prepare("SELECT * FROM wheel_customer_balances WHERE customer_id = ?")
      .get(order.customer_id);
    const accumulated =
      safeNumber(fresh[accumulatedColumn], 0) + amount;
    const spinsToAdd = Math.floor(accumulated / threshold);
    const remaining = accumulated - spinsToAdd * threshold;

    db.prepare(
      `UPDATE wheel_customer_balances
       SET spins_available = spins_available + ?,
           ${accumulatedColumn} = ?,
           last_updated_at = DATETIME('now')
       WHERE customer_id = ?`,
    ).run(spinsToAdd, remaining, order.customer_id);
    // S2-N3: last_synced_order_id is no longer used for idempotency
    // (B3 moved that to wheel_balance_ledger.order_id PRIMARY KEY).
    // Stop writing to the column so it doesn't mislead future readers
    // into thinking it gates accrual. The column itself is left in the
    // schema to avoid a destructive migration.

    db.prepare(
      `UPDATE wheel_balance_ledger
       SET spins_added = ?
       WHERE order_id = ?`,
    ).run(spinsToAdd, orderId);

    return { spinsAdded: spinsToAdd, remaining, alreadySynced: false };
  });

  const result = tx();
  if (result.alreadySynced) {
    return { accrued: false, reason: "already_synced", spins_added: 0 };
  }
  registerCustomerProfitForEpicPools(order.customer_id);
  return {
    accrued: true,
    spins_added: result.spinsAdded,
    accumulated_remaining: result.remaining,
  };
}

function getRarityRecord(rarityCode) {
  return db.prepare("SELECT * FROM wheel_rarities WHERE code = ?").get(rarityCode);
}

function getValuableRarityRule() {
  return getRarityRecord("valuable");
}

function getActiveValuablePool() {
  return db
    .prepare(
      `SELECT *
       FROM wheel_rarity_pools
       WHERE rarity_code = 'valuable' AND is_active = 1
       ORDER BY opened_at DESC
       LIMIT 1`,
    )
    .get();
}

function ensureActiveValuablePool() {
  const valuable = getValuableRarityRule();
  if (!valuable) return null;
  const existing = getActiveValuablePool();
  if (existing) return existing;

  const id = generateId(POOL_ID_PREFIX);
  const poolSize = Math.max(1, Math.floor(safeNumber(valuable.valuable_pool_size, 5)));
  const thresholdByn = Math.max(1, safeNumber(valuable.valuable_threshold_byn, 300));
  db.prepare(
    `INSERT INTO wheel_rarity_pools (
      id, rarity_code, pool_size, threshold_byn, qualified_customers_json, is_active
    ) VALUES (?, 'valuable', ?, ?, '[]', 1)`,
  ).run(id, poolSize, thresholdByn);
  logWheelEvent("pool_created", {
    pool_id: id,
    rarity_code: "valuable",
    pool_size: poolSize,
    threshold_byn: thresholdByn,
    qualified_count: 0,
  });
  return db.prepare("SELECT * FROM wheel_rarity_pools WHERE id = ?").get(id);
}

function getValuableReferenceSince(settings) {
  const lastClosed = db
    .prepare(
      `SELECT closed_at FROM wheel_rarity_pools
       WHERE rarity_code = 'valuable' AND is_active = 0
       ORDER BY closed_at DESC
       LIMIT 1`,
    )
    .get();
  if (lastClosed?.closed_at) return lastClosed.closed_at;
  return settings.start_collecting_at || "1970-01-01 00:00:00";
}

export function registerCustomerProfitForEpicPools(customerId) {
  if (!customerId) return { updated: 0 };
  const settings = getWheelSettings();
  const valuable = getValuableRarityRule();
  if (!valuable) return { updated: 0 };

  const pool = ensureActiveValuablePool();
  if (!pool) return { updated: 0 };

  const since = getValuableReferenceSince(settings);
  const profit = getCustomerProfitSince(customerId, since);
  if (profit < safeNumber(pool.threshold_byn, 0)) return { updated: 0 };

  const list = parseJson(pool.qualified_customers_json, []);
  if (Array.isArray(list) && list.includes(customerId)) return { updated: 0 };
  const nextList = Array.isArray(list) ? [...list, customerId] : [customerId];
  db.prepare(
    `UPDATE wheel_rarity_pools SET qualified_customers_json = ? WHERE id = ?`,
  ).run(JSON.stringify(nextList), pool.id);
  return { updated: 1 };
}

function findValuablePrizeReadyForCustomer(customerId, isWholesale, rng = Math.random, audit = null) {
  const pool = getActiveValuablePool();
  if (!pool) return null;
  const list = parseJson(pool.qualified_customers_json, []);
  if (!Array.isArray(list) || !list.includes(customerId)) return null;
  if (list.length < safeNumber(pool.pool_size, 0)) return null;

  const valuablePrizes = loadAllActivePrizes().filter((prize) => {
    if (String(prize.rarity_code || "") !== "valuable") return false;
    return isPrizeAvailableForContext(prize, { isWholesale });
  });
  if (!valuablePrizes.length) return null;

  if (audit) {
    audit.rng.valuable_prize_roll = {};
    audit.effective_chances = [{
      kind: "valuable",
      rarity_code: "valuable",
      chance_percent: null,
      reason: "qualified_pool_ready",
      prize_ids: valuablePrizes.map((prize) => prize.id),
    }];
    audit.availability = [{
      rarity_code: "valuable",
      is_available: true,
      available_prize_count: valuablePrizes.length,
      available_prize_ids: valuablePrizes.map((prize) => prize.id),
      pool_id: pool.id,
      qualified_count: Array.isArray(list) ? list.length : 0,
      pool_size: Number(pool.pool_size || 0),
    }];
  }

  return {
    prize: pickUniformRandom(valuablePrizes, rng, audit?.rng?.valuable_prize_roll || null) || valuablePrizes[0],
    pool,
  };
}

function getNormalRarityCandidates({ isWholesale }) {
  const rarities = listRarities();
  const prizesByRarity = groupPrizesByRarity(loadAllActivePrizes(), { isWholesale });
  return rarities
    .filter((rarity) => !["valuable", "nothing"].includes(String(rarity.code || "")))
    .map((rarity) => {
      const prizes = prizesByRarity.get(rarity.code) || [];
      const chancePercent = Math.max(0, safeNumber(rarity.chancePercent, 0));
      return {
        rarity,
        prizes,
        chancePercent,
        isAvailable: prizes.length > 0 && chancePercent > 0,
      };
    });
}

function pickPrizeWithinRarity(prizes, rng = Math.random, audit = null) {
  if (!Array.isArray(prizes) || !prizes.length) return null;
  if (audit) {
    audit.candidate_prize_ids = prizes.map((prize) => prize.id);
  }
  return pickUniformRandom(prizes, rng, audit) || prizes[0];
}

function getTechnicalNothingPrize({ isWholesale = false } = {}) {
  const existing = loadAllActivePrizes().find((prize) => {
    if (String(prize.rarity_code || "") !== "nothing") return false;
    return isPrizeAvailableForContext(prize, { isWholesale });
  });
  if (existing) return existing;

  const id = generateId("wp");
  db.prepare(
    `INSERT INTO wheel_prizes (
      id, rarity_code, title, description, image_url, weight, max_total,
      issued_count, is_for_retail, is_for_wholesale, promo_template_id,
      promo_validity_days, epic_pool_size, epic_pool_threshold_byn,
      is_active, sort_order, created_at
    ) VALUES (?, 'nothing', 'Без выигрыша', NULL, NULL, 0, 0, 0, 1, 1, NULL, 90, 5, 300, 1, -1000, DATETIME('now'))`,
  ).run(id);
  return db.prepare("SELECT * FROM wheel_prizes WHERE id = ?").get(id);
}

/**
 * Builds and rolls the normal rarity map. This is intentionally documented
 * near the code because future agents debugging "8% happened twice" need to
 * see that configured chances are first filtered by prize availability, then
 * `nothing` is derived as the remaining chance. The optional audit object is
 * persisted per spin and mirrors the exact bucket ranges used for selection.
 */
function pickRarityDrivenPrize({ isWholesale = false, rng = Math.random, audit = null }) {
  const candidates = getNormalRarityCandidates({ isWholesale }).filter((entry) => entry.isAvailable);
  const totalChance = candidates.reduce((sum, entry) => sum + entry.chancePercent, 0);
  const clampedChance = Math.min(100, totalChance);
  const nothingChance = Math.max(0, 100 - clampedChance);
  const allCandidates = getNormalRarityCandidates({ isWholesale });

  const weightedEntries = [
    ...candidates.map((entry) => ({
      kind: "rarity",
      chancePercent: entry.chancePercent,
      rarity: entry.rarity,
      prizes: entry.prizes,
    })),
    {
      kind: "nothing",
      chancePercent: nothingChance,
      prizes: [],
    },
  ].filter((entry) => entry.chancePercent > 0);

  if (audit) {
    audit.configured_chances = listRarities().map((rarity) => ({
      rarity_code: rarity.code,
      label: rarity.label,
      chance_percent: Number(rarity.chancePercent || 0),
    }));
    audit.availability = allCandidates.map((entry) => ({
      rarity_code: entry.rarity.code,
      configured_chance_percent: entry.chancePercent,
      available_prize_ids: entry.prizes.map((prize) => prize.id),
      available_prize_count: entry.prizes.length,
      is_available: entry.isAvailable,
    }));
    audit.effective_chances = weightedEntries.map((entry) => ({
      kind: entry.kind,
      rarity_code: entry.rarity?.code || "nothing",
      chance_percent: entry.chancePercent,
      prize_ids: entry.prizes.map((prize) => prize.id),
    }));
    audit.nothing_chance = nothingChance;
    audit.active_chance_total = clampedChance;
    audit.rng.rarity_roll = {};
  }

  const selected = pickWeightedEntry(
    weightedEntries,
    (entry) => entry.chancePercent,
    rng,
    audit?.rng?.rarity_roll || null,
  );
  if (!selected) {
    return { prize: null, nothingChance, activeChanceTotal: clampedChance };
  }
  if (selected.kind === "nothing") {
    if (audit) audit.rng.prize_roll = {};
    return {
      prize: null,
      nothingChance,
      activeChanceTotal: clampedChance,
    };
  }

  if (audit) audit.rng.prize_roll = {};
  return {
    prize: pickPrizeWithinRarity(selected.prizes, rng, audit?.rng?.prize_roll || null),
    nothingChance,
    activeChanceTotal: clampedChance,
    selectedRarity: selected.rarity,
  };
}

function pickPityPrize(prizes, { isWholesale = false, rng = Math.random, audit = null } = {}) {
  const candidates = getNormalRarityCandidates({ isWholesale })
    .filter((entry) => entry.prizes.length > 0);
  const configuredChance = candidates.reduce(
    (sum, entry) => sum + Math.max(0, Number(entry.chancePercent || 0)),
    0,
  );
  const nothingChance = Math.max(0, 100 - Math.min(100, configuredChance));
  const targetRarity =
    candidates.find((entry) => String(entry.rarity.code || "") === "common") ||
    candidates
      .slice()
      .sort(
        (a, b) =>
          Number(a.rarity.sortOrder ?? a.rarity.sort_order ?? 0) -
          Number(b.rarity.sortOrder ?? b.rarity.sort_order ?? 0),
      )[0] ||
    null;
  const reassignmentReason =
    targetRarity?.rarity.code === "common"
      ? "nothing_chance_reassigned_to_common"
      : "nothing_chance_reassigned_to_first_available";
  const weightedEntries = candidates
    .map((entry) => ({
      kind: "pity",
      rarity: entry.rarity,
      prizes: entry.prizes,
      chancePercent:
        Math.max(0, Number(entry.chancePercent || 0)) +
        (targetRarity?.rarity.code === entry.rarity.code ? nothingChance : 0),
      reason:
        targetRarity?.rarity.code === entry.rarity.code && nothingChance > 0
          ? reassignmentReason
          : "configured_chance",
    }))
    .filter((entry) => entry.chancePercent > 0);

  if (audit) {
    audit.configured_chances = listRarities().map((rarity) => ({
      rarity_code: rarity.code,
      label: rarity.label,
      chance_percent: Number(rarity.chancePercent || 0),
    }));
    audit.effective_chances = weightedEntries.map((entry) => ({
      kind: entry.kind,
      rarity_code: entry.rarity.code,
      chance_percent: entry.chancePercent,
      reason: entry.reason,
      prize_ids: entry.prizes.map((prize) => prize.id),
    }));
    audit.availability = candidates.map((entry) => ({
      rarity_code: entry.rarity.code,
      configured_chance_percent: Number(entry.chancePercent || 0),
      available_prize_count: entry.prizes.length,
      available_prize_ids: entry.prizes.map((prize) => prize.id),
      is_available: entry.prizes.length > 0,
    }));
    audit.nothing_chance = nothingChance;
    audit.pity_reassigned_to_rarity = targetRarity?.rarity.code || null;
    audit.rng.pity_rarity_roll = {};
  }

  const selected = pickWeightedEntry(
    weightedEntries,
    (entry) => entry.chancePercent,
    rng,
    audit?.rng?.pity_rarity_roll || null,
  );
  if (selected) {
    if (audit) audit.rng.pity_prize_roll = {};
    const prize = pickPrizeWithinRarity(
      selected.prizes,
      rng,
      audit?.rng?.pity_prize_roll || null,
    );
    if (prize) return { prize, fallback: null };
  }

  // Secondary fallback (S7): no qualifying non-elite reward exists. Better to
  // give the player anything other than another "nothing" than to drop them
  // back to weighted-random where "nothing" might fire yet again.
  const secondary = prizes.filter(
    (prize) => prize.rarity_code !== "nothing",
  );
  if (audit) {
    audit.rng.pity_secondary_roll = {};
    audit.availability.push({
      rarity_code: "pity_secondary",
      is_available: secondary.length > 0,
      available_prize_count: secondary.length,
      available_prize_ids: secondary.map((prize) => prize.id),
    });
  }
  const secondaryPick = pickUniformRandom(secondary, rng, audit?.rng?.pity_secondary_roll || null);
  if (secondaryPick) {
    return { prize: secondaryPick, fallback: "non_elite_pool_empty" };
  }

  return { prize: null, fallback: "no_candidates" };
}

function generatePromoForPrize(prize, settings, ownerCustomerId = null) {
  if (!prize.promo_template_id || prize.rarity_code === "nothing") {
    return null;
  }

  const template = db
    .prepare("SELECT * FROM promo_codes WHERE id = ?")
    .get(prize.promo_template_id);

  if (!template) return null;

  const promoId = generateId(PROMO_ID_PREFIX);
  // Wheel prizes do not own customer-facing expiry anymore: the linked
  // promo template is the source of truth, so managers configure the term
  // once in CRM promo settings. `wheel_prizes.promo_validity_days` remains
  // as a legacy fallback for older rows that predate template-driven terms.
  const templateValidityDays = safeNumber(template.duration_days, 0);
  const legacyPrizeValidityDays = safeNumber(prize.promo_validity_days, 0);
  const validityDays = Math.max(
    1,
    Math.floor(
      templateValidityDays > 0
        ? templateValidityDays
        : legacyPrizeValidityDays > 0
          ? legacyPrizeValidityDays
          : safeNumber(settings.default_promo_validity_days, 90),
    ),
  );
  const validFromDate = new Date().toISOString().slice(0, 10);
  // S4: precompute valid_until so admin "Просроченные" filter works for
  // generated wheel promos. validFromDate + (validityDays - 1) gives the
  // inclusive last day, matching how validatePromoCode interprets
  // duration_days.
  const validUntilDate = addDaysToIsoDate(validFromDate, validityDays - 1);
  // valid_until is timestamped at end-of-day in ISO 8601 so the existing
  // `now > promo.valid_until` check in validatePromoCode keeps working
  // identically for wheel-issued and manually issued promos.
  const validUntilIso = `${validUntilDate}T23:59:59.999Z`;

  let attempt = 0;
  let code = generatePromoCode();
  while (attempt < 5) {
    const exists = db.prepare("SELECT 1 FROM promo_codes WHERE code = ?").get(code);
    if (!exists) break;
    code = generatePromoCode();
    attempt += 1;
  }

  // is_wheel_template = 0 on the generated child code so that
  // validatePromoCode does NOT reject it. Only the original template row
  // (manually flagged in CRM) should be rejected.
  // S2-N1: wheel_owner_customer_id binds the code to the winner so it
  // can't be redeemed by another telegram user even if the promo string
  // leaks.
  db.prepare(
    `INSERT INTO promo_codes (
      id, code, description, discount_type, discount_value, min_order_amount,
      max_uses, current_uses, valid_from, valid_until, active,
      customer_description, manager_description, has_gift,
      valid_from_date, duration_days, is_wheel_template,
      wheel_owner_customer_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, NULL, ?, 1, ?, ?, ?, ?, ?, 0, ?, DATETIME('now'))`,
  ).run(
    promoId,
    code,
    String(template.description || "").trim() ||
      String(template.customer_description || "").trim() ||
      String(prize.title || "").trim() ||
      code,
    template.discount_type,
    template.discount_value,
    template.min_order_amount,
    validUntilIso,
    String(template.description || "").trim()
      ? String(template.customer_description || "").trim() || null
      : null,
    template.manager_description || null,
    Number(template.has_gift || 0),
    validFromDate,
    validityDays,
    ownerCustomerId || null,
  );

  return { promoId, code, validUntil: validUntilDate };
}

function addDaysToIsoDate(isoDate, dayOffset) {
  const [year, month, day] = isoDate.split("-").map((part) => Number(part));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return isoDate;
  }
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toISOString().slice(0, 10);
}

function baseSpinAudit({ customerId, isWholesale, balance }) {
  return {
    customer_id: customerId,
    is_wholesale: Boolean(isWholesale),
    balance_before: {
      spins_available: Number(balance?.spins_available || 0),
      consecutive_nothing: Number(balance?.consecutive_nothing || 0),
      accumulated_retail_byn: Number(balance?.accumulated_retail_byn || 0),
      accumulated_wholesale_byn: Number(balance?.accumulated_wholesale_byn || 0),
    },
    configured_chances: [],
    effective_chances: [],
    availability: [],
    rng: {},
  };
}

function insertSpinAudit({
  spinId,
  customerId,
  decisionType,
  chosenPrize,
  isWholesale,
  isPityRelease,
  isEpicRelease,
  audit,
  outcome,
}) {
  // This row is the long-term proof of how a spin was decided. Keep it
  // inside the same transaction as wheel_spins so analytics never sees
  // an outcome without its decision trail. JSON blobs intentionally avoid
  // promo code strings and auth payloads; agents can join by spin/prize id.
  db.prepare(
    `INSERT INTO wheel_spin_audit (
      id, spin_id, customer_id, decision_type, selected_rarity_code,
      selected_prize_id, is_wholesale, is_pity_release, is_epic_release,
      configured_chances_json, effective_chances_json, availability_json,
      rng_json, balance_before_json, outcome_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    generateId(SPIN_AUDIT_ID_PREFIX),
    spinId,
    customerId,
    decisionType,
    chosenPrize?.rarity_code || null,
    chosenPrize?.id || null,
    isWholesale ? 1 : 0,
    isPityRelease ? 1 : 0,
    isEpicRelease ? 1 : 0,
    jsonForAudit(audit?.configured_chances, []),
    jsonForAudit(audit?.effective_chances, []),
    jsonForAudit(audit?.availability, []),
    jsonForAudit(audit?.rng, {}),
    jsonForAudit(audit?.balance_before, {}),
    jsonForAudit(outcome, {}),
  );
}

/**
 * Spin the wheel for a customer. Wrapped in a single transaction so a
 * concurrent call cannot double-spend a single spin or skip an epic pool.
 */
export function spinWheelForCustomer({
  customerId,
  isWholesale = false,
  rng = Math.random,
  idempotencyKey = null,
  auditEnabled = true,
}) {
  if (!customerId) {
    const error = new Error("customer_required");
    error.code = "customer_required";
    throw error;
  }

  const settings = getWheelSettings();
  const tx = db.transaction(() => {
    const balance = ensureCustomerBalance(customerId);
    const audit = auditEnabled
      ? baseSpinAudit({ customerId, isWholesale, balance })
      : null;
    if (balance.spins_available <= 0) {
      const error = new Error("not_enough_spins");
      error.code = "not_enough_spins";
      throw error;
    }

    const configuredPrizes = loadActivePrizesForCustomer({ isWholesale }).filter(
      (prize) => String(prize.rarity_code || "") !== "nothing",
    );
    const prizes = configuredPrizes.filter((prize) =>
      isPrizeAvailableForContext(prize, { isWholesale }),
    );
    if (!configuredPrizes.length) {
      const error = new Error("no_prizes_configured");
      error.code = "no_prizes_configured";
      throw error;
    }

    let chosenPrize = null;
    let isEpicRelease = false;
    let isPityRelease = false;
    let pityFallbackReason = null;
    let carriedOverCount = 0;
    let decisionType = "rarity_roll";

    const valuableReady = findValuablePrizeReadyForCustomer(customerId, isWholesale, rng, audit);
    if (valuableReady) {
      // Race-safety re-check (B6): findEpicPrizeReadyForCustomer reads the
      // pool outside any lock. By the time we get here another concurrent
      // spin could have already closed this pool. Verify is_active = 1
      // inside the tx and only commit the epic release if it's still open.
      const stillActive = db
        .prepare(
          "SELECT id FROM wheel_rarity_pools WHERE id = ? AND is_active = 1 LIMIT 1",
        )
        .get(valuableReady.pool.id);
      if (stillActive) {
        chosenPrize = valuableReady.prize;
        isEpicRelease = true;
        decisionType = "valuable_release";
      }
    }

    if (
      !chosenPrize &&
      Number(balance.consecutive_nothing || 0) >= settings.pity_threshold
    ) {
      const pityResult = pickPityPrize(prizes, { isWholesale, rng, audit });
      if (pityResult.prize) {
        chosenPrize = pityResult.prize;
        isPityRelease = true;
        pityFallbackReason = pityResult.fallback;
        decisionType = "pity_release";
      } else {
        pityFallbackReason = pityResult.fallback || "no_candidates";
      }
    }

    if (!chosenPrize) {
      const rarityPick = pickRarityDrivenPrize({ isWholesale, rng, audit });
      chosenPrize = rarityPick.prize;
      decisionType = "rarity_roll";
    }

    let isNothing = false;
    if (!chosenPrize) {
      isNothing = true;
      chosenPrize = getTechnicalNothingPrize({ isWholesale });
      if (!chosenPrize) {
        const error = new Error("no_prizes_available");
        error.code = "no_prizes_available";
        throw error;
      }
      decisionType = "fallback_nothing";
    }

    if (pityFallbackReason) {
      logWheelEvent("pity_fallback", {
        customer_id: customerId,
        prize_id: chosenPrize?.id || null,
        fallback_reason: pityFallbackReason,
      });
    }

    const promo = isNothing ? null : generatePromoForPrize(chosenPrize, settings, customerId);
    const seedRoll = rng();
    const seed = Math.floor(seedRoll * 0x7fffffff);
    if (audit) {
      audit.rng.animation_seed_roll = seedRoll;
      audit.rng.animation_seed = seed;
    }
    const spinId = generateId(SPIN_ID_PREFIX);

    db.prepare(
      `INSERT INTO wheel_spins (
        id, customer_id, prize_id, rarity_code, is_wholesale,
        generated_promo_code_id, generated_promo_code, promo_valid_until,
        is_epic_release, is_pity_release, seed_for_animation,
        idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      spinId,
      customerId,
      chosenPrize.id,
      isNothing ? "nothing" : chosenPrize.rarity_code,
      isWholesale ? 1 : 0,
      promo?.promoId || null,
      promo?.code || null,
      promo?.validUntil || null,
      isEpicRelease ? 1 : 0,
      isPityRelease ? 1 : 0,
      seed,
      idempotencyKey || null,
    );

    if (!isNothing) {
      db.prepare(
        `UPDATE wheel_prizes
         SET issued_count = issued_count + 1
         WHERE id = ?`,
      ).run(chosenPrize.id);
      const postIssuePrize = db
        .prepare("SELECT * FROM wheel_prizes WHERE id = ?")
        .get(chosenPrize.id);
      if (isPrizeExhausted(postIssuePrize)) {
        db.prepare("UPDATE wheel_prizes SET is_active = 0 WHERE id = ?").run(
          chosenPrize.id,
        );
      }
    }

    if (auditEnabled) {
      insertSpinAudit({
        spinId,
        customerId,
        decisionType,
        chosenPrize,
        isWholesale,
        isPityRelease,
        isEpicRelease,
        audit,
        outcome: {
          prize_id: isNothing ? null : chosenPrize.id,
          rarity_code: isNothing ? "nothing" : chosenPrize.rarity_code,
          decision_type: decisionType,
          promo_generated: Boolean(promo?.promoId),
          pity_fallback_reason: pityFallbackReason || null,
          valuable_pool_id: valuableReady?.pool?.id || null,
        },
      });
    }

    if (isEpicRelease && valuableReady?.pool) {
      db.prepare(
        `UPDATE wheel_rarity_pools
         SET is_active = 0,
             released_to_customer_id = ?,
             closed_at = DATETIME('now')
         WHERE id = ?`,
      ).run(customerId, valuableReady.pool.id);
      // E5: a customer can be qualified in several active epic pools at
      // once (different prizes, different release thresholds). After
      // they win one, the other pools must drop them — otherwise the
      // very next spin would gift them a second epic prize "for free"
      // because they still satisfy `list.length >= pool_size` and
      // `list.includes(customerId)` in those other pools. Strictly
      // serial: same transaction as the spin so a parallel spin can't
      // observe a half-cleaned state.
      const otherPools = db
        .prepare(
          "SELECT id, qualified_customers_json FROM wheel_rarity_pools WHERE rarity_code = 'valuable' AND is_active = 1 AND id != ?",
        )
        .all(valuableReady.pool.id);
      for (const otherPool of otherPools) {
        const list = parseJson(otherPool.qualified_customers_json, []);
        if (!Array.isArray(list) || !list.includes(customerId)) continue;
        const filtered = list.filter((id) => id !== customerId);
        db.prepare(
          "UPDATE wheel_rarity_pools SET qualified_customers_json = ? WHERE id = ?",
        ).run(JSON.stringify(filtered), otherPool.id);
      }

      const refreshedPrize = db
        .prepare("SELECT * FROM wheel_prizes WHERE id = ?")
        .get(chosenPrize.id);
      const prizeExhausted = isPrizeExhausted(refreshedPrize);

      if (prizeExhausted) {
        db.prepare("UPDATE wheel_prizes SET is_active = 0 WHERE id = ?").run(
          chosenPrize.id,
        );
      } else if (refreshedPrize.is_active) {
        // Q4: carry-over for valuable prizes while the promo template still
        // has issue capacity. The manager owns the total winner limit on
        // the promo template (`max_uses`), not on the wheel prize row.
        // The pool we just closed contained N qualified customers, exactly
        // one of whom won. The remaining N-1 already crossed the profit
        // threshold and would otherwise have to re-qualify under a fresh
        // pool that only counts profit accrued AFTER closed_at — which in
        // practice means they fall out of the system unless they make new
        // orders. Move them into a brand new active pool so the next time
        // any of them spins they get the prize guaranteed (they are already
        // "in the queue").
        //
        // This matches industry practice: lottery jackpots roll over to
        // the next draw, and gacha pity counters carry across banners of
        // the same type. A player who paid into eligibility keeps that
        // eligibility until they actually win.
        const oldQualified = parseJson(valuableReady.pool.qualified_customers_json, []);
        const carryOver = Array.isArray(oldQualified)
          ? oldQualified.filter((id) => id && id !== customerId)
          : [];

        if (carryOver.length > 0) {
          const newPoolId = generateId(POOL_ID_PREFIX);
          // Q4 design choice: pool_size of the carry-over pool == the
          // number of carried members. This keeps the contract
          // `list.length >= pool_size` true at creation time, so the
          // very next spin from any of these N-1 customers releases the
          // prize. The user-visible promise is "you crossed the
          // threshold, you're in the queue, the next time you spin you
          // win" — anything else (re-using the original pool_size) would
          // make them wait for a fresh qualifier, which is what we
          // explicitly chose to fix.
          const carryOverPoolSize = Math.max(1, carryOver.length);
          db.prepare(
            `INSERT INTO wheel_rarity_pools (
              id, rarity_code, pool_size, threshold_byn,
              qualified_customers_json, is_active, opened_at
            ) VALUES (?, ?, ?, ?, ?, 1, DATETIME('now'))`,
          ).run(
            newPoolId,
            "valuable",
            carryOverPoolSize,
            Math.max(0, safeNumber(valuableReady.pool.threshold_byn, 0)),
            JSON.stringify(carryOver),
          );
          carriedOverCount = carryOver.length;
          logWheelEvent("pool_created", {
            pool_id: newPoolId,
            rarity_code: "valuable",
            pool_size: carryOverPoolSize,
            threshold_byn: Math.max(0, safeNumber(valuableReady.pool.threshold_byn, 0)),
            qualified_count: carryOver.length,
            reason: "carry_over",
            previous_pool_id: valuableReady.pool.id,
          });
        }
      }
    }

    const nextConsecutiveNothing = isNothing
      ? Number(balance.consecutive_nothing || 0) + 1
      : 0;

    db.prepare(
      `UPDATE wheel_customer_balances
       SET spins_available = spins_available - 1,
           consecutive_nothing = ?,
           last_updated_at = DATETIME('now')
       WHERE customer_id = ?`,
    ).run(nextConsecutiveNothing, customerId);

    // P3: structured event log emitted once per successful spin. Emit
    // AFTER all DB writes so a row in the log corresponds to a row in
    // wheel_spins (no orphan logs from rolled-back transactions).
    if (isEpicRelease && valuableReady?.pool) {
      logWheelEvent("pool_closed", {
        pool_id: valuableReady.pool.id,
        prize_id: chosenPrize?.id || null,
        winner_id: customerId,
        carryover_size: carriedOverCount,
      });
      logWheelEvent("epic_release", {
        customer_id: customerId,
        prize_id: isNothing ? null : chosenPrize.id,
        rarity_code: isNothing ? "nothing" : chosenPrize.rarity_code,
        pool_id: valuableReady.pool.id,
        carried_over_count: carriedOverCount,
      });
    }
    if (isPityRelease) {
      logWheelEvent("pity_release", {
        customer_id: customerId,
        prize_id: isNothing ? null : chosenPrize.id,
        rarity_code: isNothing ? "nothing" : chosenPrize.rarity_code,
        fallback_reason: pityFallbackReason || null,
      });
    }
    logWheelEvent("spin", {
      customer_id: customerId,
      spin_id: spinId,
      prize_id: isNothing ? null : chosenPrize.id,
      rarity_code: isNothing ? "nothing" : chosenPrize.rarity_code,
      is_epic: isEpicRelease,
      is_pity: isPityRelease,
      is_wholesale: Boolean(isWholesale),
      seed,
    });

    return {
      spinId,
      prize: !isNothing
        ? {
            ...chosenPrize,
            title: prizeDisplayTitle(chosenPrize),
            description: prizeDisplayDescription(chosenPrize),
          }
        : {
            id: null,
            rarity_code: "nothing",
            title: "Без выигрыша",
            description: null,
            image_url: null,
          },
      seed,
      promo,
      isEpicRelease,
      isPityRelease,
    };
  });

  return tx();
}

export function getCustomerWheelState(customerId, { isWholesale = false, telegramUsername = "" } = {}) {
  const settings = getWheelSettings();
  const access = getWheelAccessState(telegramUsername, settings);
  if (!access.is_allowed) {
    return {
      balance: {
        spins_available: 0,
        accumulated_byn: 0,
        threshold_byn: isWholesale ? settings.spin_byn_wholesale : settings.spin_byn_retail,
        progress_percent: 0,
        consecutive_nothing: 0,
      },
      prizes: [],
      rarities: [],
      feed: [],
      my_active_prizes: [],
      feed_consent: false,
      feed_consent_required: false,
      access,
      settings: {
        pity_threshold: settings.pity_threshold,
        spin_byn_retail: settings.spin_byn_retail,
        spin_byn_wholesale: settings.spin_byn_wholesale,
        elite_rarities: settings.elite_rarities,
      },
    };
  }
  const balance = customerId ? ensureCustomerBalance(customerId) : null;
  // Q6: feed_consent_required tells the frontend whether to show the
  // first-visit modal. We treat consent as "answered once" — anything
  // other than NULL on wheel_feed_consent_at means the customer already
  // made a choice (consent_at is stamped on both accept and decline so
  // we don't keep nagging). Anonymous viewers (no customerId) never
  // see the modal — the wheel itself is open, but consent only matters
  // when there's a customer row to bind it to.
  const customerConsentRow = customerId
    ? db
        .prepare(
          "SELECT wheel_feed_consent AS consent, wheel_feed_consent_at AS consent_at FROM customers WHERE id = ?",
        )
        .get(customerId)
    : null;
  const feedConsent = Number(customerConsentRow?.consent || 0) === 1;
  const feedConsentRequired = Boolean(
    customerId && (!customerConsentRow || !customerConsentRow.consent_at),
  );
  const accumulated = balance
    ? safeNumber(
        isWholesale
          ? balance.accumulated_wholesale_byn
          : balance.accumulated_retail_byn,
        0,
      )
    : 0;
  const threshold = isWholesale
    ? settings.spin_byn_wholesale
    : settings.spin_byn_retail;

  const rarities = listRarities();
  const availablePrizes = loadActivePrizesForCustomer({ isWholesale }).filter((prize) =>
    String(prize.rarity_code || "") !== "nothing" &&
    isPrizeAvailableForContext(prize, { isWholesale }),
  );
  const prizesByRarity = groupPrizesByRarity(
    loadAllActivePrizes().filter((prize) => String(prize.rarity_code || "") !== "nothing"),
    { isWholesale },
  );
  const rarityByCode = new Map(rarities.map((rarity) => [rarity.code, rarity]));

  const normalChanceTotal = rarities
    .filter((rarity) => !["nothing", "valuable"].includes(String(rarity.code || "")))
    .filter((rarity) => (prizesByRarity.get(rarity.code) || []).length > 0)
    .reduce((sum, rarity) => sum + Math.max(0, safeNumber(rarity.chancePercent, 0)), 0);

  const rarityPayload = rarities.map((rarity) => {
    const prizesForRarity = prizesByRarity.get(rarity.code) || [];
    const chancePercent = ["nothing", "valuable"].includes(String(rarity.code || ""))
      ? 0
      : Math.max(0, safeNumber(rarity.chancePercent, 0));
    return {
      code: rarity.code,
      label: rarity.label,
      bgColor: rarity.bgColor,
      textColor: rarity.textColor,
      isElite: Boolean(rarity.isElite),
      chance_percent:
        rarity.code === "nothing" ? Math.max(0, 100 - Math.min(100, normalChanceTotal)) : chancePercent,
      is_available: prizesForRarity.length > 0 || rarity.code === "nothing",
      prize_count: prizesForRarity.length,
    };
  });

  const prizes = availablePrizes.map((prize) => {
    const rarity = rarityByCode.get(prize.rarity_code) || null;
    return {
      id: prize.id,
      title: prizeDisplayTitle(prize),
      description: prizeDisplayDescription(prize),
      image_url: prize.image_url,
      rarity: rarity
        ? {
            code: rarity.code,
            label: rarity.label,
            bgColor: rarity.bgColor,
            textColor: rarity.textColor,
            isElite: Boolean(rarity.isElite),
            chance_percent: rarity.code === "nothing"
              ? Math.max(0, 100 - Math.min(100, normalChanceTotal))
              : Math.max(0, safeNumber(rarity.chancePercent, 0)),
          }
        : null,
      weight: Number(prize.weight || 0),
      effective_weight: effectiveWeight(prize),
      max_total: getPrizeIssueLimit(prize),
      issued_count: Number(prize.issued_count || 0),
      is_exhausted: isPrizeExhausted(prize),
      sort_order: Number(prize.sort_order || 0),
    };
  });

  const feed = db
    .prepare(
      `SELECT s.id, s.spun_at, s.rarity_code, s.is_wholesale,
              p.title AS prize_title_stored,
              pc.description AS promo_description,
              pc.customer_description AS promo_customer_description,
              pc.code AS promo_template_code,
              c.first_name, c.last_name, c.photo_url AS customer_photo
       FROM wheel_spins s
       LEFT JOIN wheel_prizes p ON p.id = s.prize_id
       LEFT JOIN promo_codes pc ON pc.id = p.promo_template_id
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.rarity_code != 'nothing'
         AND s.customer_id IS NOT NULL
         -- Show only fresh wins from the last 24 hours so the feed
         -- always reflects current "live" activity. Older entries
         -- create a stale impression even when feed_size allows them.
         AND s.spun_at >= DATETIME('now', '-24 hours')
         -- S29: do not show winners that have been deleted from CRM (deleted_at)
         -- nor winners that currently have an active block (customer_blocks).
         -- Showing them in the public feed would leak attempted PII recovery
         -- after the customer asked to be erased / blocked. The block check
         -- mirrors the canonical predicate from utils/customer-blocks.js.
         AND c.deleted_at IS NULL
         -- Q6: only winners who explicitly opted in to PII display in
         -- the live feed are visible. Default is 0 (no consent yet),
         -- so a freshly-migrated DB shows an empty feed until customers
         -- start tapping "Согласен" in the consent modal. This matches
         -- the regulatory ask in BY (закон о персональных данных) and
         -- the design decision logged in docs/wheel-open-questions.md Q6.
         AND c.wheel_feed_consent = 1
         AND NOT EXISTS (
           SELECT 1 FROM customer_blocks cb
           WHERE cb.customer_id = c.id
             AND cb.active = 1
             AND (cb.block_until IS NULL OR cb.block_until > DATETIME('now'))
         )
       ORDER BY s.spun_at DESC
       LIMIT ?`,
    )
    .all(settings.feed_size)
    .map((row) => {
      const rarity = rarityByCode.get(row.rarity_code) || null;
      return {
        id: row.id,
        spun_at: row.spun_at,
        prize_title: spinPrizeDisplayTitle(row),
        first_name: row.first_name || "Гость",
        last_initial: row.last_name ? String(row.last_name).slice(0, 1) : "",
        photo: row.customer_photo || null,
        rarity: rarity
          ? {
              code: rarity.code,
              label: rarity.label,
              bgColor: rarity.bgColor,
              textColor: rarity.textColor,
            }
          : null,
      };
    });

  const myActivePrizes = customerId
    ? db
        .prepare(
          `SELECT s.id, s.spun_at, s.rarity_code, s.generated_promo_code AS promo_code,
                  s.promo_valid_until, s.prize_used_at, s.is_wholesale,
                  p.title AS prize_title_stored,
                  p.description AS prize_description_stored,
                  pc.description AS promo_description,
                  pc.customer_description AS promo_customer_description,
                  pc.code AS promo_template_code
           FROM wheel_spins s
           LEFT JOIN wheel_prizes p ON p.id = s.prize_id
           LEFT JOIN promo_codes pc ON pc.id = p.promo_template_id
           WHERE s.customer_id = ?
             AND s.rarity_code != 'nothing'
           ORDER BY s.spun_at DESC
           LIMIT 50`,
        )
        .all(customerId)
        .map((row) => {
          const rarity = rarityByCode.get(row.rarity_code) || null;
          return {
            ...row,
            promo_code: row.promo_code,
            prize_title: spinPrizeDisplayTitle(row),
            prize_description: spinPrizeDisplayDescription(row),
            rarity: rarity
              ? {
                  code: rarity.code,
                  label: rarity.label,
                  bgColor: rarity.bgColor,
                  textColor: rarity.textColor,
                }
              : null,
          };
        })
    : [];

  return {
    balance: {
      spins_available: balance ? Number(balance.spins_available || 0) : 0,
      accumulated_byn: accumulated,
      threshold_byn: threshold,
      progress_percent:
        threshold > 0 ? Math.min(100, Math.round((accumulated / threshold) * 100)) : 0,
      consecutive_nothing: balance ? Number(balance.consecutive_nothing || 0) : 0,
    },
    prizes,
    rarities: rarityPayload,
    feed,
    my_active_prizes: myActivePrizes,
    feed_consent: feedConsent,
    feed_consent_required: feedConsentRequired,
    access,
    settings: {
      pity_threshold: settings.pity_threshold,
      spin_byn_retail: settings.spin_byn_retail,
      spin_byn_wholesale: settings.spin_byn_wholesale,
      elite_rarities: settings.elite_rarities,
      wheel_access_usernames: settings.wheel_access_usernames,
    },
  };
}

/**
 * Q6: persist the customer's choice for live-feed PII display.
 *
 * `consent` is a strict boolean. The current value plus the timestamp of
 * the most recent choice are stamped together so the frontend can stop
 * showing the consent modal regardless of accept vs decline. Returning
 * `null` lets the route turn that into a 404 without leaking customer
 * existence.
 */
export function setFeedConsent(customerId, consent) {
  if (!customerId) return null;
  const customer = db
    .prepare("SELECT id FROM customers WHERE id = ?")
    .get(customerId);
  if (!customer) return null;

  const next = consent ? 1 : 0;
  db.prepare(
    `UPDATE customers
     SET wheel_feed_consent = ?,
         wheel_feed_consent_at = DATETIME('now')
     WHERE id = ?`,
  ).run(next, customerId);

  logWheelEvent("consent_changed", {
    customer_id: customerId,
    consent: Boolean(consent),
  });

  const row = db
    .prepare(
      "SELECT wheel_feed_consent AS consent, wheel_feed_consent_at AS consent_at FROM customers WHERE id = ?",
    )
    .get(customerId);
  return {
    consent: Number(row?.consent || 0) === 1,
    consent_at: row?.consent_at || null,
  };
}

export function listAdminPrizes() {
  const rarities = listRarities();
  const rarityByCode = new Map(rarities.map((rarity) => [rarity.code, rarity]));
  return db
    .prepare(
      `SELECT p.*,
              pc.code AS promo_code,
              pc.description AS promo_description,
              pc.customer_description AS promo_customer_description,
              pc.manager_description AS promo_manager_description,
              EXISTS(
                SELECT 1
                FROM wheel_spins s
                WHERE s.prize_id = p.id
                LIMIT 1
              ) AS has_spin_history
       FROM wheel_prizes p
       LEFT JOIN promo_codes pc ON pc.id = p.promo_template_id
       WHERE p.rarity_code != 'nothing'
       ORDER BY p.sort_order ASC, p.created_at ASC`,
    )
    .all()
    .map((prize) => ({
      ...prize,
      title: prizeDisplayTitle(prize),
      description: prizeDisplayDescription(prize),
      max_total: getPrizeIssueLimit(prize),
      rarity: rarityByCode.get(prize.rarity_code) || null,
      is_active: Boolean(prize.is_active),
      is_for_retail: Boolean(prize.is_for_retail),
      is_for_wholesale: Boolean(prize.is_for_wholesale),
      is_exhausted: isPrizeExhausted(prize),
      can_delete: !Boolean(prize.has_spin_history),
      template_available:
        String(prize.rarity_code || "") === "nothing"
          ? true
          : getPromoTemplateAvailability(prize.promo_template_id),
    }));
}

export function listAdminRarityRules() {
  const issuedByRarity = new Map(
    db
      .prepare(
        `SELECT rarity_code, COUNT(*) AS issued_count
         FROM wheel_spins
         GROUP BY rarity_code`,
      )
      .all()
      .map((row) => [row.rarity_code, Number(row.issued_count || 0)]),
  );
  const activePrizeCounts = new Map(
    db
      .prepare(
        `SELECT rarity_code, COUNT(*) AS prize_count
         FROM wheel_prizes
         WHERE is_active = 1
           AND rarity_code != 'nothing'
         GROUP BY rarity_code`,
      )
      .all()
      .map((row) => [row.rarity_code, Number(row.prize_count || 0)]),
  );
  const issuablePrizeCounts = new Map(
    db
      .prepare(
        `SELECT p.rarity_code, COUNT(*) AS prize_count
         FROM wheel_prizes p
         LEFT JOIN promo_codes pc ON pc.id = p.promo_template_id
         WHERE p.is_active = 1
           AND p.rarity_code != 'nothing'
           AND (
             COALESCE(pc.max_uses, 0) = 0
             OR p.issued_count < pc.max_uses
           )
         GROUP BY p.rarity_code`,
      )
      .all()
      .map((row) => [row.rarity_code, Number(row.prize_count || 0)]),
  );
  const hotPool = getActiveValuablePool();
  const hotQualified = Array.isArray(parseJson(hotPool?.qualified_customers_json, []))
    ? parseJson(hotPool?.qualified_customers_json, [])
    : [];

  const rarities = listRarities();
  const normalChanceTotal = rarities
    .filter((rarity) => !["nothing", "valuable"].includes(String(rarity.code || "")))
    .reduce((sum, rarity) => sum + Math.max(0, safeNumber(rarity.chancePercent, 0)), 0);

  return rarities.map((rarity) => ({
    ...rarity,
    chancePercent:
      rarity.code === "nothing" ? Math.max(0, 100 - Math.min(100, normalChanceTotal)) : Math.max(0, safeNumber(rarity.chancePercent, 0)),
    chanceIsDerived: rarity.code === "nothing",
    prizeCount: activePrizeCounts.get(rarity.code) || 0,
    issuablePrizeCount: issuablePrizeCounts.get(rarity.code) || 0,
    issuedCount: issuedByRarity.get(rarity.code) || 0,
    isAvailable: rarity.code === "nothing" ? true : (issuablePrizeCounts.get(rarity.code) || 0) > 0,
    valuablePool: rarity.code === "valuable"
      ? {
          poolSize: Math.max(1, safeNumber(rarity.valuablePoolSize, 5)),
          thresholdByn: Math.max(1, safeNumber(rarity.valuableThresholdByn, 300)),
          qualifiedCount: hotQualified.length,
          isHot: hotPool ? hotQualified.length >= Math.max(1, safeNumber(hotPool.pool_size, 0)) : false,
        }
      : null,
  }));
}

/**
 * Validate the create/update prize payload from CRM.
 *
 * Returns { errors: string[] } where each entry is a short slug like
 * `rarity_unknown`. Callers (admin routes) should respond with HTTP 400
 * and `details: errors[]` when any entry is present.
 *
 * C3-CR: when called with `isUpdate: true`, pass the current row in
 * `existing` so we can validate "at least one pool stays enabled" even
 * when the partial payload only touches one of the two flags.
 */
export function validatePrizePayload(payload, { isUpdate = false, existing = null } = {}) {
  const errors = [];
  const data = payload || {};

  if (!isUpdate || data.rarity_code !== undefined) {
    const rarityCode = String(data.rarity_code || "").trim();
    if (!rarityCode) {
      errors.push("rarity_code_required");
    } else {
      const rarity = db
        .prepare("SELECT 1 FROM wheel_rarities WHERE code = ? LIMIT 1")
        .get(rarityCode);
      if (!rarity) errors.push("rarity_unknown");
    }
  }

  if (data.promo_template_id) {
    // C1-CR: extra defensive check — confirm the referenced row exists.
    // We do not block reusing the same template across prizes; that
    // matches the docs ("Promo-template can be used as wheel template").
    const template = db
      .prepare("SELECT id FROM promo_codes WHERE id = ? LIMIT 1")
      .get(String(data.promo_template_id));
    if (!template) errors.push("promo_template_not_found");
  }

  const rarityCodeForPromoRule =
    data.rarity_code !== undefined
      ? String(data.rarity_code || "").trim()
      : existing
        ? String(existing.rarity_code || "").trim()
        : "";
  const promoTemplateIdForPromoRule =
    data.promo_template_id !== undefined
      ? data.promo_template_id
      : existing
        ? existing.promo_template_id
        : null;
  if (rarityCodeForPromoRule && rarityCodeForPromoRule !== "nothing" && !promoTemplateIdForPromoRule) {
    errors.push("promo_template_required_for_prize");
  }

  // is_for_retail / is_for_wholesale: at least one must be truthy.
  // C3-CR: on partial update, fall back to the existing row's value for
  // the flag that wasn't touched by the payload — otherwise PATCHing
  // only `is_for_retail=false` could leave the prize with both pools
  // disabled and never get caught here.
  const retailGiven = Object.prototype.hasOwnProperty.call(data, "is_for_retail");
  const wholesaleGiven = Object.prototype.hasOwnProperty.call(data, "is_for_wholesale");
  if (!isUpdate || retailGiven || wholesaleGiven) {
    const retailFlag = retailGiven
      ? Boolean(data.is_for_retail)
      : existing
        ? Boolean(existing.is_for_retail)
        : true;
    const wholesaleFlag = wholesaleGiven
      ? Boolean(data.is_for_wholesale)
      : existing
        ? Boolean(existing.is_for_wholesale)
        : false;
    if (!retailFlag && !wholesaleFlag) {
      errors.push("at_least_one_pool_required");
    }
  }

  if (data.weight !== undefined) {
    const weight = Number(data.weight);
    if (!Number.isFinite(weight) || weight < 0) {
      errors.push("weight_must_be_non_negative");
    }
  }

  if (data.epic_pool_size !== undefined) {
    const size = Number(data.epic_pool_size);
    if (!Number.isFinite(size) || size < 1) {
      errors.push("epic_pool_size_must_be_positive");
    }
  }

  if (data.epic_pool_threshold_byn !== undefined) {
    const threshold = Number(data.epic_pool_threshold_byn);
    if (!Number.isFinite(threshold) || threshold < 1) {
      errors.push("epic_pool_threshold_must_be_positive");
    }
  }

  if (data.promo_validity_days !== undefined) {
    const days = Number(data.promo_validity_days);
    if (!Number.isFinite(days) || days < 1) {
      errors.push("promo_validity_days_must_be_positive");
    }
  }

  if (data.max_total !== undefined) {
    const maxTotal = Number(data.max_total);
    if (!Number.isFinite(maxTotal) || maxTotal < 0) {
      errors.push("max_total_must_be_non_negative");
    }
  }

  return { errors };
}

/**
 * Validate the wheel settings payload (PUT /api/admin/crm/wheel/settings).
 * Returns { errors: string[] }.
 */
export function validateWheelSettingsPayload(payload) {
  const errors = [];
  const data = payload || {};

  const positiveNumberKeys = [
    "spin_byn_retail",
    "spin_byn_wholesale",
    "pity_threshold",
    "default_promo_validity_days",
    "feed_size",
  ];
  for (const key of positiveNumberKeys) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    const value = Number(data[key]);
    if (!Number.isFinite(value) || value < 1) {
      errors.push(`${key}_must_be_positive`);
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(data, "elite_rarities") ||
    Object.prototype.hasOwnProperty.call(data, "elite_rarities_json")
  ) {
    const raw =
      data.elite_rarities !== undefined ? data.elite_rarities : data.elite_rarities_json;
    if (raw !== null && raw !== undefined && !Array.isArray(raw)) {
      errors.push("elite_rarities_must_be_array");
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(data, "wheel_access_usernames") ||
    Object.prototype.hasOwnProperty.call(data, "wheel_access_usernames_json")
  ) {
    const raw =
      data.wheel_access_usernames !== undefined
        ? data.wheel_access_usernames
        : data.wheel_access_usernames_json;
    if (raw !== null && raw !== undefined && !Array.isArray(raw)) {
      errors.push("wheel_access_usernames_must_be_array");
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, "start_collecting_at")) {
    const raw = data.start_collecting_at;
    if (raw !== null && raw !== undefined && raw !== "") {
      const str = String(raw).trim();
      if (str.toLowerCase() === "null" || str.toLowerCase() === "undefined") {
        errors.push("start_collecting_at_invalid");
      } else {
        const parsed = new Date(str);
        if (Number.isNaN(parsed.getTime())) {
          errors.push("start_collecting_at_invalid");
        }
      }
    }
  }

  return { errors };
}

export function createPrize(payload) {
  const id = generateId("wp");
  const storageText = resolvePrizeStorageText(payload);
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO wheel_prizes (
        id, rarity_code, title, description, image_url, weight,
        max_total, is_for_retail, is_for_wholesale, promo_template_id,
        promo_validity_days, epic_pool_size, epic_pool_threshold_byn,
        is_active, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      String(payload.rarity_code || "common"),
      storageText.title,
      storageText.description ? String(storageText.description) : null,
      payload.image_url ? String(payload.image_url) : null,
      Math.max(0, safeNumber(payload.weight, 1)),
      Math.max(0, Math.floor(safeNumber(payload.max_total, 0))),
      payload.is_for_retail === false ? 0 : 1,
      payload.is_for_wholesale ? 1 : 0,
      payload.promo_template_id || null,
      Math.max(1, Math.floor(safeNumber(payload.promo_validity_days, 90))),
      Math.max(1, Math.floor(safeNumber(payload.epic_pool_size, 5))),
      Math.max(0, safeNumber(payload.epic_pool_threshold_byn, 300)),
      payload.is_active === false ? 0 : 1,
      Math.floor(safeNumber(payload.sort_order, 0)),
    );

    // C1-CR: flag the linked promo_codes row as a wheel template so that
    // validatePromoCode rejects direct customer application. Done inside
    // the same transaction as the INSERT so we never end up in a state
    // where the prize references a template that isn't flagged.
    if (payload.promo_template_id) {
      db.prepare(
        "UPDATE promo_codes SET is_wheel_template = 1 WHERE id = ?",
      ).run(payload.promo_template_id);
    }
  });
  tx();
  return db.prepare("SELECT * FROM wheel_prizes WHERE id = ?").get(id);
}

export function updatePrize(id, payload) {
  const existing = db
    .prepare("SELECT * FROM wheel_prizes WHERE id = ?")
    .get(id);
  if (!existing) return null;

  const merged = { ...existing, ...payload };
  const previousTemplateId = existing.promo_template_id || null;
  const nextTemplateId = merged.promo_template_id || null;
  const storageText = resolvePrizeStorageText(merged, existing);

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE wheel_prizes
       SET rarity_code = ?,
           title = ?,
           description = ?,
           image_url = ?,
           weight = ?,
           max_total = ?,
           is_for_retail = ?,
           is_for_wholesale = ?,
           promo_template_id = ?,
           promo_validity_days = ?,
           epic_pool_size = ?,
           epic_pool_threshold_byn = ?,
           is_active = ?,
           sort_order = ?
       WHERE id = ?`,
    ).run(
      String(merged.rarity_code || "common"),
      storageText.title,
      storageText.description ? String(storageText.description) : null,
      merged.image_url ? String(merged.image_url) : null,
      Math.max(0, safeNumber(merged.weight, 1)),
      Math.max(0, Math.floor(safeNumber(merged.max_total, 0))),
      merged.is_for_retail === false || merged.is_for_retail === 0 ? 0 : 1,
      merged.is_for_wholesale ? 1 : 0,
      nextTemplateId,
      Math.max(1, Math.floor(safeNumber(merged.promo_validity_days, 90))),
      Math.max(1, Math.floor(safeNumber(merged.epic_pool_size, 5))),
      Math.max(0, safeNumber(merged.epic_pool_threshold_byn, 300)),
      merged.is_active === false || merged.is_active === 0 ? 0 : 1,
      Math.floor(safeNumber(merged.sort_order, 0)),
      id,
    );

    // C1-CR: keep is_wheel_template synchronized with the actual usage
    // graph. If the template changed, set the new one and clear the old
    // one — but only clear when no other prize still uses it.
    if (nextTemplateId && nextTemplateId !== previousTemplateId) {
      db.prepare(
        "UPDATE promo_codes SET is_wheel_template = 1 WHERE id = ?",
      ).run(nextTemplateId);
    }
    if (
      previousTemplateId &&
      previousTemplateId !== nextTemplateId &&
      !isPromoStillUsedAsTemplate(previousTemplateId, id)
    ) {
      db.prepare(
        "UPDATE promo_codes SET is_wheel_template = 0 WHERE id = ?",
      ).run(previousTemplateId);
    }
  });
  tx();

  return db.prepare("SELECT * FROM wheel_prizes WHERE id = ?").get(id);
}

function isPromoStillUsedAsTemplate(promoId, excludePrizeId = null) {
  if (!promoId) return false;
  const params = [promoId];
  let where = "promo_template_id = ?";
  if (excludePrizeId) {
    where += " AND id != ?";
    params.push(excludePrizeId);
  }
  return Boolean(
    db.prepare(`SELECT 1 FROM wheel_prizes WHERE ${where} LIMIT 1`).get(...params),
  );
}

export function deletePrize(id) {
  const existing = db.prepare("SELECT * FROM wheel_prizes WHERE id = ?").get(id);
  if (!existing) {
    const error = new Error("prize_not_found");
    error.code = "prize_not_found";
    error.status = 404;
    throw error;
  }
  const hasSpinHistory = Boolean(
    db.prepare("SELECT 1 FROM wheel_spins WHERE prize_id = ? LIMIT 1").get(id),
  );
  if (hasSpinHistory) {
    const error = new Error("Приз уже участвовал в розыгрышах. Его можно только выключить.");
    error.code = "prize_has_history";
    error.status = 409;
    throw error;
  }

  const tx = db.transaction(() => {
    if (String(existing?.rarity_code || "") === "valuable") {
      const stillAvailable = loadAllActivePrizes().some((prize) =>
        String(prize.rarity_code || "") === "valuable" &&
        prize.id !== id &&
        isPrizeAvailableForContext(prize, { isWholesale: false }),
      ) || loadAllActivePrizes().some((prize) =>
        String(prize.rarity_code || "") === "valuable" &&
        prize.id !== id &&
        isPrizeAvailableForContext(prize, { isWholesale: true }),
      );
      if (!stillAvailable) {
        db.prepare(
          "UPDATE wheel_rarity_pools SET is_active = 0, closed_at = DATETIME('now') WHERE rarity_code = 'valuable' AND is_active = 1",
        ).run();
      }
    }
    db.prepare("DELETE FROM wheel_prizes WHERE id = ?").run(id);
    if (
      existing.promo_template_id &&
      !isPromoStillUsedAsTemplate(existing.promo_template_id, id)
    ) {
      db.prepare(
        "UPDATE promo_codes SET is_wheel_template = 0 WHERE id = ?",
      ).run(existing.promo_template_id);
    }
  });
  tx();
}

export function listAdminSpins({ limit = 50, offset = 0, customerId, rarity } = {}) {
  const params = [];
  const where = [];
  if (customerId) {
    where.push("s.customer_id = ?");
    params.push(customerId);
  }
  if (rarity) {
    where.push("s.rarity_code = ?");
    params.push(rarity);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const safeLimit = Math.max(1, Math.min(500, Math.floor(safeNumber(limit, 50))));
  const safeOffset = Math.max(0, Math.floor(safeNumber(offset, 0)));

  const rows = db
    .prepare(
      `SELECT s.id, s.customer_id, s.prize_id, s.rarity_code, s.is_wholesale,
              CASE WHEN s.rarity_code = 'nothing' THEN NULL ELSE s.generated_promo_code_id END AS generated_promo_code_id,
              CASE WHEN s.rarity_code = 'nothing' THEN NULL ELSE s.generated_promo_code END AS generated_promo_code,
              CASE WHEN s.rarity_code = 'nothing' THEN NULL ELSE s.promo_valid_until END AS promo_valid_until,
              s.is_epic_release, s.is_pity_release, s.seed_for_animation,
              s.prize_used_at, s.spun_at, s.idempotency_key,
              p.title AS prize_title_stored,
              p.description AS prize_description_stored,
              pc.description AS promo_description,
              pc.customer_description AS promo_customer_description,
              pc.code AS promo_template_code,
              c.first_name, c.last_name, c.telegram_username
       FROM wheel_spins s
       LEFT JOIN wheel_prizes p ON p.id = s.prize_id
       LEFT JOIN promo_codes pc ON pc.id = p.promo_template_id
       LEFT JOIN customers c ON c.id = s.customer_id
       ${whereSql}
       ORDER BY s.spun_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, safeLimit, safeOffset)
    .map((row) => ({
      ...row,
      prize_title: spinPrizeDisplayTitle(row),
    }));

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM wheel_spins s
       LEFT JOIN wheel_prizes p ON p.id = s.prize_id
       ${whereSql}`,
    )
    .get(...params);

  return { rows, total: Number(totalRow?.count || 0) };
}

function parseAuditRow(row) {
  return {
    ...row,
    is_wholesale: Boolean(row.is_wholesale),
    is_pity_release: Boolean(row.is_pity_release),
    is_epic_release: Boolean(row.is_epic_release),
    configured_chances: parseJson(row.configured_chances_json, []),
    effective_chances: parseJson(row.effective_chances_json, []),
    availability: parseJson(row.availability_json, []),
    rng: parseJson(row.rng_json, {}),
    balance_before: parseJson(row.balance_before_json, {}),
    outcome: parseJson(row.outcome_json, {}),
  };
}

export function listAdminSpinAudit({ limit = 100, offset = 0, from = null, to = null, rarity = null } = {}) {
  // Agent-facing audit export. This endpoint deliberately returns raw
  // decision JSON so another Droid can recalculate expected distributions
  // without reading production code. Promo codes are not joined here.
  const params = [];
  const where = [];
  if (from) {
    where.push("a.created_at >= ?");
    params.push(String(from));
  }
  if (to) {
    where.push("a.created_at < ?");
    params.push(String(to));
  }
  if (rarity) {
    where.push("a.selected_rarity_code = ?");
    params.push(String(rarity));
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(safeNumber(limit, 100))));
  const safeOffset = Math.max(0, Math.floor(safeNumber(offset, 0)));

  const rows = db
    .prepare(
      `SELECT a.*, s.spun_at,
              p.title AS prize_title_stored,
              p.description AS prize_description_stored,
              s.rarity_code,
              pc.description AS promo_description,
              pc.customer_description AS promo_customer_description,
              pc.code AS promo_template_code,
              c.telegram_username
       FROM wheel_spin_audit a
       JOIN wheel_spins s ON s.id = a.spin_id
       LEFT JOIN wheel_prizes p ON p.id = a.selected_prize_id
       LEFT JOIN promo_codes pc ON pc.id = p.promo_template_id
       LEFT JOIN customers c ON c.id = a.customer_id
       ${whereSql}
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, safeLimit, safeOffset)
    .map((row) => ({
      ...parseAuditRow(row),
      prize_title: spinPrizeDisplayTitle(row),
    }));

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS count FROM wheel_spin_audit a ${whereSql}`)
    .get(...params);

  const summary = db
    .prepare(
      `SELECT selected_rarity_code AS rarity_code,
              decision_type,
              COUNT(*) AS count,
              SUM(is_pity_release) AS pity_count,
              SUM(is_epic_release) AS epic_count
       FROM wheel_spin_audit a
       ${whereSql}
       GROUP BY selected_rarity_code, decision_type
       ORDER BY count DESC`,
    )
    .all(...params);

  return {
    rows,
    total: Number(totalRow?.count || 0),
    summary,
  };
}

export function getAdminDashboard() {
  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS total_spins,
         SUM(CASE WHEN rarity_code = 'nothing' THEN 1 ELSE 0 END) AS nothing_spins,
         SUM(CASE WHEN is_epic_release = 1 THEN 1 ELSE 0 END) AS epic_releases,
         SUM(CASE WHEN is_pity_release = 1 THEN 1 ELSE 0 END) AS pity_releases
       FROM wheel_spins`,
    )
    .get();

  const rarityBreakdown = db
    .prepare(
      `SELECT rarity_code, COUNT(*) AS count
       FROM wheel_spins
       GROUP BY rarity_code`,
    )
    .all();

  const rarityPools = db
    .prepare(
      `SELECT *
       FROM wheel_rarity_pools
       WHERE is_active = 1
       ORDER BY opened_at DESC`,
    )
    .all()
    .map((pool) => ({
      ...pool,
      qualified_customers: parseJson(pool.qualified_customers_json, []),
    }));

  // S2-N4: only show active prizes in the CRM dashboard. Soft-deleted
  // prizes (`is_active = 0`) used to mix into "Призы и расход", which
  // confused managers reviewing live performance — they couldn't tell
  // whether `Скрыто` columns were skipped or live. Soft-deleted ones
  // can still be inspected via the Призы tab where the manager picks
  // "Активен"/"Все". For the dashboard we keep only live rows.
  const prizesIssued = db
    .prepare(
      `SELECT p.id,
              p.title AS prize_title_stored,
              p.description AS prize_description_stored,
              p.rarity_code,
              pc.description AS promo_description,
              pc.customer_description AS promo_customer_description,
              pc.code AS promo_template_code,
              p.issued_count,
              CASE
                WHEN p.rarity_code = 'nothing' THEN p.max_total
                ELSE COALESCE(pc.max_uses, 0)
              END AS max_total,
              p.is_for_retail, p.is_for_wholesale, p.is_active
       FROM wheel_prizes p
       LEFT JOIN promo_codes pc ON pc.id = p.promo_template_id
       WHERE p.is_active = 1
         AND p.rarity_code != 'nothing'
       ORDER BY p.sort_order ASC, p.created_at ASC`,
    )
    .all()
    .map((row) => ({
      ...row,
      title: spinPrizeDisplayTitle(row),
    }));

  const rarityRules = listAdminRarityRules();

  return {
    totals: {
      total_spins: Number(totals?.total_spins || 0),
      nothing_spins: Number(totals?.nothing_spins || 0),
      epic_releases: Number(totals?.epic_releases || 0),
      pity_releases: Number(totals?.pity_releases || 0),
    },
    rarity_breakdown: rarityBreakdown,
    active_epic_pools: rarityPools,
    prizes_issued: prizesIssued,
    rarity_rules: rarityRules,
  };
}
