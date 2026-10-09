import { initDb, db } from '../db.js';
import {
  getReviewSettingsResponse,
  buildReviewableLinesForOrder,
  shouldDevBypassForCustomer,
  getCooldownDays,
} from '../utils/product-reviews.js';

initDb();

const customer = db.prepare(`
  SELECT * FROM customers WHERE telegram_username = 'rk0ff' OR telegram_id = '2035055116'
`).get();

if (!customer) {
  console.log('NO_CUSTOMER');
  process.exit(1);
}

console.log('=== review settings ===');
console.log(JSON.stringify(getReviewSettingsResponse(), null, 2));
console.log('cooldown_days:', getCooldownDays());
console.log('devBypass:', shouldDevBypassForCustomer(customer));

console.log('\n=== recent orders ===');
const orders = db.prepare(`
  SELECT id, order_number, status, notes, completed_at, created_at
  FROM orders WHERE customer_id = ?
  ORDER BY created_at DESC LIMIT 10
`).all(customer.id);
console.log(JSON.stringify(orders, null, 2));

console.log('\n=== product reviews ===');
const reviews = db.prepare(`
  SELECT pr.id, pr.order_id, pr.group_id, g.name AS group_name, pr.status, pr.rating,
         pr.created_at, pr.approved_at, o.order_number
  FROM product_reviews pr
  LEFT JOIN category_groups g ON g.id = pr.group_id
  LEFT JOIN orders o ON o.id = pr.order_id
  WHERE pr.customer_id = ?
  ORDER BY pr.created_at DESC
`).all(customer.id);
console.log(JSON.stringify(reviews, null, 2));

function printEligibility(label, order) {
  const lines = buildReviewableLinesForOrder(order, customer.id, { devBypass: label === 'WITH_QA' });
  console.log(`\n=== eligibility ${label} order #${order.order_number} ===`);
  for (const line of lines) {
    console.log(JSON.stringify({
      group: line.group_name,
      canReview: line.eligibility.canReview,
      reason: line.eligibility.reason,
      cooldownEndsAt: line.eligibility.cooldownEndsAt || null,
      latest_review: line.latest_review,
    }));
  }
}

for (const order of orders.filter((o) => o.order_number >= 9114 && o.order_number <= 9116)) {
  printEligibility('WITH_QA', order);
  printEligibility('WITHOUT_QA', order);
}