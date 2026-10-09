import { db } from '../db.js';
import {
  getActiveWholesaleTiers,
  getBulkGroupWholesalePrices,
} from '../wholesale-service.js';
import {
  hasStrengthTier,
  STOREFRONT_FILTER_PROFILES,
} from './storefront-filters.js';

/**
 * Контроль заполненности линеек для админки «Категории» (п.3).
 *
 * Линейка проверяется по полям описания, остатка, опта и (для жидкостей) крепости.
 * Родительские «главные» группы без прямых товаров (контейнеры для дочерних линеек) пропускаются.
 *   - meta_value (описание / крепость)
 *   - min_stock_threshold (> 0)
 *   - оптовые цены для всех активных tier
 *
 * Waiver-флаги на линейке отключают требование к конкретному полю.
 */

export const COMPLETENESS_FIELD_LABELS = Object.freeze({
  description: 'Описание',
  min_stock: 'Минимальный остаток',
  wholesale: 'Оптовые цены',
  strength_tier: 'Крепость (фильтр)',
});

function isWaiverActive(value) {
  return Number(value) === 1;
}

function hasDescription(metaValue) {
  return typeof metaValue === 'string' && metaValue.trim().length > 0;
}

function hasMinStock(threshold) {
  const n = Number(threshold);
  return Number.isFinite(n) && n > 0;
}

function isValidWholesalePrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

export function normalizeWaiverInput(value) {
  if (value === true || value === 1 || value === '1') {
    return 1;
  }
  if (value === false || value === 0 || value === '0' || value === null || value === undefined) {
    return 0;
  }
  const err = new Error('invalid_waiver_value');
  err.code = 'invalid_waiver_value';
  throw err;
}

function getWholesaleStatusForGroup(groupId, tiers, priceMapByGroup) {
  const prices = priceMapByGroup.get(String(groupId)) || {};
  const missingTierCodes = [];
  let filledCount = 0;

  for (const tier of tiers) {
    const price = prices[tier.code];
    if (isValidWholesalePrice(price)) {
      filledCount += 1;
    } else {
      missingTierCodes.push(String(tier.code));
    }
  }

  return {
    filledCount,
    totalCount: tiers.length,
    missingTierCodes,
    isComplete: tiers.length === 0 || missingTierCodes.length === 0,
  };
}

function selectAllGroups() {
  return db
    .prepare(
      `SELECT
         g.id AS group_id,
         g.categoryId,
         g.slug,
         g.name,
         g.meta_value,
         g.min_stock_threshold,
         g.strength_tier,
         g.waive_description,
         g.waive_min_stock,
         g.waive_wholesale,
         g.waive_strength_tier,
         (g.cover_image IS NOT NULL AND g.cover_image != '') AS has_cover_image,
         c.name AS category_name,
         c.storefront_filters_profile AS storefront_filters_profile,
         COUNT(p.id) AS product_count,
         (SELECT COUNT(*) FROM category_groups child WHERE child.parent_group_id = g.id) AS child_count
       FROM category_groups g
       LEFT JOIN categories c ON c.id = g.categoryId
       LEFT JOIN products p ON p.groupId = g.id
       GROUP BY g.id, g.categoryId, g.slug, g.name, g.meta_value,
                g.min_stock_threshold, g.strength_tier, g.waive_description,
                g.waive_min_stock, g.waive_wholesale, g.waive_strength_tier,
                g.cover_image, c.name, c.storefront_filters_profile`,
    )
    .all();
}

export function evaluateGroupCompleteness(row, tiers, priceMapByGroup) {
  const missingFields = [];
  const waivers = {
    description: isWaiverActive(row.waive_description),
    min_stock: isWaiverActive(row.waive_min_stock),
    wholesale: isWaiverActive(row.waive_wholesale),
    strength_tier: isWaiverActive(row.waive_strength_tier),
  };

  const filtersProfile = String(
    row.storefront_filters_profile ?? STOREFRONT_FILTER_PROFILES.NONE,
  ).toLowerCase();

  if (!waivers.description && !hasDescription(row.meta_value)) {
    missingFields.push('description');
  }
  if (!waivers.min_stock && !hasMinStock(row.min_stock_threshold)) {
    missingFields.push('min_stock');
  }
  if (
    filtersProfile === STOREFRONT_FILTER_PROFILES.LIQUIDS &&
    !waivers.strength_tier &&
    !hasStrengthTier(row.strength_tier)
  ) {
    missingFields.push('strength_tier');
  }

  const wholesaleStatus = getWholesaleStatusForGroup(
    row.group_id ?? row.id,
    tiers,
    priceMapByGroup,
  );
  if (!waivers.wholesale && !wholesaleStatus.isComplete) {
    missingFields.push('wholesale');
  }

  return {
    missingFields,
    missingWholesaleTiers: wholesaleStatus.missingTierCodes,
    wholesaleFilledCount: wholesaleStatus.filledCount,
    wholesaleTotalCount: wholesaleStatus.totalCount,
    waivers,
    isComplete: missingFields.length === 0,
  };
}

function buildIncompleteItem(row, evaluation) {
  return {
    id: String(row.group_id),
    name: row.name,
    slug: row.slug,
    categoryId: row.categoryId,
    categoryName: row.category_name ?? null,
    hasCoverImage: Boolean(row.has_cover_image),
    productCount: Number(row.product_count ?? 0),
    missingFields: evaluation.missingFields,
    missingWholesaleTiers: evaluation.missingWholesaleTiers,
    wholesaleFilledCount: evaluation.wholesaleFilledCount,
    wholesaleTotalCount: evaluation.wholesaleTotalCount,
    waivers: evaluation.waivers,
  };
}

export function computeIncompleteGroups() {
  const tiers = getActiveWholesaleTiers();
  const rows = selectAllGroups();
  const groupIds = rows.map((row) => String(row.group_id));
  const priceMapByGroup = getBulkGroupWholesalePrices(groupIds);

  const items = [];
  for (const row of rows) {
    const productCount = Number(row.product_count ?? 0);
    const childCount = Number(row.child_count ?? 0);
    if (productCount === 0 && childCount > 0) {
      continue;
    }

    const evaluation = evaluateGroupCompleteness(row, tiers, priceMapByGroup);
    if (!evaluation.isComplete) {
      items.push(buildIncompleteItem(row, evaluation));
    }
  }

  items.sort((a, b) => {
    const catA = (a.categoryName || '').localeCompare(b.categoryName || '', 'ru');
    if (catA !== 0) return catA;
    const prodA = (a.productCount ?? 0) > 0 ? 0 : 1;
    const prodB = (b.productCount ?? 0) > 0 ? 0 : 1;
    if (prodA !== prodB) return prodA - prodB;
    return (a.name || '').localeCompare(b.name || '', 'ru');
  });

  return items;
}

export function getIncompleteGroupsSummary() {
  const items = computeIncompleteGroups();
  return {
    hasAny: items.length > 0,
    count: items.length,
  };
}

export function updateGroupCompletenessWaivers(
  groupId,
  { waiveDescription, waiveMinStock, waiveWholesale, waiveStrengthTier } = {},
) {
  if (!groupId) {
    const err = new Error('group_id_required');
    err.code = 'group_id_required';
    throw err;
  }

  const exists = db.prepare('SELECT id FROM category_groups WHERE id = ?').get(String(groupId));
  if (!exists) {
    const err = new Error('group_not_found');
    err.code = 'group_not_found';
    throw err;
  }

  const current = db
    .prepare(
      `SELECT waive_description, waive_min_stock, waive_wholesale, waive_strength_tier
         FROM category_groups WHERE id = ?`,
    )
    .get(String(groupId));

  const nextDescription =
    waiveDescription !== undefined
      ? normalizeWaiverInput(waiveDescription)
      : Number(current.waive_description ?? 0);
  const nextMinStock =
    waiveMinStock !== undefined
      ? normalizeWaiverInput(waiveMinStock)
      : Number(current.waive_min_stock ?? 0);
  const nextWholesale =
    waiveWholesale !== undefined
      ? normalizeWaiverInput(waiveWholesale)
      : Number(current.waive_wholesale ?? 0);
  const nextStrengthTier =
    waiveStrengthTier !== undefined
      ? normalizeWaiverInput(waiveStrengthTier)
      : Number(current.waive_strength_tier ?? 0);

  db.prepare(
    `UPDATE category_groups
        SET waive_description = ?,
            waive_min_stock = ?,
            waive_wholesale = ?,
            waive_strength_tier = ?,
            updatedAt = DATETIME('now')
      WHERE id = ?`,
  ).run(
    nextDescription,
    nextMinStock,
    nextWholesale,
    nextStrengthTier,
    String(groupId),
  );

  return {
    id: String(groupId),
    waive_description: nextDescription,
    waive_min_stock: nextMinStock,
    waive_wholesale: nextWholesale,
    waive_strength_tier: nextStrengthTier,
  };
}