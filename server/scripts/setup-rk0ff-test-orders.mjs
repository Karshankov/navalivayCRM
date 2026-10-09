/**
 * Три выданных тест-заказа для @rk0ff (все ключевые категории).
 *
 * Usage:
 *   node server/scripts/setup-rk0ff-test-orders.mjs
 *   node server/scripts/setup-rk0ff-test-orders.mjs --dry-run
 *   node server/scripts/setup-rk0ff-test-orders.mjs --qa   # включить обход кулдауна (только для отладки формы)
 */
import { initDb, db } from '../db.js';
import { migrateProductReviews } from '../migrations/add_product_reviews.js';
import { resolveOrderLinePrice } from '../utils/order-line-pricing.js';
import { setQaUsernames, setReviewSetting } from '../utils/product-reviews.js';

const RK_TELEGRAM_ID = '2035055116';
const RK_USERNAME = 'rk0ff';
const RK_FIRST_NAME = 'Konstantin';
const DEMO_ORDER_NOTE = '[rk0ff-test-orders]';

const ORDER_SPECS = [
  {
    label: 'Жидкость',
    items: [{ productId: 'p_1w5okc', variantName: 'Ананас манго' }],
  },
  {
    label: 'Расходка + одноразка',
    items: [
      { productId: 'p_oayxr7', variantName: null },
      { productId: 'p_h1bomb', variantName: 'Ледяной ананас' },
    ],
  },
  {
    label: 'Снюс + устройство',
    items: [
      { productId: 'p_6434ud', variantName: 'Хвоя' },
      {
        productId: 'p_m3jo0z',
        variantName: 'Rose red',
        variantId: 'p_m3jo0z-2-1773183850831',
      },
    ],
  },
];

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function nextOrderNumber() {
  const row = db.prepare('SELECT COALESCE(MAX(order_number), 0) + 1 AS n FROM orders').get();
  return Number(row?.n || 1);
}

function loadProduct(productId, { variantId = null, variantName = null } = {}) {
  const row = db.prepare(`
    SELECT
      p.id AS product_id,
      p.title AS product_title,
      cg.id AS group_id,
      cg.name AS group_name,
      c.name AS category_name,
      c.storefront_filters_profile
    FROM products p
    JOIN category_groups cg ON cg.id = p.groupId
    JOIN categories c ON c.id = cg.categoryId
    WHERE p.id = ?
  `).get(productId);

  if (!row) {
    throw new Error(`Товар не найден: ${productId}`);
  }

  const pricing = resolveOrderLinePrice(db, productId, { variantId, variantName });

  return {
    ...row,
    price_rub: pricing.price_rub,
    variant_id: pricing.variant_id,
    variant_name: pricing.variant_name,
  };
}

function resetDemoOrders(customerId) {
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

function createDeliveredOrder({ orderId, customerId, lines, now, issuedMinutesAgo }) {
  const orderNumber = nextOrderNumber();
  const total = lines.reduce((sum, line) => sum + Number(line.price_rub || 0), 0);
  const submittedAt = new Date(Date.now() - (issuedMinutesAgo + 10) * 60 * 1000).toISOString();
  const readyAt = new Date(Date.now() - (issuedMinutesAgo + 3) * 60 * 1000).toISOString();
  const issuedAt = new Date(Date.now() - issuedMinutesAgo * 60 * 1000).toISOString();

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
  insertHistory.run(`${orderId}_h1`, orderId, null, 'new', submittedAt);
  insertHistory.run(`${orderId}_h2`, orderId, 'new', 'in_progress', readyAt);
  insertHistory.run(`${orderId}_h3`, orderId, 'in_progress', 'delivered', issuedAt);

  const insertItem = db.prepare(`
    INSERT INTO order_items (
      id, order_id, product_id, product_title, variant_id, variant_name, quantity, price_per_unit, total_price, total_cost
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 0)
  `);

  const orderItems = [];
  lines.forEach((line, index) => {
    const itemId = `${orderId}_item_${index}`;
    const variantName = line.variant_name
      ?? (line.storefront_filters_profile === 'liquids' ? line.product_title : null);
    insertItem.run(
      itemId,
      orderId,
      line.product_id,
      line.product_title,
      line.variant_id || null,
      variantName,
      Number(line.price_rub || 0),
      Number(line.price_rub || 0),
    );
    orderItems.push({
      group_name: line.group_name,
      product_title: line.product_title,
      variant_name: variantName,
      category_name: line.category_name,
    });
  });

  return { orderNumber, orderItems, total };
}

initDb();
migrateProductReviews();

const dryRun = hasFlag('dry-run');
const enableQa = hasFlag('qa');
const now = new Date().toISOString();

const customer = db.prepare(`
  SELECT id, telegram_id, telegram_username, first_name, reviews_opt_out
  FROM customers
  WHERE telegram_id = ?
`).get(RK_TELEGRAM_ID);

if (!customer) {
  throw new Error(`Клиент @${RK_USERNAME} (${RK_TELEGRAM_ID}) не найден. Открой мини-апп хотя бы раз.`);
}

const previewOrders = ORDER_SPECS.map((spec) => ({
  label: spec.label,
  items: spec.items.map((item) => {
    const product = loadProduct(item.productId, {
      variantId: item.variantId || null,
      variantName: item.variantName || null,
    });
    return {
      category: product.category_name,
      group: product.group_name,
      product: product.product_title,
      variant: product.variant_name || item.variantName || product.product_title,
      price_rub: product.price_rub,
    };
  }),
}));

console.log('[setup-rk0ff-test-orders] План:');
console.log(JSON.stringify({ customer: { id: customer.id, username: RK_USERNAME }, orders: previewOrders, qa: enableQa }, null, 2));

if (dryRun) {
  console.log('\n[dry-run] Изменения не применены.');
  process.exit(0);
}

const result = db.transaction(() => {
  db.prepare(`
    UPDATE customers
    SET telegram_username = ?, first_name = ?, reviews_opt_out = 0, updated_at = ?
    WHERE id = ?
  `).run(RK_USERNAME, RK_FIRST_NAME, now, customer.id);

  const removedOrders = resetDemoOrders(customer.id);
  const createdOrders = [];

  ORDER_SPECS.forEach((spec, index) => {
    const orderId = `order_rk0ff_test_${Date.now()}_${index}`;
    const lines = spec.items.map((item) => loadProduct(item.productId, {
      variantId: item.variantId || null,
      variantName: item.variantName || null,
    }));

    const created = createDeliveredOrder({
      orderId,
      customerId: customer.id,
      lines,
      now,
      issuedMinutesAgo: 8 + index * 4,
    });

    createdOrders.push({
      label: spec.label,
      orderNumber: created.orderNumber,
      orderId,
      total: created.total,
      items: created.orderItems,
    });
  });

  if (enableQa) {
    setQaUsernames([RK_USERNAME]);
    setReviewSetting('qa_active', '1');
    setReviewSetting('dev_test_mode', '0');
  }

  return { removedOrders, createdOrders };
})();

console.log('');
console.log('[setup-rk0ff-test-orders] Готово');
console.log(`  customer: @${RK_USERNAME} (${RK_TELEGRAM_ID})`);
console.log(`  removed previous demo orders: ${result.removedOrders}`);
result.createdOrders.forEach((order) => {
  console.log(`  #${order.orderNumber} — ${order.label}`);
  order.items.forEach((item) => {
    console.log(`    · ${item.category_name}: ${item.group_name} — ${item.variant_name}`);
  });
});
if (enableQa) {
  console.log('  QA whitelist: включён для rk0ff');
}
console.log('');
console.log('Проверка: Telegram Mini App → главная (модалка отзыва) / Профиль → Мои заказы');