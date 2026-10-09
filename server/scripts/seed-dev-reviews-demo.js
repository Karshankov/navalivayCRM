/**
 * Demo data for local review + order history flow testing.
 *
 * Usage:
 *   node server/scripts/seed-dev-reviews-demo.js
 *   node server/scripts/seed-dev-reviews-demo.js --telegram-id=900000001
 *   node server/scripts/seed-dev-reviews-demo.js --telegram-id=2035055116 --username=rk0ff
 *   node server/scripts/seed-dev-reviews-demo.js --reset
 *   node server/scripts/seed-dev-reviews-demo.js --simple   # только 2 линейки, без микса категорий
 *
 * Then open in browser (dev mock):
 *   http://localhost:5173/?telegram_id=900000001&username=review_demo&first_name=Review%20Demo
 */
import { initDb, db } from '../db.js';
import { migrateProductReviews } from '../migrations/add_product_reviews.js';

const DEFAULT_TELEGRAM_ID = '900000001';
const DEFAULT_USERNAME = 'review_demo';
const DEFAULT_FIRST_NAME = 'Review Demo';
const DEMO_ORDER_NOTE = '[dev-reviews-demo]';

function readArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function nextOrderNumber() {
  const row = db.prepare('SELECT COALESCE(MAX(order_number), 0) + 1 AS n FROM orders').get();
  return Number(row?.n || 1);
}

const MIXED_CATEGORY_NAMES = [
  'Жидкости',
  'Расходники',
  'Снюс и пластины',
  'Устройства',
];

function pickProductForCategory(categoryName) {
  return db.prepare(`
    SELECT
      p.id AS product_id,
      p.title AS product_title,
      p.priceRub AS price_rub,
      p.groupId AS group_id,
      cg.name AS group_name,
      cg.categoryId AS category_id,
      c.name AS category_name,
      c.storefront_filters_profile
    FROM products p
    JOIN category_groups cg ON cg.id = p.groupId
    JOIN categories c ON c.id = p.categoryId
    WHERE p.groupId IS NOT NULL AND c.name = ?
    ORDER BY cg.[order], p.title
    LIMIT 1
  `).get(categoryName);
}

/** Смешанный заказ: по одной позиции из разных категорий (жидкости, расходники, снюс, устройства). */
function pickMixedCatalogLines(categoryNames = MIXED_CATEGORY_NAMES) {
  const lines = [];
  const missing = [];

  for (const categoryName of categoryNames) {
    const row = pickProductForCategory(categoryName);
    if (row) {
      lines.push(row);
    } else {
      missing.push(categoryName);
    }
  }

  if (lines.length === 0) {
    throw new Error('В каталоге нет товаров для демо-заказа.');
  }

  if (missing.length > 0) {
    console.warn(`[seed-dev-reviews-demo] Не найдены товары для категорий: ${missing.join(', ')}`);
  }

  return lines;
}

function pickCatalogLines(limit = 2) {
  const rows = db.prepare(`
    SELECT
      p.id AS product_id,
      p.title AS product_title,
      p.priceRub AS price_rub,
      p.groupId AS group_id,
      cg.name AS group_name,
      cg.categoryId AS category_id,
      c.name AS category_name,
      c.storefront_filters_profile
    FROM products p
    JOIN category_groups cg ON cg.id = p.groupId
    JOIN categories c ON c.id = p.categoryId
    WHERE p.groupId IS NOT NULL
    GROUP BY p.groupId
    ORDER BY c.[order], cg.[order], p.title
    LIMIT ?
  `).all(limit);

  if (rows.length === 0) {
    throw new Error('В каталоге нет товаров с groupId — нечего положить в демо-заказ.');
  }
  return rows;
}

/** 3 доп. кнопки на каждую оценку для жидкостей (демо: Ананасовая шипучка). */
function ensureLiquidsQuickTags() {
  db.prepare(`DELETE FROM review_quick_tags WHERE category_key = 'liquids'`).run();

  const tagsByStar = {
    5: ['Яркий вкус', 'Мягко в горло', 'Беру снова'],
    4: ['Вкус нравится', 'Крепость ровная', 'Хорошее качество'],
    3: ['Нормально', 'Средняя крепость', 'Без сюрпризов'],
    2: ['Вкус слабый', 'Крепость не та', 'Ожидал больше'],
    1: ['Не зашёл вкус', 'Слишком крепко', 'Не советую'],
  };

  const insert = db.prepare(`
    INSERT INTO review_quick_tags (id, category_key, star_rating, label, insert_text, sort_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);

  let sortOrder = 0;
  for (const star of [5, 4, 3, 2, 1]) {
    for (const [index, label] of tagsByStar[star].entries()) {
      insert.run(
        `rqt_liquids_${star}_${index + 1}`,
        'liquids',
        star,
        label,
        label,
        sortOrder,
      );
      sortOrder += 1;
    }
  }
}

function resetDemoForCustomer(customerId) {
  const orderIds = db.prepare(`
    SELECT id FROM orders
    WHERE customer_id = ? AND notes = ?
  `).all(customerId, DEMO_ORDER_NOTE).map((row) => row.id);

  if (!orderIds.length) return;

  const placeholders = orderIds.map(() => '?').join(', ');
  db.prepare(`DELETE FROM product_reviews WHERE order_id IN (${placeholders})`).run(...orderIds);
  db.prepare(`DELETE FROM order_items WHERE order_id IN (${placeholders})`).run(...orderIds);
  db.prepare(`DELETE FROM orders WHERE id IN (${placeholders})`).run(...orderIds);
}

initDb();
migrateProductReviews();

const telegramId = readArg('telegram-id', DEFAULT_TELEGRAM_ID);
const telegramUsername = readArg('username', DEFAULT_USERNAME);
const firstName = readArg('first-name', DEFAULT_FIRST_NAME);
const reset = hasFlag('reset') || !hasFlag('no-reset');
const useSimple = hasFlag('simple');

const now = new Date().toISOString();

const tx = db.transaction(() => {
  const existing = db.prepare('SELECT id FROM customers WHERE telegram_id = ?').get(telegramId);
  const customerId = existing?.id || `cust_dev_reviews_${telegramId}`;

  if (existing) {
    db.prepare(`
      UPDATE customers
      SET telegram_username = ?, first_name = ?, reviews_opt_out = 0, updated_at = ?
      WHERE id = ?
    `).run(telegramUsername, firstName, now, customerId);
  } else {
    db.prepare(`
      INSERT INTO customers (
        id, telegram_id, telegram_username, first_name,
        reviews_opt_out, reviews_prefer_anonymous, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 0, 0, ?, ?)
    `).run(customerId, telegramId, telegramUsername, firstName, now, now);
  }

  if (reset) {
    resetDemoForCustomer(customerId);
  }

  const lines = useSimple ? pickCatalogLines(2) : pickMixedCatalogLines();
  const orderId = `order_dev_reviews_${Date.now()}`;
  const orderNumber = nextOrderNumber();
  const total = lines.reduce((sum, line) => sum + Number(line.price_rub || 0), 0);

  const submittedAt = new Date(Date.now() - 8 * 60 * 1000).toISOString();
  const readyAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const issuedAt = now;

  db.prepare(`
    INSERT INTO orders (
      id, order_number, customer_id, status, delivery_type, delivery_address,
      total_amount, discount_amount, final_amount, notes, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'delivered', 'pickup', NULL, ?, 0, ?, ?, ?, ?, ?)
  `).run(orderId, orderNumber, customerId, total, total, DEMO_ORDER_NOTE, issuedAt, submittedAt, issuedAt);

  const insertHistory = db.prepare(`
    INSERT INTO order_status_history (id, order_id, previous_status, new_status, note, changed_at)
    VALUES (?, ?, ?, ?, NULL, ?)
  `);
  insertHistory.run(`osh_dev_${Date.now()}_1`, orderId, null, 'new', submittedAt);
  insertHistory.run(`osh_dev_${Date.now()}_2`, orderId, 'new', 'in_progress', readyAt);
  insertHistory.run(`osh_dev_${Date.now()}_3`, orderId, 'in_progress', 'delivered', issuedAt);

  const insertItem = db.prepare(`
    INSERT INTO order_items (
      id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0)
  `);

  lines.forEach((line, index) => {
    const variantName =
      line.category_name === 'Жидкости' ? 'Ананасовая шипучка (demo)' : null;
    insertItem.run(
      `oi_dev_reviews_${Date.now()}_${index}`,
      orderId,
      line.product_id,
      line.product_title,
      variantName,
      Number(line.price_rub || 0),
      Number(line.price_rub || 0),
    );
  });

  ensureLiquidsQuickTags();

  db.prepare(`
    INSERT INTO review_settings (key, value) VALUES ('dev_test_mode', '0')
    ON CONFLICT(key) DO NOTHING
  `).run();

  return { customerId, orderId, orderNumber, lines };
});

const result = tx();
const customerId = result.customerId;

const frontendPort = process.env.VITE_DEV_PORT || '5173';
const url = new URL(`http://localhost:${frontendPort}/`);
url.searchParams.set('telegram_id', telegramId);
if (telegramUsername) url.searchParams.set('username', telegramUsername);
if (firstName) url.searchParams.set('first_name', firstName);

console.log('');
console.log('[seed-dev-reviews-demo] Готово');
console.log(`  telegram_id: ${telegramId}`);
console.log(`  customer_id: ${customerId}`);
console.log(`  order: #${result.orderNumber} (${result.orderId})`);
console.log(`  categories: ${result.lines.map((line) => line.category_name).join(' · ')}`);
console.log(`  lines: ${result.lines.map((line) => `${line.category_name}: ${line.group_name}`).join(' | ')}`);
console.log(`  card title preview: ${result.lines[0]?.category_name || 'Покупка'} и ещё ${Math.max(0, result.lines.length - 1)}`);
console.log('');
console.log('Открой в браузере (один раз — мок сохранится в sessionStorage):');
console.log(`  ${url.toString()}`);
console.log('');
console.log('Дальше проверь:');
console.log('  1. Dock со звёздами на главной');
console.log('  2. Профиль → Мои заказы');
console.log(`  3. Деталь заказа #${result.orderNumber} → отзывы по линейкам`);
console.log('  4. CRM → /admin/crm/reviews (модерация)');
console.log('');
console.log('Сбросить демо-заказ этого пользователя:');
console.log(`  node server/scripts/seed-dev-reviews-demo.js --telegram-id=${telegramId} --reset`);
console.log('');