import { db } from '../db.js';
import { getReviewPeriodKey } from './review-monthly-draw.js';

export const SCENARIO_TAG = '[dev-reviews-scenarios]';

export const REVIEW_QA_PERSONAS = {
  fresh: { telegramId: '900000001', username: 'review_demo', firstName: 'Review Demo' },
  pending: { telegramId: '900000002', username: 'review_pending', firstName: 'Pending User' },
  cooldown: { telegramId: '900000003', username: 'review_cooldown', firstName: 'Cooldown User' },
  optout: { telegramId: '900000004', username: 'review_optout', firstName: 'Opt Out User' },
};

export const REVIEW_QA_WINNER_PERSONAS = [
  { telegramId: '900000101', username: 'winner_anna', firstName: 'Anna' },
  { telegramId: '900000102', username: 'winner_boris', firstName: 'Boris' },
  { telegramId: '900000103', username: 'winner_clara', firstName: 'Clara' },
  { telegramId: '900000104', username: 'winner_denis', firstName: 'Denis' },
  { telegramId: '900000105', username: 'winner_elena', firstName: 'Elena' },
];

function nextOrderNumber() {
  const row = db.prepare('SELECT COALESCE(MAX(order_number), 0) + 1 AS n FROM orders').get();
  return Number(row?.n || 1);
}

function upsertCustomer({ id, telegramId, username, firstName, optOut = 0, now }) {
  const existing = db.prepare('SELECT id FROM customers WHERE telegram_id = ?').get(telegramId);
  const customerId = existing?.id || id;

  if (existing) {
    db.prepare(`
      UPDATE customers
      SET telegram_username = ?, first_name = ?, reviews_opt_out = ?, updated_at = ?
      WHERE id = ?
    `).run(username, firstName, optOut, now, customerId);
  } else {
    db.prepare(`
      INSERT INTO customers (
        id, telegram_id, telegram_username, first_name,
        reviews_opt_out, reviews_prefer_anonymous, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(customerId, telegramId, username, firstName, optOut, now, now);
  }

  return customerId;
}

function pickCatalogGroups(limit = 4) {
  const rows = db.prepare(`
    SELECT
      cg.id AS group_id,
      cg.name AS group_name,
      cg.categoryId AS category_id,
      c.name AS category_name,
      c.storefront_filters_profile
    FROM category_groups cg
    JOIN categories c ON c.id = cg.categoryId
    JOIN products p ON p.groupId = cg.id
    GROUP BY cg.id
    ORDER BY c.[order], cg.[order], cg.name
    LIMIT ?
  `).all(limit);

  if (rows.length < 2) {
    throw new Error('В каталоге недостаточно линейок для демо-сценариев.');
  }
  return rows;
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

function createDeliveredOrder({
  orderId,
  customerId,
  lines,
  now,
  submittedMinutesAgo = 30,
  issuedMinutesAgo = 2,
}) {
  const orderNumber = nextOrderNumber();
  const total = lines.reduce((sum, line) => sum + Number(line.price_rub || 0), 0);
  const submittedAt = new Date(Date.now() - submittedMinutesAgo * 60 * 1000).toISOString();
  const issuedAt = new Date(Date.now() - issuedMinutesAgo * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO orders (
      id, order_number, customer_id, status, delivery_type, delivery_address,
      total_amount, discount_amount, final_amount, notes, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'delivered', 'pickup', NULL, ?, 0, ?, ?, ?, ?, ?)
  `).run(orderId, orderNumber, customerId, total, total, SCENARIO_TAG, issuedAt, submittedAt, issuedAt);

  const insertItem = db.prepare(`
    INSERT INTO order_items (
      id, order_id, product_id, product_title, variant_name, quantity, price_per_unit, total_price, total_cost
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0)
  `);

  const orderItems = [];
  lines.forEach((line, index) => {
    const itemId = `${orderId}_item_${index}`;
    const variantName = line.storefront_filters_profile === 'liquids'
      ? 'Ананасовая шипучка (demo)'
      : null;
    insertItem.run(
      itemId,
      orderId,
      line.product_id,
      line.product_title,
      variantName,
      Number(line.price_rub || 0),
      Number(line.price_rub || 0),
    );
    orderItems.push({
      id: itemId,
      group_id: line.group_id,
      category_id: line.category_id,
      variant_name: variantName,
    });
  });

  return { orderNumber, orderItems, issuedAt };
}

function insertReview({
  id,
  customerId,
  orderId,
  orderItemId,
  groupId,
  categoryId,
  rating,
  bodyText,
  status,
  createdAt,
  managerReply = null,
  variantName = null,
}) {
  const now = createdAt || new Date().toISOString();
  db.prepare(`
    INSERT INTO product_reviews (
      id, customer_id, order_id, order_item_id, group_id, category_id,
      purchased_variant_name, rating, body_text, quick_tag_ids, status,
      manager_reply, manager_replied_at, created_at, updated_at, approved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    customerId,
    orderId,
    orderItemId,
    groupId,
    categoryId,
    variantName,
    rating,
    bodyText,
    status,
    managerReply,
    managerReply ? now : null,
    now,
    now,
    status === 'approved' ? now : null,
  );
}

function ensureLiquidsQuickTags() {
  const existing = db.prepare(`
    SELECT COUNT(*) AS count FROM review_quick_tags WHERE category_key = 'liquids'
  `).get();
  if (Number(existing?.count || 0) >= 10) return;

  db.prepare(`DELETE FROM review_quick_tags WHERE id LIKE 'rqt_dev_scn_%'`).run();
  const tagsByStar = {
    5: ['Яркий вкус', 'Мягко в горло', 'Беру снова'],
    4: ['Вкус нравится', 'Крепость ровная', 'Хорошее качество'],
    3: ['Нормально', 'Средняя крепость', 'Без сюрпризов'],
    2: ['Вкус слабый', 'Крепость не та', 'Ожидал больше'],
    1: ['Не зашёл вкус', 'Слишком крепко', 'Не советую'],
  };
  const insert = db.prepare(`
    INSERT INTO review_quick_tags (id, category_key, star_rating, label, insert_text, sort_order, is_active)
    VALUES (?, 'liquids', ?, ?, ?, ?, 1)
  `);
  let sortOrder = 0;
  for (const star of [5, 4, 3, 2, 1]) {
    for (const [index, label] of tagsByStar[star].entries()) {
      insert.run(`rqt_dev_scn_${star}_${index + 1}`, star, label, label, sortOrder);
      sortOrder += 1;
    }
  }
}

function ensureReviewSettings() {
  const upsert = db.prepare(`
    INSERT INTO review_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  upsert.run('lottery_hint_text', 'В конце месяца разыгрываем 5 подарков среди оставивших отзывы');
  upsert.run('manager_display_name', 'Manager Rezonsky (demo)');
  upsert.run('manager_avatar_url', '/favicon.png');
  upsert.run('dev_test_mode', '0');
  upsert.run('cooldown_days', '90');
}

function deleteOrdersByIds(orderIds) {
  if (!orderIds.length) return;
  const placeholders = orderIds.map(() => '?').join(', ');
  db.prepare(`DELETE FROM product_reviews WHERE order_id IN (${placeholders})`).run(...orderIds);
  db.prepare(`DELETE FROM order_items WHERE order_id IN (${placeholders})`).run(...orderIds);
  db.prepare(`DELETE FROM orders WHERE id IN (${placeholders})`).run(...orderIds);
}

function resetOrdersForTelegramIds(telegramIds) {
  for (const telegramId of telegramIds) {
    const customer = db.prepare('SELECT id FROM customers WHERE telegram_id = ?').get(telegramId);
    if (!customer) continue;
    const orderIds = db.prepare('SELECT id FROM orders WHERE customer_id = ?')
      .all(customer.id)
      .map((row) => row.id);
    deleteOrdersByIds(orderIds);
  }
}

function resetScenarioData(periodKey) {
  const orderIds = db.prepare(`
    SELECT id FROM orders WHERE notes = ?
  `).all(SCENARIO_TAG).map((row) => row.id);
  deleteOrdersByIds(orderIds);

  db.prepare(`DELETE FROM product_reviews WHERE id LIKE 'rev_dev_scn_%'`).run();
  db.prepare(`DELETE FROM review_monthly_draw_winners WHERE draw_id LIKE 'draw_dev_scn_%'`).run();
  db.prepare(`DELETE FROM review_monthly_draws WHERE id LIKE 'draw_dev_scn_%' OR period_key = ?`).run(periodKey);
  db.prepare(`DELETE FROM customers WHERE id LIKE 'cust_dev_scn_%'`).run();

  resetOrdersForTelegramIds([
    ...Object.values(REVIEW_QA_PERSONAS).map((persona) => persona.telegramId),
    ...REVIEW_QA_WINNER_PERSONAS.map((persona) => persona.telegramId),
  ]);
}

export function runReviewQaSeed({ reset = true } = {}) {
  const now = new Date().toISOString();
  const periodKey = getReviewPeriodKey(0);
  const monthApprovedAt = new Date().toISOString();

  if (reset) {
    resetScenarioData(periodKey);
  }

  const groups = pickCatalogGroups(4);
  const groupLines = groups.map((group) => {
    const product = pickProductForGroup(group.group_id);
    if (!product) {
      throw new Error(`Нет товара для линейки ${group.group_name}`);
    }
    return { ...group, ...product };
  });

  const result = db.transaction(() => {
    ensureLiquidsQuickTags();
    ensureReviewSettings();

    const customers = {};
    for (const [key, persona] of Object.entries(REVIEW_QA_PERSONAS)) {
      customers[key] = upsertCustomer({
        id: `cust_dev_scn_${key}`,
        telegramId: persona.telegramId,
        username: persona.username,
        firstName: persona.firstName,
        optOut: key === 'optout' ? 1 : 0,
        now,
      });
    }

    const winnerCustomers = REVIEW_QA_WINNER_PERSONAS.map((persona, index) => {
      const customerId = upsertCustomer({
        id: `cust_dev_scn_winner_${index + 1}`,
        telegramId: persona.telegramId,
        username: persona.username,
        firstName: persona.firstName,
        now,
      });
      return { ...persona, customerId };
    });

    const freshOrder = createDeliveredOrder({
      orderId: 'order_dev_scn_fresh',
      customerId: customers.fresh,
      lines: groupLines.slice(0, 4),
      now,
    });

    const pendingOrder = createDeliveredOrder({
      orderId: 'order_dev_scn_pending',
      customerId: customers.pending,
      lines: groupLines.slice(0, 2),
      now,
    });
    insertReview({
      id: 'rev_dev_scn_pending_1',
      customerId: customers.pending,
      orderId: 'order_dev_scn_pending',
      orderItemId: pendingOrder.orderItems[0].id,
      groupId: pendingOrder.orderItems[0].group_id,
      categoryId: groupLines[0].category_id,
      rating: 5,
      bodyText: 'Отличная линейка, вкус держится долго и без химозы.',
      status: 'pending',
      createdAt: now,
      variantName: pendingOrder.orderItems[0].variant_name,
    });

    const cooldownOldOrder = createDeliveredOrder({
      orderId: 'order_dev_scn_cooldown_old',
      customerId: customers.cooldown,
      lines: [groupLines[0]],
      now,
      submittedMinutesAgo: 14 * 24 * 60,
      issuedMinutesAgo: 14 * 24 * 60,
    });
    const cooldownRecentAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    insertReview({
      id: 'rev_dev_scn_cooldown_1',
      customerId: customers.cooldown,
      orderId: 'order_dev_scn_cooldown_old',
      orderItemId: cooldownOldOrder.orderItems[0].id,
      groupId: groupLines[0].group_id,
      categoryId: groupLines[0].category_id,
      rating: 4,
      bodyText: 'Хороший вкус, но хотелось бы чуть мягче по крепости.',
      status: 'approved',
      createdAt: cooldownRecentAt,
      variantName: cooldownOldOrder.orderItems[0].variant_name,
    });
    const cooldownNewOrder = createDeliveredOrder({
      orderId: 'order_dev_scn_cooldown_new',
      customerId: customers.cooldown,
      lines: groupLines.slice(0, 2),
      now,
    });

    createDeliveredOrder({
      orderId: 'order_dev_scn_optout',
      customerId: customers.optout,
      lines: [groupLines[1]],
      now,
    });

    const ratingGroup = groupLines[0];
    const publicBodies = [
      'Очень яркий вкус, беру не первый раз.',
      'Нормальная крепость, парит ровно.',
      'Зашло с первого раза, рекомендую.',
      'Вкусное, но баночка быстро кончается.',
      'Средне, ожидал более насыщенный профиль.',
      'Отличное качество, без посторонних нот.',
      'Беру снова, если будет в наличии.',
      'Хорошая линейка для повседневного парения.',
      'Вкус держится, не пропадает к концу.',
      'Стабильное качество, без сюрпризов.',
      'Понравилось, буду пробовать другие вкусы.',
      'Неплохо, но есть варианты получше.',
    ];
    publicBodies.forEach((bodyText, index) => {
      const customerId = `cust_dev_scn_rating_${index + 1}`;
      upsertCustomer({
        id: customerId,
        telegramId: `9000002${String(index + 1).padStart(2, '0')}`,
        username: `rating_user_${index + 1}`,
        firstName: `Rating ${index + 1}`,
        now,
      });
      const orderId = `order_dev_scn_rating_${index + 1}`;
      const line = ratingGroup;
      const order = createDeliveredOrder({
        orderId,
        customerId,
        lines: [line],
        now,
        submittedMinutesAgo: 60 + index,
        issuedMinutesAgo: 30 + index,
      });
      insertReview({
        id: `rev_dev_scn_public_${index + 1}`,
        customerId,
        orderId,
        orderItemId: order.orderItems[0].id,
        groupId: ratingGroup.group_id,
        categoryId: ratingGroup.category_id,
        rating: index % 5 === 0 ? 5 : 4,
        bodyText,
        status: 'approved',
        createdAt: new Date(Date.now() - (index + 2) * 24 * 60 * 60 * 1000).toISOString(),
        managerReply: index === 0 ? 'Спасибо за отзыв! Рады, что линейка зашла.' : null,
        variantName: order.orderItems[0].variant_name,
      });
    });

    const crmPendingBodies = [
      'Товар хороший, но доставка задержалась на пару часов.',
      'Вкус отличный, упаковка целая, всё супер.',
      'Нормально, но ожидал более яркий аромат.',
    ];
    crmPendingBodies.forEach((bodyText, index) => {
      const customerId = `cust_dev_scn_crm_pending_${index + 1}`;
      upsertCustomer({
        id: customerId,
        telegramId: `9000003${String(index + 1).padStart(2, '0')}`,
        username: `crm_pending_${index + 1}`,
        firstName: `CRM Pending ${index + 1}`,
        now,
      });
      const line = groupLines[(index + 1) % groupLines.length];
      const orderId = `order_dev_scn_crm_pending_${index + 1}`;
      const order = createDeliveredOrder({
        orderId,
        customerId,
        lines: [line],
        now,
        submittedMinutesAgo: 20 + index,
        issuedMinutesAgo: 10 + index,
      });
      insertReview({
        id: `rev_dev_scn_crm_pending_${index + 1}`,
        customerId,
        orderId,
        orderItemId: order.orderItems[0].id,
        groupId: line.group_id,
        categoryId: line.category_id,
        rating: 4,
        bodyText,
        status: 'pending',
        createdAt: now,
        variantName: order.orderItems[0].variant_name,
      });
    });

    const drawId = 'draw_dev_scn_current';
    db.prepare(`
      INSERT INTO review_monthly_draws (id, period_key, drawn_at, status)
      VALUES (?, ?, ?, 'completed')
    `).run(drawId, periodKey, now);

    const insertWinner = db.prepare(`
      INSERT INTO review_monthly_draw_winners (
        id, draw_id, seat_number, customer_id, review_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    winnerCustomers.forEach((winner, index) => {
      const line = groupLines[index % groupLines.length];
      const orderId = `order_dev_scn_winner_${index + 1}`;
      const order = createDeliveredOrder({
        orderId,
        customerId: winner.customerId,
        lines: [line],
        now,
        submittedMinutesAgo: 40 + index,
        issuedMinutesAgo: 15 + index,
      });
      const reviewId = `rev_dev_scn_winner_${index + 1}`;
      insertReview({
        id: reviewId,
        customerId: winner.customerId,
        orderId,
        orderItemId: order.orderItems[0].id,
        groupId: line.group_id,
        categoryId: line.category_id,
        rating: 5,
        bodyText: 'Участвую в розыгрыше — линейка реально понравилась!',
        status: 'approved',
        createdAt: monthApprovedAt,
        variantName: order.orderItems[0].variant_name,
      });
      insertWinner.run(
        `win_dev_scn_${index + 1}`,
        drawId,
        index + 1,
        winner.customerId,
        reviewId,
        now,
      );
    });

    return {
      ratingGroup,
      freshOrder,
      pendingOrder,
      cooldownNewOrder,
      drawId,
      periodKey,
    };
  })();

  return {
    ...result,
    suggestedWhitelistUsernames: [
      ...Object.values(REVIEW_QA_PERSONAS).map((persona) => persona.username),
    ],
    personas: REVIEW_QA_PERSONAS,
    winnerPersonas: REVIEW_QA_WINNER_PERSONAS,
  };
}