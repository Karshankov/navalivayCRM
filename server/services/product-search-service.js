import { db } from '../db.js';
import { resolveFirstImageThumbnail } from './image-thumbnail-service.js';

const RU_TO_LAT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

const EN_TO_RU_KEYS = {
  q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з',
  '[': 'х', ']': 'ъ', a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о',
  k: 'л', l: 'д', ';': 'ж', "'": 'э', z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и',
  n: 'т', m: 'ь', ',': 'б', '.': 'ю',
};

const SEARCH_ALIASES = new Map([
  ['catswil', ['catswill']],
  ['catswilll', ['catswill']],
  ['zene', ['зелен', 'zelen']],
  ['zelene', ['зелен', 'zelen']],
  ['zelenoe', ['зелен', 'zelen']],
  ['persik', ['персик']],
  ['lit', ['lit']],
  ['energy', ['energy']],
]);

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function transliterateRuToLat(value) {
  return normalizeText(value).replace(/[а-я]/g, (char) => RU_TO_LAT[char] ?? char);
}

function keyboardEnToRu(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[a-z[\];',.]/g, (char) => EN_TO_RU_KEYS[char] ?? char);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function buildSearchTokens(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  const baseTokens = normalized.split(/\s+/).filter((token) => token.length >= 2);
  const expanded = [];
  for (const token of baseTokens) {
    expanded.push(token);
    expanded.push(transliterateRuToLat(token));
    expanded.push(normalizeText(keyboardEnToRu(token)));
    const aliases = SEARCH_ALIASES.get(token) || [];
    expanded.push(...aliases.map(normalizeText));
  }
  return unique(expanded).filter((token) => token.length >= 2);
}

function escapeFtsToken(token) {
  const clean = normalizeText(token).replace(/"/g, ' ').trim();
  if (!clean || /\s/.test(clean)) return null;
  return `"${clean}"*`;
}

function buildSearchText(parts) {
  const raw = parts.filter(Boolean).join(' ');
  return unique([
    normalizeText(raw),
    transliterateRuToLat(raw),
    normalizeText(keyboardEnToRu(raw)),
  ]).join(' ');
}

export function rebuildProductSearchIndex() {
  const regularRows = db.prepare(`
    SELECT
      p.id AS product_id,
      NULL AS variant_id,
      0 AS is_variant,
      p.categoryId AS category_id,
      p.groupId AS group_id,
      p.title,
      p.description,
      c.name AS category_name,
      c.slug AS category_slug,
      g.name AS group_name,
      g.slug AS group_slug
    FROM products p
    LEFT JOIN categories c ON c.id = p.categoryId
    LEFT JOIN category_groups g ON g.id = p.groupId
    WHERE COALESCE(p.has_variants, 0) = 0
  `).all();

  const variantRows = db.prepare(`
    SELECT
      p.id AS product_id,
      v.id AS variant_id,
      1 AS is_variant,
      p.categoryId AS category_id,
      p.groupId AS group_id,
      p.title || ' ' || COALESCE(v.name, '') AS title,
      p.description,
      v.name AS variant_name,
      c.name AS category_name,
      c.slug AS category_slug,
      g.name AS group_name,
      g.slug AS group_slug
    FROM product_variants v
    INNER JOIN products p ON p.id = v.product_id
    LEFT JOIN categories c ON c.id = p.categoryId
    LEFT JOIN category_groups g ON g.id = p.groupId
    WHERE COALESCE(p.has_variants, 0) = 1
  `).all();

  const insert = db.prepare(`
    INSERT INTO product_search_index (
      item_id, product_id, variant_id, is_variant, category_id, group_id,
      title, searchable_text, normalized_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rows) => {
    db.prepare('DELETE FROM product_search_index').run();
    for (const row of rows) {
      const itemId = row.variant_id || row.product_id;
      const searchableText = buildSearchText([
        row.title,
        row.description,
        row.variant_name,
        row.category_name,
        row.category_slug,
        row.group_name,
        row.group_slug,
      ]);
      insert.run(
        itemId,
        row.product_id,
        row.variant_id || null,
        Number(row.is_variant || 0),
        row.category_id || '',
        row.group_id || null,
        normalizeText(row.title),
        searchableText,
        searchableText,
      );
    }
    db.prepare(`
      INSERT INTO product_search_meta (key, value)
      VALUES ('rebuilt_at', DATETIME('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run();
  });

  tx([...regularRows, ...variantRows]);
}

function ensureSearchIndexReady() {
  const row = db.prepare("SELECT value FROM product_search_meta WHERE key = 'rebuilt_at'").get();
  const count = db.prepare('SELECT COUNT(*) AS count FROM product_search_index').get()?.count || 0;
  if (!row || count === 0) {
    rebuildProductSearchIndex();
  }
}

function findIndexRows({ search, limit, offset = 0, categoryId, groupId, location, includeVariants = true, maxLimit = 200 }) {
  ensureSearchIndexReady();
  const normalizedSearch = normalizeText(search);
  const tokens = buildSearchTokens(normalizedSearch);
  const safeLimit = Math.min(Math.max(Number(limit || 25), 1), Number(maxLimit));
  const safeOffset = Math.max(Math.trunc(Number(offset) || 0), 0);
  const params = [];
  const filters = [];

  if (categoryId) {
    filters.push('category_id = ?');
    params.push(String(categoryId));
  }
  if (groupId) {
    filters.push('group_id = ?');
    params.push(String(groupId));
  }
  if (!includeVariants) {
    filters.push('is_variant = 0');
  }
  if (location === 'retail' || location === 'warehouse') {
    const stockColumn = location === 'warehouse' ? 'warehouse_stock' : 'stock';
    filters.push(`(
      (product_search_index.is_variant = 0 AND EXISTS (
        SELECT 1 FROM products location_product
        WHERE location_product.id = product_search_index.product_id
          AND COALESCE(location_product.${stockColumn}, 0) > 0
      ))
      OR (product_search_index.is_variant = 1 AND EXISTS (
        SELECT 1 FROM product_variants location_variant
        WHERE location_variant.id = product_search_index.variant_id
          AND COALESCE(location_variant.${stockColumn}, 0) > 0
      ))
    )`);
  }

  let rows = [];
  if (tokens.length > 0) {
    const matchQuery = unique(tokens.map(escapeFtsToken)).filter(Boolean).join(' OR ');
    if (matchQuery) {
      rows = db.prepare(`
        SELECT *, bm25(product_search_index) AS rank
        FROM product_search_index
        WHERE product_search_index MATCH ?
          ${filters.length ? `AND ${filters.join(' AND ')}` : ''}
        ORDER BY rank, title COLLATE NOCASE, item_id
        LIMIT ? OFFSET ?
      `).all(matchQuery, ...params, safeLimit, safeOffset);
    }
  } else {
    rows = db.prepare(`
      SELECT *, 0 AS rank
      FROM product_search_index
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY title COLLATE NOCASE, item_id
      LIMIT ? OFFSET ?
    `).all(...params, safeLimit, safeOffset);

    return rows;
  }

  return rows;
}

function fetchProductDetails(indexRows) {
  const regularIds = indexRows.filter((row) => Number(row.is_variant) === 0).map((row) => row.product_id);
  const variantIds = indexRows.filter((row) => Number(row.is_variant) === 1).map((row) => row.variant_id);
  const byItemId = new Map();

  if (regularIds.length > 0) {
    const placeholders = regularIds.map(() => '?').join(',');
    db.prepare(`
      SELECT
        p.*,
        c.name AS category_name,
        c.cover_image AS category_image,
        g.name AS group_name,
        g.slug AS group_slug,
        g.cover_image AS group_image,
        (SELECT url FROM product_images WHERE productId = p.id AND variant_id IS NULL ORDER BY position LIMIT 1) AS first_image
      FROM products p
      LEFT JOIN categories c ON c.id = p.categoryId
      LEFT JOIN category_groups g ON g.id = p.groupId
      WHERE p.id IN (${placeholders})
    `).all(...regularIds).forEach((row) => {
      byItemId.set(row.id, row);
    });
  }

  if (variantIds.length > 0) {
    const placeholders = variantIds.map(() => '?').join(',');
    db.prepare(`
      SELECT
        v.id,
        v.product_id,
        v.name AS variant_name,
        v.color_code,
        v.price_rub,
        v.stock,
        v.warehouse_stock,
        (SELECT COALESCE(SUM(all_variants.stock + all_variants.warehouse_stock), 0)
         FROM product_variants all_variants
         WHERE all_variants.product_id = p.id) AS base_total_stock,
        p.id AS base_product_id,
        p.title AS base_product_title,
        p.description,
        p.cost_price,
        p.min_stock,
        p.categoryId,
        c.name AS category_name,
        c.cover_image AS category_image,
        p.groupId,
        g.name AS group_name,
        g.slug AS group_slug,
        g.cover_image AS group_image,
        (SELECT url FROM product_images WHERE productId = p.id AND (variant_id = v.id OR variant_id IS NULL) ORDER BY variant_id DESC, position LIMIT 1) AS first_image
      FROM product_variants v
      INNER JOIN products p ON p.id = v.product_id
      LEFT JOIN categories c ON c.id = p.categoryId
      LEFT JOIN category_groups g ON g.id = p.groupId
      WHERE v.id IN (${placeholders})
    `).all(...variantIds).forEach((row) => {
      byItemId.set(row.id, row);
    });
  }

  return byItemId;
}

async function toCrmSearchDto(indexRow, detail) {
  const isVariant = Number(indexRow.is_variant) === 1;
  if (isVariant) {
    const imageUrl = await resolveFirstImageThumbnail([
      { source: detail?.first_image, meta: { sourceType: 'product', sourceId: detail.product_id, sourceField: 'product_images.url' } },
      { source: detail?.group_image, meta: { sourceType: 'group', sourceId: detail.groupId, sourceField: 'category_groups.cover_image' } },
      { source: detail?.category_image, meta: { sourceType: 'category', sourceId: detail.categoryId, sourceField: 'categories.cover_image' } },
    ]);
    return {
      id: detail.id,
      product_id: detail.product_id,
      title: `${detail.base_product_title} (${detail.variant_name})`,
      description: detail.description ?? null,
      variant_name: detail.variant_name,
      color_code: detail.color_code,
      priceRub: detail.price_rub,
      cost_price: detail.cost_price,
      stock: detail.stock,
      warehouse_stock: detail.warehouse_stock,
      total_stock: detail.base_total_stock,
      min_stock: detail.min_stock,
      categoryId: detail.categoryId,
      category_name: detail.category_name,
      groupId: detail.groupId,
      group_name: detail.group_name,
      groupSlug: detail.group_slug,
      has_variants: 0,
      is_variant: true,
      imageUrl,
      thumbnailUrl: imageUrl,
      image: imageUrl,
    };
  }

  const imageUrl = await resolveFirstImageThumbnail([
    { source: detail?.first_image, meta: { sourceType: 'product', sourceId: detail.id, sourceField: 'product_images.url' } },
    { source: detail?.group_image, meta: { sourceType: 'group', sourceId: detail.groupId, sourceField: 'category_groups.cover_image' } },
    { source: detail?.category_image, meta: { sourceType: 'category', sourceId: detail.categoryId, sourceField: 'categories.cover_image' } },
  ]);
  return {
    id: detail.id,
    title: detail.title,
    description: detail.description,
    priceRub: detail.priceRub,
    cost_price: detail.cost_price,
    stock: detail.stock,
    warehouse_stock: detail.warehouse_stock,
    total_stock: Number(detail.stock || 0) + Number(detail.warehouse_stock || 0),
    min_stock: detail.min_stock,
    categoryId: detail.categoryId,
    category_name: detail.category_name,
    groupId: detail.groupId,
    group_name: detail.group_name,
    groupSlug: detail.group_slug,
    has_variants: detail.has_variants,
    is_variant: false,
    imageUrl,
    thumbnailUrl: imageUrl,
    image: imageUrl,
  };
}

export async function searchProductsForCrm(options = {}) {
  const requestedLimit = Math.min(Math.max(Number(options.limit || 25), 1), 200);
  const rawOffset = Number(options.offset);
  const requestedOffset = Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0;
  const rows = findIndexRows({
    search: options.search,
    limit: requestedLimit,
    offset: requestedOffset,
    maxLimit: 200,
    categoryId: options.categoryId,
    groupId: options.groupId,
    location: options.location,
    includeVariants: true,
  });
  const details = fetchProductDetails(rows);
  const eligibleRows = rows.filter((row) => {
    const detail = details.get(row.item_id);
    if (!detail) return false;
    if (options.location === 'retail') return Number(detail.stock || 0) > 0;
    if (options.location === 'warehouse') return Number(detail.warehouse_stock || 0) > 0;
    return true;
  }).slice(0, requestedLimit);

  return (await Promise.all(eligibleRows
    .map(async (row) => {
      const detail = details.get(row.item_id);
      return detail ? await toCrmSearchDto(row, detail) : null;
    })))
    .filter(Boolean);
}

export function searchProductsForAdmin(options = {}) {
  const page = Math.max(Number(options.page || 1), 1);
  const limit = Math.min(Math.max(Number(options.limit || 20), 1), 100);
  const allRows = findIndexRows({
    search: options.search,
    limit: 1000,
    maxLimit: 1000,
    categoryId: options.categoryId,
    groupId: options.groupId,
    location: options.location === 'warehouse' ? 'warehouse' : undefined,
    includeVariants: true,
  });
  const searchDetails = fetchProductDetails(allRows);
  const productIds = [];
  const seenProductIds = new Set();
  for (const row of allRows) {
    const detail = searchDetails.get(row.item_id);
    if (!detail) continue;
    if (options.location === 'warehouse' && Number(detail.warehouse_stock || 0) <= 0) continue;
    const productId = String(row.product_id);
    if (seenProductIds.has(productId)) continue;
    seenProductIds.add(productId);
    productIds.push(productId);
  }

  const pagedProductIds = productIds.slice((page - 1) * limit, page * limit);
  let productRows = [];
  if (pagedProductIds.length) {
    const placeholders = pagedProductIds.map(() => '?').join(',');
    productRows = db.prepare(`
      SELECT
        p.*,
        c.name AS category_name,
        c.cover_image AS category_image,
        g.name AS group_name,
        g.slug AS group_slug,
        g.cover_image AS group_image
      FROM products p
      LEFT JOIN categories c ON c.id = p.categoryId
      LEFT JOIN category_groups g ON g.id = p.groupId
      WHERE p.id IN (${placeholders})
    `).all(...pagedProductIds);
    const orderById = new Map(pagedProductIds.map((id, index) => [id, index]));
    productRows.sort((a, b) => orderById.get(a.id) - orderById.get(b.id));
  }

  const products = productRows
    .map((row) => ({
      id: row.id,
      categoryId: row.categoryId,
      groupId: row.groupId,
      title: row.title,
      priceRub: row.priceRub,
      description: row.description,
      strength: row.strength,
      stock: row.stock,
      warehouseStock: row.warehouse_stock,
      createdAt: row.createdAt,
      categoryName: row.category_name,
      categoryImage: null,
      groupName: row.group_name,
      groupSlug: row.group_slug,
      groupImage: null,
      costPrice: row.cost_price,
      minStock: row.min_stock,
      useCategoryImage: row.use_category_image,
      hasVariants: row.has_variants,
    }));

  return {
    products,
    pagination: {
      page,
      limit,
      total: productIds.length,
      totalPages: Math.max(1, Math.ceil(productIds.length / limit)),
    },
  };
}

export function syncProductSearchIndex() {
  rebuildProductSearchIndex();
}
