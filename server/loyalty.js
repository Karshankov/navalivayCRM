import { db } from "./db.js";
import { resolveDiscountPrice } from "./utils/catalog-discounts.js";
import { resolveCatalogUnitPrice } from "./utils/order-line-pricing.js";

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeTelegramUsername(value) {
  return typeof value === "string" ? value.trim().replace(/^@+/, "") : "";
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getLoyaltyCategories() {
  return db
    .prepare(
      `
      SELECT
        lc.id,
        lc.key,
        s.threshold,
        s.discount_amount,
        s.title,
        s.description,
        s.sort_order,
        s.active
      FROM loyalty_categories lc
      JOIN loyalty_category_settings s ON s.loyalty_category_id = lc.id
      ORDER BY s.sort_order ASC, lc.key ASC
    `,
    )
    .all()
    .map((row) => ({
      id: row.id,
      key: row.key,
      threshold: Number(row.threshold || 0),
      discount_amount: Number(row.discount_amount || 0),
      title: row.title,
      description: row.description || null,
      sort_order: Number(row.sort_order || 0),
      active: Number(row.active || 0) === 1,
    }));
}

function ensureCustomerBalanceRows(customerId) {
  if (!customerId) {
    return;
  }

  const categories = getLoyaltyCategories();
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO customer_loyalty_balances (customer_id, loyalty_category_id, balance, updated_at)
    VALUES (?, ?, 0, DATETIME('now'))
  `);

  for (const category of categories) {
    insertStmt.run(customerId, category.id);
  }
}

export function getCustomerBalanceMap(customerId) {
  if (!customerId) {
    return new Map();
  }

  ensureCustomerBalanceRows(customerId);
  const rows = db
    .prepare(
      `
      SELECT loyalty_category_id, balance
      FROM customer_loyalty_balances
      WHERE customer_id = ?
    `,
    )
    .all(customerId);

  return new Map(
    rows.map((row) => [row.loyalty_category_id, Number(row.balance || 0)]),
  );
}

function getReservedSpendingByOrder(orderId) {
  if (!orderId) {
    return new Map();
  }

  const rows = db
    .prepare(
      `
      SELECT loyalty_category_id, SUM(stamps_spent) AS spent
      FROM order_loyalty_redemptions
      WHERE order_id = ?
      GROUP BY loyalty_category_id
    `,
    )
    .all(orderId);

  return new Map(rows.map((row) => [row.loyalty_category_id, Number(row.spent || 0)]));
}

function getMappings() {
  const rows = db
    .prepare(
      `
      SELECT loyalty_category_id, category_id, group_id
      FROM loyalty_category_mappings
    `,
    )
    .all();

  const byCategoryId = new Map();
  const byGroupId = new Map();

  for (const row of rows) {
    if (row.group_id) {
      byGroupId.set(row.group_id, row.loyalty_category_id);
    }
    if (row.category_id) {
      byCategoryId.set(row.category_id, row.loyalty_category_id);
    }
  }

  return { byCategoryId, byGroupId };
}

function getProductContextMap(productIds) {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return new Map();
  }

  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  if (!uniqueIds.length) {
    return new Map();
  }

  const placeholders = uniqueIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `
      SELECT
        id,
        categoryId AS category_id,
        groupId AS group_id,
        title,
        priceRub AS price_rub,
        stock,
        has_variants
      FROM products
      WHERE id IN (${placeholders})
    `,
    )
    .all(...uniqueIds);

  return new Map(
    rows.map((row) => [
      row.id,
      {
        category_id: row.category_id || null,
        group_id: row.group_id || null,
        title: row.title || row.id,
        price_rub: row.price_rub ?? 0,
        stock: row.stock ?? null,
        has_variants: Number(row.has_variants || 0) === 1,
      },
    ]),
  );
}

function getVariantContextMap(variantIds) {
  if (!Array.isArray(variantIds) || variantIds.length === 0) {
    return new Map();
  }

  const uniqueIds = [...new Set(variantIds.filter(Boolean))];
  if (!uniqueIds.length) {
    return new Map();
  }

  const placeholders = uniqueIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `
      SELECT id, product_id, price_rub, stock
      FROM product_variants
      WHERE id IN (${placeholders})
    `,
    )
    .all(...uniqueIds);

  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        product_id: row.product_id || null,
        price_rub: row.price_rub ?? null,
        stock: row.stock ?? null,
      },
    ]),
  );
}

function resolveLoyaltyCategoryId(productContext, mappingLookup) {
  if (!productContext) {
    return null;
  }

  if (productContext.group_id && mappingLookup.byGroupId.has(productContext.group_id)) {
    return mappingLookup.byGroupId.get(productContext.group_id) || null;
  }

  if (
    productContext.category_id &&
    mappingLookup.byCategoryId.has(productContext.category_id)
  ) {
    return mappingLookup.byCategoryId.get(productContext.category_id) || null;
  }

  return null;
}

function ensureBalanceRow(customerId, loyaltyCategoryId) {
  db.prepare(
    `
    INSERT OR IGNORE INTO customer_loyalty_balances (customer_id, loyalty_category_id, balance, updated_at)
    VALUES (?, ?, 0, DATETIME('now'))
  `,
  ).run(customerId, loyaltyCategoryId);
}

function changeCustomerBalance({
  customerId,
  loyaltyCategoryId,
  delta,
  reason,
  orderId = null,
  orderItemId = null,
  note = null,
}) {
  if (!customerId || !loyaltyCategoryId || !delta) {
    return null;
  }

  ensureBalanceRow(customerId, loyaltyCategoryId);
  db.prepare(
    `
    UPDATE customer_loyalty_balances
    SET balance = balance + ?,
        updated_at = DATETIME('now')
    WHERE customer_id = ? AND loyalty_category_id = ?
  `,
  ).run(delta, customerId, loyaltyCategoryId);

  const updated = db
    .prepare(
      `
      SELECT balance
      FROM customer_loyalty_balances
      WHERE customer_id = ? AND loyalty_category_id = ?
    `,
    )
    .get(customerId, loyaltyCategoryId);

  const balanceAfter = Number(updated?.balance || 0);
  db.prepare(
    `
    INSERT INTO customer_loyalty_ledger (
      id, customer_id, loyalty_category_id, order_id, order_item_id, reason, delta, balance_after, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    generateId("cled"),
    customerId,
    loyaltyCategoryId,
    orderId,
    orderItemId,
    reason,
    delta,
    balanceAfter,
    note,
  );

  return balanceAfter;
}

export function resetCustomerLoyaltyOnUsernameChange({
  customerId,
  previousUsername,
  nextUsername,
}) {
  const prev = normalizeTelegramUsername(previousUsername).toLowerCase();
  const next = normalizeTelegramUsername(nextUsername).toLowerCase();

  if (!customerId || !prev || !next || prev === next) {
    return false;
  }

  const balances = db
    .prepare(
      `
      SELECT loyalty_category_id, balance
      FROM customer_loyalty_balances
      WHERE customer_id = ? AND balance > 0
    `,
    )
    .all(customerId);

  for (const balance of balances) {
    changeCustomerBalance({
      customerId,
      loyaltyCategoryId: balance.loyalty_category_id,
      delta: -Number(balance.balance || 0),
      reason: "username_reset",
      note: `username ${prev} -> ${next}`,
    });
  }

  db.prepare(
    `
    UPDATE customer_loyalty_balances
    SET balance = 0,
        updated_at = DATETIME('now')
    WHERE customer_id = ?
  `,
  ).run(customerId);

  return balances.length > 0;
}

export function getCustomerLoyaltySnapshot(customerId) {
  const categories = getLoyaltyCategories();
  const balances = getCustomerBalanceMap(customerId);

  return categories.map((category) => {
    const balance = Number(balances.get(category.id) || 0);
    const threshold = Number(category.threshold || 0);
    return {
      ...category,
      balance,
      available_bonus_count: threshold > 0 ? Math.floor(balance / threshold) : 0,
      remaining_to_next:
        threshold > 0 ? Math.max(threshold - (balance % threshold || 0), 0) : 0,
    };
  });
}

export function buildLoyaltyApplication({
  customerId = null,
  items = [],
  promoCodeText = null,
  existingOrderId = null,
}) {
  const categories = getLoyaltyCategories();
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const mappingLookup = getMappings();
  const productContextMap = getProductContextMap(items.map((item) => item.product_id));
  const variantContextMap = getVariantContextMap(items.map((item) => item.variant_id));
  const baseBalances = getCustomerBalanceMap(customerId);
  const restoredBalances = getReservedSpendingByOrder(existingOrderId);
  const effectiveBalances = new Map(baseBalances);

  for (const [categoryId, restored] of restoredBalances.entries()) {
    effectiveBalances.set(
      categoryId,
      Number(effectiveBalances.get(categoryId) || 0) + Number(restored || 0),
    );
  }

  const promoBlocked = Boolean(String(promoCodeText || "").trim());
  const normalizedItems = [];
  const requestedByCategory = new Map();
  const previewByCategory = new Map();

  for (const rawItem of items) {
    const quantity = Math.max(0, Math.floor(toNumber(rawItem.quantity, 0)));
    const manualDiscountAmount = Math.max(
      0,
      toNumber(rawItem.manual_discount_amount ?? rawItem.discount_amount, 0),
    );
    const productContext = productContextMap.get(rawItem.product_id) || null;
    const variantContext = rawItem.variant_id
      ? variantContextMap.get(rawItem.variant_id) || null
      : null;
    const variantMatchesProduct =
      !variantContext ||
      !productContext ||
      String(variantContext.product_id || "") === String(rawItem.product_id || "");
    const hasManualPricePerUnit =
      rawItem.price_per_unit !== undefined &&
      rawItem.price_per_unit !== null &&
      Number.isFinite(Number(rawItem.price_per_unit));
    const resolvedPricePerUnit = hasManualPricePerUnit
      ? rawItem.price_per_unit
      : (variantMatchesProduct
          ? variantContext?.price_rub ?? productContext?.price_rub ?? rawItem.price_per_unit
          : productContext?.price_rub ?? rawItem.price_per_unit);
    const pricePerUnit = Math.max(0, toNumber(resolvedPricePerUnit, 0));
    // Ноль у вкуса означает «цена лежит на товаре». Не откатись мы с нуля,
    // база стала бы нулевой, скидка каталога перестала бы быть видна на
    // разнице цен, и за скидочную позицию снова пошли бы штампы.
    const catalogBasePrice = variantMatchesProduct
      ? resolveCatalogUnitPrice(variantContext?.price_rub, productContext?.price_rub)
      : resolveCatalogUnitPrice(null, productContext?.price_rub);
    const basePricePerUnit = Math.max(
      0,
      catalogBasePrice > 0 ? catalogBasePrice : pricePerUnit,
    );

    const loyaltyCategoryId = resolveLoyaltyCategoryId(productContext, mappingLookup);
    const category = loyaltyCategoryId ? categoryById.get(loyaltyCategoryId) || null : null;
    const requestedUnits = Math.max(
      0,
      Math.min(quantity, Math.floor(toNumber(rawItem.loyalty_units_applied, 0))),
    );

    let preview = null;
    if (category && category.active) {
      preview = previewByCategory.get(category.id);
      if (!preview) {
        const balance = Number(effectiveBalances.get(category.id) || 0);
        preview = {
          category_id: category.id,
          category_key: category.key,
          title: category.title,
          description: category.description,
          threshold: category.threshold,
          discount_amount: category.discount_amount,
          current_balance: balance,
          current_available_bonus_count:
            category.threshold > 0 ? Math.floor(balance / category.threshold) : 0,
          items_in_cart: 0,
          eligible_purchase_units: 0,
          loyalty_units_applied: 0,
          spent_now: 0,
          earned_after_fulfillment: 0,
          projected_balance: balance,
          available_bonus_count: 0,
          remaining_to_next: 0,
          line_items: [],
        };
        previewByCategory.set(category.id, preview);
      }
    }

    // Позиция со скидкой каталога не участвует в бонусах ни одной стороной:
    // ни копит штампы, ни принимает их в оплату. Иначе скидка складывалась бы
    // с бонусом, а этого магазин не хочет.
    const catalogDiscountPrice = resolveDiscountPrice({
      productId: productContext?.id || rawItem.product_id || null,
      variantId: variantMatchesProduct ? variantContext?.id || rawItem.variant_id || null : null,
      // Именно group_id: запрос отдаёт линейку под этим именем. Пока здесь
      // стояло groupId, поле было undefined, скидки на линейку до проверки не
      // доходили, и товар со скидкой всё равно предлагал бонусную карту.
      groupId: productContext?.group_id || null,
    });
    const lineHasCatalogDiscount =
      catalogDiscountPrice !== null && catalogDiscountPrice < basePricePerUnit;

    const lineBlocked = promoBlocked || !category || !category.active;
    const lineCanApplyBonus =
      !lineBlocked && manualDiscountAmount <= 0 && !lineHasCatalogDiscount;
    const lineRequestedUnits = lineCanApplyBonus ? requestedUnits : 0;
    const discountPerUnit = category
      ? Math.max(0, Math.min(Number(category.discount_amount || 0), pricePerUnit))
      : 0;
    const loyaltyDiscountAmount = lineRequestedUnits * discountPerUnit;
    const totalDiscountAmount = manualDiscountAmount + loyaltyDiscountAmount;
    const totalPrice = Math.max(0, pricePerUnit * quantity - totalDiscountAmount);

    if (preview) {
      const maxRedeemableUnits = lineCanApplyBonus ? Math.min(quantity, 1) : 0;
      const earnedAfterFulfillment =
        promoBlocked || manualDiscountAmount > 0 || lineHasCatalogDiscount || !category?.active
          ? 0
          : Math.max(quantity - lineRequestedUnits, 0);

      preview.items_in_cart += quantity;
      preview.eligible_purchase_units +=
        promoBlocked || manualDiscountAmount > 0 || lineHasCatalogDiscount || !category?.active
          ? 0
          : quantity;
      preview.loyalty_units_applied += lineRequestedUnits;
      preview.spent_now += lineRequestedUnits * Number(category.threshold || 0);
      preview.earned_after_fulfillment += earnedAfterFulfillment;
      preview.line_items.push({
        key: `${rawItem.product_id || ""}::${rawItem.variant_id || ""}`,
        product_id: rawItem.product_id || null,
        variant_id: rawItem.variant_id || null,
        quantity,
        loyalty_units_applied: lineRequestedUnits,
        max_redeemable_units: maxRedeemableUnits,
        product_title: rawItem.product_title || productContext?.title || rawItem.product_id,
      });
    }

    if (lineRequestedUnits > 0 && category) {
      requestedByCategory.set(
        category.id,
        Number(requestedByCategory.get(category.id) || 0) + lineRequestedUnits,
      );
    }

    normalizedItems.push({
      ...rawItem,
      quantity,
      price_per_unit: pricePerUnit,
      manual_discount_amount: manualDiscountAmount,
      loyalty_category_id: category?.id || null,
      loyalty_units_applied: lineRequestedUnits,
      loyalty_discount_amount: loyaltyDiscountAmount,
      discount_amount: totalDiscountAmount,
      total_price: totalPrice,
      _product_context: productContext,
    });
  }

  if (!promoBlocked) {
    for (const [categoryId, requestedUnits] of requestedByCategory.entries()) {
      const category = categoryById.get(categoryId);
      const balance = Number(effectiveBalances.get(categoryId) || 0);
      const threshold = Number(category?.threshold || 0);
      if (!category || threshold <= 0) {
        throw new Error("loyalty_category_not_available");
      }

      if (requestedUnits > 1) {
        const error = new Error("loyalty_category_limit_exceeded");
        error.userMessage = "За один заказ можно применить только один бонус на категорию";
        throw error;
      }

      const availableUnits = Math.floor(balance / threshold);
      if (requestedUnits > availableUnits) {
        throw new Error("loyalty_balance_not_enough");
      }
    }
  } else if (normalizedItems.some((item) => Number(item.loyalty_units_applied || 0) > 0)) {
    throw new Error("promo_and_loyalty_conflict");
  }

  const redemptions = normalizedItems
    .filter((item) => item.loyalty_category_id && Number(item.loyalty_units_applied || 0) > 0)
    .map((item) => {
      const category = categoryById.get(item.loyalty_category_id);
      const threshold = Number(category?.threshold || 0);
      const discountPerUnit = category
        ? Math.max(0, Math.min(Number(category.discount_amount || 0), Number(item.price_per_unit || 0)))
        : 0;
      return {
        order_item_id: item.id,
        loyalty_category_id: item.loyalty_category_id,
        units_applied: Number(item.loyalty_units_applied || 0),
        threshold_snapshot: threshold,
        discount_per_unit_snapshot: discountPerUnit,
        stamps_spent: Number(item.loyalty_units_applied || 0) * threshold,
        discount_total: Number(item.loyalty_discount_amount || 0),
      };
    });

  for (const preview of previewByCategory.values()) {
    const spendingBalance = Math.max(0, preview.current_balance - preview.spent_now);
    preview.projected_balance = spendingBalance + preview.earned_after_fulfillment;
    preview.available_bonus_count =
      preview.threshold > 0 ? Math.floor(spendingBalance / preview.threshold) : 0;
    preview.remaining_to_next =
      preview.threshold > 0
        ? (preview.projected_balance % preview.threshold === 0
            ? 0
            : preview.threshold - (preview.projected_balance % preview.threshold))
        : 0;
  }

  const previews = [...previewByCategory.values()].sort(
    (left, right) =>
      Number(categoryById.get(left.category_id)?.sort_order || 0) -
      Number(categoryById.get(right.category_id)?.sort_order || 0),
  );

  return {
    promo_blocked: promoBlocked,
    total_loyalty_discount: normalizedItems.reduce(
      (sum, item) => sum + Number(item.loyalty_discount_amount || 0),
      0,
    ),
    items: normalizedItems.map((item) => {
      const normalized = { ...item };
      delete normalized._product_context;
      return normalized;
    }),
    redemptions,
    categories: previews,
  };
}

export function applyOrderLoyaltyReservations({ customerId, orderId, application }) {
  if (!customerId || !orderId || !application?.redemptions?.length) {
    return;
  }

  const insertStmt = db.prepare(
    `
    INSERT INTO order_loyalty_redemptions (
      id, order_id, order_item_id, customer_id, loyalty_category_id,
      units_applied, threshold_snapshot, discount_per_unit_snapshot, stamps_spent, discount_total
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  );

  for (const redemption of application.redemptions) {
    changeCustomerBalance({
      customerId,
      loyaltyCategoryId: redemption.loyalty_category_id,
      delta: -Number(redemption.stamps_spent || 0),
      reason: "reserved_for_order",
      orderId,
      orderItemId: redemption.order_item_id,
      note: `units=${redemption.units_applied}`,
    });

    insertStmt.run(
      generateId("olr"),
      orderId,
      redemption.order_item_id,
      customerId,
      redemption.loyalty_category_id,
      redemption.units_applied,
      redemption.threshold_snapshot,
      redemption.discount_per_unit_snapshot,
      redemption.stamps_spent,
      redemption.discount_total,
    );
  }
}

export function releaseOrderLoyaltyReservations(orderId, reason = "released_from_order") {
  if (!orderId) {
    return;
  }

  const rows = db
    .prepare(
      `
      SELECT *
      FROM order_loyalty_redemptions
      WHERE order_id = ?
      ORDER BY created_at ASC
    `,
    )
    .all(orderId);

  if (!rows.length) {
    return;
  }

  for (const row of rows) {
    if (row.customer_id && Number(row.stamps_spent || 0) > 0) {
      changeCustomerBalance({
        customerId: row.customer_id,
        loyaltyCategoryId: row.loyalty_category_id,
        delta: Number(row.stamps_spent || 0),
        reason,
        orderId: row.order_id,
        orderItemId: row.order_item_id,
      });
    }
  }

  db.prepare(
    `
    UPDATE order_items
    SET loyalty_discount_amount = 0,
        loyalty_units_applied = 0,
        discount_amount = COALESCE(manual_discount_amount, 0),
        total_price = MAX((price_per_unit * quantity) - COALESCE(manual_discount_amount, 0), 0)
    WHERE order_id = ?
  `,
  ).run(orderId);

  db.prepare("DELETE FROM order_loyalty_redemptions WHERE order_id = ?").run(orderId);
}

function resolveCatalogPricePerUnit(item) {
  if (item?.variant_id) {
    const variant = db
      .prepare("SELECT price_rub FROM product_variants WHERE id = ?")
      .get(item.variant_id);
    if (variant?.price_rub != null) {
      return Number(variant.price_rub);
    }
  }

  if (item?.product_id) {
    const product = db
      .prepare("SELECT priceRub FROM products WHERE id = ?")
      .get(item.product_id);
    if (product?.priceRub != null) {
      return Number(product.priceRub);
    }
  }

  return null;
}

/** CRM lowered sale price on a line item — stamp must not accrue for that item. */
export function isPositionSalePriceReduced(item) {
  const catalogPrice = resolveCatalogPricePerUnit(item);
  if (!Number.isFinite(catalogPrice) || catalogPrice <= 0) {
    return false;
  }

  const salePrice = Number(item?.price_per_unit || 0);
  return salePrice + 0.001 < catalogPrice;
}

/** CRM position discount on a line item — stamp must not accrue for that item. */
export function isPositionLoyaltyStampBlocked(item) {
  if (isPositionSalePriceReduced(item)) {
    return true;
  }

  const manualDiscount = Number(item?.manual_discount_amount ?? 0);
  return Number.isFinite(manualDiscount) && manualDiscount > 0;
}

export function awardLoyaltyForOrder(orderId) {
  if (!orderId) {
    return { awarded: false, reason: "missing_order_id" };
  }

  const alreadyAwarded = db
    .prepare(
      `
      SELECT 1
      FROM customer_loyalty_ledger
      WHERE order_id = ? AND reason = 'earned_from_order'
      LIMIT 1
    `,
    )
    .get(orderId);

  if (alreadyAwarded) {
    return { awarded: false, reason: "already_awarded" };
  }

  const order = db
    .prepare(
      `
      SELECT *
      FROM orders
      WHERE id = ?
    `,
    )
    .get(orderId);

  if (!order?.customer_id) {
    return { awarded: false, reason: "no_customer" };
  }

  if (!["delivered", "completed"].includes(order.status)) {
    return { awarded: false, reason: "status_not_final" };
  }

  if (String(order.promo_code_text || "").trim()) {
    return { awarded: false, reason: "promo_applied" };
  }

  const categories = getLoyaltyCategories();
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const mappingLookup = getMappings();
  const items = db
    .prepare(
      `
      SELECT oi.*, p.categoryId AS category_id, p.groupId AS group_id
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ?
      ORDER BY oi.rowid ASC
    `,
    )
    .all(orderId);

  const earnedRows = [];
  for (const item of items) {
    const loyaltyCategoryId = resolveLoyaltyCategoryId(item, mappingLookup);
    const category = loyaltyCategoryId ? categoryById.get(loyaltyCategoryId) || null : null;
    if (!category?.active) {
      continue;
    }

    if (isPositionLoyaltyStampBlocked(item)) {
      continue;
    }

    const quantity = Math.max(0, Number(item.quantity || 0));
    const loyaltyUnitsApplied = Math.max(0, Number(item.loyalty_units_applied || 0));
    const delta = Math.max(quantity - loyaltyUnitsApplied, 0);
    if (delta <= 0) {
      continue;
    }

    earnedRows.push({
      loyaltyCategoryId,
      orderItemId: item.id,
      delta,
    });
  }

  if (!earnedRows.length) {
    return { awarded: false, reason: "nothing_to_award" };
  }

  for (const row of earnedRows) {
    changeCustomerBalance({
      customerId: order.customer_id,
      loyaltyCategoryId: row.loyaltyCategoryId,
      delta: row.delta,
      reason: "earned_from_order",
      orderId,
      orderItemId: row.orderItemId,
    });
  }

  return { awarded: true, rows: earnedRows.length };
}

export function serializeLoyaltySnapshot(snapshot) {
  const categories = snapshot.map((category) => ({
    id: category.id,
    key: category.key,
    title: category.title,
    description: category.description,
    threshold: category.threshold,
    discount_amount: category.discount_amount,
    balance: category.balance,
    available_bonus_count: category.available_bonus_count,
    remaining_to_next: category.remaining_to_next,
    active: category.active,
  }));

  return {
    categories,
    has_available_bonus: categories.some(
      (category) => Number(category.available_bonus_count || 0) > 0,
    ),
  };
}
