import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { db } from '../db.js';
import { posAuthMiddleware, issuePosToken, verifyPassword } from '../auth.js';
import { roundMoney } from '../utils/money.js';
import { computeCheckTotals, resolvePosPrice } from '../utils/pos-pricing.js';
import {
  addPosCardOperation,
  checkManualCardFits,
  reversePosCardOperation,
  toMinorUnits,
} from '../utils/card-payment-service.js';

/**
 * Касса (POS) — экран, замаскированный под рабочее место продавца.
 *
 * Через неё продаётся два вида товаров:
 *
 *   1. Товары каталога, которые менеджер явно опубликовал на кассу в карточке
 *      категории или линейки. Остатки и себестоимость берутся из основной CRM,
 *      цена считается по настройке публикации (utils/pos-pricing.js).
 *   2. «Свои» товары, заведённые прямо с экрана через плюсик. Они живут в
 *      собственной таблице `pos_products` и в каталог CRM не попадают — иначе
 *      касса засоряла бы витрину и поиск закупок.
 *
 * Расходятся только остатки: кассовый товар тратит `pos_products.quantity`,
 * товар каталога — `products.stock` / `product_variants.stock`.
 *
 * Касса намеренно НЕ применяет скидки каталога и бонусы: это отдельный контур
 * денег, и подстановка акционной цены тут ломала бы «итого» в чеке.
 *
 * Финансовая модель не меняется: чек по-прежнему одна строка в `pos_sales`
 * (`price`, `cost_price`, `profit`), поэтому «Обзор» и закрытие дня читают его
 * без правок. Позиции в `pos_sale_items` нужны для расшифровки чека и возврата
 * остатков при удалении.
 */
export const posRouter = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Кассовое фото кладём в uploads/pos. Другие каталоги загрузок
// (см. server/upload.js) читаются сервисом миниатюр по UPLOADS_DIR, а здесь
// картинка отдаётся как есть через /uploads — путь одинаковый.
const POS_UPLOAD_DIR = path.resolve(__dirname, '../../uploads/pos');
const MAX_POS_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// Сколько товаров показывать в сетке по умолчанию и каким может быть максимум.
const POS_CATALOG_DEFAULT_LIMIT = 24;
const POS_CATALOG_MAX_LIMIT = 60;

// Helper для генерации ID
function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Helper для получения следующего номера продажи
function getNextSaleNumber() {
  const row = db.prepare('SELECT MAX(sale_number) as maxNum FROM pos_sales').get();
  return (row?.maxNum || 0) + 1;
}

function getPosCashAccount() {
  return db.prepare(`
    SELECT *
    FROM cash_accounts
    WHERE active = 1
    ORDER BY is_default DESC, created_at ASC
    LIMIT 1
  `).get();
}

function buildPosTransactionDescription(sale) {
  return `Продажа касса #${sale.sale_number}: ${sale.product_name}`;
}

function adjustAccountBalanceForTransaction(transaction, mode = 'apply') {
  if (!transaction?.account_id || !transaction?.amount) {
    return;
  }

  if (mode === 'apply') {
    if (transaction.type === 'income') {
      db.prepare('UPDATE cash_accounts SET balance = balance + ? WHERE id = ?')
        .run(transaction.amount, transaction.account_id);
    } else if (transaction.type === 'expense') {
      db.prepare('UPDATE cash_accounts SET balance = balance - ? WHERE id = ?')
        .run(transaction.amount, transaction.account_id);
    }
    return;
  }

  if (transaction.type === 'income') {
    db.prepare('UPDATE cash_accounts SET balance = balance - ? WHERE id = ?')
      .run(transaction.amount, transaction.account_id);
  } else if (transaction.type === 'expense') {
    db.prepare('UPDATE cash_accounts SET balance = balance + ? WHERE id = ?')
      .run(transaction.amount, transaction.account_id);
  }
}

function createPosCashTransaction(sale) {
  const account = getPosCashAccount();
  if (!account) {
    throw new Error('cash_account_not_found');
  }

  const transactionId = generateId('trans');

  db.prepare(`
    INSERT INTO cash_transactions (id, account_id, type, amount, description, employee_id)
    VALUES (?, ?, 'income', ?, ?, ?)
  `).run(
    transactionId,
    account.id,
    sale.price,
    buildPosTransactionDescription(sale),
    sale.employee_id || null,
  );

  adjustAccountBalanceForTransaction(
    { account_id: account.id, amount: sale.price, type: 'income' },
    'apply',
  );

  db.prepare('UPDATE pos_sales SET transaction_id = ? WHERE id = ?')
    .run(transactionId, sale.id);
}

function updatePosCashTransaction(sale) {
  if (!sale.transaction_id) {
    createPosCashTransaction(sale);
    return;
  }

  const transaction = db.prepare('SELECT * FROM cash_transactions WHERE id = ?').get(sale.transaction_id);
  if (!transaction) {
    db.prepare('UPDATE pos_sales SET transaction_id = NULL WHERE id = ?').run(sale.id);
    createPosCashTransaction(sale);
    return;
  }

  adjustAccountBalanceForTransaction(transaction, 'revert');

  db.prepare(`
    UPDATE cash_transactions
    SET amount = ?, description = ?, employee_id = ?
    WHERE id = ?
  `).run(
    sale.price,
    buildPosTransactionDescription(sale),
    sale.employee_id || null,
    transaction.id,
  );

  adjustAccountBalanceForTransaction(
    { ...transaction, amount: sale.price, type: 'income' },
    'apply',
  );
}

function deletePosCashTransaction(transactionId) {
  if (!transactionId) {
    return;
  }

  const transaction = db.prepare('SELECT * FROM cash_transactions WHERE id = ?').get(transactionId);
  if (!transaction) {
    return;
  }

  db.prepare('DELETE FROM cash_transactions WHERE id = ?').run(transactionId);
  adjustAccountBalanceForTransaction(transaction, 'revert');
}

function sanitizeOptionalText(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// =========================
// Публикация на кассу и кассовая цена
// =========================

function loadPublicationMap() {
  const rows = db.prepare('SELECT * FROM pos_publications').all();
  const byScope = { category: new Map(), group: new Map() };
  for (const row of rows) {
    const bucket = byScope[row.scope];
    if (!bucket) continue;
    bucket.set(row.target_id, row);
  }
  return byScope;
}

function isPublished(publicationMap, { categoryId, groupId }) {
  if (groupId && publicationMap.group.has(groupId)) return true;
  if (categoryId && publicationMap.category.has(categoryId)) return true;
  return false;
}

function priceForPublication(publicationMap, { retail, categoryId, groupId }) {
  return resolvePosPrice({
    retail,
    groupPublication: groupId ? publicationMap.group.get(groupId) : null,
    categoryPublication: categoryId ? publicationMap.category.get(categoryId) : null,
  });
}

/**
 * Настройка публикации — единый вид на API. Поле `published` производное:
 * в базе его нет намеренно, потому что «опубликовано» и «есть цена» —
 * одно и то же действие менеджера.
 */
function normalizePublicationPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const published = raw.published === true || raw.published === 1;
  if (!published) {
    return { published: false, fixed_price: null, markup_amount: null, markup_percent: null };
  }
  const fixedPrice = toNumberOrNull(raw.fixed_price ?? raw.fixedPrice);
  const markupAmount = toNumberOrNull(raw.markup_amount ?? raw.markupAmount);
  const markupPercent = toNumberOrNull(raw.markup_percent ?? raw.markupPercent);

  if (fixedPrice !== null && fixedPrice <= 0) throw new Error('invalid_fixed_price');
  if (markupAmount !== null && markupAmount < 0) throw new Error('invalid_markup_amount');
  if (markupPercent !== null && (markupPercent < 0 || markupPercent > 1000)) {
    throw new Error('invalid_markup_percent');
  }

  return {
    published: true,
    fixed_price: fixedPrice,
    markup_amount: markupAmount,
    markup_percent: markupPercent,
  };
}

export function savePosPublication(scope, targetId, payload) {
  if (!['category', 'group'].includes(scope)) throw new Error('invalid_scope');
  const normalized = normalizePublicationPayload(payload);
  if (!normalized) return;

  if (!normalized.published) {
    db.prepare('DELETE FROM pos_publications WHERE scope = ? AND target_id = ?')
      .run(scope, targetId);
    return;
  }

  db.prepare(`
    INSERT INTO pos_publications (scope, target_id, fixed_price, markup_amount, markup_percent)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(scope, target_id) DO UPDATE SET
      fixed_price = excluded.fixed_price,
      markup_amount = excluded.markup_amount,
      markup_percent = excluded.markup_percent
  `).run(
    scope,
    targetId,
    normalized.fixed_price,
    normalized.markup_amount,
    normalized.markup_percent,
  );
}

function publicationForResponse(scope, targetId, map = null) {
  const publicationMap = map || loadPublicationMap();
  const bucket = scope === 'category' ? publicationMap.category : publicationMap.group;
  const row = bucket.get(targetId);
  if (!row) {
    return { published: false, fixed_price: null, markup_amount: null, markup_percent: null };
  }
  return {
    published: true,
    fixed_price: row.fixed_price,
    markup_amount: row.markup_amount,
    markup_percent: row.markup_percent,
  };
}

/** Добавить `pos_publication` в ответ списков категорий и линеек. */
export function attachPosPublications(scope, rows) {
  const map = loadPublicationMap();
  return rows.map((row) => ({
    ...row,
    pos_publication: publicationForResponse(scope, row.id, map),
  }));
}

// =========================
// Каталог на кассе
// =========================

function fetchPosCatalogFromCatalog({ search = '', limit = POS_CATALOG_DEFAULT_LIMIT, offset = 0 }) {
  const publicationMap = loadPublicationMap();
  if (publicationMap.category.size === 0 && publicationMap.group.size === 0) {
    return [];
  }

  const normalized = String(search || '').trim().toLowerCase();
  const like = `%${normalized}%`;

  // Товары с вариантами и без собираем вместе: на кассе важна конкретная
  // позиция, которую можно отдать в руки, а не «карточка с вкусами».
  const rows = db.prepare(`
    SELECT
      'product' AS kind,
      p.id AS product_id,
      NULL AS variant_id,
      p.title AS title,
      NULL AS variant_name,
      p.priceRub AS retail_price,
      p.cost_price AS cost_price,
      COALESCE(p.stock, 0) AS stock,
      p.categoryId AS category_id,
      p.groupId AS group_id,
      c.name AS category_name,
      g.name AS group_name,
      (SELECT url FROM product_images WHERE productId = p.id AND variant_id IS NULL ORDER BY position LIMIT 1) AS image_url,
      g.cover_image AS group_image,
      c.cover_image AS category_image
    FROM products p
    LEFT JOIN categories c ON c.id = p.categoryId
    LEFT JOIN category_groups g ON g.id = p.groupId
    WHERE COALESCE(p.has_variants, 0) = 0
      AND COALESCE(p.stock, 0) > 0
      AND (? = '' OR LOWER(COALESCE(p.title, '')) LIKE ?)

    UNION ALL

    SELECT
      'variant' AS kind,
      p.id AS product_id,
      v.id AS variant_id,
      p.title AS title,
      v.name AS variant_name,
      COALESCE(v.price_rub, p.priceRub) AS retail_price,
      p.cost_price AS cost_price,
      COALESCE(v.stock, 0) AS stock,
      p.categoryId AS category_id,
      p.groupId AS group_id,
      c.name AS category_name,
      g.name AS group_name,
      (SELECT url FROM product_images
        WHERE productId = p.id AND (variant_id = v.id OR variant_id IS NULL)
        ORDER BY variant_id DESC, position LIMIT 1) AS image_url,
      g.cover_image AS group_image,
      c.cover_image AS category_image
    FROM product_variants v
    INNER JOIN products p ON p.id = v.product_id
    LEFT JOIN categories c ON c.id = p.categoryId
    LEFT JOIN category_groups g ON g.id = p.groupId
    WHERE COALESCE(p.has_variants, 0) = 1
      AND COALESCE(v.stock, 0) > 0
      AND (? = '' OR LOWER(COALESCE(p.title, '') || ' ' || COALESCE(v.name, '')) LIKE ?)
  `).all(normalized, like, normalized, like);

  const visible = [];
  for (const row of rows) {
    if (!isPublished(publicationMap, { categoryId: row.category_id, groupId: row.group_id })) {
      continue;
    }
    let pricing;
    try {
      pricing = priceForPublication(publicationMap, {
        retail: row.retail_price,
        categoryId: row.category_id,
        groupId: row.group_id,
      });
    } catch {
      // Битую цену в каталоге не показываем: продать её всё равно нельзя.
      continue;
    }
    visible.push({
      id: row.variant_id || row.product_id,
      source: 'catalog',
      product_id: row.product_id,
      variant_id: row.variant_id,
      title: row.variant_name ? `${row.title} · ${row.variant_name}` : row.title,
      base_title: row.title,
      variant_name: row.variant_name,
      price: pricing.price,
      retail_price: pricing.basePrice,
      price_reason: pricing.reason,
      cost_price: roundMoney(Number(row.cost_price) || 0),
      stock: Number(row.stock) || 0,
      category_name: row.category_name,
      group_name: row.group_name,
      image_url: row.image_url || row.group_image || row.category_image || null,
    });
  }

  // Дешёвые позиции выше: расходники продаются чаще, а искать их на кассе
  // среди жидкостей за 35 ₽ никто не станет.
  visible.sort((a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    return String(a.title).localeCompare(String(b.title), 'ru');
  });

  return visible.slice(offset, offset + limit);
}

function fetchPosCustomProducts({ search = '', limit = POS_CATALOG_DEFAULT_LIMIT, offset = 0 }) {
  const normalized = String(search || '').trim().toLowerCase();
  const like = `%${normalized}%`;
  const rows = db.prepare(`
    SELECT *
    FROM pos_products
    WHERE (? = '' OR LOWER(title) LIKE ?)
    ORDER BY updated_at DESC, created_at DESC
    LIMIT ? OFFSET ?
  `).all(normalized, like, limit, offset);

  return rows.map((row) => ({
    id: row.id,
    source: 'custom',
    pos_product_id: row.id,
    title: row.title,
    price: roundMoney(Number(row.retail_price) || 0),
    retail_price: roundMoney(Number(row.retail_price) || 0),
    price_reason: 'custom',
    cost_price: roundMoney(Number(row.cost_price) || 0),
    stock: Number(row.quantity) || 0,
    image_url: row.image_url,
  }));
}

// =========================
// POS SALES (Продажи через кассу)
// =========================

// Получить все POS-продажи (с фильтрами)
posRouter.get('/api/admin/pos/sales', posAuthMiddleware, (req, res) => {
  try {
    const { status, from, to, limit = 100, offset = 0 } = req.query;

    let whereClause = '1=1';
    const params = [];

    if (status && ['completed', 'pending'].includes(status)) {
      whereClause += ' AND ps.status = ?';
      params.push(status);
    }

    if (from) {
      whereClause += ' AND ps.created_at >= ?';
      params.push(from);
    }

    if (to) {
      whereClause += ' AND ps.created_at < ?';
      params.push(to);
    }

    const sales = db.prepare(`
      SELECT 
        ps.*,
        e.first_name || ' ' || e.last_name as employee_name
      FROM pos_sales ps
      LEFT JOIN employees e ON e.id = ps.employee_id
      WHERE ${whereClause}
      ORDER BY ps.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit, 10), parseInt(offset, 10));

    const countResult = db.prepare(`
      SELECT COUNT(*) as total FROM pos_sales ps WHERE ${whereClause}
    `).get(...params);

    res.json({
      sales,
      total: countResult.total,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
  } catch (error) {
    console.error('[pos] Get sales error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Получить только отложенные чеки
posRouter.get('/api/admin/pos/pending', posAuthMiddleware, (req, res) => {
  try {
    // LEFT JOIN customers — чтобы показывать привязанного клиента в списке
    // отложенных чеков (иначе кассир, возвращаясь к чеку через час, не
    // понимает чей это).
    const sales = db.prepare(`
      SELECT
        ps.*,
        e.first_name || ' ' || e.last_name as employee_name,
        c.first_name as customer_first_name,
        c.last_name as customer_last_name,
        c.phone as customer_phone,
        c.telegram_username as customer_telegram_username
      FROM pos_sales ps
      LEFT JOIN employees e ON e.id = ps.employee_id
      LEFT JOIN customers c ON c.id = ps.customer_id
      WHERE ps.status = 'pending'
      ORDER BY ps.created_at DESC
    `).all();

    res.json(sales);
  } catch (error) {
    console.error('[pos] Get pending sales error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Получить статистику POS за период
posRouter.get('/api/admin/pos/stats', posAuthMiddleware, (req, res) => {
  try {
    const { from, to } = req.query;

    let whereClause = "status = 'completed'";
    const params = [];

    if (from) {
      whereClause += ' AND created_at >= ?';
      params.push(from);
    }

    if (to) {
      whereClause += ' AND created_at < ?';
      params.push(to);
    }

    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_sales,
        COALESCE(SUM(price), 0) as total_revenue,
        COALESCE(SUM(profit), 0) as total_profit,
        COALESCE(SUM(cost_price), 0) as total_cost
      FROM pos_sales
      WHERE ${whereClause}
    `).get(...params);

    const pendingCount = db.prepare(`
      SELECT COUNT(*) as count FROM pos_sales WHERE status = 'pending'
    `).get();

    res.json({
      ...stats,
      pending_count: pendingCount.count,
    });
  } catch (error) {
    console.error('[pos] Get stats error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Создать продажу (однотоварный путь, оставлен для совместимости)
posRouter.post('/api/admin/pos/sales', posAuthMiddleware, (req, res) => {
  try {
    const { product_name, price, cost_price, notes, employee_id, customer_id } = req.body;

    if (!product_name || typeof product_name !== 'string' || !product_name.trim()) {
      return res.status(400).json({ error: 'product_name_required' });
    }

    if (price === undefined || price === null || !Number.isFinite(Number(price)) || Number(price) <= 0) {
      return res.status(400).json({ error: 'invalid_price' });
    }

    // customer_id опционален — POS-чеки могут оставаться анонимными.
    // Если передан — проверяем что клиент существует, чтобы не получить
    // болтающуюся ссылку на удалённую запись.
    let resolvedCustomerId = null;
    if (customer_id) {
      const customer = db
        .prepare('SELECT id FROM customers WHERE id = ?')
        .get(String(customer_id));
      if (!customer) {
        return res.status(400).json({ error: 'invalid_customer_id' });
      }
      resolvedCustomerId = customer.id;
    }

    const id = generateId('pos');
    const saleNumber = getNextSaleNumber();
    const priceNum = roundMoney(Number(price));
    const now = new Date().toISOString();

    let status = 'pending';
    let profit = null;
    let costPriceNum = null;
    let completedAt = null;

    if (cost_price !== undefined && cost_price !== null && cost_price !== '') {
      costPriceNum = roundMoney(Number(cost_price));
      if (!Number.isFinite(costPriceNum)) {
        return res.status(400).json({ error: 'invalid_cost_price' });
      }

      status = 'completed';
      profit = roundMoney(priceNum - costPriceNum);
      completedAt = now;
    }

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO pos_sales (
          id, sale_number, product_name, price, cost_price, profit,
          status, notes, employee_id, customer_id, created_at, completed_at,
          subtotal, discount_percent, payment_method, stock_deducted
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'cash', 0)
      `).run(
        id,
        saleNumber,
        product_name.trim(),
        priceNum,
        costPriceNum,
        profit,
        status,
        notes || null,
        employee_id || null,
        resolvedCustomerId,
        now,
        completedAt,
        priceNum,
      );

      let sale = db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(id);
      if (sale.status === 'completed') {
        createPosCashTransaction(sale);
        sale = db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(id);
      }

      return sale;
    });

    const sale = tx();
    res.json(sale);
  } catch (error) {
    console.error('[pos] Create sale error:', error);
    if (error.message === 'cash_account_not_found') {
      return res.status(400).json({ error: 'cash_account_not_found' });
    }
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// =========================
// Сессия экрана кассы
// =========================

/**
 * Открытие кассовой сессии: поле «Поиск по штрихкоду» на заблокированном
 * экране проверяет введённую строку как ключ кассы. Это тот же пароль
 * администратора, но в ответ выдаётся не админский токен, а кассовый:
 * экран кассы не должен открывать CRM.
 *
 * Про сам факт проверки на экране не пишем ничего — наружу это выглядит как
 * обычный поиск по штрихкоду, который ничего не нашёл.
 */
posRouter.post('/api/admin/pos/session', async (req, res) => {
  try {
    const key = typeof req.body?.key === 'string' ? req.body.key : '';
    if (!key) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const ok = await verifyPassword(key);
    if (!ok) {
      // 401 с кодом unauthorized: экран кассы молча чистит поле и ждёт
      // следующий штрихкод, как будто поиск не нашёл товар.
      return res.status(401).json({ error: 'unauthorized' });
    }
    const keyId = generateId('posk');
    const token = issuePosToken(keyId);
    const cookieOptions = {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/admin/pos',
      maxAge: 12 * 60 * 60 * 1000,
    };
    if (process.env.NODE_ENV === 'production') {
      cookieOptions.secure = true;
    }
    res.cookie('navalivay_pos', token, cookieOptions);
    // Токен в теле нужен одностраничнику: он шлёт Authorization-заголовок.
    res.json({ ok: true, token, key_id: keyId, role: 'pos' });
  } catch (error) {
    console.error('[pos] Session error:', error);
    res.status(500).json({ error: 'failed' });
  }
});

// =========================
// Каталог и свои товары
// =========================

posRouter.get('/api/admin/pos/catalog', posAuthMiddleware, (req, res) => {
  try {
    const search = sanitizeOptionalText(req.query.search) || '';
    const source = String(req.query.source || 'all');
    const limit = Math.min(
      Math.max(Number(req.query.limit) || POS_CATALOG_DEFAULT_LIMIT, 1),
      POS_CATALOG_MAX_LIMIT,
    );
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const custom = source === 'catalog' ? [] : fetchPosCustomProducts({ search, limit, offset });
    const catalog = source === 'custom' ? [] : fetchPosCatalogFromCatalog({ search, limit, offset });

    res.json({
      items: [...custom, ...catalog],
      has_more: custom.length + catalog.length >= limit,
    });
  } catch (error) {
    console.error('[pos] Get catalog error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

posRouter.get('/api/admin/pos/products', posAuthMiddleware, (req, res) => {
  try {
    const search = sanitizeOptionalText(req.query.search) || '';
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const items = fetchPosCustomProducts({ search, limit, offset });
    const total = db.prepare(`
      SELECT COUNT(*) AS total FROM pos_products
      WHERE (? = '' OR LOWER(title) LIKE ?)
    `).get(search.toLowerCase(), `%${search.toLowerCase()}%`).total;
    res.json({ items, total });
  } catch (error) {
    console.error('[pos] Get products error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

posRouter.post('/api/admin/pos/products', posAuthMiddleware, (req, res) => {
  try {
    const title = sanitizeOptionalText(req.body?.title);
    const costPrice = toNumberOrNull(req.body?.cost_price ?? req.body?.costPrice);
    const retailPrice = toNumberOrNull(req.body?.retail_price ?? req.body?.retailPrice);
    const quantity = toNumberOrNull(req.body?.quantity);
    const imageUrl = sanitizeOptionalText(req.body?.image_url ?? req.body?.imageUrl);

    if (!title) return res.status(400).json({ error: 'title_required' });
    if (retailPrice === null || retailPrice <= 0) {
      return res.status(400).json({ error: 'invalid_retail_price' });
    }
    if (costPrice !== null && costPrice < 0) {
      return res.status(400).json({ error: 'invalid_cost_price' });
    }
    if (quantity !== null && (!Number.isInteger(quantity) || quantity < 0)) {
      return res.status(400).json({ error: 'invalid_quantity' });
    }

    const id = generateId('posp');
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO pos_products (
        id, title, cost_price, retail_price, quantity, image_url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      title,
      roundMoney(costPrice ?? 0),
      roundMoney(retailPrice),
      quantity ?? 0,
      imageUrl,
      now,
      now,
    );

    const created = db.prepare('SELECT * FROM pos_products WHERE id = ?').get(id);
    res.json(created);
  } catch (error) {
    console.error('[pos] Create product error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

posRouter.patch('/api/admin/pos/products/:id', posAuthMiddleware, (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM pos_products WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const updates = {};
    if (req.body?.title !== undefined) {
      const title = sanitizeOptionalText(req.body.title);
      if (!title) return res.status(400).json({ error: 'title_required' });
      updates.title = title;
    }
    if (req.body?.cost_price !== undefined || req.body?.costPrice !== undefined) {
      const costPrice = toNumberOrNull(req.body.cost_price ?? req.body.costPrice);
      if (costPrice === null || costPrice < 0) {
        return res.status(400).json({ error: 'invalid_cost_price' });
      }
      updates.cost_price = roundMoney(costPrice);
    }
    if (req.body?.retail_price !== undefined || req.body?.retailPrice !== undefined) {
      const retailPrice = toNumberOrNull(req.body.retail_price ?? req.body.retailPrice);
      if (retailPrice === null || retailPrice <= 0) {
        return res.status(400).json({ error: 'invalid_retail_price' });
      }
      updates.retail_price = roundMoney(retailPrice);
    }
    if (req.body?.quantity !== undefined) {
      // Абсолютное значение, а не приход: менеджер вбивает реальное наличие
      // («было 5, приехало 5 → ставим 10»). Приход пришлось бы считать в уме.
      const quantity = toNumberOrNull(req.body.quantity);
      if (quantity === null || !Number.isInteger(quantity) || quantity < 0) {
        return res.status(400).json({ error: 'invalid_quantity' });
      }
      updates.quantity = quantity;
    }
    if (req.body?.image_url !== undefined || req.body?.imageUrl !== undefined) {
      updates.image_url = sanitizeOptionalText(req.body.image_url ?? req.body.imageUrl);
    }

    if (Object.keys(updates).length === 0) {
      return res.json(existing);
    }

    updates.updated_at = new Date().toISOString();
    const setClause = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
    db.prepare(`UPDATE pos_products SET ${setClause} WHERE id = ?`)
      .run(...Object.values(updates), existing.id);

    res.json(db.prepare('SELECT * FROM pos_products WHERE id = ?').get(existing.id));
  } catch (error) {
    console.error('[pos] Update product error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

posRouter.delete('/api/admin/pos/products/:id', posAuthMiddleware, (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM pos_products WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    // Удалённый товар, который уже лежит в чеке, превратил бы историю продаж
    // в строки без источника. Поэтому такой товар не удаляем, только
    // обнуляем остаток — история и отчёты остаются целыми.
    const used = db.prepare('SELECT 1 AS used FROM pos_sale_items WHERE pos_product_id = ? LIMIT 1')
      .get(existing.id);
    if (used) {
      return res.status(409).json({ error: 'pos_product_in_use' });
    }

    db.prepare('DELETE FROM pos_products WHERE id = ?').run(existing.id);
    res.json({ ok: true });
  } catch (error) {
    console.error('[pos] Delete product error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Загрузка фото для «своего» товара. Экран кассы открыт без входа в CRM,
// поэтому обычный /api/admin/upload сюда не годится — он требует токен.
const posImageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(POS_UPLOAD_DIR, { recursive: true });
    cb(null, POS_UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const posImageUpload = multer({
  storage: posImageStorage,
  limits: { fileSize: MAX_POS_PRODUCT_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_IMAGE_EXTENSIONS.has(ext) || !String(file.mimetype).startsWith('image/')) {
      const error = new Error('invalid_file_type');
      error.code = 'INVALID_FILE_TYPE';
      return cb(error);
    }
    return cb(null, true);
  },
});

posRouter.post('/api/admin/pos/upload', posAuthMiddleware, (req, res) => {
  posImageUpload.single('file')(req, res, (error) => {
    if (error) {
      const code = error.code === 'LIMIT_FILE_SIZE'
        ? 'file_too_large'
        : error.code === 'INVALID_FILE_TYPE'
          ? 'invalid_file_type'
          : 'upload_failed';
      return res.status(400).json({ error: code });
    }
    if (!req.file) return res.status(400).json({ error: 'file_required' });
    return res.json({ ok: true, url: `/uploads/pos/${req.file.filename}` });
  });
});

// =========================
// Проведение чека с позициями
// =========================

/**
 * Разрешить позицию чека на сервере. Цену и себестоимость клиент не присылает:
 * он присылает только «что и сколько», а всё остальное берётся из базы, чтобы
 * подмена цены в запросе не меняла чек и прибыль.
 */
function resolveCheckLine(publicationMap, rawItem) {
  const quantity = Number(rawItem?.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw Object.assign(new Error('invalid_quantity'), { code: 'invalid_quantity' });
  }

  const source = String(rawItem?.source || '');
  if (source === 'custom') {
    const posProduct = db.prepare('SELECT * FROM pos_products WHERE id = ?')
      .get(String(rawItem?.pos_product_id ?? rawItem?.posProductId ?? ''));
    if (!posProduct) {
      throw Object.assign(new Error('pos_product_not_found'), { code: 'pos_product_not_found' });
    }
    if (Number(posProduct.quantity) < quantity) {
      throw Object.assign(new Error('insufficient_stock'), {
        code: 'insufficient_stock',
        item: { title: posProduct.title, available: Number(posProduct.quantity), requested: quantity },
      });
    }
    return {
      source: 'custom',
      pos_product_id: posProduct.id,
      product_id: null,
      variant_id: null,
      title: posProduct.title,
      variant_name: null,
      unitPrice: roundMoney(Number(posProduct.retail_price) || 0),
      catalogPrice: roundMoney(Number(posProduct.retail_price) || 0),
      costPrice: roundMoney(Number(posProduct.cost_price) || 0),
      quantity,
      discountAmount: toNumberOrNull(rawItem?.discount_amount ?? rawItem?.discountAmount) ?? 0,
      discountPercent: toNumberOrNull(rawItem?.discount_percent ?? rawItem?.discountPercent) ?? 0,
    };
  }

  if (source !== 'catalog') {
    throw Object.assign(new Error('invalid_source'), { code: 'invalid_source' });
  }

  const variantId = sanitizeOptionalText(rawItem?.variant_id ?? rawItem?.variantId);
  const productId = sanitizeOptionalText(rawItem?.product_id ?? rawItem?.productId);

  let product = null;
  let variant = null;
  if (variantId) {
    variant = db.prepare('SELECT * FROM product_variants WHERE id = ?').get(variantId);
    if (!variant) {
      throw Object.assign(new Error('catalog_item_unavailable'), {
        code: 'catalog_item_unavailable',
        item: { title: null, requested: quantity },
      });
    }
    product = db.prepare('SELECT * FROM products WHERE id = ?').get(variant.product_id);
  } else if (productId) {
    product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  }

  if (!product) {
    throw Object.assign(new Error('catalog_item_unavailable'), {
      code: 'catalog_item_unavailable',
      item: { title: null, requested: quantity },
    });
  }

  if (!isPublished(publicationMap, { categoryId: product.categoryId, groupId: product.groupId })) {
    throw Object.assign(new Error('catalog_item_not_published'), {
      code: 'catalog_item_not_published',
      item: { title: product.title, requested: quantity },
    });
  }

  const available = Number(variant ? variant.stock : product.stock) || 0;
  if (available < quantity) {
    throw Object.assign(new Error('insufficient_stock'), {
      code: 'insufficient_stock',
      item: {
        title: variant ? `${product.title} · ${variant.name}` : product.title,
        available,
        requested: quantity,
      },
    });
  }

  const retail = variant && variant.price_rub !== null && variant.price_rub !== undefined
    ? Number(variant.price_rub)
    : Number(product.priceRub);
  const pricing = priceForPublication(publicationMap, {
    retail,
    categoryId: product.categoryId,
    groupId: product.groupId,
  });

  return {
    source: 'catalog',
    pos_product_id: null,
    product_id: product.id,
    variant_id: variant ? variant.id : null,
    title: product.title || 'Товар',
    variant_name: variant ? variant.name : null,
    unitPrice: pricing.price,
    catalogPrice: pricing.price,
    costPrice: roundMoney(Number(product.cost_price) || 0),
    quantity,
    discountAmount: toNumberOrNull(rawItem?.discount_amount ?? rawItem?.discountAmount) ?? 0,
    discountPercent: toNumberOrNull(rawItem?.discount_percent ?? rawItem?.discountPercent) ?? 0,
  };
}

function buildSaleTitle(lines) {
  if (lines.length === 1) {
    const line = lines[0];
    return line.variant_name ? `${line.title} · ${line.variant_name}` : line.title;
  }
  const first = lines[0];
  const firstTitle = first.variant_name ? `${first.title} · ${first.variant_name}` : first.title;
  return `${firstTitle} и ещё ${lines.length - 1}`;
}

function deductStockForLine(line) {
  if (line.source === 'custom') {
    const result = db.prepare(`
      UPDATE pos_products
      SET quantity = quantity - ?, updated_at = ?
      WHERE id = ? AND quantity >= ?
    `).run(line.quantity, new Date().toISOString(), line.pos_product_id, line.quantity);
    if (result.changes === 0) {
      // Остаток увели между проверкой и списанием (или в том же чеке дважды
      // одну позицию). Транзакция откатится целиком.
      throw Object.assign(new Error('insufficient_stock'), {
        code: 'insufficient_stock',
        item: { title: line.title, available: 0, requested: line.quantity },
      });
    }
    return;
  }

  if (line.variant_id) {
    const result = db.prepare('UPDATE product_variants SET stock = stock - ? WHERE id = ? AND stock >= ?')
      .run(line.quantity, line.variant_id, line.quantity);
    if (result.changes === 0) {
      throw Object.assign(new Error('insufficient_stock'), {
        code: 'insufficient_stock',
        item: { title: line.title, available: 0, requested: line.quantity },
      });
    }
    return;
  }

  const result = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?')
    .run(line.quantity, line.product_id, line.quantity);
  if (result.changes === 0) {
    throw Object.assign(new Error('insufficient_stock'), {
      code: 'insufficient_stock',
      item: { title: line.title, available: 0, requested: line.quantity },
    });
  }
}

function restoreStockForItem(item) {
  if (!item) return;
  if (item.source === 'custom' && item.pos_product_id) {
    db.prepare('UPDATE pos_products SET quantity = quantity + ?, updated_at = ? WHERE id = ?')
      .run(item.quantity, new Date().toISOString(), item.pos_product_id);
    return;
  }
  if (item.variant_id) {
    db.prepare('UPDATE product_variants SET stock = stock + ? WHERE id = ?')
      .run(item.quantity, item.variant_id);
    return;
  }
  if (item.product_id) {
    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?')
      .run(item.quantity, item.product_id);
  }
}

function loadSaleItems(saleId) {
  return db.prepare(`
    SELECT * FROM pos_sale_items WHERE sale_id = ? ORDER BY rowid
  `).all(saleId);
}

function attachItems(sales) {
  const list = Array.isArray(sales) ? sales : [sales];
  const ids = list.map((sale) => sale?.id).filter(Boolean);
  const bySale = new Map();
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT * FROM pos_sale_items WHERE sale_id IN (${placeholders}) ORDER BY rowid
    `).all(...ids);
    for (const row of rows) {
      if (!bySale.has(row.sale_id)) bySale.set(row.sale_id, []);
      bySale.get(row.sale_id).push(row);
    }
  }
  const decorated = list.map((sale) => (sale ? { ...sale, items: bySale.get(sale.id) || [] } : sale));
  return Array.isArray(sales) ? decorated : decorated[0];
}

posRouter.post('/api/admin/pos/sales/check', posAuthMiddleware, (req, res) => {
  try {
    const payload = req.body || {};
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    if (rawItems.length === 0) {
      return res.status(400).json({ error: 'items_required' });
    }

    const paymentMethod = payload.payment_method === 'card' || payload.paymentMethod === 'card'
      ? 'card'
      : 'cash';

    const checkDiscountAmount = toNumberOrNull(payload.discount_amount ?? payload.discountAmount) ?? 0;
    const checkDiscountPercent = toNumberOrNull(payload.discount_percent ?? payload.discountPercent) ?? 0;
    if (checkDiscountAmount < 0) return res.status(400).json({ error: 'invalid_discount' });
    if (checkDiscountPercent < 0 || checkDiscountPercent > 100) {
      return res.status(400).json({ error: 'invalid_discount' });
    }

    const idempotencyKey = sanitizeOptionalText(
      req.header('Idempotency-Key') || payload.idempotency_key || payload.idempotencyKey,
    );

    let resolvedCustomerId = null;
    if (payload.customer_id) {
      const customer = db.prepare('SELECT id FROM customers WHERE id = ?')
        .get(String(payload.customer_id));
      if (!customer) return res.status(400).json({ error: 'invalid_customer_id' });
      resolvedCustomerId = customer.id;
    }

    if (idempotencyKey) {
      const existing = db.prepare('SELECT * FROM pos_sales WHERE idempotency_key = ?')
        .get(idempotencyKey);
      if (existing) {
        return res.json(attachItems(existing));
      }
    }

    const publicationMap = loadPublicationMap();
    const lines = rawItems.map((item) => resolveCheckLine(publicationMap, item));
    const totals = computeCheckTotals(lines, {
      checkDiscountAmount,
      checkDiscountPercent,
    });

    const id = generateId('pos');
    const now = new Date().toISOString();
    const paymentMethodLabel = paymentMethod === 'card' ? 'карта' : 'наличные';

    const tx = db.transaction(() => {
      // Идемпотентность проверяем ещё раз уже внутри транзакции: два быстрых
      // нажатия «Провести» приходят почти одновременно и до вставки оба
      // могут увидеть отсутствие ключа.
      if (idempotencyKey) {
        const raced = db.prepare('SELECT id FROM pos_sales WHERE idempotency_key = ?')
          .get(idempotencyKey);
        if (raced) {
          throw Object.assign(new Error('duplicate_check'), { code: 'duplicate_check', saleId: raced.id });
        }
      }

      let cardSnapshot = null;
      if (paymentMethod === 'card') {
        const cardCheck = checkManualCardFits(toMinorUnits(totals.total));
        if (!cardCheck.ok) {
          throw Object.assign(new Error(cardCheck.reason), {
            code: cardCheck.reason,
            cardSnapshot: cardCheck.snapshot,
            exceededByMinor: cardCheck.exceededByMinor,
          });
        }
        cardSnapshot = cardCheck.snapshot;
      }

      const saleNumber = getNextSaleNumber();
      // Ключ кассовой сессии: у чека, проведённого с заблокированного
      // экрана, потом можно понять, с какой сменой/устройством он был.
      // Менеджеру в CRM поле остаётся NULL.
      const posKeyId = req.user?.r === 'pos' ? (req.user.k ?? null) : null;
      db.prepare(`
        INSERT INTO pos_sales (
          id, sale_number, product_name, price, cost_price, profit,
          status, notes, employee_id, customer_id, created_at, completed_at,
          subtotal, discount_percent, payment_method, stock_deducted, idempotency_key, pos_key_id
        ) VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        id,
        saleNumber,
        buildSaleTitle(lines),
        totals.total,
        totals.costTotal,
        totals.profit,
        sanitizeOptionalText(payload.notes) ?? `Оплата: ${paymentMethodLabel}`,
        null,
        resolvedCustomerId,
        now,
        now,
        totals.subtotal,
        roundMoney(checkDiscountPercent),
        paymentMethod,
        idempotencyKey,
        posKeyId,
      );

      const insertItem = db.prepare(`
        INSERT INTO pos_sale_items (
          id, sale_id, source, product_id, variant_id, pos_product_id,
          title, variant_name, unit_price, catalog_price, cost_price,
          quantity, discount_amount, line_total, line_cost
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      totals.lines.forEach((line, index) => {
        const resolved = lines[index];
        insertItem.run(
          generateId('posi'),
          id,
          resolved.source,
          resolved.product_id,
          resolved.variant_id,
          resolved.pos_product_id,
          resolved.title,
          resolved.variant_name,
          resolved.unitPrice,
          resolved.catalogPrice,
          resolved.costPrice,
          resolved.quantity,
          roundMoney(line.discountAmount + line.checkDiscountShare),
          line.finalTotal,
          line.lineCost,
        );
        deductStockForLine(resolved);
      });

      if (paymentMethod === 'card') {
        addPosCardOperation({
          posSaleId: id,
          amountMinor: toMinorUnits(totals.total),
          note: `Касса #${saleNumber}`,
        });
        cardSnapshot = checkManualCardFits(toMinorUnits(totals.total)).snapshot ?? cardSnapshot;
      } else {
        const created = db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(id);
        createPosCashTransaction(created);
      }

      return cardSnapshot;
    });

    tx();

    const sale = db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(id);
    res.json(attachItems(sale));
  } catch (error) {
    if (error.code === 'duplicate_check' && error.saleId) {
      const sale = db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(error.saleId);
      return res.json(attachItems(sale));
    }
    if (error.code === 'insufficient_stock') {
      return res.status(409).json({ error: 'insufficient_stock', item: error.item });
    }
    if (error.code === 'catalog_item_unavailable' || error.code === 'catalog_item_not_published'
      || error.code === 'pos_product_not_found') {
      return res.status(409).json({ error: error.code, item: error.item });
    }
    if (error.code === 'card_limit_exceeded') {
      return res.status(409).json({
        error: 'card_limit_exceeded',
        exceeded_by_minor: error.exceededByMinor,
        remaining_today_minor: error.cardSnapshot?.remaining_today_minor ?? 0,
      });
    }
    if (error.code === 'invalid_quantity' || error.code === 'invalid_source') {
      return res.status(400).json({ error: error.code, item: error.item });
    }
    if (error.message === 'cash_account_not_found') {
      return res.status(400).json({ error: 'cash_account_not_found' });
    }
    if (error.message === 'invalid_retail_price') {
      return res.status(400).json({ error: 'invalid_retail_price' });
    }
    console.error('[pos] Check sale error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Обновить продажу (дозаполнить себестоимость)
posRouter.patch('/api/admin/pos/sales/:id', posAuthMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { product_name, price, cost_price, notes } = req.body;

    const existing = db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'not_found' });
    }

    // Проведённый через кассу чек уже списал остатки и записал деньги.
    // Поменять в нём цену — это молча разойтись с каталогом и с карточным
    // лимитом. Такой чек удаляют и проводят заново.
    if (Number(existing.stock_deducted) === 1) {
      return res.status(409).json({ error: 'pos_check_edit_forbidden' });
    }

    if (price !== undefined && (!Number.isFinite(Number(price)) || Number(price) <= 0)) {
      return res.status(400).json({ error: 'invalid_price' });
    }

    const tx = db.transaction(() => {
      const updates = {};
      const now = new Date().toISOString();

      if (product_name !== undefined) {
        updates.product_name = product_name.trim();
      }

      if (price !== undefined) {
        updates.price = roundMoney(Number(price));
        updates.subtotal = roundMoney(Number(price));
      }

      if (notes !== undefined) {
        updates.notes = notes || null;
      }

      const nextPrice = updates.price !== undefined ? updates.price : existing.price;

      if (cost_price !== undefined && cost_price !== null && cost_price !== '') {
        const costPriceNum = roundMoney(Number(cost_price));
        if (!Number.isFinite(costPriceNum)) {
          throw new Error('invalid_cost_price');
        }

        updates.cost_price = costPriceNum;
        updates.profit = roundMoney(nextPrice - costPriceNum);
        updates.status = 'completed';
        updates.completed_at = existing.completed_at || now;
      } else if (updates.price !== undefined && existing.status === 'completed' && existing.cost_price !== null) {
        updates.profit = roundMoney(nextPrice - existing.cost_price);
      }

      const setClauses = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
      const values = Object.values(updates);

      if (setClauses) {
        db.prepare(`UPDATE pos_sales SET ${setClauses} WHERE id = ?`).run(...values, id);
      }

      let sale = db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(id);

      if (sale.status === 'completed') {
        updatePosCashTransaction(sale);
        sale = db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(id);
      } else if (sale.transaction_id) {
        deletePosCashTransaction(sale.transaction_id);
        db.prepare('UPDATE pos_sales SET transaction_id = NULL WHERE id = ?').run(id);
        sale = db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(id);
      }

      return sale;
    });

    const sale = tx();
    res.json(sale);
  } catch (error) {
    console.error('[pos] Update sale error:', error);
    if (error.message === 'cash_account_not_found' || error.message === 'invalid_cost_price') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Удалить продажу — и вместе с ней вернуть остатки, карту и деньги
posRouter.delete('/api/admin/pos/sales/:id', posAuthMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'not_found' });
    }

    const tx = db.transaction(() => {
      const items = loadSaleItems(existing.id);

      if (Number(existing.stock_deducted) === 1) {
        for (const item of items) {
          restoreStockForItem(item);
        }
      }

      if (existing.payment_method === 'card') {
        reversePosCardOperation(existing.id);
      } else if (existing.transaction_id) {
        deletePosCashTransaction(existing.transaction_id);
      }

      db.prepare('DELETE FROM pos_sale_items WHERE sale_id = ?').run(existing.id);
      db.prepare('DELETE FROM pos_sales WHERE id = ?').run(existing.id);
    });

    tx();

    res.json({ ok: true });
  } catch (error) {
    console.error('[pos] Delete sale error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Расшифровка состава чека — отдельным запросом, чтобы список продаж оставался лёгким
posRouter.get('/api/admin/pos/sales/:id/items', posAuthMiddleware, (req, res) => {
  try {
    const sale = db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(req.params.id);
    if (!sale) return res.status(404).json({ error: 'not_found' });
    res.json({ sale, items: loadSaleItems(sale.id) });
  } catch (error) {
    console.error('[pos] Get sale items error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});