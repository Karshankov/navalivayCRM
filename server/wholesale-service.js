import { db } from './db.js';
import { roundMoney } from './utils/money.js';

const WHOLESALE_CODE_HEADER = 'x-wholesale-code';
const WHOLESALE_SECRET_HEADER = 'x-wholesale-secret';
const MAX_SQL_VARS = 900;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function chunkArray(items, size = MAX_SQL_VARS) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toTierModel(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    code: String(row.code),
    label: row.label,
    minOrderAmount: Number(row.min_order_amount ?? 0),
    secretKey: row.secret_key,
    sortOrder: Number(row.sort_order ?? 0),
    isActive: Number(row.is_active ?? 0) === 1,
  };
}

function toPriceNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

export function getWholesaleRequestCredentials(req) {
  const query = req?.query || {};
  const body = req?.body || {};
  const headers = req?.headers || {};

  const code =
    normalizeString(headers[WHOLESALE_CODE_HEADER]) ||
    normalizeString(query.wholesale_code) ||
    normalizeString(query.wholesaleCode) ||
    normalizeString(body.wholesale_code) ||
    normalizeString(body.wholesaleCode);

  const secret =
    normalizeString(headers[WHOLESALE_SECRET_HEADER]) ||
    normalizeString(query.wholesale_secret) ||
    normalizeString(query.wholesaleSecret) ||
    normalizeString(body.wholesale_secret) ||
    normalizeString(body.wholesaleSecret);

  return {
    code,
    secret,
  };
}

export function getActiveWholesaleTiers() {
  const rows = db.prepare(`
    SELECT id, code, label, min_order_amount, secret_key, sort_order, is_active
    FROM wholesale_tiers
    WHERE is_active = 1
    ORDER BY sort_order ASC, min_order_amount ASC
  `).all();

  return rows.map(toTierModel);
}

export function getWholesaleTierById(tierId) {
  if (!tierId) {
    return null;
  }

  const row = db.prepare(`
    SELECT id, code, label, min_order_amount, secret_key, sort_order, is_active
    FROM wholesale_tiers
    WHERE id = ?
    LIMIT 1
  `).get(String(tierId));

  return toTierModel(row);
}

export function getWholesaleTierByCode(code) {
  const normalizedCode = normalizeString(code);
  if (!normalizedCode) {
    return null;
  }

  const row = db.prepare(`
    SELECT id, code, label, min_order_amount, secret_key, sort_order, is_active
    FROM wholesale_tiers
    WHERE code = ? AND is_active = 1
    LIMIT 1
  `).get(normalizedCode);

  return toTierModel(row);
}

export function getWholesaleTierByCredentials({ code, secret }) {
  const normalizedCode = normalizeString(code);
  const normalizedSecret = normalizeString(secret);
  if (!normalizedCode || !normalizedSecret) {
    return null;
  }

  const row = db.prepare(`
    SELECT id, code, label, min_order_amount, secret_key, sort_order, is_active
    FROM wholesale_tiers
    WHERE code = ? AND secret_key = ? AND is_active = 1
    LIMIT 1
  `).get(normalizedCode, normalizedSecret);

  return toTierModel(row);
}

export function resolveWholesaleContextFromRequest(req) {
  const credentials = getWholesaleRequestCredentials(req);
  if (!credentials.code && !credentials.secret) {
    return null;
  }

  if (!credentials.code || !credentials.secret) {
    const error = new Error('Оптовая ссылка неполная');
    error.code = 'invalid_wholesale_link';
    error.statusCode = 400;
    throw error;
  }

  const tier = getWholesaleTierByCredentials(credentials);
  if (!tier) {
    const error = new Error('Оптовая ссылка недействительна');
    error.code = 'invalid_wholesale_link';
    error.statusCode = 403;
    throw error;
  }

  return {
    isWholesale: true,
    tier,
    code: tier.code,
    secret: credentials.secret,
    minOrderAmount: tier.minOrderAmount,
    label: tier.label,
  };
}

export function buildWholesaleContextPayload(context) {
  if (!context?.tier) {
    return null;
  }

  return {
    is_wholesale: true,
    wholesale_code: context.tier.code,
    wholesale_label: context.tier.label,
    wholesale_min_amount: Number(context.tier.minOrderAmount || 0),
  };
}

export function buildWholesaleLinkPath(tier) {
  if (!tier?.code || !tier?.secretKey) {
    return null;
  }

  return `/opt/${encodeURIComponent(String(tier.code))}/${encodeURIComponent(String(tier.secretKey))}`;
}

export function getWholesalePricedGroupIds(tierId) {
  if (!tierId) {
    return [];
  }

  const rows = db.prepare(`
    SELECT group_id
    FROM category_group_wholesale_prices
    WHERE tier_id = ? AND price_byn > 0
  `).all(String(tierId));

  return rows.map((row) => String(row.group_id));
}

export function getWholesalePriceMapForGroups(groupIds, tierId) {
  const normalizedGroupIds = Array.from(
    new Set((groupIds || []).map((id) => normalizeString(id)).filter(Boolean)),
  );
  if (!normalizedGroupIds.length || !tierId) {
    return new Map();
  }

  const rows = [];
  for (const chunk of chunkArray(normalizedGroupIds)) {
    const placeholders = chunk.map(() => '?').join(', ');
    rows.push(
      ...db.prepare(`
        SELECT group_id, price_byn
        FROM category_group_wholesale_prices
        WHERE tier_id = ?
          AND group_id IN (${placeholders})
      `).all(String(tierId), ...chunk),
    );
  }

  return new Map(
    rows.map((row) => [String(row.group_id), Number(row.price_byn ?? 0)]),
  );
}

export function getWholesaleUnitPriceForGroup(groupId, tierId) {
  const normalizedGroupId = normalizeString(groupId);
  if (!normalizedGroupId || !tierId) {
    return null;
  }

  const row = db.prepare(`
    SELECT price_byn
    FROM category_group_wholesale_prices
    WHERE group_id = ? AND tier_id = ?
    LIMIT 1
  `).get(normalizedGroupId, String(tierId));

  return row ? Number(row.price_byn ?? 0) : null;
}

export function getWholesaleUnitPriceForProduct(product, tierId) {
  if (!product?.groupId || !tierId) {
    return null;
  }

  return getWholesaleUnitPriceForGroup(product.groupId, tierId);
}

export function normalizeWholesalePricesInput(rawValue) {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return {};
  }

  const result = {};
  for (const [code, value] of Object.entries(rawValue)) {
    const normalizedCode = normalizeString(code);
    if (!normalizedCode) {
      continue;
    }

    if (value === '' || value === null || value === undefined) {
      result[normalizedCode] = null;
      continue;
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      const error = new Error(`Некорректная оптовая цена для уровня ${normalizedCode}`);
      error.code = 'invalid_wholesale_price';
      throw error;
    }

    result[normalizedCode] = numeric;
  }

  return result;
}

export function saveGroupWholesalePrices(groupId, wholesalePrices = {}) {
  const normalizedGroupId = normalizeString(groupId);
  if (!normalizedGroupId) {
    return;
  }

  const normalized = normalizeWholesalePricesInput(wholesalePrices);
  const tiers = getActiveWholesaleTiers();
  const tierByCode = new Map(tiers.map((tier) => [tier.code, tier]));

  const deleteStmt = db.prepare(`
    DELETE FROM category_group_wholesale_prices
    WHERE group_id = ? AND tier_id = ?
  `);
  const upsertStmt = db.prepare(`
    INSERT INTO category_group_wholesale_prices (
      group_id, tier_id, price_byn, created_at, updated_at
    ) VALUES (?, ?, ?, DATETIME('now'), DATETIME('now'))
    ON CONFLICT(group_id, tier_id) DO UPDATE SET
      price_byn = excluded.price_byn,
      updated_at = DATETIME('now')
  `);

  for (const [code, maybePrice] of Object.entries(normalized)) {
    const tier = tierByCode.get(code);
    if (!tier) {
      continue;
    }

    const price = toPriceNumber(maybePrice);
    if (price === null) {
      deleteStmt.run(normalizedGroupId, tier.id);
      continue;
    }

    upsertStmt.run(normalizedGroupId, tier.id, price);
  }
}

export function getGroupWholesalePrices(groupId) {
  const normalizedGroupId = normalizeString(groupId);
  if (!normalizedGroupId) {
    return {};
  }

  const rows = db.prepare(`
    SELECT wt.code, gwp.price_byn
    FROM category_group_wholesale_prices gwp
    JOIN wholesale_tiers wt ON wt.id = gwp.tier_id
    WHERE gwp.group_id = ?
      AND wt.is_active = 1
    ORDER BY wt.sort_order ASC, wt.min_order_amount ASC
  `).all(normalizedGroupId);

  const result = {};
  rows.forEach((row) => {
    result[String(row.code)] = Number(row.price_byn ?? 0);
  });
  return result;
}

export function getBulkGroupWholesalePrices(groupIds) {
  const normalizedGroupIds = Array.from(
    new Set((groupIds || []).map((id) => normalizeString(id)).filter(Boolean)),
  );
  if (!normalizedGroupIds.length) {
    return new Map();
  }

  const rows = [];
  for (const chunk of chunkArray(normalizedGroupIds)) {
    const placeholders = chunk.map(() => '?').join(', ');
    rows.push(
      ...db.prepare(`
        SELECT gwp.group_id, wt.code, gwp.price_byn
        FROM category_group_wholesale_prices gwp
        JOIN wholesale_tiers wt ON wt.id = gwp.tier_id
        WHERE gwp.group_id IN (${placeholders})
          AND wt.is_active = 1
        ORDER BY wt.sort_order ASC, wt.min_order_amount ASC
      `).all(...chunk),
    );
  }

  const result = new Map();
  rows.forEach((row) => {
    const groupId = String(row.group_id);
    const current = result.get(groupId) || {};
    current[String(row.code)] = Number(row.price_byn ?? 0);
    result.set(groupId, current);
  });

  return result;
}

export function getGroupAverageCostStats(groupId) {
  const normalizedGroupId = normalizeString(groupId);
  if (!normalizedGroupId) {
    return {
      averageCostAuto: null,
      directProductCount: 0,
      productsWithCostCount: 0,
    };
  }

  const row = db.prepare(`
    WITH direct_products AS (
      SELECT
        p.id,
        CAST(COALESCE(p.cost_price, 0) AS REAL) AS cost_price,
        CASE
          WHEN COALESCE(p.has_variants, 0) = 1 THEN (
            SELECT COALESCE(SUM(COALESCE(pv.stock, 0)), 0)
            FROM product_variants pv
            WHERE pv.product_id = p.id
          )
          ELSE COALESCE(p.stock, 0)
        END AS stock_units
      FROM products p
      WHERE p.groupId = ?
    )
    SELECT
      COUNT(*) AS direct_product_count,
      SUM(CASE WHEN cost_price > 0 THEN 1 ELSE 0 END) AS products_with_cost_count,
      CASE
        WHEN SUM(CASE WHEN cost_price > 0 AND stock_units > 0 THEN stock_units ELSE 0 END) > 0
          THEN
            SUM(CASE WHEN cost_price > 0 AND stock_units > 0 THEN cost_price * stock_units ELSE 0 END) /
            SUM(CASE WHEN cost_price > 0 AND stock_units > 0 THEN stock_units ELSE 0 END)
        WHEN SUM(CASE WHEN cost_price > 0 THEN 1 ELSE 0 END) > 0
          THEN AVG(CASE WHEN cost_price > 0 THEN cost_price END)
        ELSE NULL
      END AS average_cost_auto
    FROM direct_products
  `).get(normalizedGroupId);

  return {
    averageCostAuto:
      row?.average_cost_auto === null || row?.average_cost_auto === undefined
        ? null
        : roundMoney(row.average_cost_auto),
    directProductCount: Number(row?.direct_product_count ?? 0),
    productsWithCostCount: Number(row?.products_with_cost_count ?? 0),
  };
}

export function getBulkGroupAverageCostStats(groupIds) {
  const normalizedGroupIds = Array.from(
    new Set((groupIds || []).map((id) => normalizeString(id)).filter(Boolean)),
  );
  if (!normalizedGroupIds.length) {
    return new Map();
  }

  const result = new Map();
  for (const chunk of chunkArray(normalizedGroupIds)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = db.prepare(`
      WITH direct_products AS (
        SELECT
          p.groupId AS group_id,
          CAST(COALESCE(p.cost_price, 0) AS REAL) AS cost_price,
          CASE
            WHEN COALESCE(p.has_variants, 0) = 1 THEN (
              SELECT COALESCE(SUM(COALESCE(pv.stock, 0)), 0)
              FROM product_variants pv
              WHERE pv.product_id = p.id
            )
            ELSE COALESCE(p.stock, 0)
          END AS stock_units
        FROM products p
        WHERE p.groupId IN (${placeholders})
      )
      SELECT
        group_id,
        COUNT(*) AS direct_product_count,
        SUM(CASE WHEN cost_price > 0 THEN 1 ELSE 0 END) AS products_with_cost_count,
        CASE
          WHEN SUM(CASE WHEN cost_price > 0 AND stock_units > 0 THEN stock_units ELSE 0 END) > 0
            THEN
              SUM(CASE WHEN cost_price > 0 AND stock_units > 0 THEN cost_price * stock_units ELSE 0 END) /
              SUM(CASE WHEN cost_price > 0 AND stock_units > 0 THEN stock_units ELSE 0 END)
          WHEN SUM(CASE WHEN cost_price > 0 THEN 1 ELSE 0 END) > 0
            THEN AVG(CASE WHEN cost_price > 0 THEN cost_price END)
          ELSE NULL
        END AS average_cost_auto
      FROM direct_products
      GROUP BY group_id
    `).all(...chunk);

    rows.forEach((row) => {
      result.set(String(row.group_id), {
        averageCostAuto:
          row.average_cost_auto === null || row.average_cost_auto === undefined
            ? null
            : roundMoney(row.average_cost_auto),
        directProductCount: Number(row.direct_product_count ?? 0),
        productsWithCostCount: Number(row.products_with_cost_count ?? 0),
      });
    });
  }

  return result;
}

export function getWholesaleCoverageSummary() {
  const targetGroupIds = db.prepare(`
    SELECT DISTINCT g.id
    FROM category_groups g
    JOIN products p ON p.groupId = g.id
  `).all().map((row) => String(row.id));

  const targetSet = new Set(targetGroupIds);
  const totalTargetGroups = targetSet.size;
  const tiers = getActiveWholesaleTiers();

  return tiers.map((tier) => {
    const pricedGroupIds = new Set(getWholesalePricedGroupIds(tier.id));
    const filledGroupCount = totalTargetGroups === 0
      ? 0
      : Array.from(targetSet).filter((groupId) => pricedGroupIds.has(groupId)).length;

    return {
      ...tier,
      path: buildWholesaleLinkPath(tier),
      totalTargetGroups,
      filledGroupCount,
      missingGroupCount: Math.max(totalTargetGroups - filledGroupCount, 0),
    };
  });
}

export function validateWholesaleMinimum(totalAmount, context) {
  if (!context?.tier) {
    return null;
  }

  const minAmount = Number(context.tier.minOrderAmount || 0);
  const currentAmount = Number(totalAmount || 0);
  if (!Number.isFinite(minAmount) || minAmount <= 0 || currentAmount >= minAmount) {
    return null;
  }

  return {
    error: 'wholesale_min_not_met',
    message: `Минимальная сумма для выбранного оптового прайса: ${minAmount} BYN. Сейчас в корзине: ${currentAmount.toFixed(2)} BYN`,
    min_amount: minAmount,
    current_amount: currentAmount,
    remaining_amount: Number((minAmount - currentAmount).toFixed(2)),
    wholesale_code: context.tier.code,
    wholesale_label: context.tier.label,
  };
}

export function buildWholesaleHeadersFromContext(context) {
  if (!context?.tier?.code || !context?.secret) {
    return {};
  }

  return {
    [WHOLESALE_CODE_HEADER]: String(context.tier.code),
    [WHOLESALE_SECRET_HEADER]: String(context.secret),
  };
}
