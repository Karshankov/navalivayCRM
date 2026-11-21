
import { db } from '../db.js';
const m = await import('../utils/product-reviews.js');

const c = m.findCustomerByTelegram({ telegramId: '100001', telegramUsername: 'test_client_1' });
const r = m.getReviewPromptForCustomer(c);
console.log('=== ЧТО ПОПАЛО НА ОЦЕНКУ ===');
console.log('show:', r.show);
console.log('ждёт отзывов:', r.pending_review_count);
console.log('текущий товар:', r.group_name, '·', r.purchased_variant_name);
console.log();
// Посмотрим все позиции
const orders = m.findOwnedOrders({ telegramId: '100001', telegramUsername: 'test_client_1', statuses: ['delivered','completed'], limit: 20 });
for (const o of orders) {
  const lines = m.buildReviewableLinesForOrder(o, c.id, {});
  const pending = lines.filter(l => l.eligibility.canReview);
  if (pending.length) {
    console.log('заказ', o.order_number, '→ на оценку:', pending.map(l => l.group_name + (l.purchased_variant_name ? ' · ' + l.purchased_variant_name : '')).join(', '));
  }
}
