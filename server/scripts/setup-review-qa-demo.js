/**
 * Подготовка сценария отзывов для QA:
 * - выданный заказ с PODONKI PODGON + картридж XROS
 * - опционально whitelist QA (обход кулдауна при тесте)
 *
 * Usage:
 *   node server/scripts/setup-review-qa-demo.js --username dmitriy_mityuk --telegram-id 897676474
 *   node server/scripts/setup-review-qa-demo.js --username rk0ff --telegram-id 2035055116 --dry-run
 *   node server/scripts/setup-review-qa-demo.js --username rk0ff --telegram-id 2035055116 --no-qa
 *   node server/scripts/setup-review-qa-demo.js --username dmitriy_mityuk --telegram-id 897676474 --add-qa
 */
import { initDb, db } from '../db.js';
import { migrateProductReviews } from '../migrations/add_product_reviews.js';
import {
  getQaUsernames,
  setReviewSetting,
  setQaUsernames,
} from '../utils/product-reviews.js';

const TARGET_GROUPS = [
  { match: 'PODONKI PODGON', variantFromTitle: true },
  { match: 'Картриджи для XROS', variantFromTitle: false },
];

function readArg(name) {
  const prefix = `--${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return null;
}

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

function resetDemoForCustomer(customerId, demoOrderNote) {
  const orderIds = db.prepare(`
    SELECT id FROM orders
    WHERE customer_id = ? AND notes = ?
  `).all(customerId, demoOrderNote).map((row) => row.id);

  if (!orderIds.length) return 0;

  const placeholders = orderIds.map(() => '?').join(', ');
  db.prepare(`DELETE FROM product_reviews WHERE order_id IN (${placeholders})`).run(...orderIds);
  db.prepare(`DELETE FROM order_items WHERE order_id IN (${placeholders})`).run(...orderIds);
  db.prepare(`DELETE FROM order_status_history WHERE order_id IN (${placeholders})`).run(...orderIds);
  db.prepare(`DELETE FROM orders WHERE id IN (${placeholders})`).run(...orderIds);
  return orderIds.length;
}

const username = (readArg('username') || '').replace(/^@/, '').trim().toLowerCase();
const telegramId = (readArg('telegram-id') || '').trim();
const firstName = readArg('first-name') || username;

if (!username || !telegramId) {
  console.error('Usage: node server/scripts/setup-review-qa-demo.js --username USER --telegram-id ID [--first-name NAME] [--add-qa] [--no-qa] [--dry-run]');
  process.exit(1);
}

const demoOrderNote = `[${username}-review-qa]`;
const dryRun = hasFlag('dry-run');
const enableQa = !hasFlag('no-qa');
const addQa = hasFlag('add-qa');

initDb();
migrateProductReviews();

const now = new Date().toISOString();

const existingCustomer = db.prepare(`
  SELECT id, telegram_id, telegram_username, first_name, reviews_opt_out
  FROM customers
  WHERE telegram_id = ?
`).get(telegramId);

if (!existingCustomer && !dryRun) {
  throw new Error(`Клиент с telegram_id=${telegramId} не найден. Открой мини-апп под @${username} хотя бы раз.`);
}

const customerId = existingCustomer?.id || `cust_${username}_review_qa`;
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

const qaUsernames = enableQa
  ? (addQa
    ? [...new Set([...getQaUsernames(), username])]
    : [username])
  : [];

const preview = {
  customer: existingCustomer || {
    id: customerId,
    telegram_id: telegramId,
    telegram_username: username,
    first_name: firstName,
  },
  lines: lines.map((line) => ({
    group: line.group_name,
    product: line.product_title,
    variant: line.variant_name,
    category: line.category_name,
  })),
  qa: enableQa ? { active: true, usernames: qaUsernames, mode: addQa ? 'append' : 'replace' } : { active: false },
};

console.log('[setup-review-qa-demo] План:');
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
  `).run(username, firstName, now, customerId);

  const removedOrders = resetDemoForCustomer(customerId, demoOrderNote);

  const orderId = `order_${username}_review_qa_${Date.now()}`;
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
  `).run(orderId, orderNumber, customerId, total, total, demoOrderNote, issuedAt, submittedAt, issuedAt);

  const insertHistory = db.prepare(`
    INSERT INTO order_status_history (id, order_id, previous_status, new_status, note, changed_at)
    VALUES (?, ?, ?, ?, NULL, ?)
  `);
  insertHistory.run(`osh_${username}_${Date.now()}_1`, orderId, null, 'new', submittedAt);
  insertHistory.run(`osh_${username}_${Date.now()}_2`, orderId, 'new', 'in_progress', readyAt);
  insertHistory.run(`osh_${username}_${Date.now()}_3`, orderId, 'in_progress', 'delivered', issuedAt);

  const insertItem = db.prepare(`
    INSERT INTO order_items (
      id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0)
  `);

  const orderItems = [];
  lines.forEach((line, index) => {
    const itemId = `oi_${username}_${Date.now()}_${index}`;
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
    setQaUsernames(qaUsernames);
    setReviewSetting('qa_active', '1');
    setReviewSetting('dev_test_mode', '0');
  }

  return { removedOrders, orderId, orderNumber, orderItems, qaUsernames };
})();

console.log('');
console.log('[setup-review-qa-demo] Готово');
console.log(`  customer: @${username} (${telegramId})`);
console.log(`  removed demo orders: ${result.removedOrders}`);
console.log(`  new order: #${result.orderNumber} (${result.orderId})`);
console.log(`  lines: ${result.orderItems.map((item) => `${item.group_name}: ${item.variant_name || item.product_title}`).join(' | ')}`);
if (enableQa) {
  console.log(`  QA whitelist: ${result.qaUsernames.map((name) => `@${name}`).join(', ')}`);
}
console.log('');
console.log('Проверка:');
console.log(`  1. Открыть Telegram Mini App под @${username}`);
console.log('  2. На главной — dock «Оцените заказ»');
console.log('  3. Профиль → Мои заказы → деталь заказа → отзывы по линейкам');
console.log('  4. После проверки: CRM → Отзывы → «Выключить тестирование»');
console.log('');