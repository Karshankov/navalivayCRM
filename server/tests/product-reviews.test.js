/**
 * Product reviews core logic tests.
 * Run: node server/tests/product-reviews.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-product-reviews-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'test';

const { initDb, db } = await import('../db.js');
const {
  createProductReview,
  getGroupReviewEligibility,
  getReviewPromptForCustomer,
  validateReviewBodyText,
  resolveReviewCategoryKey,
  getPublicGroupReviews,
  resolvePurchasedVariantName,
  buildOrderLineIconsFromGroups,
  buildOrderFulfillmentMilestones,
  buildReviewableLinesForOrder,
  serializeOrderDetail,
  serializeOrderHistoryCard,
  getCooldownDays,
  parseQaUsernames,
  isQaReviewUser,
  shouldDevBypassForCustomer,
  setReviewSetting,
  setQaUsernames,
  REVIEW_STATUSES,
  MAX_REVIEW_BODY_LENGTH,
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

function seedBase() {
  db.exec('DELETE FROM product_reviews;');
  db.exec('DELETE FROM order_items;');
  db.exec('DELETE FROM orders;');
  db.exec('DELETE FROM products;');
  db.exec('DELETE FROM category_groups;');
  db.exec('DELETE FROM categories;');
  db.exec('DELETE FROM customers;');

  db.prepare(
    `INSERT INTO customers (id, telegram_id, telegram_username, first_name, reviews_opt_out, created_at, updated_at)
     VALUES ('cust1', '111', 'buyer1', 'Buyer', 0, DATETIME('now'), DATETIME('now'))`,
  ).run();

  db.prepare(
    `INSERT INTO categories (id, slug, name, [order], hide_empty, storefront_filters_profile)
     VALUES ('cat_liq', 'salt-liquids', 'Жидкости', 1, 0, 'liquids')`,
  ).run();

  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp1', 'cat_liq', 'grp1', 'Подонки', 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();

  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, createdAt)
     VALUES ('prod1', 'cat_liq', 'grp1', 'Ананас', 10, '', 5, DATETIME('now'))`,
  ).run();

  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, completed_at, created_at, updated_at)
     VALUES ('ord1', 1001, 'cust1', 'delivered', 10, 10, DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
  ).run();

  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi1', 'ord1', 'prod1', 'Ананас', 'Ананасовая шипучка', 1, 10, 10, 4)`,
  ).run();
}

function seedRepeatPurchaseGroup({
  groupId = 'grp_last_hap',
  groupName = 'PODONKI LAST HAP',
  productId = 'prod_last_hap',
} = {}) {
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES (?, 'cat_liq', ?, ?, 2, 0, DATETIME('now'), DATETIME('now'))`,
  ).run(groupId, groupId, groupName);

  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, createdAt)
     VALUES (?, 'cat_liq', ?, ?, 15, '', 5, DATETIME('now'))`,
  ).run(productId, groupId, groupName);

  return { groupId, groupName, productId };
}

function createDeliveredOrder({
  orderId,
  orderNumber,
  customerId = 'cust1',
  productId = 'prod_last_hap',
  groupId = 'grp_last_hap',
  groupName = 'PODONKI LAST HAP',
  orderItemId,
  variantName = '50 мг',
  createdAt,
  completedAt,
}) {
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, 'delivered', 15, 15, ?, ?, ?)`,
  ).run(
    orderId,
    orderNumber,
    customerId,
    completedAt || createdAt || "DATETIME('now')",
    createdAt || "DATETIME('now')",
    createdAt || "DATETIME('now')",
  );

  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, group_name, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES (?, ?, ?, ?, ?, ?, 1, 15, 15, 6)`,
  ).run(
    orderItemId,
    orderId,
    productId,
    groupName,
    groupName,
    variantName,
  );

  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

function clearDefaultSeedOrder() {
  db.exec("DELETE FROM order_items WHERE order_id = 'ord1'");
  db.exec("DELETE FROM orders WHERE id = 'ord1'");
}

function insertApprovedReview({
  reviewId,
  customerId,
  orderId,
  orderItemId,
  groupId,
  createdAt,
  rating = 5,
}) {
  db.prepare(
    `INSERT INTO product_reviews (
      id, customer_id, order_id, order_item_id, group_id, category_id,
      rating, body_text, status, is_anonymous, created_at, approved_at
    ) VALUES (?, ?, ?, ?, ?, 'cat_liq', ?, ?, ?, 0, ?, ?)`,
  ).run(
    reviewId,
    customerId,
    orderId,
    orderItemId,
    groupId,
    rating,
    'Отличная линейка, вкус насыщенный и держится долго',
    REVIEW_STATUSES.APPROVED,
    createdAt,
    createdAt,
  );
}

function insertPendingReview({
  reviewId,
  customerId,
  orderId,
  orderItemId,
  groupId,
  createdAt,
  rating = 5,
}) {
  db.prepare(
    `INSERT INTO product_reviews (
      id, customer_id, order_id, order_item_id, group_id, category_id,
      rating, body_text, status, is_anonymous, created_at, approved_at
    ) VALUES (?, ?, ?, ?, ?, 'cat_liq', ?, ?, ?, 0, ?, NULL)`,
  ).run(
    reviewId,
    customerId,
    orderId,
    orderItemId,
    groupId,
    rating,
    'Отличная линейка, жду публикации после модерации',
    REVIEW_STATUSES.PENDING,
    createdAt,
  );
}

function seedZloyLine() {
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp_zloy', 'cat_liq', 'grp_zloy', 'Жидкая злая', 4, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, createdAt)
     VALUES ('prod_zloy', 'cat_liq', 'grp_zloy', 'Жидкая злая', 14, '', 5, DATETIME('now'))`,
  ).run();
}

console.log('\n=== product-reviews core ===\n');

console.log('--- resolveReviewCategoryKey ---');
{
  ok(
    resolveReviewCategoryKey({ slug: 'salt-liquids', storefrontFiltersProfile: 'liquids' }) === 'liquids',
    'liquids category',
  );
  ok(
    resolveReviewCategoryKey({ slug: 'accessories' }) === 'consumables',
    'consumables from accessories slug',
  );
}

console.log('\n--- validateReviewBodyText ---');
{
  let threw = false;
  try {
    validateReviewBodyText('коротко');
  } catch (error) {
    threw = error.code === 'review_body_too_short';
  }
  ok(threw, 'rejects short body');

  ok(
    validateReviewBodyText('Мне очень понравился вкус, беру ещё раз') ===
      'Мне очень понравился вкус, беру ещё раз',
    'accepts long enough body',
  );

  let tooLong = false;
  try {
    validateReviewBodyText('а'.repeat(MAX_REVIEW_BODY_LENGTH + 1));
  } catch (error) {
    tooLong = error.code === 'review_body_too_long';
  }
  ok(tooLong, 'rejects overly long body');

  ok(
    validateReviewBodyText('а'.repeat(MAX_REVIEW_BODY_LENGTH)).length === MAX_REVIEW_BODY_LENGTH,
    'accepts body at max length',
  );
}

console.log('\n--- eligibility ---');
{
  seedBase();
  const eligible = getGroupReviewEligibility({
    customerId: 'cust1',
    groupId: 'grp1',
    orderId: 'ord1',
    orderItemId: 'oi1',
  });
  ok(eligible.canReview === true, 'eligible after delivered purchase');
  ok(eligible.purchasedVariantName === 'Ананасовая шипучка', 'captures purchased variant');
}

console.log('\n--- create + cooldown ---');
{
  seedBase();
  const review = createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp1',
    orderItemId: 'oi1',
    rating: 5,
    bodyText: 'Отличная линейка, вкус сочный и насыщенный',
    quickTagIds: [],
    isAnonymous: false,
  });
  ok(review?.id, 'review created');
  ok(review.status === REVIEW_STATUSES.PENDING, 'pending moderation');

  const blocked = getGroupReviewEligibility({
    customerId: 'cust1',
    groupId: 'grp1',
    orderId: 'ord1',
  });
  ok(blocked.canReview === false, 'blocked while pending');
  ok(blocked.reason === 'pending_moderation', 'pending reason');
}

console.log('\n--- review prompt ---');
{
  seedBase();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get('cust1');

  createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp1',
    orderItemId: 'oi1',
    rating: 5,
    bodyText: 'Отличная линейка, вкус сочный и насыщенный',
    quickTagIds: [],
    isAnonymous: false,
  });

  const hiddenWhilePending = getReviewPromptForCustomer(customer);
  ok(hiddenWhilePending.show === false, 'no prompt while pending moderation blocks line');

  db.prepare(`UPDATE product_reviews SET status = 'rejected' WHERE customer_id = ?`).run('cust1');
  const promptAfterReject = getReviewPromptForCustomer(customer);
  ok(promptAfterReject.show === true, 'prompt returns when line becomes reviewable again');

  db.prepare(`UPDATE customers SET reviews_opt_out = 1 WHERE id = ?`).run('cust1');
  const optedOut = getReviewPromptForCustomer(
    db.prepare('SELECT * FROM customers WHERE id = ?').get('cust1'),
  );
  ok(optedOut.show === false && optedOut.reason === 'opt_out', 'opt-out hides prompt');
  ok(
    optedOut.preferences?.reviews_opt_out === true,
    'opt-out prompt includes preferences',
  );

  db.prepare(`UPDATE customers SET reviews_opt_out = 0, reviews_prefer_anonymous = 1 WHERE id = ?`).run(
    'cust1',
  );
  const withPrefs = getReviewPromptForCustomer(
    db.prepare('SELECT * FROM customers WHERE id = ?').get('cust1'),
  );
  ok(
    withPrefs.preferences?.reviews_prefer_anonymous === true,
    'prompt exposes prefer_anonymous preference',
  );
}

console.log('\n--- parent vs child public review summaries ---');
{
  seedBase();
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, parent_group_id, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp_parent', 'cat_liq', NULL, 'podonki', 'PODONKI', 0, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, parent_group_id, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp_child', 'cat_liq', 'grp_parent', 'podonki-podgon', 'PODONKI PODGON', 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(`UPDATE products SET groupId = 'grp_child' WHERE id = 'prod1'`).run();

  createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp_child',
    orderItemId: 'oi1',
    rating: 5,
    bodyText: 'Отличная линейка, беру не первый раз',
    quickTagIds: [],
    isAnonymous: false,
  });
  const childReviewId = db.prepare('SELECT id FROM product_reviews LIMIT 1').get().id;
  db.prepare(`UPDATE product_reviews SET status = 'approved', approved_at = DATETIME('now') WHERE id = ?`).run(
    childReviewId,
  );

  const parentSummary = getPublicGroupReviews('grp_parent', { limit: 1, offset: 0 });
  const childSummary = getPublicGroupReviews('grp_child', { limit: 1, offset: 0 });

  ok(parentSummary.review_count === 0, 'parent group summary stays empty');
  ok(childSummary.review_count === 1, 'child line keeps published review');
  ok(childSummary.average_rating === 5, 'child line average rating is exposed');
}

console.log('\n--- resolve purchased variant name ---');
{
  ok(
    resolvePurchasedVariantName({ variantName: 'Rose red' }) === 'Rose red',
    'prefers explicit variant_name',
  );
  ok(
    resolvePurchasedVariantName({
      productTitle: 'Сладкая мята',
      groupName: 'Снюс DRYMOST 75MG',
    }) === 'Сладкая мята',
    'uses product title as flavor when variant is missing',
  );
  ok(
    resolvePurchasedVariantName({
      productTitle: 'XROS 5 MINI - Rose red',
      baseProductTitle: 'XROS 5 MINI',
      groupName: 'XROS 5 MINI',
    }) === 'Rose red',
    'extracts device color from composite title',
  );
  ok(
    resolvePurchasedVariantName({
      productTitle: 'XROS 5 MINI',
      baseProductTitle: 'XROS 5 MINI',
      groupName: 'XROS 5 MINI',
    }) === null,
    'skips variant label when only base device title is present',
  );
}

console.log('\n--- public reviews ---');
{
  seedBase();
  createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp1',
    orderItemId: 'oi1',
    rating: 4,
    bodyText: 'Нормальная линейка, в целом доволен покупкой',
    quickTagIds: [],
    isAnonymous: true,
  });
  const reviewId = db.prepare('SELECT id FROM product_reviews LIMIT 1').get().id;
  db.prepare(`UPDATE product_reviews SET status = 'approved', approved_at = DATETIME('now') WHERE id = ?`).run(reviewId);

  const publicReviews = getPublicGroupReviews('grp1');
  ok(publicReviews.review_count === 1, 'one public review');
  ok(publicReviews.items[0].reviewer.is_anonymous === true, 'anonymous mask');
  ok(publicReviews.items[0].purchased_variant_name === 'Ананасовая шипучка', 'variant in public review');
}

console.log('\n--- public reviews expose proxied reviewer avatar ---');
{
  seedBase();
  db.prepare(
    `UPDATE customers
     SET photo_url = 'https://api.telegram.org/file/botSECRET_TOKEN/photos/file.jpg'
     WHERE id = 'cust1'`,
  ).run();
  const { customerAvatarDir } = await import('../utils/customer-photo-disk.js');
  fs.mkdirSync(customerAvatarDir, { recursive: true });
  fs.writeFileSync(path.join(customerAvatarDir, 'cust1.jpg'), Buffer.from('avatar'));
  const review = createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp1',
    orderItemId: 'oi1',
    rating: 5,
    bodyText: 'Отличная жидкость, вкус держится долго и приятный',
    quickTagIds: [],
    isAnonymous: false,
  });
  db.prepare(`UPDATE product_reviews SET status = 'approved', approved_at = DATETIME('now') WHERE id = ?`).run(
    review.id,
  );

  const publicReviews = getPublicGroupReviews('grp1');
  ok(publicReviews.items[0].reviewer.photo_url === '/api/customer-photo/cust1', 'reviewer photo uses proxy url');
  ok(!JSON.stringify(publicReviews.items[0]).includes('SECRET_TOKEN'), 'review payload hides bot token');
}

console.log('\n--- public reviews expose t.me avatar without disk cache ---');
{
  seedBase();
  db.prepare(
    `UPDATE customers
     SET photo_url = 'https://t.me/i/userpic/320/cust1.jpg'
     WHERE id = 'cust1'`,
  ).run();
  const review = createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp1',
    orderItemId: 'oi1',
    rating: 5,
    bodyText: 'Отличная жидкость, вкус держится долго и приятный',
    quickTagIds: [],
    isAnonymous: false,
  });
  db.prepare(`UPDATE product_reviews SET status = 'approved', approved_at = DATETIME('now') WHERE id = ?`).run(
    review.id,
  );

  const publicReviews = getPublicGroupReviews('grp1');
  ok(
    publicReviews.items[0].reviewer.photo_url === 'https://t.me/i/userpic/320/cust1.jpg',
    'reviewer photo uses safe t.me url',
  );
}

console.log('\n--- public reviews hide avatar url until disk cache exists ---');
{
  seedBase();
  const { customerAvatarDir } = await import('../utils/customer-photo-disk.js');
  const cachedAvatarPath = path.join(customerAvatarDir, 'cust1.jpg');
  if (fs.existsSync(cachedAvatarPath)) {
    fs.unlinkSync(cachedAvatarPath);
  }
  db.prepare(
    `UPDATE customers
     SET photo_url = 'https://api.telegram.org/file/botSECRET_TOKEN/photos/file.jpg'
     WHERE id = 'cust1'`,
  ).run();
  const review = createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp1',
    orderItemId: 'oi1',
    rating: 5,
    bodyText: 'Отличная жидкость, вкус держится долго и приятный',
    quickTagIds: [],
    isAnonymous: false,
  });
  db.prepare(`UPDATE product_reviews SET status = 'approved', approved_at = DATETIME('now') WHERE id = ?`).run(
    review.id,
  );

  const publicReviews = getPublicGroupReviews('grp1');
  ok(publicReviews.items[0].reviewer.photo_url === null, 'reviewer photo hidden without disk cache');
}

console.log('\n--- public reviews mark viewer reviewer ---');
{
  seedBase();
  const review = createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp1',
    orderItemId: 'oi1',
    rating: 5,
    bodyText: 'Отличная жидкость, вкус держится долго и приятный',
    quickTagIds: [],
    isAnonymous: false,
  });
  db.prepare(`UPDATE product_reviews SET status = 'approved', approved_at = DATETIME('now') WHERE id = ?`).run(
    review.id,
  );
  const publicReviews = getPublicGroupReviews('grp1', { viewerCustomerId: 'cust1' });
  ok(publicReviews.items[0].reviewer.is_viewer === true, 'viewer flag on own review');
  ok(publicReviews.items[0].reviewer.is_anonymous === false, 'viewer flag only on named review');
}

console.log('\n--- public reviews backfill flavor from order item ---');
{
  db.exec('DELETE FROM product_reviews;');
  db.exec('DELETE FROM order_items;');
  db.exec('DELETE FROM orders;');
  db.exec('DELETE FROM products;');
  db.exec('DELETE FROM category_groups;');
  db.exec('DELETE FROM categories;');

  db.prepare(
    `INSERT INTO categories (id, slug, name, [order], hide_empty, storefront_filters_profile)
     VALUES ('cat_snus', 'snus', 'Снюс', 1, 0, 'snus_plates')`,
  ).run();
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp_snus', 'cat_snus', 'grp_snus', 'Снюс DRYMOST 75MG', 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, createdAt)
     VALUES ('prod_snus', 'cat_snus', 'grp_snus', 'Сладкая мята', 8, '', 5, DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, completed_at, created_at, updated_at)
     VALUES ('ord_snus', 2001, 'cust1', 'delivered', 8, 8, DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (
      id, order_id, product_id, product_title, group_name, base_product_title, variant_name,
      quantity, price_per_unit, total_price, total_cost
    ) VALUES ('oi_snus', 'ord_snus', 'prod_snus', 'Сладкая мята', 'Снюс DRYMOST 75MG', 'Сладкая мята', NULL, 1, 8, 8, 4)`,
  ).run();

  createProductReview({
    customerId: 'cust1',
    orderId: 'ord_snus',
    groupId: 'grp_snus',
    orderItemId: 'oi_snus',
    rating: 5,
    bodyText: 'Все отлично, и по цене одно из лучших предложений',
    quickTagIds: [],
    isAnonymous: false,
  });

  const reviewId = db.prepare('SELECT id FROM product_reviews LIMIT 1').get().id;
  db.prepare(
    `UPDATE product_reviews
     SET status = 'approved', approved_at = DATETIME('now'), purchased_variant_name = NULL
     WHERE id = ?`,
  ).run(reviewId);

  const publicReviews = getPublicGroupReviews('grp_snus');
  ok(publicReviews.review_count === 1, 'one snus public review');
  ok(
    publicReviews.items[0].purchased_variant_name === 'Сладкая мята',
    'public review backfills flavor from order item',
  );
}

console.log('\n--- order history line icons ---');
{
  seedBase();
  db.prepare(`UPDATE categories SET cover_image = ? WHERE id = ?`).run(
    'data:image/webp;base64,CATEGORY_COVER',
    'cat_liq',
  );
  db.prepare(`UPDATE category_groups SET cover_image = ? WHERE id = ?`).run(
    'data:image/webp;base64,GROUP_ONE_COVER',
    'grp1',
  );
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, cover_image, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp2', 'cat_liq', 'grp2', 'Другая линейка', 'data:image/webp;base64,GROUP_TWO_COVER', 2, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, createdAt)
     VALUES ('prod2', 'cat_liq', 'grp2', 'Манго', 12, '', 5, DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi2', 'ord1', 'prod2', 'Манго', 'Манговая', 1, 12, 12, 5)`,
  ).run();

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get('ord1');
  const card = serializeOrderHistoryCard(order);

  ok(card.category_icons.length === 2, 'two line icons for two groups in one category');
  ok(
    card.category_icons.every((icon) => icon.image?.includes('GROUP_') && !icon.image?.includes('CATEGORY')),
    'history thumbs prefer group cover, not parent category cover',
  );
  ok(card.category_icons[0].group_id === 'grp1', 'first icon is first product line');
  ok(
    buildOrderLineIconsFromGroups([
      {
        group_id: 'grp1',
        category_id: 'cat_liq',
        category_name: 'Жидкости',
        group_name: 'Подонки',
        group_cover_image: null,
        category_cover_image: 'data:image/webp;base64,CATEGORY_ONLY',
      },
    ]).icons[0].image?.includes('CATEGORY_ONLY'),
    'category cover is fallback when group cover is missing',
  );
}

console.log('\n--- fulfillment milestones ---');
{
  seedBase();
  const submittedAt = '2026-06-19T09:54:00.000Z';
  const readyAt = '2026-06-19T09:56:00.000Z';
  const issuedAt = '2026-06-19T10:04:00.000Z';
  db.prepare(`UPDATE orders SET delivery_type = 'pickup', created_at = ?, completed_at = ? WHERE id = ?`).run(
    submittedAt,
    issuedAt,
    'ord1',
  );
  db.prepare(
    `INSERT INTO order_status_history (id, order_id, previous_status, new_status, changed_at)
     VALUES ('osh1', 'ord1', NULL, 'new', ?), ('osh2', 'ord1', 'new', 'in_progress', ?), ('osh3', 'ord1', 'in_progress', 'delivered', ?)`,
  ).run(submittedAt, readyAt, issuedAt);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get('ord1');
  const milestones = buildOrderFulfillmentMilestones(order);
  const card = serializeOrderHistoryCard(order);

  ok(milestones.submitted_at === submittedAt, 'submitted milestone');
  ok(milestones.ready_at === readyAt, 'ready milestone');
  ok(milestones.issued_at === issuedAt, 'issued milestone');
  ok(card.delivery_type === 'pickup', 'history card exposes delivery type');
  ok(card.fulfillment_milestones.ready_at === readyAt, 'history card exposes milestones');
  ok(!('pending_review_count' in card), 'history card omits pending_review_count');
  ok(!('has_reviews' in card), 'history card omits has_reviews');
}

console.log('\n--- fulfillment milestones prefer status history over completed_at ---');
{
  seedBase();
  const readyAt = '2026-06-22 17:09:41';
  const historyIssuedAt = '2026-06-22 17:09:44';
  const wrongCompletedAt = '2026-06-22T17:09:44.459Z';

  db.prepare(
    `UPDATE orders
     SET delivery_type = 'pickup', created_at = '2026-06-22 17:08:55', completed_at = ?, status = 'delivered'
     WHERE id = ?`,
  ).run(wrongCompletedAt, 'ord1');
  db.prepare('DELETE FROM order_status_history WHERE order_id = ?').run('ord1');
  db.prepare(
    `INSERT INTO order_status_history (id, order_id, previous_status, new_status, changed_at)
     VALUES ('osh_a', 'ord1', 'new', 'in_progress', ?),
            ('osh_b', 'ord1', 'in_progress', 'delivered', ?)`,
  ).run(readyAt, historyIssuedAt);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get('ord1');
  const milestones = buildOrderFulfillmentMilestones(order);

  ok(milestones.ready_at === readyAt, 'ready milestone from history');
  ok(milestones.issued_at === historyIssuedAt, 'issued prefers status history over ISO completed_at');
  ok(milestones.issued_at !== wrongCompletedAt, 'issued does not expose shifted completed_at');
}

console.log('\n--- repeat purchase: same line within cooldown ---');
{
  seedBase();
  clearDefaultSeedOrder();
  setReviewSetting('cooldown_days', '90');
  seedRepeatPurchaseGroup();

  const firstCreatedAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  const firstOrder = createDeliveredOrder({
    orderId: 'ord_last_hap_1',
    orderNumber: 2001,
    orderItemId: 'oi_last_hap_1',
    createdAt: firstCreatedAt,
    completedAt: firstCreatedAt,
  });
  insertApprovedReview({
    reviewId: 'rev_last_hap_1',
    customerId: 'cust1',
    orderId: 'ord_last_hap_1',
    orderItemId: 'oi_last_hap_1',
    groupId: 'grp_last_hap',
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const secondCreatedAt = new Date().toISOString();
  const secondOrder = createDeliveredOrder({
    orderId: 'ord_last_hap_2',
    orderNumber: 2002,
    orderItemId: 'oi_last_hap_2',
    createdAt: secondCreatedAt,
    completedAt: secondCreatedAt,
  });

  const blocked = getGroupReviewEligibility({
    customerId: 'cust1',
    groupId: 'grp_last_hap',
    orderId: 'ord_last_hap_2',
    orderItemId: 'oi_last_hap_2',
  });
  ok(blocked.canReview === false, 'second purchase within 90d cooldown is not reviewable');
  ok(blocked.reason === 'cooldown', 'repeat purchase reason is cooldown');
  ok(Boolean(blocked.cooldownEndsAt), 'cooldown end date is exposed');

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get('cust1');
  const prompt = getReviewPromptForCustomer(customer);
  ok(prompt.show === false, 'review dock hidden when only repeat line is on cooldown');
  ok(prompt.reason === 'nothing_to_review', 'prompt reason is nothing_to_review');

  const firstOrderLines = buildReviewableLinesForOrder(firstOrder, 'cust1');
  ok(firstOrderLines.length === 1, 'first order exposes one reviewable line');
  ok(firstOrderLines[0].latest_review?.id === 'rev_last_hap_1', 'first order keeps its own review');
  ok(firstOrderLines[0].eligibility.reason === 'cooldown', 'first order line is also in cooldown window');

  const secondOrderLines = buildReviewableLinesForOrder(secondOrder, 'cust1');
  ok(secondOrderLines.length === 1, 'second order exposes one reviewable line');
  ok(secondOrderLines[0].latest_review == null, 'second order has no review tied to that order id');
  ok(secondOrderLines[0].eligibility.reason === 'cooldown', 'second order UI gets cooldown state');

  const secondDetail = serializeOrderDetail(secondOrder, 'cust1');
  ok(secondDetail.reviewable_lines[0].eligibility.canReview === false, 'order detail blocks repeat review');
  ok(
    !('pending_review_count' in serializeOrderHistoryCard(secondOrder)),
    'history card stays compact without review badges',
  );
}

console.log('\n--- repeat purchase: same line after cooldown expires ---');
{
  seedBase();
  clearDefaultSeedOrder();
  setReviewSetting('cooldown_days', '90');
  seedRepeatPurchaseGroup();

  const firstCreatedAt = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
  createDeliveredOrder({
    orderId: 'ord_old',
    orderNumber: 3001,
    orderItemId: 'oi_old',
    createdAt: firstCreatedAt,
    completedAt: firstCreatedAt,
  });
  insertApprovedReview({
    reviewId: 'rev_old',
    customerId: 'cust1',
    orderId: 'ord_old',
    orderItemId: 'oi_old',
    groupId: 'grp_last_hap',
    createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const freshOrder = createDeliveredOrder({
    orderId: 'ord_fresh',
    orderNumber: 3002,
    orderItemId: 'oi_fresh',
  });

  const eligible = getGroupReviewEligibility({
    customerId: 'cust1',
    groupId: 'grp_last_hap',
    orderId: 'ord_fresh',
    orderItemId: 'oi_fresh',
  });
  ok(eligible.canReview === true, 'repeat purchase after cooldown can be reviewed again');
  ok(eligible.orderId === 'ord_fresh', 'eligibility binds to the newest delivered order');

  const prompt = getReviewPromptForCustomer(
    db.prepare('SELECT * FROM customers WHERE id = ?').get('cust1'),
  );
  ok(prompt.show === true, 'review dock appears for post-cooldown repeat purchase');
  ok(prompt.order_id === 'ord_fresh', 'dock points to the newest eligible order');
  ok(prompt.group_id === 'grp_last_hap', 'dock points to the repeat line');
}

console.log('\n--- repeat purchase: rejected review does not start cooldown ---');
{
  seedBase();
  clearDefaultSeedOrder();
  setReviewSetting('cooldown_days', '90');
  seedRepeatPurchaseGroup();

  createDeliveredOrder({
    orderId: 'ord_reject_1',
    orderNumber: 4001,
    orderItemId: 'oi_reject_1',
  });
  const rejected = createProductReview({
    customerId: 'cust1',
    orderId: 'ord_reject_1',
    groupId: 'grp_last_hap',
    orderItemId: 'oi_reject_1',
    rating: 2,
    bodyText: 'Не зашло, вкус странный и быстро надоедает',
    quickTagIds: [],
  });
  db.prepare(`UPDATE product_reviews SET status = ? WHERE id = ?`).run(
    REVIEW_STATUSES.REJECTED,
    rejected.id,
  );

  const repeatOrder = createDeliveredOrder({
    orderId: 'ord_reject_2',
    orderNumber: 4002,
    orderItemId: 'oi_reject_2',
  });

  const eligible = getGroupReviewEligibility({
    customerId: 'cust1',
    groupId: 'grp_last_hap',
    orderId: 'ord_reject_2',
    orderItemId: 'oi_reject_2',
  });
  ok(eligible.canReview === true, 'rejected review does not block a new attempt');
  ok(
    buildReviewableLinesForOrder(repeatOrder, 'cust1')[0].eligibility.canReview === true,
    'repeat order detail shows review form after rejection',
  );
}

console.log('\n--- repeat purchase: mixed lines only prompts reviewable ones ---');
{
  seedBase();
  clearDefaultSeedOrder();
  setReviewSetting('cooldown_days', '90');
  seedRepeatPurchaseGroup();

  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp_other', 'cat_liq', 'grp_other', 'PODONKI OTHER', 3, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, createdAt)
     VALUES ('prod_other', 'cat_liq', 'grp_other', 'PODONKI OTHER', 12, '', 5, DATETIME('now'))`,
  ).run();

  createDeliveredOrder({
    orderId: 'ord_mix_old',
    orderNumber: 5001,
    orderItemId: 'oi_mix_old',
  });
  insertApprovedReview({
    reviewId: 'rev_mix_old',
    customerId: 'cust1',
    orderId: 'ord_mix_old',
    orderItemId: 'oi_mix_old',
    groupId: 'grp_last_hap',
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  });

  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, completed_at, created_at, updated_at)
     VALUES ('ord_mix_new', 5002, 'cust1', 'delivered', 27, 27, DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, group_name, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi_mix_repeat', 'ord_mix_new', 'prod_last_hap', 'PODONKI LAST HAP', 'PODONKI LAST HAP', '50 мг', 1, 15, 15, 6)`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, group_name, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi_mix_other', 'ord_mix_new', 'prod_other', 'PODONKI OTHER', 'PODONKI OTHER', '40 мг', 1, 12, 12, 5)`,
  ).run();

  const prompt = getReviewPromptForCustomer(
    db.prepare('SELECT * FROM customers WHERE id = ?').get('cust1'),
  );
  ok(prompt.show === true, 'dock still appears when another line in the order is reviewable');
  ok(prompt.group_id === 'grp_other', 'dock targets the still-reviewable line');
  ok(prompt.pending_review_count === 1, 'only one pending line is counted');

  const lines = buildReviewableLinesForOrder(
    db.prepare('SELECT * FROM orders WHERE id = ?').get('ord_mix_new'),
    'cust1',
  );
  ok(lines.length === 2, 'mixed order exposes both lines');
  const repeatLine = lines.find((line) => line.group_id === 'grp_last_hap');
  const otherLine = lines.find((line) => line.group_id === 'grp_other');
  ok(repeatLine?.eligibility.reason === 'cooldown', 'repeat line stays on cooldown');
  ok(otherLine?.eligibility.canReview === true, 'fresh line still has the form');
}

console.log('\n--- Konstantin: LAST HAP rebuy after 10d with 30d cooldown ---');
{
  seedBase();
  clearDefaultSeedOrder();
  setReviewSetting('cooldown_days', '30');
  seedRepeatPurchaseGroup();

  const approvedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const firstOrder = createDeliveredOrder({
    orderId: 'ord_konst_1',
    orderNumber: 6001,
    orderItemId: 'oi_konst_1',
    createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
  });
  insertApprovedReview({
    reviewId: 'rev_konst_1',
    customerId: 'cust1',
    orderId: 'ord_konst_1',
    orderItemId: 'oi_konst_1',
    groupId: 'grp_last_hap',
    createdAt: approvedAt,
  });

  const secondOrder = createDeliveredOrder({
    orderId: 'ord_konst_2',
    orderNumber: 6002,
    orderItemId: 'oi_konst_2',
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const blocked = getGroupReviewEligibility({
    customerId: 'cust1',
    groupId: 'grp_last_hap',
    orderId: 'ord_konst_2',
    orderItemId: 'oi_konst_2',
  });
  ok(blocked.canReview === false, '10d rebuy stays blocked under 30d cooldown');
  ok(blocked.reason === 'cooldown', 'repeat purchase reason is cooldown');

  const expectedCooldownEnd = new Date(
    new Date(approvedAt).getTime() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  ok(blocked.cooldownEndsAt === expectedCooldownEnd, 'cooldown end date matches approved review + 30d');

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get('cust1');
  const prompt = getReviewPromptForCustomer(customer);
  ok(prompt.show === false, 'review dock hidden after 10d rebuy of reviewed line');
  ok(prompt.reason === 'nothing_to_review', 'prompt reason is nothing_to_review');

  const secondDetail = serializeOrderDetail(secondOrder, 'cust1');
  ok(
    secondDetail.reviewable_lines[0].eligibility.reason === 'cooldown',
    'order detail explains cooldown on repeat purchase',
  );
  ok(secondDetail.reviewable_lines[0].latest_review == null, 'repeat order has no review on that order id');

  const firstDetail = serializeOrderDetail(firstOrder, 'cust1');
  ok(firstDetail.reviewable_lines[0].latest_review?.id === 'rev_konst_1', 'first order keeps approved review');

  const historyCard = serializeOrderHistoryCard(secondOrder, 'cust1');
  ok(!('pending_review_count' in historyCard), 'history card has no pending_review_count');
  ok(!('has_reviews' in historyCard), 'history card has no review badges');
  ok(
    historyCard.review_hint === 'Отзыв на эту линейку уже оставлен',
    'history card hints cooldown on repeat purchase',
  );
}

console.log('\n--- Dmitriy hole: pending moderation blocks repeat purchase dock ---');
{
  seedBase();
  clearDefaultSeedOrder();
  setReviewSetting('cooldown_days', '30');
  seedRepeatPurchaseGroup();

  createDeliveredOrder({
    orderId: 'ord_pending_1',
    orderNumber: 7001,
    orderItemId: 'oi_pending_1',
    createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
  });
  insertPendingReview({
    reviewId: 'rev_pending_1',
    customerId: 'cust1',
    orderId: 'ord_pending_1',
    orderItemId: 'oi_pending_1',
    groupId: 'grp_last_hap',
    createdAt: new Date(Date.now() - 19 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const repeatOrder = createDeliveredOrder({
    orderId: 'ord_pending_2',
    orderNumber: 7002,
    orderItemId: 'oi_pending_2',
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const blocked = getGroupReviewEligibility({
    customerId: 'cust1',
    groupId: 'grp_last_hap',
    orderId: 'ord_pending_2',
    orderItemId: 'oi_pending_2',
  });
  ok(blocked.canReview === false, 'pending moderation blocks repeat purchase review');
  ok(blocked.reason === 'pending_moderation', 'repeat purchase reason is pending_moderation');
  ok(!blocked.cooldownEndsAt, 'pending review does not expose cooldown end date');

  const prompt = getReviewPromptForCustomer(
    db.prepare('SELECT * FROM customers WHERE id = ?').get('cust1'),
  );
  ok(prompt.show === false, 'review dock hidden while same line is on moderation');

  const repeatLines = buildReviewableLinesForOrder(repeatOrder, 'cust1');
  ok(repeatLines[0].eligibility.reason === 'pending_moderation', 'repeat order detail blocks duplicate review');
  ok(repeatLines[0].latest_review == null, 'repeat order has no scoped review row');

  let duplicateRejected = false;
  try {
    createProductReview({
      customerId: 'cust1',
      orderId: 'ord_pending_2',
      groupId: 'grp_last_hap',
      orderItemId: 'oi_pending_2',
      rating: 4,
      bodyText: 'Повторный отзыв на ту же линейку после повторной покупки',
      quickTagIds: [],
    });
  } catch (error) {
    duplicateRejected = error.code === 'pending_moderation';
  }
  ok(duplicateRejected, 'API rejects second review while first is pending');
}

console.log('\n--- Konstantin: pending on LAST HAP, fresh Zloy in repeat order ---');
{
  seedBase();
  clearDefaultSeedOrder();
  setReviewSetting('cooldown_days', '30');
  seedRepeatPurchaseGroup();
  seedZloyLine();

  createDeliveredOrder({
    orderId: 'ord_mix_pending_old',
    orderNumber: 8001,
    orderItemId: 'oi_mix_pending_old',
  });
  insertPendingReview({
    reviewId: 'rev_mix_pending',
    customerId: 'cust1',
    orderId: 'ord_mix_pending_old',
    orderItemId: 'oi_mix_pending_old',
    groupId: 'grp_last_hap',
    createdAt: new Date().toISOString(),
  });

  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, completed_at, created_at, updated_at)
     VALUES ('ord_mix_pending_new', 8002, 'cust1', 'delivered', 29, 29, DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, group_name, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi_mix_pending_repeat', 'ord_mix_pending_new', 'prod_last_hap', 'PODONKI LAST HAP', 'PODONKI LAST HAP', '50 мг', 1, 15, 15, 6)`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, group_name, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi_mix_pending_zloy', 'ord_mix_pending_new', 'prod_zloy', 'Жидкая злая', 'Жидкая злая', '45 мг', 1, 14, 14, 5)`,
  ).run();

  const prompt = getReviewPromptForCustomer(
    db.prepare('SELECT * FROM customers WHERE id = ?').get('cust1'),
  );
  ok(prompt.show === true, 'dock appears when another line is still reviewable');
  ok(prompt.group_id === 'grp_zloy', 'dock targets the never-reviewed line');
  ok(prompt.group_name === 'Жидкая злая', 'dock names the fresh line');

  const lines = buildReviewableLinesForOrder(
    db.prepare('SELECT * FROM orders WHERE id = ?').get('ord_mix_pending_new'),
    'cust1',
  );
  const lastHapLine = lines.find((line) => line.group_id === 'grp_last_hap');
  const zloyLine = lines.find((line) => line.group_id === 'grp_zloy');
  ok(lastHapLine?.eligibility.reason === 'pending_moderation', 'LAST HAP stays blocked by pending review');
  ok(zloyLine?.eligibility.canReview === true, 'Жидкая злая remains reviewable');
}

console.log('\n--- per-line cooldown does not block other lines ---');
{
  seedBase();
  clearDefaultSeedOrder();
  setReviewSetting('cooldown_days', '30');
  seedRepeatPurchaseGroup();
  seedZloyLine();

  createDeliveredOrder({
    orderId: 'ord_iso_old',
    orderNumber: 9001,
    orderItemId: 'oi_iso_old',
  });
  insertApprovedReview({
    reviewId: 'rev_iso_old',
    customerId: 'cust1',
    orderId: 'ord_iso_old',
    orderItemId: 'oi_iso_old',
    groupId: 'grp_last_hap',
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const zloyOrder = createDeliveredOrder({
    orderId: 'ord_iso_zloy',
    orderNumber: 9002,
    orderItemId: 'oi_iso_zloy',
    productId: 'prod_zloy',
    groupId: 'grp_zloy',
    groupName: 'Жидкая злая',
  });

  const zloyEligible = getGroupReviewEligibility({
    customerId: 'cust1',
    groupId: 'grp_zloy',
    orderId: 'ord_iso_zloy',
    orderItemId: 'oi_iso_zloy',
  });
  ok(zloyEligible.canReview === true, 'cooldown on LAST HAP does not block Zloy');
  ok(
    buildReviewableLinesForOrder(zloyOrder, 'cust1')[0].eligibility.canReview === true,
    'Zloy order detail exposes review form',
  );
}

console.log('\n--- cooldown setting ---');
{
  seedBase();
  setReviewSetting('cooldown_days', '90');
  ok(getCooldownDays() === 90, 'default cooldown is 90 days');

  setReviewSetting('cooldown_days', '30');
  ok(getCooldownDays() === 30, 'admin cooldown_days=30 is respected');
}

function seedSnusAndDeviceCatalog() {
  db.prepare(
    `INSERT INTO categories (id, slug, name, [order], hide_empty, storefront_filters_profile)
     VALUES ('cat_snus', 'snus', 'Снюс', 2, 0, 'snus')`,
  ).run();
  db.prepare(
    `INSERT INTO categories (id, slug, name, [order], hide_empty, storefront_filters_profile)
     VALUES ('cat_dev', 'devices', 'Устройства', 3, 0, 'devices')`,
  ).run();
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp_snus', 'cat_snus', 'iceberg', 'ICEBERG 150', 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO category_groups (id, categoryId, slug, name, [order], hide_empty, createdAt, updatedAt)
     VALUES ('grp_xros', 'cat_dev', 'xros5', 'XROS 5 MINI', 1, 0, DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO products (id, categoryId, groupId, title, priceRub, description, stock, has_variants, createdAt)
     VALUES ('prod_snus', 'cat_snus', 'grp_snus', 'Хвоя', 15, '', 5, 0, DATETIME('now')),
            ('prod_xros', 'cat_dev', 'grp_xros', 'XROS 5 MINI', 0, '', 5, 1, DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO product_variants (id, product_id, name, price_rub, stock, position, created_at)
     VALUES ('var_xros_red', 'prod_xros', 'Rose red', 75, 3, 0, DATETIME('now'))`,
  ).run();
}

function insertMixedDeliveredOrder({
  orderId,
  orderNumber,
  snusTotal = 15,
  deviceTotal = 75,
  notes = null,
}) {
  const finalAmount = snusTotal + deviceTotal;
  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, notes, completed_at, created_at, updated_at)
     VALUES (?, ?, 'cust1', 'delivered', ?, ?, ?, DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
  ).run(orderId, orderNumber, finalAmount, finalAmount, notes);

  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, group_name, variant_id, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi_snus', ?, 'prod_snus', 'Хвоя', 'ICEBERG 150', NULL, 'Хвоя', 1, ?, ?, 6)`,
  ).run(orderId, snusTotal, snusTotal);

  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, group_name, variant_id, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi_xros', ?, 'prod_xros', 'XROS 5 MINI', 'XROS 5 MINI', 'var_xros_red', 'Rose red', 1, ?, ?, 30)`,
  ).run(orderId, deviceTotal, deviceTotal);

  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

console.log('\n--- review line totals: mixed snus + device order ---');
{
  seedBase();
  clearDefaultSeedOrder();
  seedSnusAndDeviceCatalog();

  const order = insertMixedDeliveredOrder({
    orderId: 'ord_mix_snus_dev',
    orderNumber: 9116,
    snusTotal: 15,
    deviceTotal: 75,
    notes: '[rk0ff-test-orders]',
  });

  const detail = serializeOrderDetail(order, 'cust1');
  ok(detail.final_amount === 90, 'mixed order final_amount is 90');
  ok(detail.reviewable_lines.length === 2, 'mixed order exposes two review lines');

  const snusLine = detail.reviewable_lines.find((line) => line.group_id === 'grp_snus');
  const deviceLine = detail.reviewable_lines.find((line) => line.group_id === 'grp_xros');
  ok(
    snusLine?.items.reduce((sum, item) => sum + item.total_price, 0) === 15,
    'snus review line total is 15',
  );
  ok(
    deviceLine?.items.reduce((sum, item) => sum + item.total_price, 0) === 75,
    'device review line total is 75',
  );
  ok(deviceLine?.purchased_variant_name === 'Rose red', 'device line keeps variant label');
}

console.log('\n--- review line totals: legacy zero-priced device row (rk0ff artifact) ---');
{
  seedBase();
  clearDefaultSeedOrder();
  seedSnusAndDeviceCatalog();

  const order = insertMixedDeliveredOrder({
    orderId: 'ord_mix_bad_device',
    orderNumber: 9117,
    snusTotal: 15,
    deviceTotal: 0,
  });

  const detail = serializeOrderDetail(order, 'cust1');
  const deviceLine = detail.reviewable_lines.find((line) => line.group_id === 'grp_xros');
  ok(
    deviceLine?.items[0]?.total_price === 0,
    'legacy bad device row still serializes as 0 BYN',
  );
  ok(detail.final_amount === 15, 'order total can disagree with real retail when device row is zero');
}

console.log('\n--- review line totals: multiple items in one group ---');
{
  seedBase();
  clearDefaultSeedOrder();

  db.prepare(
    `INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount, completed_at, created_at, updated_at)
     VALUES ('ord_multi_qty', 9118, 'cust1', 'delivered', 30, 30, DATETIME('now'), DATETIME('now'), DATETIME('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_title, group_name, variant_name, quantity, price_per_unit, total_price, total_cost)
     VALUES ('oi_multi_1', 'ord_multi_qty', 'prod1', 'Ананас', 'Подонки', 'Вкус 1', 1, 10, 10, 4),
            ('oi_multi_2', 'ord_multi_qty', 'prod1', 'Ананас', 'Подонки', 'Вкус 2', 1, 20, 20, 8)`,
  ).run();

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get('ord_multi_qty');
  const lines = buildReviewableLinesForOrder(order, 'cust1');
  ok(lines.length === 1, 'same group collapses to one review line');
  ok(
    lines[0].items.reduce((sum, item) => sum + item.total_price, 0) === 30,
    'group line total sums all order_items',
  );
}

console.log('\n--- QA usernames: parse and bypass ---');
{
  setReviewSetting('dev_test_mode', '0');
  setReviewSetting('qa_active', '0');
  setQaUsernames(['rk0ff', '@Review_Demo']);

  ok(parseQaUsernames('rk0ff, @demo\nfoo').join(',') === 'rk0ff,demo,foo', 'parse usernames');
  ok(!shouldDevBypassForCustomer({ telegram_username: 'rk0ff' }), 'no bypass when qa inactive');

  setReviewSetting('qa_active', '1');
  ok(isQaReviewUser({ telegram_username: 'review_demo' }), 'qa user recognized');
  ok(!isQaReviewUser({ telegram_username: 'stranger' }), 'non-qa user rejected');
  ok(shouldDevBypassForCustomer({ telegram_username: 'review_demo' }), 'qa user bypass');

  seedBase();
  createProductReview({
    customerId: 'cust1',
    orderId: 'ord1',
    groupId: 'grp1',
    orderItemId: 'oi1',
    rating: 5,
    bodyText: 'QA отзыв на линейку, всё отлично',
    quickTagIds: [],
    devBypass: true,
  });
  const qaBlocked = getGroupReviewEligibility({
    customerId: 'cust1',
    groupId: 'grp1',
    orderId: 'ord1',
    devBypass: true,
  });
  ok(qaBlocked.canReview === false && qaBlocked.reason === 'pending_moderation', 'qa bypass still blocks duplicate pending');

  setReviewSetting('dev_test_mode', '1');
  ok(shouldDevBypassForCustomer({ telegram_username: 'anyone' }), 'global dev mode bypass');
  setReviewSetting('dev_test_mode', '0');
  setReviewSetting('qa_active', '0');
}

console.log(`\nDone: ${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);