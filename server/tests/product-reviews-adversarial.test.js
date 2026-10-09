/**
 * Product reviews — adversarial + regression unit tests.
 * Fraud patterns: fake purchase, cooldown abuse, duplicate spam, IDOR payloads.
 * Run: node server/tests/product-reviews-adversarial.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-product-reviews-adv-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'test';

const { initDb, db } = await import('../db.js');
const {
  createProductReview,
  findOwnedOrders,
  getGroupReviewEligibility,
  getPublicGroupReviews,
  getReviewPromptForCustomer,
  buildReviewableLinesForOrder,
  serializeOrderDetail,
  serializeOrderHistoryCard,
  setReviewSetting,
  validateReviewBodyText,
  REVIEW_STATUSES,
} = await import('../utils/product-reviews.js');

initDb();

const results = { passed: 0, failed: 0 };

function ok(cond, msg) {
  if (cond) {
    results.passed++;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

function expectThrows(fn, code, msg) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  ok(thrown?.code === code, `${msg} — code=${thrown?.code || 'none'}`);
}

function seedWorld({
  customerId = 'cust1',
  telegramId = '111',
  orderStatus = 'delivered',
  secondCustomer = false,
} = {}) {
  db.exec('DELETE FROM product_reviews;');
  db.exec('DELETE FROM order_items;');
  db.exec('DELETE FROM orders;');
  db.exec('DELETE FROM products;');
  db.exec('DELETE FROM category_groups;');
  db.exec('DELETE FROM categories;');
  db.exec('DELETE FROM customers;');
  db.exec('DELETE FROM review_quick_tags;');

  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, first_name, reviews_opt_out, created_at, updated_at)
     VALUES (?, ?, ?, 'Buyer', 0, DATETIME('now'), DATETIME('now'))`,
  ).run(customerId, telegramId, 'buyer1');

  if (secondCustomer) {
    db.prepare(
      `INSERT INTO customers (id, telegram_id, telegram_username, first_name, reviews_opt_out, created_at, updated_at)
       VALUES ('cust2', '222', 'buyer2', 'Other', 0, DATETIME('now'), DATETIME('now'))`,
    ).run();
  }

  db.prepare(
    `INSERT INTO categories (id, slug, name, [order], hide_empty, storefront_filters_profile)
     VALUES ('cat1', 'salt-liquids', 'Жидкости', 1, 0, 'liquids')`,
  ).run();

  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp1', 'cat1', 'grp1', 'Подонки', 1, 0, DATETIME('now'), DATETIME('now')),
            ('grp2', 'cat1', 'grp2', 'Другая', 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();

  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, createdAt)
     VALUES ('prod1', 'cat1', 'grp1', 'Ананас', 10, '', 5, DATETIME('now')),
            ('prod2', 'cat1', 'grp2', 'Манго', 10, '', 5, DATETIME('now'))`,
  ).run();

  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, completed_at, created_at, updated_at)
     VALUES ('ord1', 1001, ?, ?, 10, 10, DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
  ).run(customerId, orderStatus);

  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi1', 'ord1', 'prod1', 'Ананас', 'Ананасовая шипучка', 1, 10, 10, 4)`,
  ).run();

  db.prepare(
    `INSERT INTO review_quick_tags (id, category_key, star_rating, label, insert_text, sort_order, is_active, created_at, updated_at)
     VALUES ('tag1', 'liquids', 5, 'Хороший вкус', 'Хороший вкус жидкости.', 1, 1, DATETIME('now'), DATETIME('now'))`,
  ).run();
}

console.log('\n=== product-reviews adversarial + regression ===\n');

console.log('--- A1: cannot review without purchase ---');
{
  seedWorld();
  const eligibility = getGroupReviewEligibility({
    customerId: 'cust2',
    groupId: 'grp1',
    orderId: 'ord1',
  });
  ok(eligibility.canReview === false && eligibility.reason === 'not_purchased', 'foreign customer blocked');
}

console.log('\n--- A2: cannot review active order ---');
{
  seedWorld({ orderStatus: 'in_progress' });
  expectThrows(
    () =>
      createProductReview({
        customerId: 'cust1',
        orderId: 'ord1',
        groupId: 'grp1',
        orderItemId: 'oi1',
        rating: 5,
        bodyText: 'Пытаюсь оставить отзыв на незавершённый заказ',
        quickTagIds: [],
      }),
    'order_not_reviewable',
    'active order rejected',
  );
}

console.log('\n--- A3: duplicate pending blocks second review ---');
{
  seedWorld();
  createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp1',
    orderItemId: 'oi1',
    rating: 5,
    bodyText: 'Первый отзыв на линейку, всё отлично',
    quickTagIds: [],
  });
  expectThrows(
    () =>
      createProductReview({
        customerId: 'cust1',
        orderId: 'ord1',
        groupId: 'grp1',
        orderItemId: 'oi1',
        rating: 4,
        bodyText: 'Второй отзыв сразу же, спам попытка',
        quickTagIds: [],
      }),
    'pending_moderation',
    'duplicate pending blocked',
  );
}

console.log('\n--- A3b: qa/dev bypass still blocks duplicate pending ---');
{
  seedWorld();
  createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp1',
    orderItemId: 'oi1',
    rating: 5,
    bodyText: 'Первый QA-отзыв на линейку, всё отлично',
    quickTagIds: [],
    devBypass: true,
  });
  expectThrows(
    () =>
      createProductReview({
        customerId: 'cust1',
        orderId: 'ord1',
        groupId: 'grp1',
        orderItemId: 'oi1',
        rating: 4,
        bodyText: 'Повторная отправка в QA-режиме, спам попытка',
        quickTagIds: [],
        devBypass: true,
      }),
    'pending_moderation',
    'qa duplicate pending blocked',
  );
}

console.log('\n--- A4: cooldown after approved review ---');
{
  seedWorld();
  const review = createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp1',
    orderItemId: 'oi1',
    rating: 5,
    bodyText: 'Отличная линейка, беру снова и снова',
    quickTagIds: [],
  });
  db.prepare(
    `UPDATE product_reviews SET status = ?, approved_at = DATETIME('now') WHERE id = ?`,
  ).run(REVIEW_STATUSES.APPROVED, review.id);

  const blocked = getGroupReviewEligibility({
    customerId: 'cust1',
    groupId: 'grp1',
    orderId: 'ord1',
  });
  ok(blocked.canReview === false && blocked.reason === 'cooldown', 'cooldown enforced');
}

console.log('\n--- A5: invalid quick tag rejected ---');
{
  seedWorld();
  expectThrows(
    () =>
      createProductReview({
        customerId: 'cust1',
        orderId: 'ord1',
        groupId: 'grp1',
        orderItemId: 'oi1',
        rating: 5,
        bodyText: 'Отзыв с подставным тегом для накрутки',
        quickTagIds: ['fake-tag-id'],
      }),
    'invalid_quick_tags',
    'fake quick tag rejected',
  );
}

console.log('\n--- A5b: quick tag with wrong star rating rejected ---');
{
  seedWorld();
  db.prepare(
    `INSERT INTO review_quick_tags (id, category_key, star_rating, label, insert_text, sort_order, is_active, created_at, updated_at)
     VALUES ('tag4', 'liquids', 4, 'Норм', 'Нормальный вкус.', 2, 1, DATETIME('now'), DATETIME('now'))`,
  ).run();
  expectThrows(
    () =>
      createProductReview({
        customerId: 'cust1',
        orderId: 'ord1',
        groupId: 'grp1',
        orderItemId: 'oi1',
        rating: 5,
        bodyText: 'Пытаюсь прикрепить тег от четырёх звёзд к пятёрке',
        quickTagIds: ['tag4'],
      }),
    'invalid_quick_tags',
    'wrong star rating tag rejected',
  );
}

console.log('\n--- A5c: quick tag from another category rejected ---');
{
  seedWorld();
  db.prepare(
    `INSERT INTO review_quick_tags (id, category_key, star_rating, label, insert_text, sort_order, is_active, created_at, updated_at)
     VALUES ('tag_snus', 'snus', 5, 'Крепко', 'Крепкий снюс.', 3, 1, DATETIME('now'), DATETIME('now'))`,
  ).run();
  expectThrows(
    () =>
      createProductReview({
        customerId: 'cust1',
        orderId: 'ord1',
        groupId: 'grp1',
        orderItemId: 'oi1',
        rating: 5,
        bodyText: 'Пытаюсь прикрепить тег от другой категории',
        quickTagIds: ['tag_snus'],
      }),
    'invalid_quick_tags',
    'wrong category tag rejected',
  );
}

console.log('\n--- A6: rating bounds ---');
{
  seedWorld();
  expectThrows(
    () =>
      createProductReview({
        customerId: 'cust1',
        orderId: 'ord1',
        groupId: 'grp1',
        rating: 0,
        bodyText: 'Нулевая оценка не должна пройти валидацию',
        quickTagIds: [],
      }),
    'invalid_rating',
    'rating 0 rejected',
  );
  expectThrows(
    () =>
      createProductReview({
        customerId: 'cust1',
        orderId: 'ord1',
        groupId: 'grp1',
        rating: 6,
        bodyText: 'Шестая звезда не должна пройти валидацию',
        quickTagIds: [],
      }),
    'invalid_rating',
    'rating 6 rejected',
  );
}

console.log('\n--- A7: body too short (anti empty-review) ---');
{
  seedWorld();
  expectThrows(
    () => validateReviewBodyText('коротко'),
    'review_body_too_short',
    'short body rejected',
  );
}

console.log('\n--- A8: wrong group on order rejected ---');
{
  seedWorld();
  expectThrows(
    () =>
      createProductReview({
        customerId: 'cust1',
        orderId: 'ord1',
        groupId: 'grp2',
        orderItemId: 'oi1',
        rating: 5,
        bodyText: 'Отзыв на линейку которую не покупал в заказе',
        quickTagIds: [],
      }),
    'not_purchased',
    'group not in order blocked',
  );
}

console.log('\n--- A9: opt-out hides prompt ---');
{
  seedWorld();
  db.prepare('UPDATE customers SET reviews_opt_out = 1 WHERE id = ?').run('cust1');
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get('cust1');
  const prompt = getReviewPromptForCustomer(customer);
  ok(prompt.show === false && prompt.reason === 'opt_out', 'opt-out respected');
}

console.log('\n--- A10: public reviews hide pending/rejected ---');
{
  seedWorld();
  const pending = createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp1',
    orderItemId: 'oi1',
    rating: 1,
    bodyText: 'Негативный отзыв пока на модерации, скрыт',
    quickTagIds: [],
    isAnonymous: false,
  });
  db.prepare(`UPDATE product_reviews SET status = ? WHERE id = ?`).run(
    REVIEW_STATUSES.REJECTED,
    pending.id,
  );

  const approved = createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp1',
    orderItemId: 'oi1',
    rating: 5,
    bodyText: 'Одобренный отзыв виден всем покупателям',
    quickTagIds: [],
    isAnonymous: true,
  });
  db.prepare(`UPDATE product_reviews SET status = ?, approved_at = DATETIME('now') WHERE id = ?`).run(
    REVIEW_STATUSES.APPROVED,
    approved.id,
  );

  const pub = getPublicGroupReviews('grp1');
  ok(pub.review_count === 1, 'only approved visible');
  ok(pub.items[0].reviewer.is_anonymous === true, 'anonymous mask applied');
  ok(!JSON.stringify(pub.items[0]).includes('@'), 'no username in public payload');
}

console.log('\n--- A11: dev test mode allows review without delivered status ---');
{
  seedWorld({ orderStatus: 'new' });
  setReviewSetting('dev_test_mode', '1');
  const review = createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp1',
    orderItemId: 'oi1',
    rating: 5,
    bodyText: 'Тестовый отзыв в dev mode без выдачи',
    quickTagIds: [],
    devBypass: true,
  });
  ok(review?.id, 'dev bypass creates review');
  setReviewSetting('dev_test_mode', '0');
}

console.log('\n--- R1: whitespace-trimmed body passes at 20 chars ---');
{
  ok(
    validateReviewBodyText('  Двадцать символов тут  ').length >= 20,
    'trimmed body accepted',
  );
}

console.log('\n--- R2: rejected review allows resubmit ---');
{
  seedWorld();
  const first = createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp1',
    orderItemId: 'oi1',
    rating: 2,
    bodyText: 'Первый отзыв отклонён модератором позже',
    quickTagIds: [],
  });
  db.prepare(`UPDATE product_reviews SET status = ? WHERE id = ?`).run(
    REVIEW_STATUSES.REJECTED,
    first.id,
  );

  const second = createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp1',
    orderItemId: 'oi1',
    rating: 5,
    bodyText: 'Исправленный отзыв после отклонения модерации',
    quickTagIds: ['tag1'],
  });
  ok(second?.status === REVIEW_STATUSES.PENDING, 'resubmit after reject allowed');
}

function seedRepeatPurchaseWorld() {
  seedWorld();
  setReviewSetting('cooldown_days', '30');

  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, completed_at, created_at, updated_at)
     VALUES ('ord_old', 1002, 'cust1', 'delivered', 10, 10, DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi_old', 'ord_old', 'prod1', 'Ананас', '50 мг', 1, 10, 10, 4)`,
  ).run();

  const approvedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO product_reviews (
      id, customer_id, order_id, order_item_id, group_id, category_id,
      rating, body_text, status, is_anonymous, created_at, approved_at
    ) VALUES ('rev_old', 'cust1', 'ord_old', 'oi_old', 'grp1', 'cat1', 5, 'Уже оценил эту линейку раньше', 'approved', 0, ?, ?)`,
  ).run(approvedAt, approvedAt);

  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, completed_at, created_at, updated_at)
     VALUES ('ord_repeat', 1003, 'cust1', 'delivered', 10, 10, DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi_repeat', 'ord_repeat', 'prod1', 'Ананас', '50 мг', 1, 10, 10, 4)`,
  ).run();
}

console.log('\n--- A12: repeat purchase within 30d cooldown cannot farm reviews ---');
{
  seedRepeatPurchaseWorld();
  const blocked = getGroupReviewEligibility({
    customerId: 'cust1',
    groupId: 'grp1',
    orderId: 'ord_repeat',
    orderItemId: 'oi_repeat',
  });
  ok(blocked.canReview === false && blocked.reason === 'cooldown', '10d rebuy blocked by 30d cooldown');
  ok(Boolean(blocked.cooldownEndsAt), 'cooldown end date exposed for order detail');
}

console.log('\n--- A13: cooldown hides dock when only repeat line exists ---');
{
  seedRepeatPurchaseWorld();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get('cust1');
  const prompt = getReviewPromptForCustomer(customer);
  ok(prompt.show === false && prompt.reason === 'nothing_to_review', 'dock hidden on cooldown-only customer');
}

console.log('\n--- A14: order history hints cooldown without exposing internals ---');
{
  seedRepeatPurchaseWorld();
  const repeatOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get('ord_repeat');
  const card = serializeOrderHistoryCard(repeatOrder, 'cust1');
  ok(!('pending_review_count' in card), 'history card has no pending_review_count');
  ok(!('has_reviews' in card), 'history card has no has_reviews');
  ok(!('cooldownEndsAt' in card), 'history card has no cooldown end date');
  ok(card.review_hint === 'Отзыв на эту линейку уже оставлен', 'history card hints cooldown repeat purchase');
}

console.log('\n--- A15: order detail exposes cooldown explanation ---');
{
  seedRepeatPurchaseWorld();
  const repeatOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get('ord_repeat');
  const detail = serializeOrderDetail(repeatOrder, 'cust1');
  const line = detail.reviewable_lines.find((row) => row.group_id === 'grp1');
  ok(line?.eligibility.reason === 'cooldown', 'detail line shows cooldown reason');
  ok(line?.latest_review == null, 'repeat order has no scoped review row');
}

console.log('\n--- A16: pending moderation blocks repeat purchase duplicate ---');
{
  seedRepeatPurchaseWorld();
  db.exec("DELETE FROM product_reviews WHERE id = 'rev_old'");
  createProductReview({
    customerId: 'cust1',
    orderId: 'ord_old',
    groupId: 'grp1',
    orderItemId: 'oi_old',
    rating: 5,
    bodyText: 'Первый отзыв ещё на модерации, повтор нельзя',
    quickTagIds: [],
  });

  expectThrows(
    () =>
      createProductReview({
        customerId: 'cust1',
        orderId: 'ord_repeat',
        groupId: 'grp1',
        orderItemId: 'oi_repeat',
        rating: 4,
        bodyText: 'Повторная покупка не должна дать второй отзыв',
        quickTagIds: [],
      }),
    'pending_moderation',
    'repeat purchase blocked while pending',
  );
}

console.log('\n--- A17: cooldown on one line does not block another line ---');
{
  seedRepeatPurchaseWorld();
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, completed_at, created_at, updated_at)
     VALUES ('ord_mix', 1004, 'cust1', 'delivered', 20, 20, DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi_mix1', 'ord_mix', 'prod1', 'Ананас', '50 мг', 1, 10, 10, 4),
            ('oi_mix2', 'ord_mix', 'prod2', 'Манго', '40 мг', 1, 10, 10, 4)`,
  ).run();

  const lines = buildReviewableLinesForOrder(
    db.prepare('SELECT * FROM orders WHERE id = ?').get('ord_mix'),
    'cust1',
  );
  const grp1 = lines.find((line) => line.group_id === 'grp1');
  const grp2 = lines.find((line) => line.group_id === 'grp2');
  ok(grp1?.eligibility.reason === 'cooldown', 'first line stays on cooldown');
  ok(grp2?.eligibility.canReview === true, 'fresh line still reviewable');

  const prompt = getReviewPromptForCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get('cust1'));
  ok(prompt.show === true && prompt.group_id === 'grp2', 'dock targets fresh line only');
}

console.log('\n--- A18: global dev_test_mode without devBypass still enforces cooldown ---');
{
  seedRepeatPurchaseWorld();
  setReviewSetting('dev_test_mode', '1');
  const blocked = getGroupReviewEligibility({
    customerId: 'cust1',
    groupId: 'grp1',
    orderId: 'ord_repeat',
    orderItemId: 'oi_repeat',
    devBypass: false,
  });
  ok(blocked.canReview === false && blocked.reason === 'cooldown', 'cooldown enforced without explicit bypass flag');
  setReviewSetting('dev_test_mode', '0');
}

console.log('\n--- A19: archived delivered order stays in customer history ---');
{
  seedWorld();
  db.prepare(`UPDATE orders SET archived = 1 WHERE id = 'ord1'`).run();

  const owned = findOwnedOrders({
    telegramId: '111',
    telegramUsername: 'buyer1',
    statuses: ['delivered', 'completed', 'cancelled'],
    orderId: 'ord1',
    limit: 1,
  });
  ok(owned.length === 1 && owned[0].archived === 1, 'archived delivered order is owned');

  const order = owned[0];
  const card = serializeOrderHistoryCard(order, 'cust1');
  ok(card.id === 'ord1' && card.order_number === 1001, 'archived order serializes for history card');
}

console.log('\n--- A20: archived order with rejected reviews allows resubmit and prompt ---');
{
  seedWorld();
  db.prepare(`UPDATE orders SET archived = 1 WHERE id = 'ord1'`).run();

  const first = createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp1',
    orderItemId: 'oi1',
    rating: 5,
    bodyText: 'Первый отзыв отклонён после ночной архивации',
    quickTagIds: [],
  });
  db.prepare(`UPDATE product_reviews SET status = ? WHERE id = ?`).run(
    REVIEW_STATUSES.REJECTED,
    first.id,
  );

  const eligible = getGroupReviewEligibility({
    customerId: 'cust1',
    groupId: 'grp1',
    orderId: 'ord1',
    orderItemId: 'oi1',
  });
  ok(eligible.canReview === true, 'archived order line is reviewable after rejection');

  const second = createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp1',
    orderItemId: 'oi1',
    rating: 4,
    bodyText: 'Исправленный отзыв на архивный заказ после отклонения',
    quickTagIds: [],
  });
  ok(second?.status === REVIEW_STATUSES.PENDING, 'resubmit on archived order allowed');

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get('cust1');
  const prompt = getReviewPromptForCustomer(customer);
  ok(prompt.show === false, 'prompt hidden while resubmit pending');
}

console.log('\n--- A21: Maffsim-like multi-line archived order with all reviews rejected ---');
{
  seedWorld();
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp3', 'cat1', 'grp3', 'Третья', 3, 0, DATETIME('now'), DATETIME('now')),
            ('grp4', 'cat1', 'grp4', 'Четвёртая', 4, 0, DATETIME('now'), DATETIME('now')),
            ('grp5', 'cat1', 'grp5', 'Пятая', 5, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, createdAt)
     VALUES ('prod3', 'cat1', 'grp3', 'Линия 3', 10, '', 5, DATETIME('now')),
            ('prod4', 'cat1', 'grp4', 'Линия 4', 10, '', 5, DATETIME('now')),
            ('prod5', 'cat1', 'grp5', 'Линия 5', 10, '', 5, DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi2', 'ord1', 'prod2', 'Манго', 'Манговая', 1, 10, 10, 4),
            ('oi3', 'ord1', 'prod3', 'Линия 3', 'Вкус 3', 1, 10, 10, 4),
            ('oi4', 'ord1', 'prod4', 'Линия 4', 'Вкус 4', 1, 10, 10, 4),
            ('oi5', 'ord1', 'prod5', 'Линия 5', 'Вкус 5', 1, 10, 10, 4)`,
  ).run();
  db.prepare(`UPDATE orders SET archived = 1, order_number = 9086 WHERE id = 'ord1'`).run();
  db.prepare(`UPDATE customers SET telegram_username = 'Maffsim' WHERE id = 'cust1'`).run();

  for (const [groupId, itemId, suffix] of [
    ['grp1', 'oi1', '1'],
    ['grp2', 'oi2', '2'],
    ['grp3', 'oi3', '3'],
    ['grp4', 'oi4', '4'],
    ['grp5', 'oi5', '5'],
  ]) {
    const review = createProductReview({
      customerId: 'cust1',
      orderId: 'ord1',
      groupId,
      orderItemId: itemId,
      rating: 5,
      bodyText: `Все чётко быстро. Спасибо за линейку ${suffix}`,
      quickTagIds: [],
    });
    db.prepare(`UPDATE product_reviews SET status = ? WHERE id = ?`).run(
      REVIEW_STATUSES.REJECTED,
      review.id,
    );
  }

  const owned = findOwnedOrders({
    telegramId: '111',
    telegramUsername: 'Maffsim',
    statuses: ['delivered', 'completed', 'cancelled'],
    orderId: 'ord1',
    limit: 1,
  });
  ok(owned.length === 1, 'Maffsim archived order visible in owned orders');

  const lines = buildReviewableLinesForOrder(owned[0], 'cust1');
  const reviewable = lines.filter((line) => line.eligibility.canReview);
  ok(reviewable.length === lines.length, 'all rejected lines become reviewable again');

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get('cust1');
  const prompt = getReviewPromptForCustomer(customer);
  ok(prompt.show === true && prompt.order_id === 'ord1', 'review dock returns for archived rejected order');
}

console.log('\n--- A22: pre-launch archived orders stay out of customer history ---');
{
  seedWorld();
  db.prepare(
    `INSERT INTO orders (
      id, order_number, customer_id, status, archived, total_amount, final_amount,
      completed_at, created_at, updated_at
    ) VALUES ('ord_old_arch', 7001, 'cust1', 'delivered', 1, 10, 10,
      '2026-06-10T12:00:00.000Z', '2026-06-10T10:00:00.000Z', '2026-06-10T12:00:00.000Z')`,
  ).run();
  db.prepare(`UPDATE orders SET archived = 1, completed_at = '2026-06-22T15:00:00.000Z' WHERE id = 'ord1'`).run();

  const owned = findOwnedOrders({
    telegramId: '111',
    telegramUsername: 'buyer1',
    statuses: ['delivered', 'completed', 'cancelled'],
  });

  ok(owned.length === 1 && owned[0].id === 'ord1', 'post-launch archived order stays visible');
  ok(!owned.some((order) => order.id === 'ord_old_arch'), 'pre-launch archived order stays hidden');
}

console.log(`\nDone: ${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);