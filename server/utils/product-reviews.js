import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { resolvePublicCustomerPhotoUrl } from './customer-photo.js';
import { hasCustomerPhotoOnDisk } from './customer-photo-disk.js';
import { getBusinessPeriodRange, getUtcDateForTimeZoneLocalTime } from './business-time.js';

/** First day the customer order history + reviews cabinet went live on prod. */
export const CUSTOMER_ORDER_HISTORY_LAUNCH = Object.freeze({
  year: 2026,
  month: 6,
  day: 22,
});

export function getCustomerOrderHistoryLaunchIso() {
  const override = getReviewSetting('customer_history_since', '');
  if (override) {
    const match = String(override).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return getUtcDateForTimeZoneLocalTime(
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
      ).toISOString();
    }
  }

  return getUtcDateForTimeZoneLocalTime(
    CUSTOMER_ORDER_HISTORY_LAUNCH.year,
    CUSTOMER_ORDER_HISTORY_LAUNCH.month,
    CUSTOMER_ORDER_HISTORY_LAUNCH.day,
  ).toISOString();
}

function normalizeOrderTimestampSqlExpr(fieldsExpr) {
  // SQLite datetime() does not parse ISO-8601 values like 2026-06-22T17:09:44.459Z.
  // Normalize mixed storage formats before lexicographic compare.
  return `REPLACE(REPLACE(COALESCE(${fieldsExpr}), 'T', ' '), 'Z', '')`;
}

function buildCustomerHistoryVisibilityClause(alias = 'o') {
  // Uses completed_at first; cancelled orders without completed_at fall back to
  // updated_at/created_at so post-launch cancellations still appear in history.
  const milestoneExpr = normalizeOrderTimestampSqlExpr(
    `${alias}.completed_at, ${alias}.updated_at, ${alias}.created_at`,
  );
  const launchParam = getCustomerOrderHistoryLaunchIso().replace('T', ' ').replace('Z', '');

  return {
    sql: `${milestoneExpr} >= ?`,
    param: launchParam,
  };
}

/** Keep in sync with normalizeTelegramUsername(): trim, strip leading @, lowercase. */
export function normalizeTelegramUsernameSqlExpr(valueExpr) {
  return `LOWER(LTRIM(TRIM(COALESCE(${valueExpr}, '')), '@'))`;
}

function buildCustomerOwnershipClause({ telegramId = '', telegramUsername = '' } = {}) {
  const normalizedUsername = normalizeTelegramUsername(telegramUsername).toLowerCase();
  const parts = [];
  const params = [];

  if (telegramId) {
    parts.push('c.telegram_id = ?');
    params.push(String(telegramId));
  }

  if (normalizedUsername) {
    parts.push(
      `${normalizeTelegramUsernameSqlExpr('o.telegram_username, c.telegram_username')} = ?`,
    );
    params.push(normalizedUsername);
  }

  if (parts.length === 0) {
    return { sql: '0 = 1', params: [] };
  }

  return {
    sql: `(${parts.join(' OR ')})`,
    params,
  };
}

export const REVIEW_CATEGORY_KEYS = Object.freeze({
  LIQUIDS: 'liquids',
  SNUS: 'snus',
  CONSUMABLES: 'consumables',
  DISPOSABLES: 'disposables',
  DEVICES: 'devices',
  OTHER: 'other',
});

export const REVIEW_STATUSES = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

const COMPLETED_ORDER_STATUSES = new Set(['delivered', 'completed']);
const MIN_REVIEW_BODY_LENGTH = 20;
const MAX_REVIEW_BODY_LENGTH = 4000;

export { MIN_REVIEW_BODY_LENGTH, MAX_REVIEW_BODY_LENGTH };

export const REVIEW_ERROR_MESSAGES = Object.freeze({
  pending_moderation:
    'Вы уже отправили отзыв на эту линейку. Мы проверим его и опубликуем после одобрения.',
  cooldown: 'Недавно вы уже оставляли отзыв на эту линейку. Подождите, прежде чем писать снова.',
  not_purchased: 'Отзыв можно оставить только на товары, которые вы уже покупали.',
  order_not_reviewable: 'Отзыв можно оставить только после выдачи заказа.',
  review_body_too_short: 'Напишите отзыв подробнее - минимум 20 символов.',
  review_body_too_long: 'Слишком длинный отзыв. Сократите текст и попробуйте снова.',
  invalid_rating: 'Поставьте оценку от 1 до 5 звёзд.',
  invalid_quick_tags: 'Не удалось добавить выбранные теги. Обновите страницу и попробуйте снова.',
  not_eligible: 'Сейчас нельзя оставить отзыв на эту позицию.',
  order_not_found: 'Заказ не найден. Обновите страницу и попробуйте снова.',
  group_not_found: 'Линейка не найдена. Обновите страницу и попробуйте снова.',
});

export function getReviewErrorMessage(code, fallback = 'Не удалось отправить отзыв') {
  return REVIEW_ERROR_MESSAGES[code] || fallback;
}

export function createReviewError(code, details = null) {
  const err = new Error(getReviewErrorMessage(code, code));
  err.code = code;
  if (details) err.details = details;
  return err;
}

export function normalizeTelegramUsername(value) {
  return typeof value === 'string'
    ? value.trim().replace(/^@+/, '').toLowerCase()
    : '';
}

export function resolveReviewCategoryKey({ slug = '', storefrontFiltersProfile = '' } = {}) {
  const normalizedSlug = String(slug || '').toLowerCase();
  const profile = String(storefrontFiltersProfile || '').toLowerCase();

  if (
    profile === 'liquids' ||
    normalizedSlug.includes('liquid') ||
    normalizedSlug.includes('zhidk')
  ) {
    return REVIEW_CATEGORY_KEYS.LIQUIDS;
  }
  if (
    profile === 'snus_plates' ||
    normalizedSlug.includes('snus') ||
    normalizedSlug.includes('snyus') ||
    normalizedSlug.includes('plastin')
  ) {
    return REVIEW_CATEGORY_KEYS.SNUS;
  }
  if (
    normalizedSlug.includes('disposable') ||
    normalizedSlug.includes('odnoraz') ||
    normalizedSlug.includes('razk')
  ) {
    return REVIEW_CATEGORY_KEYS.DISPOSABLES;
  }
  if (
    normalizedSlug.includes('pod-system') ||
    normalizedSlug.includes('device') ||
    normalizedSlug.includes('ustroistv') ||
    normalizedSlug.includes('pod_system')
  ) {
    return REVIEW_CATEGORY_KEYS.DEVICES;
  }
  if (
    normalizedSlug.includes('accessor') ||
    normalizedSlug.includes('rashod') ||
    normalizedSlug.includes('consum')
  ) {
    return REVIEW_CATEGORY_KEYS.CONSUMABLES;
  }
  return REVIEW_CATEGORY_KEYS.OTHER;
}

function normalizePurchasedVariantToken(value) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU');
}

/**
 * Resolves the customer-facing flavor/color label for reviews and order detail.
 * Uses variant_name when present; otherwise falls back to flavor-as-product titles.
 */
export function resolvePurchasedVariantName({
  variantName = null,
  productTitle = null,
  baseProductTitle = null,
  groupName = null,
} = {}) {
  const variant = String(variantName || '').trim();
  if (variant) return variant;

  const title = String(productTitle || '').trim();
  const base = String(baseProductTitle || '').trim();
  const group = String(groupName || '').trim();
  if (!title) return null;

  const normalizedTitle = normalizePurchasedVariantToken(title);
  const normalizedBase = normalizePurchasedVariantToken(base);
  const normalizedGroup = normalizePurchasedVariantToken(group);

  if (base && normalizedTitle !== normalizedBase) {
    const dashPrefix = `${base} - `;
    if (title.startsWith(dashPrefix)) {
      const extracted = title.slice(dashPrefix.length).trim();
      if (extracted) return extracted;
    }
    const parenPrefix = `${base} (`;
    if (title.startsWith(parenPrefix) && title.endsWith(')')) {
      const extracted = title.slice(parenPrefix.length, -1).trim();
      if (extracted) return extracted;
    }
  }

  if (group && normalizedTitle !== normalizedGroup) {
    return title;
  }

  if (base && normalizedTitle === normalizedBase) {
    return null;
  }

  return null;
}

function resolvePurchasedVariantFromOrderItem(row, groupName = null) {
  if (!row) return null;
  return resolvePurchasedVariantName({
    variantName: row.variant_name,
    productTitle: row.product_title,
    baseProductTitle: row.base_product_title,
    groupName: row.group_name || groupName,
  });
}

export function getReviewSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM review_settings WHERE key = ?').get(key);
  return row?.value ?? fallback;
}

export function setReviewSetting(key, value) {
  db.prepare(
    `INSERT INTO review_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, String(value));
}

export function getCooldownDays() {
  const raw = Number(getReviewSetting('cooldown_days', '90'));
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 90;
}

export function isDevTestModeEnabled() {
  return getReviewSetting('dev_test_mode', '0') === '1';
}

export const MAX_QA_USERNAMES = 20;

export function parseQaUsernames(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => normalizeTelegramUsername(entry))
      .filter(Boolean)
      .slice(0, MAX_QA_USERNAMES);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => normalizeTelegramUsername(entry))
          .filter(Boolean)
          .slice(0, MAX_QA_USERNAMES);
      }
    } catch {
      // fall through to delimiter split
    }
    return trimmed
      .split(/[\n,;]+/)
      .map((entry) => normalizeTelegramUsername(entry))
      .filter(Boolean)
      .slice(0, MAX_QA_USERNAMES);
  }
  return [];
}

export function getQaUsernames() {
  return parseQaUsernames(getReviewSetting('qa_usernames', '[]'));
}

export function isQaReviewModeActive() {
  return getReviewSetting('qa_active', '0') === '1';
}

export function isQaReviewUser(customer) {
  if (!customer || !isQaReviewModeActive()) return false;
  const username = normalizeTelegramUsername(customer.telegram_username);
  if (!username) return false;
  return getQaUsernames().includes(username);
}

export function shouldDevBypassForCustomer(customer) {
  return isDevTestModeEnabled() || isQaReviewUser(customer);
}

export function setQaUsernames(value) {
  const usernames = parseQaUsernames(value);
  setReviewSetting('qa_usernames', JSON.stringify(usernames));
  return usernames;
}

export function disableReviewQaModes() {
  setReviewSetting('qa_active', '0');
  setReviewSetting('dev_test_mode', '0');
}

export function getReviewSettingsResponse() {
  return {
    cooldown_days: getCooldownDays(),
    lottery_hint_text: getReviewSetting('lottery_hint_text', ''),
    dev_test_mode: isDevTestModeEnabled(),
    qa_active: isQaReviewModeActive(),
    qa_usernames: getQaUsernames(),
    manager_display_name: getReviewSetting('manager_display_name', 'Manager Rezonsky'),
    manager_avatar_url: getReviewSetting('manager_avatar_url', '/favicon.png'),
  };
}

export function getManagerReviewBlock() {
  const avatarUrl = getReviewSetting('manager_avatar_url', '/favicon.png');
  return {
    display_name: getReviewSetting('manager_display_name', 'Manager Rezonsky'),
    avatar_url: avatarUrl ? String(avatarUrl) : '/favicon.png',
  };
}

export function validateReviewBodyText(bodyText) {
  const trimmed = String(bodyText || '').trim();
  if (trimmed.length < MIN_REVIEW_BODY_LENGTH) {
    const err = new Error('review_body_too_short');
    err.code = 'review_body_too_short';
    err.minLength = MIN_REVIEW_BODY_LENGTH;
    throw err;
  }
  if (trimmed.length > MAX_REVIEW_BODY_LENGTH) {
    const err = new Error('review_body_too_long');
    err.code = 'review_body_too_long';
    err.maxLength = MAX_REVIEW_BODY_LENGTH;
    throw err;
  }
  return trimmed;
}

function buildReviewPreferencesPayload(customer) {
  return {
    reviews_opt_out: Number(customer?.reviews_opt_out || 0) === 1,
    reviews_prefer_anonymous: Number(customer?.reviews_prefer_anonymous || 0) === 1,
  };
}

export function findCustomerByTelegram({ telegramId = '', telegramUsername = '' } = {}) {
  const normalizedUsername = normalizeTelegramUsername(telegramUsername).toLowerCase();

  if (telegramId) {
    const byId = db.prepare(`
      SELECT id, telegram_id, telegram_username, first_name, last_name,
             photo_url, reviews_opt_out, reviews_prefer_anonymous
      FROM customers
      WHERE telegram_id = ?
    `).get(String(telegramId));
    if (byId) return byId;
  }

  if (normalizedUsername) {
    return db.prepare(`
      SELECT id, telegram_id, telegram_username, first_name, last_name,
             photo_url, reviews_opt_out, reviews_prefer_anonymous
      FROM customers
      WHERE LOWER(COALESCE(telegram_username, '')) = LOWER(?)
      LIMIT 1
    `).get(normalizedUsername) || null;
  }

  return null;
}

function orderBelongsToCustomer(order, { telegramId = '', telegramUsername = '' } = {}) {
  const normalizedUsername = normalizeTelegramUsername(telegramUsername).toLowerCase();

  if (
    telegramId &&
    order.customer_telegram_id &&
    String(order.customer_telegram_id) === String(telegramId)
  ) {
    return true;
  }

  if (!normalizedUsername) return false;

  const candidateUsername = normalizeTelegramUsername(
    order.resolved_telegram_username || order.telegram_username,
  ).toLowerCase();
  return Boolean(candidateUsername) && candidateUsername === normalizedUsername;
}

function loadOwnedOrdersBaseSql() {
  const visibility = buildCustomerHistoryVisibilityClause('o');
  // `archived` hides delivered orders from the CRM kanban only.
  // Customer history keeps archived orders from the cabinet launch date onward.
  return {
    sql: `
      SELECT
        o.*,
        c.telegram_id AS customer_telegram_id,
        c.first_name AS customer_first_name,
        c.last_name AS customer_last_name,
        COALESCE(o.telegram_username, c.telegram_username) AS resolved_telegram_username
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE ${visibility.sql}
    `,
    params: [visibility.param],
  };
}

export function findOwnedOrders({
  telegramId = '',
  telegramUsername = '',
  statuses = null,
  orderId = null,
  limit = 50,
  beforeCreatedAt = null,
} = {}) {
  const base = loadOwnedOrdersBaseSql();
  const ownership = buildCustomerOwnershipClause({ telegramId, telegramUsername });
  const params = [...base.params, ...ownership.params];
  let sql = `${base.sql} AND ${ownership.sql}`;

  if (orderId) {
    sql += ' AND o.id = ?';
    params.push(orderId);
  }

  if (Array.isArray(statuses) && statuses.length > 0) {
    sql += ` AND o.status IN (${statuses.map(() => '?').join(', ')})`;
    params.push(...statuses);
  }

  if (beforeCreatedAt) {
    sql += ' AND o.created_at < ?';
    params.push(beforeCreatedAt);
  }

  sql += ' ORDER BY COALESCE(o.completed_at, o.updated_at, o.created_at) DESC, o.created_at DESC';

  if (limit) {
    sql += ' LIMIT ?';
    params.push(limit);
  }

  const candidates = db.prepare(sql).all(...params);
  return candidates.filter((order) =>
    orderBelongsToCustomer(order, { telegramId, telegramUsername }),
  );
}

function getLatestReviewForGroup(customerId, groupId) {
  return db.prepare(`
    SELECT *
    FROM product_reviews
    WHERE customer_id = ? AND group_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(customerId, groupId);
}

function resolvePendingModerationBlock({ customerId, groupId, orderId = null }) {
  if (orderId) {
    const scoped = db.prepare(`
      SELECT *
      FROM product_reviews
      WHERE customer_id = ? AND group_id = ? AND order_id = ? AND status = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(customerId, groupId, orderId, REVIEW_STATUSES.PENDING);

    if (scoped) {
      return {
        canReview: false,
        reason: 'pending_moderation',
        reviewId: scoped.id,
        existingReview: scoped,
      };
    }
  }

  const latest = getLatestReviewForGroup(customerId, groupId);
  if (latest?.status === REVIEW_STATUSES.PENDING) {
    return {
      canReview: false,
      reason: 'pending_moderation',
      reviewId: latest.id,
      existingReview: latest,
    };
  }

  return null;
}

function resolveDevBypassEligibility({
  customerId,
  groupId,
  orderId = null,
  orderItemId = null,
}) {
  let scopedOrderId = orderId;
  let scopedItem = null;

  if (orderId) {
    scopedItem = orderItemId
      ? db.prepare(`
          SELECT
            oi.id,
            oi.variant_id,
            oi.variant_name,
            oi.product_title,
            oi.group_name,
            oi.base_product_title
          FROM order_items oi
          INNER JOIN products p ON p.id = oi.product_id
          WHERE oi.id = ? AND oi.order_id = ? AND p.groupId = ?
        `).get(orderItemId, orderId, groupId)
      : db.prepare(`
          SELECT
            oi.id,
            oi.variant_id,
            oi.variant_name,
            oi.product_title,
            oi.group_name,
            oi.base_product_title
          FROM order_items oi
          INNER JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = ? AND p.groupId = ?
          ORDER BY oi.rowid ASC
          LIMIT 1
        `).get(orderId, groupId);
  } else {
    const purchase = db.prepare(`
      SELECT
        oi.id AS order_item_id,
        oi.order_id,
        oi.variant_id,
        oi.variant_name,
        oi.product_title,
        oi.group_name,
        oi.base_product_title
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      INNER JOIN products p ON p.id = oi.product_id
      WHERE o.customer_id = ?
        AND p.groupId = ?
      ORDER BY COALESCE(o.completed_at, o.updated_at, o.created_at) DESC
      LIMIT 1
    `).get(customerId, groupId);

    if (purchase) {
      scopedOrderId = purchase.order_id;
      scopedItem = {
        id: purchase.order_item_id,
        variant_id: purchase.variant_id,
        variant_name: purchase.variant_name,
        product_title: purchase.product_title,
        group_name: purchase.group_name,
        base_product_title: purchase.base_product_title,
      };
    }
  }

  const groupName = db.prepare('SELECT name FROM category_groups WHERE id = ?').get(groupId)?.name || null;

  return {
    canReview: true,
    reason: 'dev_test_mode',
    orderId: scopedOrderId,
    orderItemId: scopedItem?.id || orderItemId || null,
    purchasedVariantId: scopedItem?.variant_id || null,
    purchasedVariantName: resolvePurchasedVariantFromOrderItem(scopedItem, groupName),
  };
}

export function getGroupReviewEligibility({
  customerId,
  groupId,
  orderId = null,
  orderItemId = null,
  devBypass = false,
} = {}) {
  if (!customerId || !groupId) {
    return { canReview: false, reason: 'missing_context' };
  }

  const pendingBlock = resolvePendingModerationBlock({ customerId, groupId, orderId });
  if (pendingBlock) return pendingBlock;

  if (devBypass) {
    return resolveDevBypassEligibility({ customerId, groupId, orderId, orderItemId });
  }

  const purchaseVisibility = buildCustomerHistoryVisibilityClause('o');
  const purchase = db.prepare(`
    SELECT
      oi.id AS order_item_id,
      oi.order_id,
      oi.variant_id,
      oi.variant_name,
      oi.product_title,
      oi.group_name,
      oi.base_product_title,
      o.id AS order_id_ref,
      o.status,
      o.completed_at,
      o.created_at
    FROM order_items oi
    INNER JOIN orders o ON o.id = oi.order_id
    INNER JOIN products p ON p.id = oi.product_id
    WHERE o.customer_id = ?
      AND p.groupId = ?
      AND o.status IN ('delivered', 'completed')
      AND ${purchaseVisibility.sql}
    ORDER BY COALESCE(o.completed_at, o.updated_at, o.created_at) DESC
    LIMIT 1
  `).get(customerId, groupId, purchaseVisibility.param);

  if (!purchase) {
    return { canReview: false, reason: 'not_purchased' };
  }

  const latest = getLatestReviewForGroup(customerId, groupId);
  if (latest) {
    if (latest.status === REVIEW_STATUSES.APPROVED) {
      const cooldownDays = getCooldownDays();
      const createdAt = new Date(latest.created_at);
      const cooldownEnds = new Date(createdAt.getTime() + cooldownDays * 24 * 60 * 60 * 1000);
      if (Date.now() < cooldownEnds.getTime()) {
        return {
          canReview: false,
          reason: 'cooldown',
          cooldownEndsAt: cooldownEnds.toISOString(),
          reviewId: latest.id,
          existingReview: latest,
        };
      }
    }
  }

  const scopedOrderId = orderId || purchase.order_id;
  const scopedItem = orderItemId
    ? db.prepare(`
        SELECT
          oi.id,
          oi.variant_id,
          oi.variant_name,
          oi.product_title,
          oi.group_name,
          oi.base_product_title
        FROM order_items oi
        INNER JOIN products p ON p.id = oi.product_id
        WHERE oi.id = ? AND oi.order_id = ? AND p.groupId = ?
      `).get(orderItemId, scopedOrderId, groupId)
    : db.prepare(`
        SELECT
          oi.id,
          oi.variant_id,
          oi.variant_name,
          oi.product_title,
          oi.group_name,
          oi.base_product_title
        FROM order_items oi
        INNER JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ? AND p.groupId = ?
        ORDER BY oi.rowid ASC
        LIMIT 1
      `).get(scopedOrderId, groupId);

  const itemForVariant = scopedItem || purchase;
  const groupName = db.prepare('SELECT name FROM category_groups WHERE id = ?').get(groupId)?.name || null;

  return {
    canReview: true,
    reason: 'eligible',
    orderId: scopedOrderId,
    orderItemId: scopedItem?.id || purchase.order_item_id,
    purchasedVariantId: scopedItem?.variant_id || purchase.variant_id || null,
    purchasedVariantName: resolvePurchasedVariantFromOrderItem(itemForVariant, groupName),
  };
}

function loadOrderItemsGrouped(orderId) {
  const rows = db.prepare(`
    SELECT
      oi.*,
      p.groupId AS group_id,
      p.categoryId AS category_id,
      g.name AS resolved_group_name,
      g.cover_image AS group_cover_image,
      c.slug AS category_slug,
      c.name AS category_name,
      c.cover_image AS category_cover_image,
      c.storefront_filters_profile
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN category_groups g ON g.id = p.groupId
    LEFT JOIN categories c ON c.id = p.categoryId
    WHERE oi.order_id = ?
    ORDER BY oi.rowid ASC
  `).all(orderId);

  const byGroup = new Map();
  for (const row of rows) {
    const groupId = row.group_id || `item:${row.id}`;
    if (!byGroup.has(groupId)) {
      byGroup.set(groupId, {
        group_id: row.group_id,
        group_name: row.group_name || row.resolved_group_name || null,
        category_id: row.category_id || null,
        category_name: row.category_name || null,
        category_slug: row.category_slug || null,
        category_cover_image: row.category_cover_image || null,
        group_cover_image: row.group_cover_image || null,
        review_category_key: resolveReviewCategoryKey({
          slug: row.category_slug,
          storefrontFiltersProfile: row.storefront_filters_profile,
        }),
        items: [],
      });
    }
    byGroup.get(groupId).items.push({
      id: row.id,
      product_id: row.product_id,
      product_title: row.product_title,
      base_product_title: row.base_product_title || row.product_title,
      group_name: row.group_name || row.resolved_group_name || null,
      variant_id: row.variant_id || null,
      variant_name: row.variant_name || null,
      quantity: Number(row.quantity || 0),
      total_price: Number(row.total_price || 0),
      image: row.group_cover_image || row.category_cover_image || null,
    });
  }
  return [...byGroup.values()];
}

function loadOrderStatusTimeline(orderId) {
  return db.prepare(`
    SELECT previous_status, new_status, changed_at, note
    FROM order_status_history
    WHERE order_id = ?
    ORDER BY changed_at ASC
  `).all(orderId);
}

function findStatusEnteredAt(timeline, status) {
  for (const entry of timeline) {
    if (entry.new_status === status) {
      return entry.changed_at || null;
    }
  }
  return null;
}

export function buildOrderFulfillmentMilestones(order, timeline = null) {
  const history = timeline ?? loadOrderStatusTimeline(order.id);
  const submittedAt = order.created_at || null;
  const readyAt = findStatusEnteredAt(history, 'in_progress');
  // Status history uses SQLite UTC timestamps; completed_at is often ISO UTC.
  // Prefer history so "Собран" and "Выдан" stay on the same clock in the UI.
  let issuedAt = null;

  if (['delivered', 'completed'].includes(order.status)) {
    issuedAt =
      findStatusEnteredAt(history, order.status) ||
      findStatusEnteredAt(history, 'delivered') ||
      findStatusEnteredAt(history, 'completed') ||
      order.completed_at ||
      null;
  }

  const cancelledAt =
    order.status === 'cancelled'
      ? findStatusEnteredAt(history, 'cancelled') || order.updated_at || null
      : null;

  return {
    submitted_at: submittedAt,
    ready_at: readyAt,
    issued_at: issuedAt,
    cancelled_at: cancelledAt,
  };
}

function computeFulfillmentDuration(order, timeline) {
  const createdAt = order.created_at ? new Date(order.created_at) : null;
  const completedAt = order.completed_at
    ? new Date(order.completed_at)
    : timeline.length
      ? new Date(timeline[timeline.length - 1].changed_at)
      : null;

  if (!createdAt || !completedAt || Number.isNaN(createdAt.getTime()) || Number.isNaN(completedAt.getTime())) {
    return null;
  }

  const diffMs = Math.max(0, completedAt.getTime() - createdAt.getTime());
  return {
    created_at: order.created_at,
    completed_at: order.completed_at || completedAt.toISOString(),
    duration_minutes: Math.round(diffMs / 60000),
  };
}

export function buildReviewableLinesForOrder(order, customerId, { devBypass = false } = {}) {
  const groups = loadOrderItemsGrouped(order.id);
  return groups
    .filter((group) => group.group_id)
    .map((group) => {
      const primaryItem = group.items[0];
      const eligibility = getGroupReviewEligibility({
        customerId,
        groupId: group.group_id,
        orderId: order.id,
        orderItemId: primaryItem?.id || null,
        devBypass,
      });

      const latestReview = db.prepare(`
        SELECT id, status, rating, created_at
        FROM product_reviews
        WHERE customer_id = ? AND group_id = ? AND order_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(customerId, group.group_id, order.id);

      return {
        group_id: group.group_id,
        group_name: group.group_name,
        category_id: group.category_id,
        category_name: group.category_name,
        category_cover_image: group.category_cover_image,
        group_cover_image: group.group_cover_image,
        review_category_key: group.review_category_key,
        order_item_id: primaryItem?.id || null,
        purchased_variant_id: primaryItem?.variant_id || null,
        purchased_variant_name: resolvePurchasedVariantFromOrderItem(primaryItem, group.group_name),
        items: group.items,
        eligibility,
        latest_review: latestReview || null,
      };
    });
}

export function buildOrderLineIconsFromGroups(groups, maxVisible = 4) {
  const icons = [];
  const seen = new Set();

  for (const group of groups) {
    const key = group.group_id || group.category_id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    icons.push({
      category_id: group.category_id,
      group_id: group.group_id,
      category_name: group.category_name,
      group_name: group.group_name,
      image: group.group_cover_image || group.category_cover_image || null,
    });
  }

  return {
    icons: icons.slice(0, maxVisible),
    overflow: Math.max(0, icons.length - maxVisible),
  };
}

function buildOrderHistoryReviewHint(order, customerId, { devBypass = false } = {}) {
  if (!customerId || !['delivered', 'completed'].includes(order.status)) {
    return null;
  }

  const lines = buildReviewableLinesForOrder(order, customerId, { devBypass });
  if (!lines.length) return null;

  const hasReviewable = lines.some((line) => line.eligibility.canReview);
  if (hasReviewable) return null;

  const hasCooldown = lines.some((line) => line.eligibility.reason === 'cooldown');
  if (!hasCooldown) return null;

  return 'Отзыв на эту линейку уже оставлен';
}

export function serializeOrderHistoryCard(order, customerId = null, { devBypass = false } = {}) {
  const groups = loadOrderItemsGrouped(order.id);
  const { icons: categoryIcons, overflow: categoryIconsOverflow } =
    buildOrderLineIconsFromGroups(groups);

  const card = {
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    delivery_type: order.delivery_type || 'pickup',
    created_at: order.created_at,
    completed_at: order.completed_at || null,
    final_amount: Number(order.final_amount || 0),
    category_icons: categoryIcons,
    category_icons_overflow: categoryIconsOverflow,
    fulfillment_milestones: buildOrderFulfillmentMilestones(order),
  };

  const reviewHint = buildOrderHistoryReviewHint(order, customerId, { devBypass });
  if (reviewHint) {
    card.review_hint = reviewHint;
  }

  return card;
}

export function serializeOrderDetail(order, customerId, { devBypass = false } = {}) {
  const reviewableLines = buildReviewableLinesForOrder(order, customerId, { devBypass });

  return {
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    delivery_type: order.delivery_type,
    delivery_address: order.delivery_address || null,
    phone: order.phone || null,
    notes: order.notes || null,
    total_amount: Number(order.total_amount || 0),
    discount_amount: Number(order.discount_amount || 0),
    final_amount: Number(order.final_amount || 0),
    promo_code_text: order.promo_code_text || null,
    created_at: order.created_at,
    updated_at: order.updated_at,
    completed_at: order.completed_at || null,
    fulfillment_milestones: buildOrderFulfillmentMilestones(order),
    reviewable_lines: reviewableLines,
    lottery_hint_text: getReviewSetting('lottery_hint_text', ''),
  };
}

export function getReviewPromptForCustomer(customer, { devBypass = false } = {}) {
  if (!customer) return { show: false, reason: 'no_customer' };
  const preferences = buildReviewPreferencesPayload(customer);
  if (Number(customer.reviews_opt_out || 0) === 1) {
    return { show: false, reason: 'opt_out', preferences };
  }

  const orders = findOwnedOrders({
    telegramId: customer.telegram_id,
    telegramUsername: customer.telegram_username,
    statuses: [...COMPLETED_ORDER_STATUSES],
    limit: 20,
  });

  for (const order of orders) {
    const lines = buildReviewableLinesForOrder(order, customer.id, { devBypass });
    const pending = lines.filter((line) => line.eligibility.canReview);
    if (pending.length === 0) continue;

    const primary = pending[0];
    const pendingGroups = pending.map((line) => ({
      group_id: line.group_id,
      category_id: line.category_id,
      category_name: line.category_name,
      group_name: line.group_name,
      group_cover_image: line.group_cover_image,
      category_cover_image: line.category_cover_image,
    }));
    const { icons: previewIcons, overflow: previewIconsOverflow } =
      buildOrderLineIconsFromGroups(pendingGroups, 5);

    return {
      show: true,
      reason: 'pending_reviews',
      order_id: order.id,
      order_number: order.order_number,
      group_id: primary.group_id,
      group_name: primary.group_name,
      purchased_variant_name: primary.purchased_variant_name,
      pending_review_count: pending.length,
      preview_icons: previewIcons,
      preview_icons_overflow: previewIconsOverflow,
      lottery_hint_text: getReviewSetting('lottery_hint_text', ''),
      preferences,
    };
  }

  return { show: false, reason: 'nothing_to_review', preferences };
}

export function listQuickTags(categoryKey, starRating) {
  return db.prepare(`
    SELECT id, label, insert_text, sort_order
    FROM review_quick_tags
    WHERE category_key = ? AND star_rating = ? AND is_active = 1
    ORDER BY sort_order ASC, label ASC
  `).all(categoryKey, starRating);
}

export function createProductReview({
  customerId,
  orderId,
  groupId,
  orderItemId = null,
  rating,
  bodyText,
  quickTagIds = [],
  isAnonymous = false,
  devBypass = false,
} = {}) {
  const normalizedRating = Number(rating);
  if (!Number.isInteger(normalizedRating) || normalizedRating < 1 || normalizedRating > 5) {
    const err = new Error('invalid_rating');
    err.code = 'invalid_rating';
    throw err;
  }

  const trimmedBody = validateReviewBodyText(bodyText);

  const order = db.prepare(`
    SELECT o.*, c.telegram_id AS customer_telegram_id
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ?
  `).get(orderId);

  if (!order || order.customer_id !== customerId) {
    const err = new Error('order_not_found');
    err.code = 'order_not_found';
    throw err;
  }

  if (!COMPLETED_ORDER_STATUSES.has(order.status) && !devBypass) {
    const err = new Error('order_not_reviewable');
    err.code = 'order_not_reviewable';
    throw err;
  }

  const eligibility = getGroupReviewEligibility({
    customerId,
    groupId,
    orderId,
    orderItemId,
    devBypass,
  });

  if (!eligibility.canReview) {
    throw createReviewError(eligibility.reason || 'not_eligible', eligibility);
  }

  const groupMeta = db.prepare(`
    SELECT g.id, g.categoryId AS category_id, c.slug, c.storefront_filters_profile
    FROM category_groups g
    LEFT JOIN categories c ON c.id = g.categoryId
    WHERE g.id = ?
  `).get(groupId);

  if (!groupMeta) {
    const err = new Error('group_not_found');
    err.code = 'group_not_found';
    throw err;
  }

  const tagIds = Array.isArray(quickTagIds) ? [...new Set(quickTagIds.map(String))] : [];
  if (tagIds.length > 0) {
    const expectedCategoryKey = resolveReviewCategoryKey({
      slug: groupMeta.slug,
      storefrontFiltersProfile: groupMeta.storefront_filters_profile,
    });
    const placeholders = tagIds.map(() => '?').join(', ');
    const found = db.prepare(
      `SELECT id FROM review_quick_tags
       WHERE id IN (${placeholders}) AND is_active = 1
         AND category_key = ? AND star_rating = ?`,
    ).all(...tagIds, expectedCategoryKey, normalizedRating);
    if (found.length !== tagIds.length) {
      const err = new Error('invalid_quick_tags');
      err.code = 'invalid_quick_tags';
      throw err;
    }
  }

  const reviewId = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO product_reviews (
      id, customer_id, order_id, order_item_id, group_id, category_id,
      purchased_variant_id, purchased_variant_name,
      rating, body_text, quick_tag_ids, status, is_anonymous,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reviewId,
    customerId,
    orderId,
    eligibility.orderItemId || orderItemId || null,
    groupId,
    groupMeta.category_id || null,
    eligibility.purchasedVariantId || null,
    eligibility.purchasedVariantName || null,
    normalizedRating,
    trimmedBody,
    JSON.stringify(tagIds),
    REVIEW_STATUSES.PENDING,
    isAnonymous ? 1 : 0,
    now,
    now,
  );

  return db.prepare('SELECT * FROM product_reviews WHERE id = ?').get(reviewId);
}

function maskReviewer(customer, review, { viewerCustomerId = null } = {}) {
  if (Number(review.is_anonymous || 0) === 1) {
    return {
      display_name: 'Покупатель',
      photo_url: null,
      is_anonymous: true,
      is_viewer: false,
    };
  }

  const firstName = customer?.first_name || 'Покупатель';
  const lastName = customer?.last_name ? `${customer.last_name.charAt(0)}.` : '';
  return {
    display_name: `${firstName}${lastName ? ` ${lastName}` : ''}`.trim(),
    photo_url: resolvePublicCustomerPhotoUrl(customer, {
      hasDiskCache: hasCustomerPhotoOnDisk(customer?.id),
    }),
    is_anonymous: false,
    is_viewer: Boolean(
      viewerCustomerId
      && customer?.id
      && viewerCustomerId === customer.id,
    ),
  };
}

export function getPublicGroupReviews(
  groupId,
  { limit = 20, offset = 0, viewerCustomerId = null } = {},
) {
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS review_count,
      AVG(rating) AS average_rating
    FROM product_reviews
    WHERE group_id = ? AND status = ?
  `).get(groupId, REVIEW_STATUSES.APPROVED);

  const groupName = db.prepare('SELECT name FROM category_groups WHERE id = ?').get(groupId)?.name || null;

  const rows = db.prepare(`
    SELECT
      pr.*,
      c.id AS customer_id_ref,
      c.first_name,
      c.last_name,
      c.photo_url,
      oi.variant_name AS order_item_variant_name,
      oi.product_title AS order_item_product_title,
      oi.group_name AS order_item_group_name,
      oi.base_product_title AS order_item_base_product_title
    FROM product_reviews pr
    LEFT JOIN customers c ON c.id = pr.customer_id
    LEFT JOIN order_items oi ON oi.id = pr.order_item_id
    WHERE pr.group_id = ? AND pr.status = ?
    ORDER BY pr.approved_at DESC, pr.created_at DESC
    LIMIT ? OFFSET ?
  `).all(groupId, REVIEW_STATUSES.APPROVED, limit, offset);

  const tagIds = new Set();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.quick_tag_ids || '[]');
      if (Array.isArray(parsed)) parsed.forEach((id) => tagIds.add(String(id)));
    } catch {
      // ignore malformed tag ids
    }
  }

  const tagMap = new Map();
  if (tagIds.size > 0) {
    const placeholders = [...tagIds].map(() => '?').join(', ');
    const tags = db.prepare(
      `SELECT id, label FROM review_quick_tags WHERE id IN (${placeholders})`,
    ).all(...tagIds);
    for (const tag of tags) tagMap.set(tag.id, tag.label);
  }

  return {
    group_id: groupId,
    review_count: Number(summary?.review_count || 0),
    average_rating: summary?.average_rating ? Number(summary.average_rating) : null,
    manager: getManagerReviewBlock(),
    items: rows.map((row) => {
      let quickTagLabels = [];
      try {
        const parsed = JSON.parse(row.quick_tag_ids || '[]');
        if (Array.isArray(parsed)) {
          quickTagLabels = parsed
            .map((id) => tagMap.get(String(id)))
            .filter(Boolean);
        }
      } catch {
        quickTagLabels = [];
      }

      const purchasedVariantName =
        row.purchased_variant_name
        || resolvePurchasedVariantName({
          variantName: row.order_item_variant_name,
          productTitle: row.order_item_product_title,
          baseProductTitle: row.order_item_base_product_title,
          groupName: row.order_item_group_name || groupName,
        });

      return {
        id: row.id,
        rating: row.rating,
        body_text: row.body_text,
        purchased_variant_name: purchasedVariantName || null,
        quick_tag_labels: quickTagLabels,
        reviewer: maskReviewer(
          {
            id: row.customer_id_ref,
            first_name: row.first_name,
            last_name: row.last_name,
            photo_url: row.photo_url,
          },
          row,
          { viewerCustomerId },
        ),
        manager_reply: row.manager_reply || null,
        manager_replied_at: row.manager_replied_at || null,
        created_at: row.created_at,
        approved_at: row.approved_at || null,
      };
    }),
  };
}

export function updateCustomerReviewPreferences(customerId, { optOut, preferAnonymous } = {}) {
  const fields = [];
  const params = [];

  if (optOut !== undefined) {
    fields.push('reviews_opt_out = ?');
    params.push(optOut ? 1 : 0);
  }
  if (preferAnonymous !== undefined) {
    fields.push('reviews_prefer_anonymous = ?');
    params.push(preferAnonymous ? 1 : 0);
  }

  if (fields.length === 0) return null;

  fields.push("updated_at = DATETIME('now')");
  params.push(customerId);

  db.prepare(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return db.prepare(`
    SELECT id, reviews_opt_out, reviews_prefer_anonymous
    FROM customers WHERE id = ?
  `).get(customerId);
}

export function countCustomerReviewsInBusinessMonth(customerId, monthOffset = 0) {
  const { start, end } = getBusinessPeriodRange('month', monthOffset);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM product_reviews
    WHERE customer_id = ?
      AND status = ?
      AND COALESCE(approved_at, created_at) >= ?
      AND COALESCE(approved_at, created_at) < ?
  `).get(customerId, REVIEW_STATUSES.APPROVED, startIso, endIso);

  return Number(row?.count || 0);
}