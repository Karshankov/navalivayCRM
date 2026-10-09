/**
 * Каталожная цена единицы: цена варианта, если она задана и больше нуля, иначе
 * цена самого товара. Ноль у варианта означает «цена лежит на товаре», а не
 * «отдаём даром», поэтому `??` здесь не годится — он откатывается только с
 * null, и вкус с price_rub = 0 уехал бы в заказ бесплатно.
 *
 * Возвращает 0, если каталожной цены нет вовсе. Что с этим делать, решает
 * вызывающий: витрина показывает товар без цены, а оформление заказа обязано
 * отказать.
 */
export function resolveCatalogUnitPrice(variantPrice, productPrice) {
  const variant = Number(variantPrice);
  if (Number.isFinite(variant) && variant > 0) return variant;
  const product = Number(productPrice);
  return Number.isFinite(product) && product > 0 ? product : 0;
}

/**
 * Resolves the unit price for a catalog line when building order_items
 * (e.g. demo orders). Devices often have priceRub=0 on the product row and
 * store the retail price on product_variants.price_rub.
 */
export function resolveOrderLinePrice(db, productId, { variantId = null, variantName = null } = {}) {
  const product = db.prepare(`
    SELECT id, title, priceRub AS price_rub
    FROM products
    WHERE id = ?
  `).get(productId);

  if (!product) {
    throw new Error(`Товар не найден: ${productId}`);
  }

  let resolvedVariantId = variantId || null;
  let resolvedVariantName = variantName || null;
  let priceRub = Number(product.price_rub || 0);

  if (resolvedVariantId || resolvedVariantName) {
    const variant = resolvedVariantId
      ? db.prepare(`
          SELECT id, name, price_rub
          FROM product_variants
          WHERE id = ? AND product_id = ?
        `).get(resolvedVariantId, productId)
      : db.prepare(`
          SELECT id, name, price_rub
          FROM product_variants
          WHERE product_id = ? AND name = ?
        `).get(productId, resolvedVariantName);

    if (!variant) {
      throw new Error(
        `Вариант не найден для ${productId}: ${resolvedVariantId || resolvedVariantName}`,
      );
    }

    resolvedVariantId = variant.id;
    resolvedVariantName = variant.name;
    if (Number(variant.price_rub) > 0) {
      priceRub = Number(variant.price_rub);
    }
  }

  return {
    product_id: product.id,
    product_title: product.title,
    price_rub: priceRub,
    variant_id: resolvedVariantId,
    variant_name: resolvedVariantName,
  };
}

export function sumOrderLinePrices(lines) {
  return lines.reduce((sum, line) => sum + Number(line.price_rub || 0), 0);
}

export function sumReviewLineItemTotals(items) {
  return items.reduce((sum, item) => sum + Number(item.total_price || 0), 0);
}