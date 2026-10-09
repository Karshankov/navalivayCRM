import { initDb, db } from '../db.js';

initDb();

const settings = db
  .prepare(
    `SELECT key, value FROM review_settings WHERE key IN ('qa_active','dev_test_mode','qa_usernames')`,
  )
  .all();

console.log('SETTINGS', JSON.stringify(settings, null, 2));
console.log('REVIEWS', db.prepare('SELECT COUNT(*) AS n FROM product_reviews').get());
console.log('DRAWS', db.prepare('SELECT COUNT(*) AS n FROM review_monthly_draws').get());

const reviews = db
  .prepare(
    `SELECT pr.id, pr.status, pr.order_id, pr.created_at, c.telegram_username
     FROM product_reviews pr
     LEFT JOIN customers c ON c.id = pr.customer_id
     ORDER BY pr.created_at DESC
     LIMIT 30`,
  )
  .all();
console.log('RECENT_REVIEWS', JSON.stringify(reviews, null, 2));

const devOrders = db
  .prepare(`SELECT COUNT(*) AS n FROM orders WHERE id LIKE 'order_dev_%'`)
  .get();
console.log('DEV_ORDERS', devOrders);

const testCustomers = db
  .prepare(
    `SELECT id, telegram_id, telegram_username FROM customers
     WHERE telegram_id LIKE '90000000%' OR telegram_username LIKE 'review_%'`,
  )
  .all();
console.log('TEST_CUSTOMERS', JSON.stringify(testCustomers, null, 2));