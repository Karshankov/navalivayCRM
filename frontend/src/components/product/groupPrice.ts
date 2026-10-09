import type { Product, ProductVariant } from "@/stores/catalog";

type PriceGroupNode = {
  products?: Product[];
  children?: PriceGroupNode[];
};

export function hasPositivePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function getSafeVariants(product: Product): ProductVariant[] {
  if (!Array.isArray(product.variants)) return [];
  return product.variants.filter(
    (variant): variant is ProductVariant => Boolean(variant),
  );
}

type PricedItem = {
  priceRub?: number | null;
  oldPriceRub?: number | null;
  hasDiscount?: boolean;
};

/** Цена, по которой позиция продаётся сейчас. */
function effectivePriceOf(item: PricedItem): number | null {
  return item.priceRub ?? null;
}

/**
 * Цена до скидки. Нужна там, где скидка отдельной позиции не должна утягивать
 * за собой цену всей линейки: подешевел один вкус, а на обложке стоит цена,
 * по которой продаются остальные.
 */
function basePriceOf(item: PricedItem): number | null {
  const oldPrice = Number(item.oldPriceRub ?? 0);
  if (item.hasDiscount && oldPrice > 0) return oldPrice;
  return item.priceRub ?? null;
}

function getProductPrices(
  product: Product,
  pick: (item: PricedItem) => number | null = effectivePriceOf,
): number[] {
  if (product.hasVariants) {
    const variantsWithPrice = getSafeVariants(product).filter((variant) =>
      hasPositivePrice(pick(variant)),
    );

    if (!variantsWithPrice.length) {
      const own = pick(product);
      return hasPositivePrice(own) ? [own] : [];
    }

    const inStockVariants = variantsWithPrice.filter(
      (variant) => typeof variant.stock !== "number" || variant.stock > 0,
    );
    const source = inStockVariants.length ? inStockVariants : variantsWithPrice;

    return source.map(pick).filter(hasPositivePrice);
  }

  const own = pick(product);
  return hasPositivePrice(own) ? [own] : [];
}

export function getMinPriceForProducts(products: Product[]): number | null {
  const prices = products.flatMap((product) => getProductPrices(product));
  if (!prices.length) return null;
  return Math.min(...prices);
}

/** Минимальная цена линейки без учёта скидок на отдельные позиции. */
export function getMinBasePriceForProducts(products: Product[]): number | null {
  const prices = products.flatMap((product) => getProductPrices(product, basePriceOf));
  if (!prices.length) return null;
  return Math.min(...prices);
}

export function getMinPriceForGroupTree(node: PriceGroupNode): number | null {
  const ownMinPrice = getMinPriceForProducts(node.products || []);
  const childMinPrices = (node.children || [])
    .map(getMinPriceForGroupTree)
    .filter((price): price is number => price !== null);

  const prices = [
    ...(ownMinPrice !== null ? [ownMinPrice] : []),
    ...childMinPrices,
  ];

  if (!prices.length) return null;
  return Math.min(...prices);
}

/**
 * Минимум, который нужен, чтобы понять «есть ли скидка». Отдельный тип нужен
 * фильтру раздела: там линейки описаны урезанной формой товара, полного
 * `Product` у него нет.
 */
type DiscountableProduct = {
  hasDiscount?: boolean;
  variants?: Array<{ hasDiscount?: boolean } | null | undefined> | null;
};

/**
 * Скидка у товара или у любого его вкуса: скидка на отдельный вкус не поднимает
 * флаг у самого товара, поэтому одного `hasDiscount` мало.
 */
export function hasDiscountForProduct(product: DiscountableProduct): boolean {
  if (product.hasDiscount) return true;
  const variants = Array.isArray(product.variants) ? product.variants : [];
  return variants.some((variant) => variant?.hasDiscount);
}

/**
 * Подешевело ли у товара вообще всё. У товара с цветами это значит «каждый
 * цвет со скидкой»: если подешевел один цвет из десяти, цена линейки на
 * обложке меняться не должна, остальные продаются по-старому.
 */
export function isFullyDiscountedProduct(product: Product): boolean {
  const variants = getSafeVariants(product).filter((variant) =>
    hasPositivePrice(variant.priceRub),
  );
  if (variants.length) return variants.every((variant) => variant.hasDiscount);
  return Boolean(product.hasDiscount);
}

/** Есть ли скидка где-то в линейке, включая вложенные линейки. */
export function hasDiscountInTree(node: PriceGroupNode): boolean {
  return (node.products || []).some(hasDiscountForProduct)
    || (node.children || []).some(hasDiscountInTree);
}

/**
 * Цену позиции прячем, когда она совпадает с ценой линейки, чтобы не дублировать
 * одно и то же число. Но скидочная позиция цену показывает всегда: именно рядом
 * с ней живут зачёркнутая старая цена и процент.
 */
export function shouldShowPrice(
  item: { priceRub?: number | null; hasDiscount?: boolean },
  reference: number | null,
): boolean {
  if (!hasPositivePrice(item.priceRub)) return false;
  return Boolean(item.hasDiscount) || item.priceRub !== reference;
}

/** Глубина скидки в процентах. Одна формула на витрину и на админку. */
export function discountPercent(basePrice: number, discountPrice: number): number {
  if (!Number.isFinite(basePrice) || basePrice <= 0) return 0;
  return Math.round(((basePrice - discountPrice) / basePrice) * 100);
}
