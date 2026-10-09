/**
 * Подготовка сценария отзывов для @rk0ff:
 * - выданный заказ с PODONKI PODGON + картридж XROS
 * - whitelist QA (обход кулдауна при тесте)
 *
 * Usage:
 *   node server/scripts/setup-rk0ff-review-qa.js
 *   node server/scripts/setup-rk0ff-review-qa.js --dry-run
 *   node server/scripts/setup-rk0ff-review-qa.js --no-qa   # только заказ, без whitelist
 */
import { initDb, db } from '../db.js';
import { migrateProductReviews } from '../migrations/add_product_reviews.js';
import {
  setReviewSetting,
  setQaUsernames,
} from '../utils/product-reviews.js';

const RK_TELEGRAM_ID = '2035055116';
const RK_USERNAME = 'rk0ff';
const RK_FIRST_NAME = 'Konstantin';
const DEMO_ORDER_NOTE = '[rk0ff-review-qa]';
const TARGET_GROUPS = [
  { match: 'PODONKI PODGON', variantFromTitle: true },
  { match: 'Картриджи для XROS', variantFromTitle: false },
];

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function nextOrderNumber() {
  const row = db.prepare('SELECT COALESCE(MAX(order_number), 0) + 1 AS n FROM orders').get();
  return Number(row?.n || 1);
}

function findGroupByName(fragment) {
  return db.prepare(`
    SELECT cg.id AS group_id, cg.name AS group_name, cg.categoryId AS category_id,
           c.name AS category_name, c.storefront_filters_profile
    FROM category_groups cg
    JOIN categories c ON c.id = cg.categoryId
    WHERE cg.name = ?
    LIMIT 1
  `).get(fragment);
}

function pickProductForGroup(groupId) {
  return db.prepare(`
    SELECT id AS product_id, title AS product_title, priceRub AS price_rub
    FROM products
    WHERE groupId = ?
    ORDER BY title
    LIMIT 1
  `).get(groupId);
}

function resetDemoForCustomer(customerId) {
  const orderIds = db.prepare(`
    SELECT id FROM orders
    WHERE customer_id = ? AND notes = ?
  `).all(customerId, DEMO_ORDER_NOTE).map((row) => row.id);

  if (!orderIds.length) return 0;

  const placeholders = orderIds.map(() => '?').join(', ');
  db.prepare(`DELETE FROM product_reviews WHERE order_id IN (${placeholders})`).run(...orderIds);
  db.prepare(`DELETE FROM order_items WHERE order_id IN (${placeholders})`).run(...orderIds);
  db.prepare(`DELETE FROM order_status_history WHERE order_id IN (${placeholders})`).run(...orderIds);
  db.prepare(`DELETE FROM orders WHERE id IN (${placeholders})`).run(...orderIds);
  return orderIds.length;
}

initDb();
migrateProductReviews();

const dryRun = hasFlag('dry-run');
const enableQa = !hasFlag('no-qa');
const now = new Date().toISOString();

const existingCustomer = db.prepare(`
  SELECT id, telegram_id, telegram_username, first_name, reviews_opt_out
  FROM customers
  WHERE telegram_id = ?
`).get(RK_TELEGRAM_ID);

if (!existingCustomer && !dryRun) {
  throw new Error(`Клиент с telegram_id=${RK_TELEGRAM_ID} не найден. Открой мини-апп под @${RK_USERNAME} хотя бы раз.`);
}

const customerId = existingCustomer?.id || `cust_rk0ff_review_qa`;
const lines = [];

for (const target of TARGET_GROUPS) {
  const group = findGroupByName(target.match);
  if (!group) {
    throw new Error(`Линейка не найдена: ${target.match}`);
  }
  const product = pickProductForGroup(group.group_id);
  if (!product) {
    throw new Error(`Нет товаров в линейке: ${group.group_name}`);
  }
  lines.push({
    ...group,
    ...product,
    variant_name: target.variantFromTitle ? product.product_title : null,
  });
}

const preview = {
  customer: existingCustomer || {
    id: customerId,
    telegram_id: RK_TELEGRAM_ID,
    telegram_username: RK_USERNAME,
    first_name: RK_FIRST_NAME,
  },
  lines: lines.map((line) => ({
    group: line.group_name,
    product: line.product_title,
    variant: line.variant_name,
    category: line.category_name,
  })),
  qa: enableQa ? { active: true, usernames: [RK_USERNAME] } : { active: false },
};

console.log('[setup-rk0ff-review-qa] План:');
console.log(JSON.stringify(preview, null, 2));

if (dryRun) {
  console.log('\n[dry-run] Изменения не применены.');
  process.exit(0);
}

const result = db.transaction(() => {
  db.prepare(`
    UPDATE customers
    SET telegram_username = ?, first_name = ?, reviews_opt_out = 0, updated_at = ?
    WHERE id = ?
  `).run(RK_USERNAME, RK_FIRST_NAME, now, customerId);

  const removedOrders = resetDemoForCustomer(customerId);

  const orderId = `order_rk0ff_review_qa_${Date.now()}`;
  const orderNumber = nextOrderNumber();
  const total = lines.reduce((sum, line) => sum + Number(line.price_rub || 0), 0);
  const submittedAt = new Date(Date.now() - 12 * 60 * 1000).toISOString();
  const readyAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
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
  insertHistory.run(`osh_rk0ff_${Date.now()}_1`, orderId, null, 'new', submittedAt);
  insertHistory.run(`osh_rk0ff_${Date.now()}_2`, orderId, 'new', 'in_progress', readyAt);
  insertHistory.run(`osh_rk0ff_${Date.now()}_3`, orderId, 'in_progress', 'delivered', issuedAt);

  const insertItem = db.prepare(`
    INSERT INTO order_items (
      id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0)
  `);

  const orderItems = [];
  lines.forEach((line, index) => {
    const itemId = `oi_rk0ff_${Date.now()}_${index}`;
    insertItem.run(
      itemId,
      orderId,
      line.product_id,
      line.product_title,
      line.variant_name,
      Number(line.price_rub || 0),
      Number(line.price_rub || 0),
    );
    orderItems.push({
      id: itemId,
      group_name: line.group_name,
      product_title: line.product_title,
      variant_name: line.variant_name,
    });
  });

  if (enableQa) {
    setQaUsernames([RK_USERNAME]);
    setReviewSetting('qa_active', '1');
    setReviewSetting('dev_test_mode', '0');
  }

  return { removedOrders, orderId, orderNumber, orderItems };
})();

console.log('');
console.log('[setup-rk0ff-review-qa] Готово');
console.log(`  customer: @${RK_USERNAME} (${RK_TELEGRAM_ID})`);
console.log(`  removed demo orders: ${result.removedOrders}`);
console.log(`  new order: #${result.orderNumber} (${result.orderId})`);
console.log(`  lines: ${result.orderItems.map((item) => `${item.group_name}: ${item.variant_name || item.product_title}`).join(' | ')}`);
if (enableQa) {
  console.log('  QA whitelist: включён только для rk0ff');
}
console.log('');
console.log('Проверка для Кости:');
console.log('  1. Открыть Telegram Mini App под @rk0ff');
console.log('  2. На главной — dock «Оцените заказ»');
console.log('  3. Профиль → Мои заказы → деталь заказа → отзывы по линейкам');
console.log('  4. После проверки: CRM → Отзывы → «Выключить тестирование»');
console.log('');