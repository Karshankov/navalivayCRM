import express from "express";
import rateLimit from "express-rate-limit";
import { db } from "../db.js";
import {
  applyOrderLoyaltyReservations,
  buildLoyaltyApplication,
  releaseOrderLoyaltyReservations,
} from "../loyalty.js";
import {
  isInsecureTelegramFallbackEnabled,
  optionalTelegramMiniAppAuth,
  requireTelegramMiniAppAuth,
} from "../telegram-miniapp-auth.js";
import {
  normalizePromoCode,
  releasePromoUsageForOrder,
  reservePromoUsageForOrder,
  validatePromoCode as validatePromoCodeForOrder,
} from "../promo-code-service.js";
import {
  getWholesaleTierById,
  getWholesaleUnitPriceForProduct,
  getWholesalePricedGroupIds,
  resolveWholesaleContextFromRequest,
  validateWholesaleMinimum,
} from "../wholesale-service.js";
import { activatePendingNotesForCustomer } from '../utils/customer-notes.js';
import { resolvePublicCustomerPhotoUrl } from "../utils/customer-photo.js";
import { hasCustomerPhotoOnDisk } from "../utils/customer-photo-disk.js";
import { applyTelegramHttpProxy } from "../utils/telegram-http-proxy.js";
import {
  cacheCustomerPhotoToDisk,
  fetchCustomerPhotoBytes,
  readCustomerPhotoFromDisk,
  refreshCustomerPhotoIfStale,
  warmCustomerPhotoFromInitData,
} from "../utils/customer-photo-refresh.js";
import {
  activatePendingBansForCustomer,
  getActiveBlockForTelegramId,
  getPendingBanForUsername,
  serializeBlock,
} from "../utils/customer-blocks.js";
import {
  listActiveAgreements,
  validateAcceptedAgreementIds,
  buildAcceptedSnapshot,
} from "../utils/agreements.js";
import {
  confirmVerificationOnAccess,
  isCustomerVerified,
} from "../utils/business-bot.js";
import { autoNotifyOrderAcceptedAfterRecipientWarmup } from "../utils/auto-notify.js";
import {
  assignLowestAvailablePickupCell,
  getActivePickupCellAssignment,
  releaseActivePickupCell,
} from "../utils/pickup-cells.js";
import {
  activatePendingInviteBanForCustomer,
  activatePendingStaffAccess,
  attachFirstOrderToReferral,
  authorizeCustomerWithoutReferral,
  getReferralAuthorizationStatus,
  inspectInviter,
  isReferralAuthorizationEnabled,
  markReferralAuthorized,
  recordReferralOutcome,
} from "../utils/referral-authorization.js";
import { getBusinessPeriodRange } from "../utils/business-time.js";
import { queryTopSalesGroups } from "../utils/top-sales-groups.js";
import {
  applyDiscountToPrice,
  loadActiveDiscounts,
  pickDiscountFromMaps,
  resolveDiscountPrice,
} from "../utils/catalog-discounts.js";
import { STOREFRONT_FILTER_PROFILES } from "../utils/storefront-filters.js";
import { resolveCatalogUnitPrice } from "../utils/order-line-pricing.js";
import { resolveCoverImage } from "../services/image-thumbnail-service.js";
import { roundMoney } from "../utils/money.js";
import {
  getCardCustomerSnapshot,
  getCardLimitSnapshot,
  normalizeTelegramUsername as normalizeCardTelegramUsername,
  checkCardOrder,
  reserveCheckedCardOrder,
  reverseCardOrder,
  resolveCardAccount,
  toMinorUnits,
} from "../utils/card-payment-service.js";
import {
  createProductReview,
  findCustomerByTelegram,
  findOwnedOrders,
  getPublicGroupReviews,
  getReviewErrorMessage,
  getReviewPromptForCustomer,
  shouldDevBypassForCustomer,
  listQuickTags,
  serializeOrderDetail,
  serializeOrderHistoryCard,
  updateCustomerReviewPreferences,
} from "../utils/product-reviews.js";

export const publicRouter = express.Router();

const topSalesCache = new Map();
const TOP_SALES_CACHE_TTL_MS = 10 * 60 * 1000;

function getTopSalesCacheKey(categoryId, limit) {
  return `${String(categoryId || "all")}:${Number(limit)}`;
}

function readTopSalesCache(key) {
  const entry = topSalesCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    topSalesCache.delete(key);
    return null;
  }
  return entry.data;
}

function writeTopSalesCache(key, data) {
  topSalesCache.set(key, {
    data,
    expiresAt: Date.now() + TOP_SALES_CACHE_TTL_MS,
  });
}

/** Розница: цена варианта из БД, если > 0; иначе цена строки товара / опт. Опт: всегда effectivePrice. */
function resolveVariantPublicPriceRub(variantRow, effectivePrice, isWholesaleTier) {
  if (isWholesaleTier) {
    return effectivePrice;
  }
  const raw = variantRow?.priceRub;
  const n = raw != null && raw !== "" ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) {
    return n;
  }
  return effectivePrice;
}

const MAX_SQL_VARS = 900;
const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN || "";
const allowInsecureTelegramFallback = isInsecureTelegramFallbackEnabled();
const publicMiniAppReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
const publicMiniAppMutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  // Один большой дымовой тест проверяет много независимых пользователей с
  // одного loopback-IP. Остальные тесты и production сохраняют лимит 40.
  max: process.env.NODE_ENV === "test"
    ? Number(process.env.TEST_PUBLIC_MINIAPP_MUTATION_RATE_LIMIT_MAX || 40)
    : 40,
  standardHeaders: true,
  legacyHeaders: false,
});

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getNextNumber(table, field) {
  const row = db.prepare(`SELECT MAX(${field}) as maxNum FROM ${table}`).get();
  return (row?.maxNum || 0) + 1;
}

function throwPromoValidationError(result) {
  const error = new Error(result?.error || "invalid_promo");
  error.code = "invalid_promo";
  error.promoError = result?.error || "invalid_promo";
  error.userMessage = result?.message || "Недействительный промокод";
  throw error;
}

async function fetchTelegramChat(telegramId) {
  if (!TELEGRAM_BOT_TOKEN || !telegramId) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  timeout.unref?.();
  let response;
  let payload;
  try {
    response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChat?chat_id=${encodeURIComponent(String(telegramId))}`,
      { ...applyTelegramHttpProxy(), signal: controller.signal },
    );
    payload = await response.json();
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok || !payload?.ok) {
    const description = payload?.description || `HTTP ${response.status}`;
    throw new Error(description);
  }

  return payload.result || null;
}


function normalizeTelegramUsername(value) {
  return typeof value === "string" ? value.trim().replace(/^@+/, "") : "";
}

async function resolveTelegramUsernameStatus(telegramId) {
  const dbCustomer = db
    .prepare("SELECT telegram_username, first_name, last_name FROM customers WHERE telegram_id = ?")
    .get(telegramId);

  const storedUsername = normalizeTelegramUsername(dbCustomer?.telegram_username);

  // Локально живого Telegram нет, и без этой ветки витрину в браузере не
  // открыть вовсе: замок требует свежий username, а взять его неоткуда.
  // Верим тому, что уже лежит в базе. Флаг требует одновременно
  // NODE_ENV=development и ALLOW_INSECURE_TELEGRAM_AUTH=1, поэтому на проде
  // ветка недостижима.
  if (allowInsecureTelegramFallback && storedUsername) {
    return {
      ok: true,
      status: "confirmed",
      hasUsername: true,
      username: storedUsername,
      source: "dev-stored",
      canRetryLive: false,
      message: "Username взят из базы: локальная разработка без Telegram",
    };
  }

  if (!TELEGRAM_BOT_TOKEN) {
    return {
      ok: true,
      status: "retry",
      hasUsername: false,
      username: null,
      source: "unavailable",
      canRetryLive: false,
      storedUsername,
      message: "Проверка username временно недоступна. Закройте и откройте магазин заново.",
    };
  }

  try {
    const chat = await fetchTelegramChat(telegramId);
    const username = normalizeTelegramUsername(chat?.username);
    const firstName = typeof chat?.first_name === "string" && chat.first_name.trim() !== ""
      ? chat.first_name.trim()
      : dbCustomer?.first_name || null;
    const lastName = typeof chat?.last_name === "string" && chat.last_name.trim() !== ""
      ? chat.last_name.trim()
      : dbCustomer?.last_name || null;

    if (dbCustomer) {
      db.prepare(`
        UPDATE customers
        SET telegram_username = ?,
            first_name = COALESCE(?, first_name),
            last_name = COALESCE(?, last_name),
            last_visit_at = DATETIME('now'),
            updated_at = DATETIME('now')
        WHERE telegram_id = ?
      `).run(username || null, firstName, lastName, telegramId);
    }

    const status = username ? "confirmed" : "missing";
    const message = username
      ? "Username подтвержден"
      : "Telegram пока не передал ваш username. Если вы только что его установили, закройте магазин и откройте заново - это обновит данные.";

    return {
      ok: true,
      status,
      hasUsername: Boolean(username),
      username: username || null,
      source: "telegram",
      canRetryLive: true,
      message,
    };
  } catch (telegramError) {
    return {
      ok: true,
      status: "retry",
      hasUsername: false,
      username: null,
      source: "unavailable",
      canRetryLive: true,
      warning: "live_check_failed",
      storedUsername: normalizeTelegramUsername(dbCustomer?.telegram_username),
      message: "Telegram пока не передал обновлённый username. Подождите несколько секунд и попробуйте ещё раз.",
    };
  }
}

function chunkArray(arr, size = MAX_SQL_VARS) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function pushToMap(map, key, value) {
  const list = map.get(key);
  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}

function pushVariantImage(map, productId, variantId, url) {
  let byProduct = map.get(productId);
  if (!byProduct) {
    byProduct = new Map();
    map.set(productId, byProduct);
  }
  const list = byProduct.get(variantId);
  if (list) {
    list.push(url);
  } else {
    byProduct.set(variantId, [url]);
  }
}

function getMinDeliveryAmount() {
  const minDeliveryRow = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("min_delivery_amount");
  return parseFloat(minDeliveryRow?.value || "0") || 0;
}

function ensureMinDeliveryAmountSatisfied(totalAmount) {
  const minDeliveryAmount = getMinDeliveryAmount();
  if (minDeliveryAmount <= 0) {
    return null;
  }

  if (Number(totalAmount || 0) >= minDeliveryAmount) {
    return null;
  }

  return {
    error: "min_delivery_amount_not_met",
    message: `Минимальная сумма заказа для доставки: ${minDeliveryAmount} BYN. Сейчас в корзине: ${Number(totalAmount || 0).toFixed(2)} BYN`,
    min_amount: minDeliveryAmount,
    current_amount: Number(totalAmount || 0),
  };
}

function buildWholesaleErrorPayload(error) {
  return {
    error: error?.code || "invalid_wholesale_link",
    message: error?.message || "Оптовая ссылка недействительна",
  };
}

function resolveWholesaleContextOrSendError(req, res) {
  try {
    return resolveWholesaleContextFromRequest(req);
  } catch (error) {
    res.status(error?.statusCode || 400).json(buildWholesaleErrorPayload(error));
    return null;
  }
}

function buildStoredWholesaleContext(order) {
  if (!order || Number(order.is_wholesale || 0) !== 1 || !order.wholesale_tier_id) {
    return null;
  }

  const tier = getWholesaleTierById(order.wholesale_tier_id);
  if (!tier) {
    return null;
  }

  return {
    isWholesale: true,
    tier: {
      ...tier,
      label: order.wholesale_tier_label || tier.label,
      minOrderAmount: Number(
        order.wholesale_min_amount ?? tier.minOrderAmount ?? 0,
      ),
    },
    code: tier.code,
    secret: "",
    minOrderAmount: Number(order.wholesale_min_amount ?? tier.minOrderAmount ?? 0),
    label: order.wholesale_tier_label || tier.label,
  };
}

function applyWholesaleTierFilter(whereClauses, whereParams, tierId, column = "p.groupId") {
  const normalizedTierId = typeof tierId === "string" ? tierId.trim() : "";
  if (!normalizedTierId) {
    whereClauses.push("1 = 0");
    return;
  }

  whereClauses.push(`EXISTS (
    SELECT 1
    FROM category_group_wholesale_prices gwp
    WHERE gwp.group_id = ${column}
      AND gwp.tier_id = ?
      AND gwp.price_byn > 0
  )`);
  whereParams.push(normalizedTierId);
}

async function resolveVerifiedOrderUsername(authIdentity, submittedUsername) {
  const normalizedSubmitted = normalizeTelegramUsername(submittedUsername);
  const verifiedFromAuth = normalizeTelegramUsername(authIdentity?.telegramUsername);

  if (verifiedFromAuth) {
    return verifiedFromAuth;
  }

  const telegramId = authIdentity?.telegramId ? String(authIdentity.telegramId).trim() : "";
  if (telegramId) {
    const usernameStatus = await resolveTelegramUsernameStatus(telegramId);

    if (usernameStatus.status === "confirmed" && usernameStatus.username) {
      return normalizeTelegramUsername(usernameStatus.username);
    }

    if (usernameStatus.status === "missing") {
      const error = new Error(
        usernameStatus.message || "Для оформления заказа нужен Telegram username",
      );
      error.code = "telegram_username_required";
      throw error;
    }

    if (normalizedSubmitted && allowInsecureTelegramFallback) {
      return normalizedSubmitted;
    }

    const error = new Error(
      "Не удалось проверить username. Закройте магазин и откройте заново.",
    );
    error.code = "telegram_username_not_verified";
    throw error;
  }

  return normalizedSubmitted;
}

const ACTIVE_CUSTOMER_ORDER_STATUSES = new Set(["new", "in_progress"]);

function recordOrderStatusChange(orderId, previousStatus, newStatus, note) {
  if (!orderId || previousStatus === newStatus) {
    return;
  }

  try {
    db.prepare(
      `
      INSERT INTO order_status_history (id, order_id, previous_status, new_status, note)
      VALUES (?, ?, ?, ?, ?)
    `,
    ).run(
      generateId("osh"),
      orderId,
      previousStatus || null,
      newStatus,
      note || null,
    );
  } catch (error) {
    console.warn("[public] Failed to record status history:", error.message);
  }
}

function findOwnedActiveOrder({ orderId = null, telegramId = "", telegramUsername = "" } = {}) {
  const normalizedUsername = normalizeTelegramUsername(telegramUsername).toLowerCase();

  if (!telegramId && !normalizedUsername) {
    return null;
  }

  const params = [];
  let sql = `
    SELECT
      o.*,
      c.telegram_id AS customer_telegram_id,
      c.first_name AS customer_first_name,
      c.last_name AS customer_last_name,
      COALESCE(o.telegram_username, c.telegram_username) AS resolved_telegram_username
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE COALESCE(o.archived, 0) = 0
      AND o.status IN ('new', 'in_progress')
  `;

  if (orderId) {
    sql += " AND o.id = ?";
    params.push(orderId);
  }

  sql += " ORDER BY o.updated_at DESC, o.created_at DESC";

  const candidates = db.prepare(sql).all(...params);

  return (
    candidates.find((candidate) => {
      if (
        telegramId &&
        candidate.customer_telegram_id &&
        String(candidate.customer_telegram_id) === String(telegramId)
      ) {
        return true;
      }

      if (!normalizedUsername) {
        return false;
      }

      const candidateUsername = normalizeTelegramUsername(
        candidate.resolved_telegram_username,
      ).toLowerCase();
      return Boolean(candidateUsername) && candidateUsername === normalizedUsername;
    }) || null
  );
}

function restoreStockForOrderItems(orderItems) {
  for (const item of orderItems) {
    if (item.variant_id) {
      db.prepare(
        "UPDATE product_variants SET stock = stock + ? WHERE id = ?",
      ).run(item.quantity, item.variant_id);
    } else if (item.product_id) {
      db.prepare(
        "UPDATE products SET stock = stock + ? WHERE id = ?",
      ).run(item.quantity, item.product_id);
    }
  }
}

function clearPromoUsageForOrder(order) {
  releasePromoUsageForOrder(order);
}

function describeOrderItem(item) {
  const lineName = item.group_name || item.groupName || null;
  const baseTitle =
    item.base_product_title ||
    item.product_title ||
    item.title ||
    item.product_id ||
    "товар";
  const titledItem = item.variant_name ? `${baseTitle} (${item.variant_name})` : baseTitle;
  return lineName ? `${lineName} - ${titledItem}` : titledItem;
}

function buildManagerActionNote({
  previousItems,
  nextItems,
  previousPromoCodeText,
  nextPromoCodeText,
}) {
  const previousMap = new Map();
  const nextMap = new Map();

  previousItems.forEach((item) => {
    previousMap.set(`${item.product_id || ""}::${item.variant_id || ""}`, item);
  });
  nextItems.forEach((item) => {
    nextMap.set(`${item.product_id || ""}::${item.variant_id || ""}`, item);
  });

  const parts = [];

  for (const [key, nextItem] of nextMap.entries()) {
    const previousItem = previousMap.get(key);
    if (!previousItem) {
      parts.push(`добавлено: ${describeOrderItem(nextItem)} x${nextItem.quantity}`);
      continue;
    }

    if (Number(previousItem.quantity) !== Number(nextItem.quantity)) {
      parts.push(
        `количество: ${describeOrderItem(nextItem)} ${previousItem.quantity}→${nextItem.quantity}`,
      );
    }
  }

  for (const [key, previousItem] of previousMap.entries()) {
    if (!nextMap.has(key)) {
      parts.push(`убрано: ${describeOrderItem(previousItem)} x${previousItem.quantity}`);
    }
  }

  if ((previousPromoCodeText || null) !== (nextPromoCodeText || null)) {
    parts.push(
      nextPromoCodeText
        ? `промокод: ${nextPromoCodeText}`
        : "промокод удалён",
    );
  }

  return parts.slice(0, 4).join("; ") || "Клиент обновил заказ";
}

function loadCustomerOrderItems(orderId) {
  const items = db
    .prepare(
      `
      SELECT
        oi.*,
        p.categoryId AS category_id,
        p.groupId AS group_id,
        p.description AS product_description,
        g.cover_image AS group_cover_image,
        c.cover_image AS category_cover_image
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN category_groups g ON g.id = p.groupId
      LEFT JOIN categories c ON c.id = p.categoryId
      WHERE oi.order_id = ?
      ORDER BY oi.rowid ASC
    `,
    )
    .all(orderId);

  const baseImageStmt = db.prepare(
    "SELECT url FROM product_images WHERE productId = ? AND variant_id IS NULL ORDER BY position ASC",
  );
  const variantImageStmt = db.prepare(
    "SELECT url FROM product_images WHERE productId = ? AND variant_id = ? ORDER BY position ASC",
  );

  return items.map((item) => {
    const variantImages =
      item.product_id && item.variant_id
        ? variantImageStmt
            .all(item.product_id, item.variant_id)
            .map((row) => row.url)
        : [];
    const baseImages = item.product_id
      ? baseImageStmt.all(item.product_id).map((row) => row.url)
      : [];

    const image =
      variantImages[0] ||
      baseImages[0] ||
      item.group_cover_image ||
      item.category_cover_image ||
      null;

    return {
      id: item.id,
      product_id: item.product_id,
      product_title: item.product_title,
      product_description: item.product_description || null,
      group_name: item.group_name || null,
      base_product_id: item.base_product_id || null,
      base_product_title: item.base_product_title || item.product_title,
      variant_id: item.variant_id || null,
      variant_name: item.variant_name || null,
      quantity: Number(item.quantity || 0),
      price_per_unit: Number(item.price_per_unit || 0),
      discount_amount: Number(item.discount_amount || 0),
      manual_discount_amount: Number(item.manual_discount_amount || 0),
      loyalty_discount_amount: Number(item.loyalty_discount_amount || 0),
      loyalty_units_applied: Number(item.loyalty_units_applied || 0),
      total_price: Number(item.total_price || 0),
      total_cost: Number(item.total_cost || 0),
      image,
      cart_item: {
        productId: item.product_id,
        title: item.product_title,
        productTitle: item.base_product_title || item.product_title,
        groupName: item.group_name || null,
        priceRub: Number(item.price_per_unit || 0),
        quantity: Number(item.quantity || 0),
        image,
        variantId: item.variant_id || null,
        variantName: item.variant_name || null,
        groupId: item.group_id || null,
        categoryId: item.category_id || null,
      },
    };
  });
}

function serializeCustomerOrder(order) {
  const items = loadCustomerOrderItems(order.id);
  const isActive = ACTIVE_CUSTOMER_ORDER_STATUSES.has(order.status);
  const pickupCell = getActivePickupCellAssignment(order.id);
  const wholesaleTier = order.wholesale_tier_id
    ? getWholesaleTierById(order.wholesale_tier_id)
    : null;

  return {
    found: true,
    id: order.id,
    order_number: isActive ? pickupCell?.cell_number ?? null : order.order_number,
    status: order.status,
    pickup_cell_number: isActive ? pickupCell?.cell_number ?? null : null,
    delivery_type: order.delivery_type,
    delivery_address: order.delivery_address || null,
    phone: order.phone || null,
    notes: order.notes || null,
    total_amount: Number(order.total_amount || 0),
    discount_amount: Number(order.discount_amount || 0),
    final_amount: Number(order.final_amount || 0),
    payment_type: order.payment_type || null,
    card_amount_minor: Number(order.card_amount_minor || 0),
    cash_due_minor: Number(order.cash_due_minor || 0),
    promo_code_text: order.promo_code_text || null,
    is_wholesale: Number(order.is_wholesale || 0),
    wholesale_tier_id: order.wholesale_tier_id || null,
    wholesale_code: wholesaleTier?.code || null,
    wholesale_secret: wholesaleTier?.secretKey || null,
    wholesale_tier_label: order.wholesale_tier_label || null,
    wholesale_min_amount: order.wholesale_min_amount === null || order.wholesale_min_amount === undefined
      ? null
      : Number(order.wholesale_min_amount),
    telegram_username: normalizeTelegramUsername(
      order.resolved_telegram_username || order.telegram_username,
    ) || null,
    created_at: order.created_at,
    updated_at: order.updated_at,
    needs_manager_action: Number(order.needs_manager_action || 0),
    manager_action_type: order.manager_action_type || null,
    manager_action_note: order.manager_action_note || null,
    can_edit: isActive,
    can_cancel: isActive,
    items,
  };
}

publicRouter.get("/api/wholesale/context", (req, res) => {
  const wholesaleContext = resolveWholesaleContextOrSendError(req, res);
  if (!wholesaleContext) {
    if (res.headersSent) {
      return;
    }
    return res.status(400).json({
      error: "wholesale_required",
      message: "Не указана оптовая ссылка",
    });
  }

  return res.json({
    ok: true,
    is_wholesale: true,
    wholesale_code: wholesaleContext.tier.code,
    wholesale_label: wholesaleContext.tier.label,
    wholesale_min_amount: Number(wholesaleContext.tier.minOrderAmount || 0),
    restrictions: {
      hide_banners: true,
      disable_loyalty: true,
      disable_promos: true,
      replace_bottom_tab_bar: true,
    },
  });
});

publicRouter.get("/api/categories", (req, res) => {
  const wholesaleContext = resolveWholesaleContextOrSendError(req, res);
  if (!wholesaleContext && res.headersSent) {
    return;
  }

  const pricedGroupIds = wholesaleContext?.tier
    ? getWholesalePricedGroupIds(wholesaleContext.tier.id)
    : [];

  // РћРџРўРРњРР—РђР¦РРЇ: РЅРµ Р·Р°РіСЂСѓР¶Р°РµРј cover_image РІ СЃРїРёСЃРєРµ - СЌРєРѕРЅРѕРјРёС‚ ~8MB С‚СЂР°С„РёРєР°
  // Р¤СЂРѕРЅС‚РµРЅРґ Р·Р°РіСЂСѓР¶Р°РµС‚ РѕР±Р»РѕР¶РєРё РѕС‚РґРµР»СЊРЅРѕ С‡РµСЂРµР· /api/categories/:id/image
  const categoriesRaw = db
    .prepare(
      `
    SELECT c.id, c.slug, c.name, c.[order], c.hide_empty, 
           CASE WHEN c.cover_image IS NOT NULL AND c.cover_image != '' THEN 1 ELSE 0 END as hasCoverImage,
           c.display_mode,
           c.storefront_filters_profile
    FROM categories c
    ORDER BY c.[order] ASC, c.name ASC
  `,
    )
    .all();

  let groupsRaw = db
    .prepare(
      `
    SELECT g.id, g.categoryId, g.slug, g.name, 
           CASE WHEN g.cover_image IS NOT NULL AND g.cover_image != '' THEN 1 ELSE 0 END as hasCoverImage,
           g.[order], g.hide_empty, g.parent_group_id, g.meta_label, g.meta_value,
           g.strength_tier,
           g.new_since,
           CASE WHEN g.new_until > DATETIME('now') THEN 1 ELSE 0 END AS is_new
    FROM category_groups g
    ORDER BY g.categoryId ASC, g.[order] ASC, g.name ASC
  `,
    )
    .all();

  if (wholesaleContext?.tier) {
    const parentById = new Map(
      groupsRaw.map((group) => [
        String(group.id),
        group.parent_group_id ? String(group.parent_group_id) : null,
      ]),
    );
    const visibleGroupIds = new Set(pricedGroupIds.map((id) => String(id)));

    pricedGroupIds.forEach((groupId) => {
      let cursor = parentById.get(String(groupId));
      while (cursor) {
        if (visibleGroupIds.has(cursor)) {
          break;
        }
        visibleGroupIds.add(cursor);
        cursor = parentById.get(cursor) || null;
      }
    });

    groupsRaw = groupsRaw.filter((group) => visibleGroupIds.has(String(group.id)));
  }

  const categoryCountWhere = [
    `(
      (p.has_variants = 0 AND (p.stock IS NULL OR p.stock > 0))
      OR
      (p.has_variants = 1 AND EXISTS (
        SELECT 1 FROM product_variants pv 
        WHERE pv.product_id = p.id 
          AND (pv.stock IS NULL OR pv.stock > 0)
      ))
    )`,
  ];
  const categoryCountParams = [];

  if (wholesaleContext?.tier) {
    applyWholesaleTierFilter(
      categoryCountWhere,
      categoryCountParams,
      wholesaleContext.tier.id,
    );
  }

  const categoryCountRows = db
    .prepare(
      `
    SELECT categoryId, COUNT(DISTINCT p.id) as total
    FROM products p
    WHERE ${categoryCountWhere.join(" AND ")}
    GROUP BY categoryId
  `,
    )
    .all(...categoryCountParams);

  const groupCountWhere = [
    "groupId IS NOT NULL",
    `(
      (p.has_variants = 0 AND (p.stock IS NULL OR p.stock > 0))
      OR
      (p.has_variants = 1 AND EXISTS (
        SELECT 1 FROM product_variants pv 
        WHERE pv.product_id = p.id 
          AND (pv.stock IS NULL OR pv.stock > 0)
      ))
    )`,
  ];
  const groupCountParams = [];

  if (wholesaleContext?.tier) {
    applyWholesaleTierFilter(
      groupCountWhere,
      groupCountParams,
      wholesaleContext.tier.id,
    );
  }

  const groupCountRows = db
    .prepare(
      `
    SELECT groupId, COUNT(DISTINCT p.id) as total
    FROM products p
    WHERE ${groupCountWhere.join(" AND ")}
    GROUP BY groupId
  `,
    )
    .all(...groupCountParams);

  const categoryCounts = new Map(
    categoryCountRows.map((row) => [row.categoryId, row.total]),
  );
  const groupCounts = new Map(
    groupCountRows.map((row) => [row.groupId, row.total]),
  );

  const nodes = groupsRaw.map((group) => ({
    id: group.id,
    categoryId: group.categoryId,
    slug: group.slug,
    name: group.name,
    order: group["order"],
    hasCoverImage: group.hasCoverImage === 1,
    // Готовый адрес обложки: витрина ставит его прямо в <img>, и картинку
    // тянет сам браузер — лениво, параллельно и с кэшем.
    coverImage: group.hasCoverImage === 1 ? `/api/category-groups/${group.id}/cover` : null,
    hideEmpty: group.hide_empty === 1,
    parentId: group.parent_group_id || null,
    metaLabel: group.meta_label || null,
    metaValue: group.meta_value || null,
    strengthTier: group.strength_tier || null,
    isNew: group.is_new === 1,
    newSince: group.new_since || null,
    productCount: groupCounts.get(group.id) || 0,
    totalProductCount: 0,
    children: [],
  }));

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const rootsByCategory = new Map();

  nodes.forEach((node) => {
    if (node.parentId && nodesById.has(node.parentId)) {
      nodesById.get(node.parentId).children.push(node);
    } else {
      const list = rootsByCategory.get(node.categoryId) || [];
      list.push(node);
      rootsByCategory.set(node.categoryId, list);
    }
  });

  const computeTotals = (node) => {
    node.children.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    let total = Number(node.productCount ?? 0);
    node.children.forEach((child) => {
      total += computeTotals(child);
    });
    node.totalProductCount = total;
    return total;
  };

  rootsByCategory.forEach((list) => {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    list.forEach((node) => computeTotals(node));
  });

  const collectVisible = (node) => {
    if (node.totalProductCount === 0 && node.hideEmpty) {
      return [];
    }
    const result = [
      {
        id: node.id,
        categoryId: node.categoryId,
        slug: node.slug,
        name: node.name,
        order: node.order,
        hasCoverImage: node.hasCoverImage,
        coverImage: node.coverImage,
        hideEmpty: node.hideEmpty,
        parentId: node.parentId,
        metaLabel: node.metaLabel || null,
        metaValue: node.metaValue || null,
        strengthTier: node.strengthTier || null,
        // Линейка без остатка на витрину вообще не попадает, поэтому «кончился
        // товар, плашка снимается» отрабатывает само.
        isNew: node.isNew && node.totalProductCount > 0,
        newSince: node.newSince || null,
        productCount: node.productCount,
        totalProductCount: node.totalProductCount,
      },
    ];

    node.children.forEach((child) => {
      result.push(...collectVisible(child));
    });
    return result;
  };

  const flattenedGroupsByCategory = new Map();
  rootsByCategory.forEach((nodesList, categoryId) => {
    const collected = [];
    nodesList.forEach((node) => {
      collected.push(...collectVisible(node));
    });
    flattenedGroupsByCategory.set(categoryId, collected);
  });

  const categories = [];

  for (const cat of categoriesRaw) {
    const totalProducts = categoryCounts.get(cat.id) || 0;
    const groups = (flattenedGroupsByCategory.get(cat.id) || []).filter(
      (group) => group.totalProductCount > 0,
    );

    const hasVisibleProducts = totalProducts > 0 || groups.length > 0;

    if (!hasVisibleProducts) {
      continue;
    }

    if (cat.hide_empty === 1 && totalProducts === 0 && groups.length === 0) {
      continue;
    }

    categories.push({
      id: cat.id,
      slug: cat.slug,
      name: cat.name,
      order: cat["order"],
      hasCoverImage: cat.hasCoverImage === 1,
      coverImage: cat.hasCoverImage === 1 ? `/api/categories/${cat.id}/cover` : null,
      productCount: totalProducts,
      groups,
      displayMode: cat.display_mode || "default",
      storefrontFiltersProfile:
        cat.storefront_filters_profile || STOREFRONT_FILTER_PROFILES.NONE,
    });
  }

  res.json(categories);
});

publicRouter.get("/api/top-sales-groups", (req, res) => {
  try {
    const categoryRaw = req.query.category ?? req.query.categoryId ?? null;
    const categoryId =
      categoryRaw != null && String(categoryRaw).trim() !== ""
        ? String(categoryRaw).trim()
        : null;

    const limitRaw = Number(req.query.limit ?? 5);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), 20)
      : 5;

    if (categoryId) {
      const category = db
        .prepare("SELECT id, storefront_filters_profile FROM categories WHERE id = ?")
        .get(categoryId);
      if (!category) {
        return res.status(404).json({ error: "category_not_found" });
      }
      const profile = String(
        category.storefront_filters_profile ?? STOREFRONT_FILTER_PROFILES.NONE,
      );
      if (
        profile !== STOREFRONT_FILTER_PROFILES.LIQUIDS &&
        profile !== STOREFRONT_FILTER_PROFILES.SNUS_PLATES
      ) {
        return res.json({ period: "month", items: [], hasMore: false });
      }
    }

    const cacheKey = getTopSalesCacheKey(categoryId, limit);
    const cached = readTopSalesCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const { start, end } = getBusinessPeriodRange("month", 0);
    const { items, hasMore } = queryTopSalesGroups({
      start,
      end,
      categoryId,
      sortBy: "quantity",
      limit,
      onlyStorefrontAvailable: true,
    });

    const payload = {
      period: "month",
      categoryId,
      items,
      hasMore,
    };
    writeTopSalesCache(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    console.error("[public] top-sales-groups error:", error);
    res.status(500).json({ error: "failed", message: error.message });
  }
});

publicRouter.get("/api/banners", (req, res) => {
  const wholesaleContext = resolveWholesaleContextOrSendError(req, res);
  if (!wholesaleContext && res.headersSent) {
    return;
  }

  if (wholesaleContext) {
    return res.json([]);
  }

  const rows = db
    .prepare(
      "SELECT id, image, href, active, [order], openInNewTab FROM banners WHERE active = 1 ORDER BY [order] ASC",
    )
    .all();
  return res.json(rows);
});

// Endpoint РґР»СЏ РїРѕР»СѓС‡РµРЅРёСЏ РѕР±Р»РѕР¶РєРё РєР°С‚РµРіРѕСЂРёРё РѕС‚РґРµР»СЊРЅРѕ (РѕРїС‚РёРјРёР·Р°С†РёСЏ С‚СЂР°С„РёРєР°)
/**
 * Обложки отдаём файлом, а не base64 внутри JSON.
 *
 * В базе обложка лежит куском base64 на 800x800 — до 190 КБ на линейку, и в
 * категории «Жидкости» таких 107 штук. Раньше витрина тянула их по одной
 * JSON-запросом, браузер не мог ни кэшировать их, ни грузить лениво, и на
 * мобильном интернете фото проявлялись по десять секунд.
 *
 * Теперь на первый запрос картинка один раз режется в webp и ложится на диск
 * под именем от хэша содержимого, дальше отдаётся редиректом на готовый файл.
 * Имя меняется вместе с картинкой, поэтому файл можно кэшировать надолго.
 */
function sendCoverRedirect(res, source, meta) {
  return resolveCoverImage(source, meta)
    .then((url) => {
      if (!url) return res.status(404).json({ error: "Image not found" });
      // Сам редирект короткоживущий: у линейки могут поменять обложку, и
      // тогда покупатель должен увидеть новую, а не вчерашнюю.
      res.set("Cache-Control", "public, max-age=300");
      return res.redirect(302, url);
    })
    .catch((error) => {
      console.error("[cover] failed to resolve cover image:", error);
      return res.status(500).json({ error: "cover_failed" });
    });
}

publicRouter.get("/api/categories/:id/cover", (req, res) => {
  const row = db
    .prepare("SELECT cover_image FROM categories WHERE id = ?")
    .get(req.params.id);
  if (!row?.cover_image) {
    return res.status(404).json({ error: "Image not found" });
  }
  return sendCoverRedirect(res, row.cover_image, {
    sourceType: "category",
    sourceId: req.params.id,
    sourceField: "cover_image",
  });
});

publicRouter.get("/api/category-groups/:id/cover", (req, res) => {
  const row = db
    .prepare("SELECT cover_image FROM category_groups WHERE id = ?")
    .get(req.params.id);
  if (!row?.cover_image) {
    return res.status(404).json({ error: "Image not found" });
  }
  return sendCoverRedirect(res, row.cover_image, {
    sourceType: "category_group",
    sourceId: req.params.id,
    sourceField: "cover_image",
  });
});

publicRouter.get("/api/categories/:id/image", (req, res) => {
  const { id } = req.params;
  const row = db
    .prepare("SELECT cover_image FROM categories WHERE id = ?")
    .get(id);
  if (!row || !row.cover_image) {
    return res.status(404).json({ error: "Image not found" });
  }
  res.json({ image: row.cover_image });
});

// Endpoint РґР»СЏ РїРѕР»СѓС‡РµРЅРёСЏ РѕР±Р»РѕР¶РєРё РіСЂСѓРїРїС‹ РєР°С‚РµРіРѕСЂРёР№
publicRouter.get("/api/category-groups/:id/image", (req, res) => {
  const { id } = req.params;
  const row = db
    .prepare("SELECT cover_image FROM category_groups WHERE id = ?")
    .get(id);
  if (!row || !row.cover_image) {
    return res.status(404).json({ error: "Image not found" });
  }
  res.json({ image: row.cover_image });
});

publicRouter.get("/api/products", (req, res) => {
  const wholesaleContext = resolveWholesaleContextOrSendError(req, res);
  if (!wholesaleContext && res.headersSent) {
    return;
  }

  const { category, group, sort } = req.query;

  const limit = Math.min(
    Math.max(parseInt(req.query.limit ?? "50", 10) || 50, 1),
    1000,
  );
  const offset = Math.max(parseInt(req.query.offset ?? "0", 10) || 0, 0);

  let whereClauses = [];
  const whereParams = [];
  let categoryFilterId = null;

  if (category) {
    const cat = db
      .prepare("SELECT id FROM categories WHERE slug = ?")
      .get(String(category));
    if (!cat) {
      return res.json({ products: [], total: 0, hasMore: false });
    }
    categoryFilterId = cat.id;
    whereClauses.push("p.categoryId = ?");
    whereParams.push(cat.id);
  }

  if (group) {
    const groupRow = db
      .prepare("SELECT id, categoryId FROM category_groups WHERE slug = ?")
      .get(String(group));
    if (!groupRow) {
      return res.json({ products: [], total: 0, hasMore: false });
    }
    if (categoryFilterId && groupRow.categoryId !== categoryFilterId) {
      return res.json({ products: [], total: 0, hasMore: false });
    }
    if (!categoryFilterId) {
      categoryFilterId = groupRow.categoryId;
    }
    whereClauses.push("p.groupId = ?");
    whereParams.push(groupRow.id);
  }

  whereClauses.unshift(`(
    (p.has_variants = 0 AND (p.stock IS NULL OR p.stock > 0))
    OR
    (p.has_variants = 1 AND EXISTS (
      SELECT 1 FROM product_variants pv 
      WHERE pv.product_id = p.id 
      AND (pv.stock IS NULL OR pv.stock > 0)
    ))
  )`);

  if (wholesaleContext?.tier) {
    applyWholesaleTierFilter(whereClauses, whereParams, wholesaleContext.tier.id);
  }

  const where = `WHERE ${whereClauses.join(" AND ")}`;
  const effectivePriceExpr = wholesaleContext?.tier
    ? `(SELECT gwp.price_byn FROM category_group_wholesale_prices gwp WHERE gwp.group_id = p.groupId AND gwp.tier_id = ? LIMIT 1)`
    : `p.priceRub`;

  let orderBy = "ORDER BY effectivePriceRub ASC";
  switch (String(sort || "price_asc")) {
    case "price_desc":
      orderBy = "ORDER BY effectivePriceRub DESC";
      break;
    case "newest":
      orderBy = "ORDER BY p.createdAt DESC";
      break;
    case "oldest":
      orderBy = "ORDER BY p.createdAt ASC";
      break;
    default:
      orderBy = "ORDER BY effectivePriceRub ASC";
  }

  const countSql = `SELECT COUNT(*) as total FROM products p ${where}`;
  const total = whereParams.length
    ? db.prepare(countSql).get(...whereParams).total
    : db.prepare(countSql).get().total;

  const sql = `
    SELECT 
      p.id, 
      p.categoryId, 
      p.groupId,
      p.title, 
      p.priceRub, 
      ${effectivePriceExpr} AS effectivePriceRub,
      p.description, 
      p.variant AS variant,
      p.strength AS strength,
      p.cost_price AS costPrice,
      p.stock AS stock,
      p.min_stock AS minStock,
      p.use_category_image AS useCategoryImage,
      p.has_variants AS hasVariants,
      p.createdAt,
      g.slug as groupSlug,
      g.name as groupName
    FROM products p
    LEFT JOIN category_groups g ON p.groupId = g.id
    ${where}
    ${orderBy}
    LIMIT ? OFFSET ?
  `;
  const sqlParams = wholesaleContext?.tier
    ? [wholesaleContext.tier.id, ...whereParams, limit, offset]
    : [...whereParams, limit, offset];
  const products = db.prepare(sql).all(...sqlParams);

  const productIds = products.map((p) => p.id);
  const baseImagesByProduct = new Map();
  const variantImagesByProduct = new Map();
  const linksByProduct = new Map();
  const badgesByProduct = new Map();
  const variantsByProduct = new Map();

  if (productIds.length > 0) {
    for (const chunk of chunkArray(productIds)) {
      const placeholders = chunk.map(() => "?").join(",");

      const imageRows = db
        .prepare(
          `
        SELECT productId, variant_id AS variantId, url, position
        FROM product_images
        WHERE productId IN (${placeholders})
        ORDER BY productId ASC, variant_id ASC, position ASC
      `,
        )
        .all(...chunk);
      imageRows.forEach((row) => {
        if (row.variantId) {
          pushVariantImage(
            variantImagesByProduct,
            row.productId,
            row.variantId,
            row.url,
          );
        } else {
          pushToMap(baseImagesByProduct, row.productId, row.url);
        }
      });

      const linkRows = db
        .prepare(
          `
        SELECT productId, label, url, position
        FROM product_links
        WHERE productId IN (${placeholders})
        ORDER BY productId ASC, position ASC
      `,
        )
        .all(...chunk);
      linkRows.forEach((row) => {
        pushToMap(linksByProduct, row.productId, {
          label: row.label ?? "",
          url: row.url,
        });
      });

      const badgeRows = db
        .prepare(
          `
        SELECT product_id as productId, type, label, color
        FROM product_badges
        WHERE product_id IN (${placeholders})
        ORDER BY product_id ASC, rowid ASC
      `,
        )
        .all(...chunk);
      badgeRows.forEach((row) => {
        pushToMap(badgesByProduct, row.productId, {
          type: row.type || null,
          label: row.label || null,
          color: row.color || null,
        });
      });

      const variantRows = db
        .prepare(
          `
        SELECT id, product_id, name, color_code AS colorCode, color_image AS colorImage, color_display_mode AS colorDisplayMode, price_rub AS priceRub, stock, position
        FROM product_variants
        WHERE product_id IN (${placeholders})
        ORDER BY product_id ASC, position ASC
      `,
        )
        .all(...chunk);
      variantRows.forEach((row) => {
        pushToMap(variantsByProduct, row.product_id, row);
      });
    }
  }

  // Оптовым покупателям скидки каталога не показываем: у них своя цена.
  const activeDiscounts = wholesaleContext?.tier ? null : loadActiveDiscounts();

  const enriched = products
    .map((p) => {
      const stockValue = typeof p.stock === "number" ? p.stock : null;
      const basePrice = Number(
        wholesaleContext?.tier ? p.effectivePriceRub ?? 0 : p.priceRub ?? 0,
      );

      if (wholesaleContext?.tier && (!Number.isFinite(basePrice) || basePrice <= 0)) {
        return null;
      }

      const productDiscount = activeDiscounts
        ? pickDiscountFromMaps(activeDiscounts, { productId: p.id, groupId: p.groupId })
        : null;
      const effectivePrice = applyDiscountToPrice(basePrice, productDiscount);
      const hasDiscount = effectivePrice < basePrice;

      const result = {
        ...p,
        priceRub: effectivePrice,
        oldPriceRub: hasDiscount ? basePrice : null,
        hasDiscount,
        stock: stockValue,
        costPrice: typeof p.costPrice === "number" ? p.costPrice : null,
        minStock: typeof p.minStock === "number" ? p.minStock : null,
        badges: badgesByProduct.get(p.id) ?? [],
        isAvailable: stockValue === null ? true : stockValue > 0,
        links: linksByProduct.get(p.id) ?? [],
        isWholesale: Boolean(wholesaleContext?.tier),
        wholesaleCode: wholesaleContext?.tier?.code || null,
        wholesaleMinAmount: wholesaleContext?.tier
          ? Number(wholesaleContext.tier.minOrderAmount || 0)
          : null,
      };

      if (p.hasVariants) {
        const variants = variantsByProduct.get(p.id) ?? [];
        result.variants = variants.map((v) => {
          const variantBase = resolveVariantPublicPriceRub(v, basePrice, Boolean(wholesaleContext?.tier));
          const variantDiscount = activeDiscounts
            ? pickDiscountFromMaps(activeDiscounts, {
                variantId: v.id,
                productId: p.id,
                groupId: p.groupId,
              })
            : null;
          const variantPrice = applyDiscountToPrice(variantBase, variantDiscount);
          return {
            ...v,
            priceRub: variantPrice,
            oldPriceRub: variantPrice < variantBase ? variantBase : null,
            hasDiscount: variantPrice < variantBase,
            images: variantImagesByProduct.get(p.id)?.get(v.id) ?? [],
          };
        });
        result.images =
          result.variants.length > 0 &&
          result.variants[0].images &&
          result.variants[0].images.length > 0
            ? result.variants[0].images
            : [];
        result.isAvailable = result.variants.some(
          (v) => v.stock === null || v.stock > 0,
        );
      } else {
        const productImages = baseImagesByProduct.get(p.id) ?? [];
        result.images = productImages;
        result.needsCategoryImage =
          p.useCategoryImage && productImages.length === 0;
      }

      return result;
    })
    .filter(Boolean);

  res.json({
    products: enriched,
    total,
    hasMore: offset + limit < total,
    is_wholesale: Boolean(wholesaleContext?.tier),
    wholesale_code: wholesaleContext?.tier?.code || null,
    wholesale_min_amount: wholesaleContext?.tier
      ? Number(wholesaleContext.tier.minOrderAmount || 0)
      : null,
  });
});

publicRouter.get("/api/product/:id", (req, res) => {
  const wholesaleContext = resolveWholesaleContextOrSendError(req, res);
  if (!wholesaleContext && res.headersSent) {
    return;
  }

  const id = req.params.id;
  const effectivePriceExpr = wholesaleContext?.tier
    ? `(SELECT gwp.price_byn FROM category_group_wholesale_prices gwp WHERE gwp.group_id = p.groupId AND gwp.tier_id = ? LIMIT 1)`
    : `p.priceRub`;

  const p = db
    .prepare(
      `
    SELECT 
      p.id,
      p.categoryId,
      p.groupId,
      p.title,
      p.priceRub,
      ${effectivePriceExpr} AS effectivePriceRub,
      p.description,
      p.variant AS variant,
      p.strength AS strength,
      p.cost_price AS costPrice,
      p.stock AS stock,
      p.min_stock AS minStock,
      p.use_category_image AS useCategoryImage,
      p.has_variants AS hasVariants,
      p.createdAt,
      g.slug AS groupSlug,
      g.name AS groupName
    FROM products p
    LEFT JOIN category_groups g ON p.groupId = g.id
    WHERE p.id = ?
  `,
    )
    .get(...(wholesaleContext?.tier ? [wholesaleContext.tier.id, id] : [id]));
  if (!p) return res.status(404).json({ error: "Not found" });

  const effectivePrice = Number(
    wholesaleContext?.tier ? p.effectivePriceRub ?? 0 : p.priceRub ?? 0,
  );
  if (wholesaleContext?.tier && (!Number.isFinite(effectivePrice) || effectivePrice <= 0)) {
    return res.status(404).json({ error: "Not found" });
  }

  const links = db
    .prepare(
      "SELECT label, url FROM product_links WHERE productId = ? ORDER BY position ASC",
    )
    .all(id)
    .map((link) => ({
      label: link.label ?? "",
      url: link.url,
    }));
  const badges = db
    .prepare(
      `
    SELECT type, label, color
    FROM product_badges
    WHERE product_id = ?
    ORDER BY rowid ASC
  `,
    )
    .all(id);
  const stockValue = typeof p.stock === "number" ? p.stock : null;
  const cardDiscounts = wholesaleContext?.tier ? null : loadActiveDiscounts();
  const cardDiscountPrice = cardDiscounts
    ? pickDiscountFromMaps(cardDiscounts, { productId: p.id, groupId: p.groupId })
    : null;
  const discountedPrice = applyDiscountToPrice(effectivePrice, cardDiscountPrice);

  const result = {
    ...p,
    priceRub: discountedPrice,
    oldPriceRub: discountedPrice < effectivePrice ? effectivePrice : null,
    hasDiscount: discountedPrice < effectivePrice,
    stock: stockValue,
    costPrice: typeof p.costPrice === "number" ? p.costPrice : null,
    minStock: typeof p.minStock === "number" ? p.minStock : null,
    badges: badges.map((badge) => ({
      type: badge.type || null,
      label: badge.label || null,
      color: badge.color || null,
    })),
    isAvailable: stockValue === null ? true : stockValue > 0,
    links,
    isWholesale: Boolean(wholesaleContext?.tier),
    wholesaleCode: wholesaleContext?.tier?.code || null,
    wholesaleMinAmount: wholesaleContext?.tier
      ? Number(wholesaleContext.tier.minOrderAmount || 0)
      : null,
  };

  if (p.hasVariants) {
    // Р”Р»СЏ С‚РѕРІР°СЂРѕРІ СЃ РІР°СЂРёР°РЅС‚Р°РјРё РїРѕР»СѓС‡Р°РµРј РІР°СЂРёР°РЅС‚С‹ Рё РёС… РёР·РѕР±СЂР°Р¶РµРЅРёСЏ
    const variants = db
      .prepare(
        `
      SELECT id, product_id, name, color_code AS colorCode, color_image AS colorImage, color_display_mode AS colorDisplayMode, price_rub AS priceRub, stock, position
      FROM product_variants
      WHERE product_id = ?
      ORDER BY position ASC
    `,
      )
      .all(id);

    result.variants = variants.map((v) => {
      const variantBase = resolveVariantPublicPriceRub(v, effectivePrice, Boolean(wholesaleContext?.tier));
      const variantDiscount = cardDiscounts
        ? pickDiscountFromMaps(cardDiscounts, { variantId: v.id, productId: p.id, groupId: p.groupId })
        : null;
      const variantPrice = applyDiscountToPrice(variantBase, variantDiscount);
      return {
        ...v,
        priceRub: variantPrice,
        oldPriceRub: variantPrice < variantBase ? variantBase : null,
        hasDiscount: variantPrice < variantBase,
        images: db
          .prepare(
            "SELECT url FROM product_images WHERE productId = ? AND variant_id = ? ORDER BY position ASC",
          )
          .all(id, v.id)
          .map((r) => r.url),
      };
    });
    // Р”Р»СЏ РѕР±СЂР°С‚РЅРѕР№ СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚Рё, РїРѕРєР°Р·С‹РІР°РµРј РёР·РѕР±СЂР°Р¶РµРЅРёСЏ РїРµСЂРІРѕРіРѕ РІР°СЂРёР°РЅС‚Р° РєР°Рє РёР·РѕР±СЂР°Р¶РµРЅРёСЏ С‚РѕРІР°СЂР°
    result.images =
      result.variants.length > 0 &&
      result.variants[0].images &&
      result.variants[0].images.length > 0
        ? result.variants[0].images
        : [];
    // РћР±РЅРѕРІР»СЏРµРј РґРѕСЃС‚СѓРїРЅРѕСЃС‚СЊ РЅР° РѕСЃРЅРѕРІРµ РІР°СЂРёР°РЅС‚РѕРІ
    result.isAvailable = result.variants.some(
      (v) => v.stock === null || v.stock > 0,
    );
  } else {
    // РћР±С‹С‡РЅС‹Р№ С‚РѕРІР°СЂ Р±РµР· РІР°СЂРёР°РЅС‚РѕРІ
    const productImages = db
      .prepare(
        "SELECT url FROM product_images WHERE productId = ? AND variant_id IS NULL ORDER BY position ASC",
      )
      .all(id)
      .map((r) => r.url);
    result.images = productImages;
    // Р¤Р»Р°Рі РґР»СЏ С„СЂРѕРЅС‚РµРЅРґР° - РЅСѓР¶РЅРѕ Р·Р°РіСЂСѓР·РёС‚СЊ РѕР±Р»РѕР¶РєСѓ РєР°С‚РµРіРѕСЂРёРё
    result.needsCategoryImage =
      p.useCategoryImage && productImages.length === 0;
  }

  res.json(result);
});

publicRouter.get("/api/cross-sells", (req, res) => {
  const wholesaleContext = resolveWholesaleContextOrSendError(req, res);
  if (!wholesaleContext && res.headersSent) {
    return;
  }

  if (wholesaleContext) {
    return res.json([]);
  }

  const { category, limit } = req.query;
  if (!category) {
    return res.json([]);
  }

  const categoryRow = db
    .prepare("SELECT id FROM categories WHERE slug = ?")
    .get(String(category));
  if (!categoryRow) {
    return res.json([]);
  }

  const maxItems = Math.min(Math.max(parseInt(limit ?? "6", 10) || 6, 1), 12);

  // РћРџРўРРњРР—РђР¦РРЇ: РЅРµ Р·Р°РіСЂСѓР¶Р°РµРј cover_image РєР°С‚РµРіРѕСЂРёРё
  const rows = db
    .prepare(
      `
    SELECT 
      cs.id,
      cs.[order],
      p.id AS productId,
      p.title,
      p.priceRub,
      p.description,
      p.variant AS variant,
      p.strength AS strength,
      p.cost_price AS costPrice,
      p.stock AS stock,
      p.min_stock AS minStock,
      p.use_category_image AS useCategoryImage,
      p.has_variants AS hasVariants,
      p.createdAt,
      p.categoryId,
      p.groupId,
      g.slug as groupSlug,
      g.name as groupName
    FROM category_cross_sells cs
    JOIN products p ON p.id = cs.productId
    LEFT JOIN category_groups g ON p.groupId = g.id
    WHERE cs.categoryId = ?
      AND (
        (p.has_variants = 0 AND (p.stock IS NULL OR p.stock > 0))
        OR
        (p.has_variants = 1 AND EXISTS (
          SELECT 1 FROM product_variants pv 
          WHERE pv.product_id = p.id 
          AND (pv.stock IS NULL OR pv.stock > 0)
        ))
      )
    ORDER BY cs.[order] ASC
    LIMIT ?
  `,
    )
    .all(categoryRow.id, maxItems);

  const imageStmt = db.prepare(
    "SELECT url FROM product_images WHERE productId = ? AND variant_id IS NULL ORDER BY position ASC",
  );
  const linkStmt = db.prepare(
    "SELECT label, url FROM product_links WHERE productId = ? ORDER BY position ASC",
  );
  const badgeStmt = db.prepare(`
    SELECT type, label, color
    FROM product_badges
    WHERE product_id = ?
    ORDER BY rowid ASC
  `);
  const variantStmt = db.prepare(`
    SELECT id, product_id, name, color_code AS colorCode, color_image AS colorImage, color_display_mode AS colorDisplayMode, price_rub AS priceRub, stock, position
    FROM product_variants
    WHERE product_id = ?
    ORDER BY position ASC
  `);
  const variantImgStmt = db.prepare(
    "SELECT url FROM product_images WHERE productId = ? AND variant_id = ? ORDER BY position ASC",
  );

  const payload = rows.map((row) => {
    const stockValue = typeof row.stock === "number" ? row.stock : null;

    const result = {
      id: row.productId,
      title: row.title,
      priceRub: row.priceRub,
      description: row.description,
      variant: row.variant,
      strength: row.strength,
      costPrice: typeof row.costPrice === "number" ? row.costPrice : null,
      stock: stockValue,
      minStock: typeof row.minStock === "number" ? row.minStock : null,
      isAvailable: stockValue === null ? true : stockValue > 0,
      createdAt: row.createdAt,
      categoryId: row.categoryId,
      groupId: row.groupId,
      groupSlug: row.groupSlug,
      groupName: row.groupName,
      links: linkStmt
        .all(row.productId)
        .map((link) => ({ label: link.label ?? "", url: link.url })),
      badges: badgeStmt.all(row.productId).map((badge) => ({
        type: badge.type || null,
        label: badge.label || null,
        color: badge.color || null,
      })),
    };

    if (row.hasVariants) {
      // Р”Р»СЏ С‚РѕРІР°СЂРѕРІ СЃ РІР°СЂРёР°РЅС‚Р°РјРё РїРѕР»СѓС‡Р°РµРј РІР°СЂРёР°РЅС‚С‹ Рё РёС… РёР·РѕР±СЂР°Р¶РµРЅРёСЏ
      const variants = variantStmt.all(row.productId);
      result.variants = variants.map((v) => ({
        ...v,
        images: variantImgStmt.all(row.productId, v.id).map((r) => r.url),
      }));
      // Р”Р»СЏ РѕР±СЂР°С‚РЅРѕР№ СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚Рё, РїРѕРєР°Р·С‹РІР°РµРј РёР·РѕР±СЂР°Р¶РµРЅРёСЏ РїРµСЂРІРѕРіРѕ РІР°СЂРёР°РЅС‚Р° РєР°Рє РёР·РѕР±СЂР°Р¶РµРЅРёСЏ С‚РѕРІР°СЂР°
      result.images =
        result.variants.length > 0 &&
        result.variants[0].images &&
        result.variants[0].images.length > 0
          ? result.variants[0].images
          : [];
      // РћР±РЅРѕРІР»СЏРµРј РґРѕСЃС‚СѓРїРЅРѕСЃС‚СЊ РЅР° РѕСЃРЅРѕРІРµ РІР°СЂРёР°РЅС‚РѕРІ
      result.isAvailable = result.variants.some(
        (v) => v.stock === null || v.stock > 0,
      );
    } else {
      // РћР±С‹С‡РЅС‹Р№ С‚РѕРІР°СЂ Р±РµР· РІР°СЂРёР°РЅС‚РѕРІ
      const productImages = imageStmt.all(row.productId).map((r) => r.url);
      result.images = productImages;
      // Р¤Р»Р°Рі РґР»СЏ С„СЂРѕРЅС‚РµРЅРґР°
      result.needsCategoryImage =
        row.useCategoryImage && productImages.length === 0;
    }

    return result;
  });

  res.json(payload);
});

// Public settings (only specific settings that are safe to expose)
publicRouter.get("/api/settings", (req, res) => {
  try {
    const getSettingValue = (key, defaultValue = "") => {
      const row = db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get(key);
      return row?.value || defaultValue;
    };

    res.json({
      manager_telegram: getSettingValue("manager_telegram", "dmitriy_mityuk"),
      telegram_bot_username: (process.env.TELEGRAM_BOT_USERNAME || "")
        .trim()
        .replace(/^@/, ""),
      /** Короткое имя Mini App из @BotFather (сегмент t.me/bot/NAME/…). Пусто = только main-ссылка. */
      telegram_mini_app_short_name: (process.env.TELEGRAM_MINI_APP_SHORT_NAME || "")
        .trim()
        .replace(/^\/+|\/+$/g, ""),
      // РњРёРЅРёРјР°Р»СЊРЅР°СЏ СЃСѓРјРјР° РґР»СЏ РґРѕСЃС‚Р°РІРєРё
      min_delivery_amount: getSettingValue("min_delivery_amount", "0"),
      min_delivery_banner_image: getSettingValue(
        "min_delivery_banner_image",
        "",
      ),
      min_delivery_banner_button_text: getSettingValue(
        "min_delivery_banner_button_text",
        "Понятно",
      ),
      min_delivery_banner_button_color: getSettingValue(
        "min_delivery_banner_button_color",
        "#FFD700",
      ),
      // Р‘Р°РЅРЅРµСЂ СѓСЃР»РѕРІРёР№ РґРѕСЃС‚Р°РІРєРё (fullscreen)
      delivery_conditions_image: getSettingValue(
        "delivery_conditions_image",
        "",
      ),
      // Р РµРґРёСЂРµРєС‚ РІ Telegram РїРѕСЃР»Рµ Р·Р°РєР°Р·Р°
      order_redirect_telegram: getSettingValue("order_redirect_telegram", ""),
      order_redirect_text_template: getSettingValue(
        "order_redirect_text_template",
        "Здравствуйте, хочу уточнить по покупке",
      ),
    });
  } catch (error) {
    console.error("[public] Failed to get settings:", error);
    // Р’РѕР·РІСЂР°С‰Р°РµРј РґРµС„РѕР»С‚РЅС‹Рµ Р·РЅР°С‡РµРЅРёСЏ РІ СЃР»СѓС‡Р°Рµ РѕС€РёР±РєРё
    res.json({
      manager_telegram: "dmitriy_mityuk",
      telegram_bot_username: "",
      telegram_mini_app_short_name: "",
      min_delivery_amount: "0",
      min_delivery_banner_image: "",
      min_delivery_banner_button_text: "Понятно",
      min_delivery_banner_button_color: "#FFD700",
      delivery_conditions_image: "",
      order_redirect_telegram: "",
      order_redirect_text_template: "Здравствуйте, хочу уточнить по покупке",
    });
  }
});

// Подтверждение бот-кода доступа: клиент пришёл в Mini App с кодом из чата
// (deep-link `?startapp=NV-XXXXXX` распарсивается на фронте и передаётся
// сюда). Если код совпал с записью у клиента по telegram_id — клиент
// маркируется как verified. Старые клиенты (total_orders > 0) считаются
// verified автоматически, см. isCustomerVerified.
publicRouter.get(
  "/api/card-payment/status",
  publicMiniAppReadLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
    try {
      const telegramId = String(req.telegramAuth?.telegramId || "").trim();
      const username = normalizeCardTelegramUsername(req.telegramAuth?.telegramUsername);
      if (!telegramId) {
        return res.status(401).json({ error: "telegram_identity_required" });
      }
      const snapshot = getCardCustomerSnapshot(telegramId, username);
      const latestRequest = db.prepare(`
        SELECT created_at, status
        FROM card_payment_limit_requests
        WHERE telegram_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(telegramId);
      const cooldown = latestRequest?.created_at
        ? new Date(new Date(`${latestRequest.created_at.replace(" ", "T")}Z`).getTime() + 60 * 60 * 1000)
        : null;
      const requestCooldownUntil =
        cooldown && cooldown.getTime() > Date.now() ? cooldown.toISOString() : null;
      return res.json({
        ...snapshot,
        request_cooldown_until: requestCooldownUntil,
      });
    } catch (error) {
      console.error("[public] Card payment status error:", error);
      return res.status(500).json({ error: "card_payment_status_failed" });
    }
  },
);

publicRouter.get(
  "/api/card-payment/tariffs",
  publicMiniAppReadLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
    try {
      const telegramId = String(req.telegramAuth?.telegramId || "").trim();
      const account = resolveCardAccount(
        telegramId,
        normalizeCardTelegramUsername(req.telegramAuth?.telegramUsername),
      );
      if (!account?.enabled) {
        return res.status(403).json({ error: "card_payment_not_allowed" });
      }
      const tariffs = db.prepare(`
        SELECT id, title, limit_minor, transition_cost_text, position
        FROM card_payment_tariffs
        WHERE active = 1
        ORDER BY position, id
      `).all();
      return res.json({
        current_limit_minor: Number(account.max_order_minor || 0),
        tariffs,
      });
    } catch (error) {
      console.error("[public] Card payment tariffs error:", error);
      return res.status(500).json({ error: "card_payment_tariffs_failed" });
    }
  },
);

publicRouter.post(
  "/api/card-payment/requests",
  publicMiniAppMutationLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
    try {
      const telegramId = String(req.telegramAuth?.telegramId || "").trim();
      const username = normalizeCardTelegramUsername(req.telegramAuth?.telegramUsername);
      const tariffId = String(req.body?.tariff_id || "").trim();
      if (!telegramId || !tariffId) {
        return res.status(400).json({ error: "invalid_request" });
      }

      const result = db.transaction(() => {
        const account = resolveCardAccount(telegramId, username);
        if (!account?.enabled) return { error: "card_payment_not_allowed" };
        const lastRequest = db.prepare(`
          SELECT created_at
          FROM card_payment_limit_requests
          WHERE telegram_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `).get(telegramId);
        if (lastRequest) {
          const lastRequestTime = new Date(`${lastRequest.created_at.replace(" ", "T")}Z`).getTime();
          if (Date.now() - lastRequestTime < 60 * 60 * 1000) {
            return { error: "card_request_cooldown" };
          }
        }
        const tariff = db.prepare(`
          SELECT id, title, limit_minor
          FROM card_payment_tariffs
          WHERE id = ? AND active = 1
        `).get(tariffId);
        if (!tariff) return { error: "card_tariff_not_found" };
        const requestId = generateId("card_request");
        db.prepare(`
          INSERT INTO card_payment_limit_requests (
            id, telegram_id, telegram_username, tariff_id, tariff_title,
            current_limit_minor, requested_limit_minor, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'new')
        `).run(
          requestId,
          telegramId,
          username || null,
          tariff.id,
          tariff.title,
          account.max_order_minor,
          tariff.limit_minor,
        );
        return { request_id: requestId };
      }).immediate();

      if (result.error === "card_payment_not_allowed") {
        return res.status(403).json({ error: result.error });
      }
      if (result.error === "card_request_cooldown") {
        return res.status(429).json({ error: result.error });
      }
      if (result.error) return res.status(404).json({ error: result.error });
      return res.status(201).json({ success: true, request_id: result.request_id });
    } catch (error) {
      console.error("[public] Submit card payment request error:", error);
      return res.status(500).json({ error: "card_request_failed" });
    }
  },
);

publicRouter.post(
  "/api/customer/bot-verify",
  publicMiniAppMutationLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
    try {
      const telegramId = String(req.telegramAuth?.telegramId || "").trim();
      if (!telegramId) {
        return res.status(400).json({ error: "telegram_id_required" });
      }
      const code = String(req.body?.code ?? "").trim();
      const confirmed = confirmVerificationOnAccess({
        telegramId,
        code: code || null,
      });
      const verified = isCustomerVerified(telegramId);
      res.json({ ok: confirmed, verified });
    } catch (err) {
      console.error("[public] bot-verify error:", err);
      res.status(500).json({ error: "failed", message: err.message });
    }
  },
);

// Активные соглашения для чекаута (публично, без auth — клиент должен видеть
// заголовки и body чтобы прочитать в модалке перед оформлением заказа).
// Body шлём целиком — это короткие маркетинговые/юридические тексты, не
// чувствительные данные. Под rate-limiter'ом для консистентности с другими
// public read-эндпоинтами.
publicRouter.get("/api/agreements", publicMiniAppReadLimiter, (req, res) => {
  try {
    res.json({ items: listActiveAgreements() });
  } catch (err) {
    console.error("[public] List agreements error:", err);
    res.status(500).json({ error: "failed", message: err.message });
  }
});

publicRouter.get(
  "/api/telegram/username-status",
  publicMiniAppReadLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  async (req, res) => {
    try {
      res.set("Cache-Control", "no-store, max-age=0");
      res.set("Pragma", "no-cache");
      const telegramId = String(req.telegramAuth?.telegramId || "").trim();
      return res.json(await resolveTelegramUsernameStatus(telegramId));
    } catch (error) {
      console.error("[public] Failed to check telegram username status:", error);
      return res.status(500).json({
        ok: false,
        error: "username_status_failed",
        message: "Не удалось проверить username",
      });
    }
  },
);

publicRouter.get(
  "/api/customer-photo/:customerId",
  publicMiniAppReadLimiter,
  async (req, res) => {
    try {
      const customerId = String(req.params.customerId || "").trim();
      if (!customerId) {
        return res.status(404).end();
      }

      const customer = db.prepare(`
        SELECT id, telegram_id, photo_url, photo_updated_at
        FROM customers
        WHERE id = ?
      `).get(customerId);

      if (!customer) {
        return res.status(404).end();
      }

      let payload = readCustomerPhotoFromDisk(customerId);

      if (!payload) {
        let photoUrl = await refreshCustomerPhotoIfStale(customer, {
          token: TELEGRAM_BOT_TOKEN,
          fetchTelegramChat,
          db,
        });

        if (photoUrl) {
          await cacheCustomerPhotoToDisk(customerId, photoUrl);
          payload = readCustomerPhotoFromDisk(customerId);
        }

        if (!payload && customer.telegram_id && TELEGRAM_BOT_TOKEN) {
          photoUrl = await refreshCustomerPhotoIfStale(customer, {
            token: TELEGRAM_BOT_TOKEN,
            fetchTelegramChat,
            db,
            forceRefresh: true,
          });
          if (photoUrl) {
            await cacheCustomerPhotoToDisk(customerId, photoUrl);
            payload = readCustomerPhotoFromDisk(customerId);
          }
        }
      }

      if (!payload) {
        return res.status(404).end();
      }

      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("Content-Type", payload.contentType);
      return res.send(payload.body);
    } catch (error) {
      console.error("[public] Failed to proxy customer photo:", error);
      return res.status(404).end();
    }
  },
);

publicRouter.get(
  "/api/referral-authorization/status",
  publicMiniAppReadLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
    const telegramId = String(req.telegramAuth?.telegramId || "").trim();
    if (req.telegramAuth?.verified) {
      activatePendingStaffAccess({
        telegramId,
        telegramUsername: req.telegramAuth?.telegramUsername || null,
        firstName: req.telegramAuth?.firstName || null,
        lastName: req.telegramAuth?.lastName || null,
      });
    }
    return res.json(getReferralAuthorizationStatus(telegramId));
  },
);

publicRouter.post(
  "/api/referral-authorization/authorize",
  publicMiniAppMutationLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  async (req, res) => {
    try {
      const telegramId = String(req.telegramAuth?.telegramId || "").trim();
      let telegramUsername;
      try {
        telegramUsername = await resolveVerifiedOrderUsername(req.telegramAuth, null);
      } catch (usernameError) {
        if (
          usernameError?.code === "telegram_username_required"
          || usernameError?.code === "telegram_username_not_verified"
        ) {
          return res.status(428).json({
            error: usernameError.code,
            message: usernameError.code === "telegram_username_required"
              ? "Установите имя пользователя @username в настройках Telegram"
              : "Не удалось проверить обновлённый username. Попробуйте ещё раз.",
          });
        }
        throw usernameError;
      }
      const identity = {
        telegramId,
        telegramUsername,
        firstName: req.telegramAuth?.firstName || null,
        lastName: req.telegramAuth?.lastName || null,
      };
      if (req.telegramAuth?.verified) activatePendingStaffAccess(identity);
      const rawUsername = req.body?.inviter_username;
      const currentStatus = getReferralAuthorizationStatus(telegramId);

      if (!currentStatus.enabled || currentStatus.authorized) {
        return res.json({ success: true, ...currentStatus });
      }
      if (currentStatus.blocked) {
        const block = getActiveBlockForTelegramId(telegramId);
        return res.status(403).json({
          error: "customer_blocked",
          message: "Авторизация не пройдена",
          block: serializeBlock(block, "active"),
          attempts_used: currentStatus.attempts_used,
          attempts_remaining: 0,
        });
      }

      const pendingBan = telegramUsername
        ? getPendingBanForUsername(telegramUsername)
        : null;
      if (pendingBan) {
        return res.status(403).json({
          error: "customer_blocked",
          block: serializeBlock(pendingBan, "pending"),
        });
      }
      const activeBlock = getActiveBlockForTelegramId(telegramId);
      if (activeBlock) {
        return res.status(403).json({
          error: "customer_blocked",
          block: serializeBlock(activeBlock, "active"),
        });
      }

      if (typeof rawUsername !== "string" || !rawUsername.trim()) {
        return res.status(428).json({
          error: "referral_authorization_required",
          message: "Укажите username пригласившего",
          attempts_used: currentStatus.attempts_used,
          attempts_remaining: currentStatus.attempts_remaining,
        });
      }

      const sendFailure = (inspected) => {
        const nextStatus = recordReferralOutcome({
          identity,
          rawUsername,
          result: inspected,
        });
        if (nextStatus.customer_blocked) {
          const block = getActiveBlockForTelegramId(telegramId);
          return res.status(403).json({
            error: "customer_blocked",
            block: serializeBlock(block, "active"),
            attempts_used: nextStatus.attempts_used,
            attempts_remaining: nextStatus.attempts_remaining,
          });
        }
        if (nextStatus.blocked) {
          const block = getActiveBlockForTelegramId(telegramId);
          return res.status(403).json({
            error: "customer_blocked",
            message: "Авторизация не пройдена",
            block: serializeBlock(block, "active"),
            attempts_used: 3,
            attempts_remaining: 0,
          });
        }
        const messages = {
          referral_username_invalid: "Проверьте username пригласившего",
          referral_inviter_not_eligible: "Пользователь не найден или ещё не забирал заказ",
          referral_self_invite: "Нельзя указать самого себя",
          referral_inviter_blocked: "Пользователь заблокирован и не может быть пригласившим",
          referral_inviter_forbidden: "Данный пользователь не может приглашать новых людей",
          referral_inviter_reserved: "Данный пользователь не может приглашать новых людей",
          referral_username_ambiguous: "Не удалось однозначно проверить username. Напишите менеджеру",
        };
        return res.status(422).json({
          error: inspected.code,
          message: messages[inspected.code] || "Не удалось проверить пригласившего",
          attempts_used: nextStatus.attempts_used,
          attempts_remaining: nextStatus.attempts_remaining,
        });
      };

      const inspected = inspectInviter({
        telegramId,
        telegramUsername,
        rawUsername,
      });
      if (!inspected.ok) return sendFailure(inspected);

      const result = db.transaction(() => {
        const finalStatus = getReferralAuthorizationStatus(telegramId);
        if (!finalStatus.enabled || finalStatus.authorized) {
          return { success: true, status: finalStatus };
        }
        if (finalStatus.blocked) return { blocked: true };

        const finalInviter = inspectInviter({
          telegramId,
          telegramUsername,
          rawUsername,
        });
        if (!finalInviter.ok) return { referralViolation: finalInviter };

        const customerId = upsertPublicCustomer({
          telegramId,
          telegramUsername: telegramUsername || null,
          firstName: identity.firstName,
          lastName: identity.lastName,
          phone: null,
        });
        const activatedBlock = getActiveBlockForTelegramId(telegramId);
        if (activatedBlock) return { activatedBlock };

        markReferralAuthorized({
          customerId,
          telegramId,
          inviter: finalInviter.inviter,
          submittedUsername: rawUsername,
          orderId: null,
        });
        return { success: true, status: getReferralAuthorizationStatus(telegramId) };
      }).immediate();

      if (result.blocked) {
        const block = getActiveBlockForTelegramId(telegramId);
        return res.status(403).json({
          error: "customer_blocked",
          message: "Авторизация не пройдена",
          block: serializeBlock(block, "active"),
          attempts_used: 3,
          attempts_remaining: 0,
        });
      }
      if (result.activatedBlock) {
        return res.status(403).json({
          error: "customer_blocked",
          block: serializeBlock(result.activatedBlock, "active"),
        });
      }
      if (result.referralViolation) return sendFailure(result.referralViolation);
      return res.json({ success: true, ...result.status });
    } catch (error) {
      console.error("[public] Referral authorization error:", error);
      return res.status(500).json({
        error: "referral_authorization_failed",
        message: "Не удалось пройти авторизацию. Попробуйте ещё раз",
      });
    }
  },
);

publicRouter.get(
  "/api/customer/me",
  publicMiniAppReadLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  async (req, res) => {
    try {
      const telegramId = String(req.telegramAuth?.telegramId || "").trim();
      const telegramUsername = normalizeTelegramUsername(req.telegramAuth?.telegramUsername);

      let customer = null;
      if (telegramId) {
        customer = db.prepare(`
          SELECT id, telegram_id, telegram_username, first_name, last_name,
                 phone, total_orders, total_spent, photo_url, photo_updated_at,
                 created_at
          FROM customers
          WHERE telegram_id = ?
        `).get(telegramId);
      }

      if (!customer && telegramUsername) {
        customer = db.prepare(`
          SELECT id, telegram_id, telegram_username, first_name, last_name,
                 phone, total_orders, total_spent, photo_url, photo_updated_at,
                 created_at
          FROM customers
          WHERE LOWER(COALESCE(telegram_username, '')) = LOWER(?)
          LIMIT 1
        `).get(telegramUsername);
      }

      if (!customer) {
        return res.json({
          found: false,
          telegram_id: telegramId || null,
          first_name: null,
          last_name: null,
          telegram_username: telegramUsername || null,
          photo_url: null,
          total_orders: 0,
          total_spent: 0,
          member_since: null,
        });
      }

      const initPhotoUrl = String(req.telegramAuth?.photoUrl || "").trim();
      await warmCustomerPhotoFromInitData(customer.id, initPhotoUrl, db);

      const latestCustomer = db.prepare(`
        SELECT photo_url, photo_updated_at
        FROM customers
        WHERE id = ?
      `).get(customer.id);

      const photoUrl = await refreshCustomerPhotoIfStale(
        { ...customer, photo_url: latestCustomer?.photo_url || customer.photo_url },
        {
          token: TELEGRAM_BOT_TOKEN,
          fetchTelegramChat,
          db,
        },
      );

      // bot_verified: клиент считается верифицированным, если у него есть
      // bot_verified_at либо хотя бы один заказ (старые клиенты). Используем
      // util чтобы логика была в одном месте — те же правила применяются
      // на стороне бота при выдаче доступа.
      const botVerified = isCustomerVerified(customer.telegram_id);
      const storedPhotoUrl = db.prepare(
        'SELECT photo_url FROM customers WHERE id = ?',
      ).get(customer.id)?.photo_url || photoUrl;

      res.json({
        found: true,
        id: customer.id,
        telegram_id: customer.telegram_id,
        telegram_username: customer.telegram_username || null,
        first_name: customer.first_name || null,
        last_name: customer.last_name || null,
        photo_url: resolvePublicCustomerPhotoUrl(
          { id: customer.id, photo_url: storedPhotoUrl },
          { hasDiskCache: hasCustomerPhotoOnDisk(customer.id) },
        ),
        total_orders: customer.total_orders || 0,
        total_spent: customer.total_spent || 0,
        member_since: customer.created_at || null,
        bot_verified: botVerified,
      });
    } catch (error) {
      console.error("[public] Failed to get customer profile:", error);
      res.status(500).json({
        error: "profile_failed",
        message: "Не удалось загрузить профиль",
      });
    }
  },
);

publicRouter.get(
  "/api/orders/my-active",
  publicMiniAppReadLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
    try {
      const telegramId = String(req.telegramAuth?.telegramId || "").trim();
      const telegramUsername = normalizeTelegramUsername(req.telegramAuth?.telegramUsername);

      const order = findOwnedActiveOrder({
        telegramId,
        telegramUsername,
      });

      if (!order) {
        return res.json({ found: false });
      }

      return res.json(serializeCustomerOrder(order));
    } catch (error) {
      console.error("[public] Failed to get active order:", error);
      return res.status(500).json({
        error: "active_order_failed",
        message: "Не удалось загрузить активный заказ",
      });
    }
  },
);

publicRouter.get(
  "/api/reviews/prompt",
  publicMiniAppReadLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
    try {
      const telegramId = String(req.telegramAuth?.telegramId || "").trim();
      const telegramUsername = normalizeTelegramUsername(req.telegramAuth?.telegramUsername);
      const customer = findCustomerByTelegram({ telegramId, telegramUsername });

      if (!customer) {
        return res.json({ show: false, reason: "no_customer" });
      }

      const devBypass = shouldDevBypassForCustomer(customer);
      return res.json(getReviewPromptForCustomer(customer, { devBypass }));
    } catch (error) {
      console.error("[public] Failed to get review prompt:", error);
      return res.status(500).json({
        error: "review_prompt_failed",
        message: "Не удалось загрузить напоминание об отзыве",
      });
    }
  },
);

publicRouter.get(
  "/api/orders/my-history",
  publicMiniAppReadLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
    try {
      const telegramId = String(req.telegramAuth?.telegramId || "").trim();
      const telegramUsername = normalizeTelegramUsername(req.telegramAuth?.telegramUsername);
      const customer = findCustomerByTelegram({ telegramId, telegramUsername });

      if (!customer) {
        return res.json({ items: [], next_cursor: null });
      }

      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
      const beforeCreatedAt = typeof req.query.cursor === "string" ? req.query.cursor : null;
      const devBypass = shouldDevBypassForCustomer(customer);

      const orders = findOwnedOrders({
        telegramId,
        telegramUsername,
        statuses: ["delivered", "completed", "cancelled"],
        limit: limit + 1,
        beforeCreatedAt,
      });

      const page = orders.slice(0, limit);
      const nextCursor =
        orders.length > limit ? page[page.length - 1]?.created_at || null : null;

      return res.json({
        items: page.map((order) =>
          serializeOrderHistoryCard(order, customer.id, { devBypass }),
        ),
        next_cursor: nextCursor,
      });
    } catch (error) {
      console.error("[public] Failed to get order history:", error);
      return res.status(500).json({
        error: "order_history_failed",
        message: "Не удалось загрузить историю заказов",
      });
    }
  },
);

publicRouter.get(
  "/api/orders/:id/detail",
  publicMiniAppReadLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
    try {
      const { id } = req.params;
      const telegramId = String(req.telegramAuth?.telegramId || "").trim();
      const telegramUsername = normalizeTelegramUsername(req.telegramAuth?.telegramUsername);
      const customer = findCustomerByTelegram({ telegramId, telegramUsername });

      if (!customer) {
        return res.status(404).json({
          error: "not_found",
          message: "Заказ не найден",
        });
      }

      const orders = findOwnedOrders({
        orderId: id,
        telegramId,
        telegramUsername,
        limit: 1,
      });
      const order = orders[0];

      if (!order) {
        return res.status(404).json({
          error: "not_found",
          message: "Заказ не найден",
        });
      }

      const devBypass = shouldDevBypassForCustomer(customer);
      return res.json(
        serializeOrderDetail(order, customer.id, { devBypass }),
      );
    } catch (error) {
      console.error("[public] Failed to get order detail:", error);
      return res.status(500).json({
        error: "order_detail_failed",
        message: "Не удалось загрузить детали заказа",
      });
    }
  },
);

publicRouter.get(
  "/api/reviews/quick-tags",
  publicMiniAppReadLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
    try {
      const categoryKey = String(req.query.category_key || "").trim();
      const starRating = Number(req.query.star_rating || 0);

      if (!categoryKey || !Number.isInteger(starRating) || starRating < 1 || starRating > 5) {
        return res.status(400).json({ error: "invalid_params" });
      }

      return res.json({
        items: listQuickTags(categoryKey, starRating),
      });
    } catch (error) {
      console.error("[public] Failed to list quick tags:", error);
      return res.status(500).json({
        error: "quick_tags_failed",
        message: "Не удалось загрузить быстрые отзывы",
      });
    }
  },
);

publicRouter.post(
  "/api/reviews",
  publicMiniAppMutationLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  async (req, res) => {
    try {
      const telegramId = String(req.telegramAuth?.telegramId || "").trim();
      const telegramUsername = normalizeTelegramUsername(req.telegramAuth?.telegramUsername);
      const customer = findCustomerByTelegram({ telegramId, telegramUsername });

      if (!customer) {
        return res.status(404).json({ error: "customer_not_found" });
      }

      const initPhotoUrl = String(req.telegramAuth?.photoUrl || "").trim();
      await warmCustomerPhotoFromInitData(customer.id, initPhotoUrl, db);

      const {
        order_id: orderId,
        group_id: groupId,
        order_item_id: orderItemId,
        rating,
        body_text: bodyText,
        quick_tag_ids: quickTagIds,
        is_anonymous: isAnonymous,
      } = req.body || {};

      const devBypass = shouldDevBypassForCustomer(customer);
      const review = createProductReview({
        customerId: customer.id,
        orderId,
        groupId,
        orderItemId: orderItemId || null,
        rating,
        bodyText,
        quickTagIds: Array.isArray(quickTagIds) ? quickTagIds : [],
        isAnonymous: Boolean(isAnonymous ?? customer.reviews_prefer_anonymous),
        devBypass,
      });

      return res.status(201).json({ ok: true, review });
    } catch (error) {
      const code = error?.code || "review_create_failed";
      const status =
        code === "review_body_too_short" ||
        code === "review_body_too_long" ||
        code === "invalid_rating" ||
        code === "invalid_quick_tags" ||
        code === "not_eligible" ||
        code === "cooldown" ||
        code === "pending_moderation" ||
        code === "not_purchased" ||
        code === "order_not_reviewable"
          ? 400
          : code === "order_not_found" || code === "group_not_found"
            ? 404
            : 500;

      if (status === 500) {
        console.error("[public] Failed to create review:", error);
      }

      return res.status(status).json({
        error: code,
        message: error.message || getReviewErrorMessage(code),
        details: error.details || null,
      });
    }
  },
);

publicRouter.patch(
  "/api/profile/review-preferences",
  publicMiniAppMutationLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
    try {
      const telegramId = String(req.telegramAuth?.telegramId || "").trim();
      const telegramUsername = normalizeTelegramUsername(req.telegramAuth?.telegramUsername);
      const customer = findCustomerByTelegram({ telegramId, telegramUsername });

      if (!customer) {
        return res.status(404).json({ error: "customer_not_found" });
      }

      const updated = updateCustomerReviewPreferences(customer.id, {
        optOut:
          req.body?.reviews_opt_out !== undefined
            ? Boolean(req.body.reviews_opt_out)
            : undefined,
        preferAnonymous:
          req.body?.reviews_prefer_anonymous !== undefined
            ? Boolean(req.body.reviews_prefer_anonymous)
            : undefined,
      });

      return res.json({
        ok: true,
        reviews_opt_out: Boolean(updated?.reviews_opt_out),
        reviews_prefer_anonymous: Boolean(updated?.reviews_prefer_anonymous),
      });
    } catch (error) {
      console.error("[public] Failed to update review preferences:", error);
      return res.status(500).json({
        error: "review_preferences_failed",
        message: "Не удалось обновить настройки отзывов",
      });
    }
  },
);

publicRouter.get(
  "/api/groups/:groupId/reviews",
  publicMiniAppReadLimiter,
  optionalTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  async (req, res) => {
    try {
      const { groupId } = req.params;
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      const group = db.prepare("SELECT id FROM category_groups WHERE id = ?").get(groupId);
      if (!group) {
        return res.status(404).json({ error: "group_not_found" });
      }

      const telegramId = String(req.telegramAuth?.telegramId || "").trim();
      const telegramUsername = normalizeTelegramUsername(req.telegramAuth?.telegramUsername);
      const viewer = telegramId || telegramUsername
        ? findCustomerByTelegram({ telegramId, telegramUsername })
        : null;

      const initPhotoUrl = String(req.telegramAuth?.photoUrl || "").trim();
      if (viewer) {
        await warmCustomerPhotoFromInitData(viewer.id, initPhotoUrl, db);
      }

      return res.json(getPublicGroupReviews(groupId, {
        limit,
        offset,
        viewerCustomerId: viewer?.id || null,
      }));
    } catch (error) {
      console.error("[public] Failed to get public group reviews:", error);
      return res.status(500).json({
        error: "group_reviews_failed",
        message: "Не удалось загрузить отзывы",
      });
    }
  },
);

publicRouter.post(
  "/api/orders/:id/cancel-by-customer",
  publicMiniAppMutationLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
    try {
      const { id } = req.params;
      const telegramId = String(req.telegramAuth?.telegramId || "").trim();
      const telegramUsername = normalizeTelegramUsername(req.telegramAuth?.telegramUsername);

      const order = findOwnedActiveOrder({
        orderId: id,
        telegramId,
        telegramUsername,
      });

      if (!order) {
        return res.status(404).json({
          error: "not_found",
          message: "Активный заказ не найден",
        });
      }

      const tx = db.transaction(() => {
        reverseCardOrder(id);
        releaseOrderLoyaltyReservations(id);

        const updateFields = [
          "status = 'cancelled'",
          "previous_status = ?",
          "cancelled_at = DATETIME('now')",
          "updated_at = DATETIME('now')",
        ];
        const updateValues = [order.status];

        releasePromoUsageForOrder(order);

        const requiresManagerCleanup =
          order.status === "in_progress" ||
          (Number(order.needs_manager_action || 0) === 1 &&
            order.manager_action_type === "modified" &&
            order.previous_status === "in_progress");

        if (requiresManagerCleanup) {
          const orderItems = db
            .prepare("SELECT * FROM order_items WHERE order_id = ?")
            .all(id);

          if (order.stock_deducted) {
            restoreStockForOrderItems(orderItems);
            updateFields.push("stock_deducted = 0");
          }
          updateFields.push("needs_manager_action = 1");
          updateFields.push("manager_action_type = 'cancelled_by_customer'");
          updateFields.push("manager_action_note = 'Клиент отменил заказ, который уже начали собирать'");
          updateFields.push("manager_action_resolved_at = NULL");
        } else {
          releaseActivePickupCell(id, "cancelled_by_customer_before_assembly");
          updateFields.push("needs_manager_action = 0");
          updateFields.push("manager_action_type = NULL");
          updateFields.push("manager_action_note = NULL");
          updateFields.push("manager_action_resolved_at = NULL");
        }

        updateValues.push(id);

        db.prepare(
          `UPDATE orders SET ${updateFields.join(", ")} WHERE id = ?`,
        ).run(...updateValues);
      });

      tx();
      recordOrderStatusChange(id, order.status, "cancelled", "Клиент отменил заказ");

      return res.json({
        success: true,
        order_id: id,
        status: "cancelled",
        needs_manager_action:
          order.status === "in_progress" ||
          (Number(order.needs_manager_action || 0) === 1 &&
            order.manager_action_type === "modified" &&
            order.previous_status === "in_progress")
            ? 1
            : 0,
      });
    } catch (error) {
      console.error("[public] Cancel by customer error:", error);
      return res.status(500).json({
        error: "cancel_failed",
        message: error.message || "Не удалось отменить заказ",
      });
    }
  },
);

publicRouter.put(
  "/api/orders/:id/modify-by-customer",
  publicMiniAppMutationLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        telegram_username,
        first_name,
        last_name,
        phone,
        delivery_type = "pickup",
        delivery_address,
        notes,
        items,
        promo_code,
      } = req.body || {};

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          error: "items_required",
          message: "Товары обязательны",
        });
      }

      const telegramId = String(req.telegramAuth?.telegramId || "").trim();
      const authTelegramUsername = normalizeTelegramUsername(req.telegramAuth?.telegramUsername);
      const order = findOwnedActiveOrder({
        orderId: id,
        telegramId,
        telegramUsername: authTelegramUsername,
      });

      if (!order) {
        return res.status(404).json({
          error: "not_found",
          message: "Активный заказ не найден",
        });
      }

      const normalizedUsername = await resolveVerifiedOrderUsername(
        req.telegramAuth,
        telegram_username || order.resolved_telegram_username || order.telegram_username,
      );

      if (!normalizedUsername) {
        return res.status(400).json({
          error: "telegram_username_required",
          message: "Укажите Telegram username",
        });
      }

      if (delivery_type === "delivery") {
        if (!phone || !String(phone).trim()) {
          return res.status(400).json({
            error: "phone_required",
            message: "Укажите телефон для доставки",
          });
        }
        if (!delivery_address || !String(delivery_address).trim()) {
          return res.status(400).json({
            error: "address_required",
            message: "Укажите адрес доставки",
          });
        }
      }

      const previousStatus = order.status;
      const statusBeforePhysicalAssembly =
        order.previous_status === "in_progress" ? "in_progress" : previousStatus;
      const wholesaleContext = buildStoredWholesaleContext(order);

      if (Number(order.is_wholesale || 0) === 1 && !wholesaleContext) {
        return res.status(400).json({
          error: "wholesale_context_missing",
          message: "Не удалось восстановить оптовый прайс для этого заказа",
        });
      }

      let nextCardAmountMinor = 0;
      let nextCashDueMinor = 0;
      const tx = db.transaction(() => {
        // Re-check under the write transaction: the seller may have issued or
        // cancelled the order while username verification was in flight.
        const freshOrder = db
          .prepare("SELECT status, paid_amount, updated_at FROM orders WHERE id = ?")
          .get(id);
        if (
          !freshOrder ||
          !ACTIVE_CUSTOMER_ORDER_STATUSES.has(freshOrder.status) ||
          Number(freshOrder.paid_amount || 0) > 0 ||
          freshOrder.updated_at !== order.updated_at
        ) {
          const error = new Error("order_not_modifiable");
          error.code = "order_not_modifiable";
          throw error;
        }
        const previousItems = db
          .prepare(
            `
            SELECT *
            FROM order_items
            WHERE order_id = ?
            ORDER BY rowid ASC
          `,
          )
          .all(id);

        if (order.stock_deducted) {
          restoreStockForOrderItems(previousItems);
        }
        releaseOrderLoyaltyReservations(id);

        const normalizedPromoCode = normalizePromoCode(promo_code);
        const orderBuild = buildPublicOrderItems({
          items,
          customerId: order.customer_id || null,
          promoCodeText: normalizedPromoCode,
          existingOrderId: id,
          wholesaleContext,
        });

        if (delivery_type === "delivery") {
          const minDeliveryError = ensureMinDeliveryAmountSatisfied(orderBuild.totalAmount);
          if (minDeliveryError) {
            const error = new Error(minDeliveryError.message);
            error.code = minDeliveryError.error;
            error.payload = minDeliveryError;
            throw error;
          }
        }

        const wholesaleMinError = validateWholesaleMinimum(
          orderBuild.totalAmount,
          wholesaleContext,
        );
        if (wholesaleMinError) {
          const error = new Error(wholesaleMinError.message);
          error.code = wholesaleMinError.error;
          error.payload = wholesaleMinError;
          throw error;
        }

        let nextPromoDiscount = 0;
        let nextPromoCodeId = null;
        let nextPromoResult = null;
        if (normalizedPromoCode) {
          nextPromoResult = validatePromoCodeForOrder(
            normalizedPromoCode,
            orderBuild.totalAmount,
            {
              excludeOrderId: id,
              expectedCustomerId: order.customer_id || null,
              isWholesale: Boolean(wholesaleContext),
              requireCustomerForOwnedPromo: true,
            },
          );
          if (!nextPromoResult.valid) {
            throwPromoValidationError(nextPromoResult);
            throw new Error(
              nextPromoResult.message || "Недействительный промокод",
            );
          }
          nextPromoDiscount = Number(nextPromoResult.calculated_discount || 0);
          nextPromoCodeId = nextPromoResult.promo.id;
        }

        const nextFinalAmount = Math.max(
          0,
          orderBuild.totalAmount -
            nextPromoDiscount -
            Number(orderBuild.totalLoyaltyDiscount || 0),
        );
        const nextProfit = nextFinalAmount - orderBuild.totalCost;
        const reservedCardOperation = db.prepare(`
          SELECT amount_minor
          FROM card_payment_operations
          WHERE order_id = ? AND operation_type = 'order' AND operation_status = 'reserved'
        `).get(id);
        nextCardAmountMinor = 0;
        if (reservedCardOperation) {
          const previousCardAmountMinor = Number(reservedCardOperation.amount_minor || 0);
          // Editing an already-created card order must not spend another
          // portion of either limit. Keep its existing card reservation and
          // put any newly added amount into the cash due at pickup.
          nextCardAmountMinor = Math.min(
            previousCardAmountMinor,
            toMinorUnits(nextFinalAmount),
          );
        }
        nextCashDueMinor = Math.max(0, toMinorUnits(nextFinalAmount) - nextCardAmountMinor);
        const nextManagerActionNote = buildManagerActionNote({
          previousItems,
          nextItems: orderBuild.items,
          previousPromoCodeText: order.promo_code_text || null,
          nextPromoCodeText: normalizedPromoCode,
        });

        clearPromoUsageForOrder(order);
        if (reservedCardOperation) {
          if (nextCardAmountMinor > 0) {
            db.prepare(`
              UPDATE card_payment_operations
              SET amount_minor = ?
              WHERE order_id = ? AND operation_type = 'order' AND operation_status = 'reserved'
            `).run(nextCardAmountMinor, id);
          } else {
            reverseCardOrder(id);
          }
        }
        db.prepare("DELETE FROM order_items WHERE order_id = ?").run(id);

        const updatedItemStmt = db.prepare(`
          INSERT INTO order_items (
            id, order_id, product_id, product_title, group_name, base_product_title, base_product_id, variant_id, variant_name, quantity,
            price_per_unit, base_price_per_unit, catalog_discount_per_unit,
            cost_per_unit, manual_discount_amount, loyalty_discount_amount, loyalty_units_applied, discount_amount, total_price, total_cost
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const item of orderBuild.items) {
          updatedItemStmt.run(
            item.id,
            id,
            item.product_id,
            item.product_title,
            item.group_name,
            item.base_product_title,
            item.base_product_id,
            item.variant_id || null,
            item.variant_name,
            item.quantity,
            item.price_per_unit,
            item.base_price_per_unit,
            item.catalog_discount_per_unit,
            item.cost_per_unit,
            item.manual_discount_amount,
            item.loyalty_discount_amount,
            item.loyalty_units_applied,
            item.discount_amount,
            item.total_price,
            item.total_cost,
          );
        }

        if (!wholesaleContext) {
          applyOrderLoyaltyReservations({
            customerId: order.customer_id || null,
            orderId: id,
            application: orderBuild.application,
          });
        }

        db.prepare(
          `
          UPDATE orders
          SET status = 'new',
              previous_status = ?,
              delivery_type = ?,
              delivery_address = ?,
              notes = ?,
              phone = ?,
              telegram_username = ?,
              total_amount = ?,
              discount_amount = ?,
              discount_percent = 0,
              final_amount = ?,
              profit = ?,
              promo_code_id = ?,
              promo_code_text = ?,
              needs_manager_action = 1,
              manager_action_type = 'modified',
              manager_action_note = ?,
              manager_action_resolved_at = NULL,
              is_wholesale = ?,
              wholesale_tier_id = ?,
              wholesale_tier_label = ?,
              wholesale_min_amount = ?,
              payment_type = ?,
              card_amount_minor = ?,
              cash_due_minor = ?,
              stock_deducted = 0,
              cancelled_at = NULL,
              updated_at = DATETIME('now')
          WHERE id = ?
        `,
        ).run(
          statusBeforePhysicalAssembly,
          delivery_type,
          delivery_type === "delivery" ? delivery_address || null : null,
          notes || null,
          delivery_type === "delivery" ? phone || null : null,
          normalizedUsername,
          orderBuild.totalAmount,
          nextPromoDiscount,
          nextFinalAmount,
          nextProfit,
          nextPromoCodeId,
          normalizedPromoCode,
          nextManagerActionNote,
          wholesaleContext ? 1 : 0,
          wholesaleContext?.tier?.id || null,
          wholesaleContext?.tier?.label || null,
          wholesaleContext?.tier
            ? Number(wholesaleContext.tier.minOrderAmount || 0)
            : null,
          nextCardAmountMinor > 0 ? "card" : null,
          nextCardAmountMinor,
          nextCashDueMinor,
          id,
        );

        if (order.customer_id) {
          db.prepare(
            `
            UPDATE customers
            SET telegram_username = ?,
                first_name = COALESCE(?, first_name),
                last_name = COALESCE(?, last_name),
                phone = COALESCE(?, phone),
                updated_at = DATETIME('now')
            WHERE id = ?
          `,
          ).run(
            normalizedUsername,
            req.telegramAuth?.firstName || first_name || null,
            req.telegramAuth?.lastName || last_name || null,
            delivery_type === "delivery" ? phone || null : null,
            order.customer_id,
          );
        }

        if (nextPromoCodeId && nextPromoResult) {
          reservePromoUsageForOrder({
            promoCodeId: nextPromoCodeId,
            orderId: id,
            customerId: order.customer_id || null,
            discountApplied: nextPromoDiscount,
            idFactory: () => generateId("pu"),
          });
        }
      });

      tx();
      recordOrderStatusChange(id, previousStatus, "new", "Клиент изменил заказ");

      return res.json({
        success: true,
        order_id: id,
        payment_type: nextCardAmountMinor > 0 ? "card" : "cash",
        card_amount_minor: nextCardAmountMinor,
        cash_due_minor: nextCashDueMinor,
      });
    } catch (error) {
      const errorCode = String(error.code || error.message || "");
      if (error.payload?.error === "min_delivery_amount_not_met") {
        return res.status(400).json(error.payload);
      }
      if (error.payload?.error === "wholesale_min_not_met") {
        return res.status(400).json(error.payload);
      }
      if (
        errorCode === "order_not_modifiable"
      ) {
        return res.status(409).json({
          error: errorCode,
          message: "Заказ уже изменился и больше не может быть отредактирован. Обновите страницу.",
        });
      }
      if (
        errorCode === "telegram_username_required" ||
        errorCode === "telegram_username_not_verified" ||
        errorCode === "promo_and_loyalty_conflict" ||
        errorCode === "invalid_promo" ||
        errorCode === "loyalty_category_not_available" ||
        errorCode === "loyalty_balance_not_enough" ||
        errorCode === "loyalty_category_limit_exceeded" ||
        errorCode === "wholesale_price_unavailable"
      ) {
        return res.status(400).json({
          error: errorCode,
          message: error.userMessage || error.message || errorCode,
        });
      }
      console.error("[public] Modify by customer error:", error);
      return res.status(500).json({
        error: "modify_failed",
        message: error.message || "Не удалось изменить заказ",
      });
    }
  },
);

publicRouter.post(
  "/api/orders",
  publicMiniAppMutationLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  async (req, res) => {
    try {
      const {
        telegram_username,
        first_name,
        last_name,
        phone,
        delivery_type = "pickup",
        delivery_address,
        notes,
        items,
        promo_code,
        accepted_agreement_ids,
        inviter_username,
        payment_method = "cash",
      } = req.body || {};

      if (!["cash", "card"].includes(payment_method)) {
        return res.status(400).json({ error: "invalid_payment_method" });
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res
          .status(400)
          .json({ error: "items_required", message: "Товары обязательны" });
      }

      // Соглашения: квик-валидация ДО основной транзакции (быстрый отказ
      // без лишней работы — стоковые проверки, lookup'ы и т.п.). Реальный
      // снимок и финальная проверка происходят ВНУТРИ db.transaction ниже,
      // под write-lock'ом — это закрывает race между чтением agreements
      // и INSERT в orders (admin не может в этот момент вставить новое
      // обязательное соглашение).
      const preliminaryAgreementsCheck = validateAcceptedAgreementIds(accepted_agreement_ids);
      if (!preliminaryAgreementsCheck.ok) {
        return res.status(400).json({
          error: "agreements_required",
          message: "Подтвердите согласие для оформления заказа",
          missing: preliminaryAgreementsCheck.missing,
        });
      }

      const verifiedTelegramUsername = await resolveVerifiedOrderUsername(
        req.telegramAuth,
        telegram_username,
      );

      if (!verifiedTelegramUsername) {
        return res.status(400).json({
          error: "telegram_username_required",
          message: "Укажите Telegram username",
        });
      }

      if (!/^[a-zA-Z0-9_]{5,32}$/.test(verifiedTelegramUsername)) {
        return res.status(400).json({
          error: "telegram_username_invalid",
          message: "Username должен содержать от 5 до 32 символов",
        });
      }

      const telegramId = String(req.telegramAuth?.telegramId || "").trim();
      if (req.telegramAuth?.verified) {
        activatePendingStaffAccess({
          telegramId,
          telegramUsername: verifiedTelegramUsername,
          firstName: req.telegramAuth?.firstName || first_name || null,
          lastName: req.telegramAuth?.lastName || last_name || null,
        });
      }
      const existingActiveOrder = findOwnedActiveOrder({
        telegramId,
        telegramUsername: verifiedTelegramUsername,
      });

      if (existingActiveOrder) {
        const existingPickupCell = getActivePickupCellAssignment(existingActiveOrder.id);
        return res.status(409).json({
          error: "active_order_exists",
          message: "У вас уже есть активный заказ. Его можно только изменить или отменить.",
          order_id: existingActiveOrder.id,
          order_number: existingPickupCell?.cell_number ?? null,
        });
      }

      // Блокировка клиента — отказываем в новом заказе.
      // Сначала pending (превентивный бан по @username, клиент ещё не в БД),
      // потом активный блок по telegram_id (если клиент уже есть).
      //
      // Важно: эта проверка идёт ПОСЛЕ existingActiveOrder. Это намеренно —
      // согласно ТЗ активные заказы заблокированного клиента должны выдаваться
      // как обычно. Если у заблокированного есть активный заказ, он получит
      // 409 active_order_exists вместо 403 customer_blocked — экран блокировки
      // он всё равно увидит при следующем входе через /check-blocks (он же
      // вызывается в App.vue:onMounted).
      const pendingBan = getPendingBanForUsername(verifiedTelegramUsername);
      if (pendingBan) {
        return res.status(403).json({
          error: "customer_blocked",
          block: serializeBlock(pendingBan, "pending"),
        });
      }
      const activeBlock = getActiveBlockForTelegramId(telegramId);
      if (activeBlock) {
        return res.status(403).json({
          error: "customer_blocked",
          block: serializeBlock(activeBlock, "active"),
        });
      }

      const wholesaleContext = resolveWholesaleContextOrSendError(req, res);
      if (!wholesaleContext && res.headersSent) {
        return;
      }

      if (delivery_type === "delivery") {
        if (!phone || !phone.trim()) {
          return res.status(400).json({
            error: "phone_required",
            message: "Укажите телефон для доставки",
          });
        }
        if (!delivery_address || !delivery_address.trim()) {
          return res.status(400).json({
            error: "address_required",
            message: "Укажите адрес доставки",
          });
        }
      }

      const normalizedPromoCode = normalizePromoCode(promo_code);
      const preflightCustomerId = resolveCustomerIdFromVerifiedAuth(req);
      const runBusinessPreflight = () => validatePublicOrderPreflight({
        items,
        customerId: preflightCustomerId,
        normalizedPromoCode,
        wholesaleContext,
        deliveryType: delivery_type,
      });

      // Ошибки товара, остатков, скидок и оптового минимума должны вернуться
      // раньше проверки пригласившего и никогда не расходовать попытку.
      db.transaction(runBusinessPreflight).immediate();

      const referralStatus = getReferralAuthorizationStatus(telegramId);
      if (referralStatus.blocked) {
        const block = getActiveBlockForTelegramId(telegramId);
        return res.status(403).json({
          error: "customer_blocked",
          message: "Авторизация не пройдена",
          block: serializeBlock(block, "active"),
          attempts_used: referralStatus.attempts_used,
          attempts_remaining: 0,
        });
      }
      const sendReferralFailure = (inspected) => {
        const nextStatus = db.transaction(() => {
          const agreementsCheck = validateAcceptedAgreementIds(accepted_agreement_ids);
          if (!agreementsCheck.ok) {
            const error = new Error("Подтвердите согласие для оформления заказа");
            error.code = "agreements_required";
            error.payload = {
              error: "agreements_required",
              message: error.message,
              missing: agreementsCheck.missing,
            };
            throw error;
          }
          runBusinessPreflight();
          return recordReferralOutcome({
            identity: {
              telegramId,
              telegramUsername: verifiedTelegramUsername,
              firstName: req.telegramAuth?.firstName || first_name || null,
              lastName: req.telegramAuth?.lastName || last_name || null,
            },
            rawUsername: inviter_username,
            result: inspected,
          });
        }).immediate();
        if (nextStatus.customer_blocked) {
          const block = getActiveBlockForTelegramId(telegramId);
          return res.status(403).json({
            error: "customer_blocked",
            block: serializeBlock(block, "active"),
            attempts_used: nextStatus.attempts_used,
            attempts_remaining: nextStatus.attempts_remaining,
          });
        }
        if (nextStatus.blocked) {
          const block = getActiveBlockForTelegramId(telegramId);
          return res.status(403).json({
            error: "customer_blocked",
            message: "Авторизация не пройдена",
            block: serializeBlock(block, "active"),
            attempts_used: 3,
            attempts_remaining: 0,
          });
        }
        const messages = {
          referral_username_invalid: "Проверьте username пригласившего",
          referral_inviter_not_eligible: "Пользователь не найден или ещё не забирал заказ",
          referral_self_invite: "Нельзя указать самого себя",
          referral_inviter_blocked: "Пользователь заблокирован и не может быть пригласившим",
          referral_inviter_forbidden: "Данный пользователь не может приглашать новых людей",
          referral_inviter_reserved: "Данный пользователь не может приглашать новых людей",
          referral_username_ambiguous: "Не удалось однозначно проверить username. Напишите менеджеру",
        };
        return res.status(422).json({
          error: inspected.code,
          message: messages[inspected.code] || "Не удалось проверить пригласившего",
          attempts_used: nextStatus.attempts_used,
          attempts_remaining: nextStatus.attempts_remaining,
        });
      };
      if (referralStatus.required) {
        if (typeof inviter_username !== "string" || !inviter_username.trim()) {
          return res.status(428).json({
            error: "referral_authorization_required",
            message: "Укажите username пригласившего",
            attempts_used: referralStatus.attempts_used,
            attempts_remaining: referralStatus.attempts_remaining,
          });
        }

        const inspected = inspectInviter({
          telegramId,
          telegramUsername: verifiedTelegramUsername,
          rawUsername: inviter_username,
        });
        if (!inspected.ok) {
          return sendReferralFailure(inspected);
        }
      }

      const tx = db.transaction(() => {
        // Финальная проверка соглашений: повторяем под write-lock на случай,
        // если между preliminary-проверкой выше и стартом транзакции admin
        // активировал новое обязательное соглашение. Возвращаем sentinel
        // вместо throw — наружный код увидит violation и вернёт 400 без 500.
        const finalAgreementsCheck = validateAcceptedAgreementIds(accepted_agreement_ids);
        if (!finalAgreementsCheck.ok) {
          return { agreementsViolation: finalAgreementsCheck.missing };
        }
        const acceptedAgreementsSnapshot = buildAcceptedSnapshot(accepted_agreement_ids);

        // Повторная проверка уже под write-lock: параллельный запрос мог
        // успеть создать заказ между внешней проверкой и транзакцией.
        const concurrentActiveOrder = findOwnedActiveOrder({
          telegramId,
          telegramUsername: verifiedTelegramUsername,
        });
        if (concurrentActiveOrder) {
          return {
            activeOrderConflict: {
              id: concurrentActiveOrder.id,
              order_number: concurrentActiveOrder.order_number,
            },
          };
        }

        // Проверяем пригласившего повторно уже под write-lock. Менеджер мог
        // успеть заблокировать его или запретить приглашения между запросами.
        const finalReferralStatus = getReferralAuthorizationStatus(telegramId);
        if (finalReferralStatus.blocked) {
          return { referralBlocked: true };
        }
        if (
          finalReferralStatus.required &&
          (typeof inviter_username !== "string" || !inviter_username.trim())
        ) {
          return { referralRequired: finalReferralStatus };
        }
        let transactionInviter = null;
        if (finalReferralStatus.required) {
          transactionInviter = inspectInviter({
            telegramId,
            telegramUsername: verifiedTelegramUsername,
            rawUsername: inviter_username,
          });
          if (!transactionInviter.ok) {
            return { referralViolation: transactionInviter };
          }
        }

        const resolvedCustomerId = upsertPublicCustomer({
          telegramId,
          telegramUsername: verifiedTelegramUsername || null,
          firstName: req.telegramAuth?.firstName || first_name || null,
          lastName: req.telegramAuth?.lastName || last_name || null,
          phone: phone || null,
        });

        const createdOrderId = generateId("order");
        const createdOrderNumber = getNextNumber("orders", "order_number");
        const orderBuild = buildPublicOrderItems({
          items,
          customerId: resolvedCustomerId,
          promoCodeText: normalizedPromoCode,
          wholesaleContext,
        });

        if (delivery_type === "delivery") {
          const minDeliveryError = ensureMinDeliveryAmountSatisfied(orderBuild.totalAmount);
          if (minDeliveryError) {
            const error = new Error(minDeliveryError.message);
            error.code = minDeliveryError.error;
            error.payload = minDeliveryError;
            throw error;
          }
        }

        const wholesaleMinError = validateWholesaleMinimum(
          orderBuild.totalAmount,
          wholesaleContext,
        );
        if (wholesaleMinError) {
          const error = new Error(wholesaleMinError.message);
          error.code = wholesaleMinError.error;
          error.payload = wholesaleMinError;
          throw error;
        }

        let createdPromoDiscount = 0;
        let createdPromoCodeId = null;
        let createdPromoResult = null;
        if (normalizedPromoCode) {
          createdPromoResult = validatePromoCodeForOrder(
            normalizedPromoCode,
            orderBuild.totalAmount,
            {
              expectedCustomerId: resolvedCustomerId || null,
              isWholesale: Boolean(wholesaleContext),
              requireCustomerForOwnedPromo: true,
            },
          );
          if (!createdPromoResult.valid) {
            throwPromoValidationError(createdPromoResult);
            throw new Error(
              createdPromoResult.message || "Недействительный промокод",
            );
          }
          createdPromoDiscount = Number(createdPromoResult.calculated_discount || 0);
          createdPromoCodeId = createdPromoResult.promo.id;
        }

        const createdFinalAmount = Math.max(
          0,
          orderBuild.totalAmount - createdPromoDiscount - orderBuild.totalLoyaltyDiscount,
        );
        const createdProfit = createdFinalAmount - orderBuild.totalCost;
        let cardPayment = {
          cardAmountMinor: 0,
          cashDueMinor: toMinorUnits(createdFinalAmount),
        };
        if (payment_method === "card") {
          const decision = checkCardOrder({
            orderId: createdOrderId,
            telegramId,
            telegramUsername: verifiedTelegramUsername,
            amountMinor: toMinorUnits(createdFinalAmount),
          });
          if (!decision.ok) {
            const error = new Error(decision.reason || "card_payment_unavailable");
            error.code = decision.reason || "card_payment_unavailable";
            error.cardPaymentError = decision;
            throw error;
          }
          cardPayment = decision;
        }

        db.prepare(
          `
          INSERT INTO orders (
            id, order_number, customer_id, status, delivery_type, delivery_address,
            total_amount, discount_amount, discount_percent, final_amount, profit, notes, phone, telegram_username,
            promo_code_id, promo_code_text, is_wholesale, wholesale_tier_id, wholesale_tier_label, wholesale_min_amount,
            accepted_agreements, payment_type, card_amount_minor, cash_due_minor
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
        `,
        ).run(
          createdOrderId,
          createdOrderNumber,
          resolvedCustomerId,
          "new",
          delivery_type,
          delivery_type === "delivery" ? delivery_address || null : null,
          orderBuild.totalAmount,
          createdPromoDiscount,
          0,
          createdFinalAmount,
          createdProfit,
          notes || null,
          delivery_type === "delivery" ? phone || null : null,
          verifiedTelegramUsername || null,
          createdPromoCodeId,
          normalizedPromoCode,
          wholesaleContext ? 1 : 0,
          wholesaleContext?.tier?.id || null,
          wholesaleContext?.tier?.label || null,
          wholesaleContext?.tier
            ? Number(wholesaleContext.tier.minOrderAmount || 0)
            : null,
          acceptedAgreementsSnapshot,
          payment_method === "card" ? "card" : null,
          cardPayment.cardAmountMinor,
          cardPayment.cashDueMinor,
        );

        if (payment_method === "card") {
          reserveCheckedCardOrder(cardPayment);
        }

        if (transactionInviter?.ok) {
          markReferralAuthorized({
            customerId: resolvedCustomerId,
            telegramId,
            inviter: transactionInviter.inviter,
            submittedUsername: inviter_username,
            orderId: createdOrderId,
          });
        } else if (!isReferralAuthorizationEnabled()) {
          authorizeCustomerWithoutReferral(resolvedCustomerId, "feature_disabled");
        }
        attachFirstOrderToReferral(resolvedCustomerId, createdOrderId);

        const createdItemStmt = db.prepare(`
          INSERT INTO order_items (
            id, order_id, product_id, product_title, group_name, base_product_title, base_product_id, variant_id, variant_name, quantity,
            price_per_unit, base_price_per_unit, catalog_discount_per_unit,
            cost_per_unit, manual_discount_amount, loyalty_discount_amount, loyalty_units_applied, discount_amount, total_price, total_cost
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const item of orderBuild.items) {
          createdItemStmt.run(
            item.id,
            createdOrderId,
            item.product_id,
            item.product_title,
            item.group_name,
            item.base_product_title,
            item.base_product_id,
            item.variant_id || null,
            item.variant_name,
            item.quantity,
            item.price_per_unit,
            item.base_price_per_unit,
            item.catalog_discount_per_unit,
            item.cost_per_unit,
            item.manual_discount_amount,
            item.loyalty_discount_amount,
            item.loyalty_units_applied,
            item.discount_amount,
            item.total_price,
            item.total_cost,
          );
        }

        if (!wholesaleContext) {
          applyOrderLoyaltyReservations({
            customerId: resolvedCustomerId,
            orderId: createdOrderId,
            application: orderBuild.application,
          });
        }

        if (createdPromoCodeId && createdPromoResult) {
          reservePromoUsageForOrder({
            promoCodeId: createdPromoCodeId,
            orderId: createdOrderId,
            customerId: resolvedCustomerId || null,
            discountApplied: createdPromoDiscount,
            idFactory: () => generateId("pu"),
          });
        }

        if (resolvedCustomerId) {
          db.prepare(
            `
            UPDATE customers
            SET total_orders = total_orders + 1,
                total_spent = total_spent + ?,
                last_order_at = DATETIME('now'),
                updated_at = DATETIME('now')
            WHERE id = ?
          `,
          ).run(createdFinalAmount, resolvedCustomerId);
        }

        const pickupCell = assignLowestAvailablePickupCell(createdOrderId);

        return {
          orderId: createdOrderId,
          orderNumber: createdOrderNumber,
          pickupCellNumber: pickupCell.cell_number,
        };
      });

      const created = tx.immediate();
      // Sentinel из транзакции: если активировалось новое соглашение между
      // preliminary-проверкой и началом tx — возвращаем 400 с актуальным
      // missing[].
      if (created?.agreementsViolation) {
        return res.status(400).json({
          error: "agreements_required",
          message: "Подтвердите согласие для оформления заказа",
          missing: created.agreementsViolation,
        });
      }
      if (created?.activeOrderConflict) {
        const conflictPickupCell = getActivePickupCellAssignment(
          created.activeOrderConflict.id,
        );
        return res.status(409).json({
          error: "active_order_exists",
          message: "У вас уже есть активный заказ. Его можно только изменить или отменить.",
          order_id: created.activeOrderConflict.id,
          order_number: conflictPickupCell?.cell_number ?? null,
        });
      }
      if (created?.referralBlocked) {
        const block = getActiveBlockForTelegramId(telegramId);
        const latestStatus = getReferralAuthorizationStatus(telegramId);
        return res.status(403).json({
          error: "customer_blocked",
          message: "Авторизация не пройдена",
          block: serializeBlock(block, "active"),
          attempts_used: latestStatus.attempts_used,
          attempts_remaining: 0,
        });
      }
      if (created?.referralRequired) {
        return res.status(428).json({
          error: "referral_authorization_required",
          message: "Укажите username пригласившего",
          attempts_used: created.referralRequired.attempts_used,
          attempts_remaining: created.referralRequired.attempts_remaining,
        });
      }
      if (created?.referralViolation) {
        return sendReferralFailure(created.referralViolation);
      }
      setImmediate(() => {
        void autoNotifyOrderAcceptedAfterRecipientWarmup({ orderId: created.orderId }).catch((notifyErr) => {
          console.error("[public] deferred order-accepted notify error:", notifyErr);
        });
      });

      return res.json({
        success: true,
        order_id: created.orderId,
        order_number: created.pickupCellNumber,
        pickup_cell_number: created.pickupCellNumber,
      });
    } catch (error) {
      if (error.cardPaymentError) {
        const denied = error.cardPaymentError;
        if (denied.reason === "personal_limit_exceeded") {
          return res.status(409).json({
            error: denied.reason,
            message: `Лимит оплаты картой для вашего аккаунта — ${(denied.personalLimitMinor / 100).toFixed(2)} BYN. Сумма заказа — ${(denied.orderAmountMinor / 100).toFixed(2)} BYN.`,
            personal_limit_minor: denied.personalLimitMinor,
            order_amount_minor: denied.orderAmountMinor,
          });
        }
        if (denied.reason === "personal_monthly_limit_exceeded") {
          return res.status(409).json({
            error: denied.reason,
            message: `Месячный лимит оплаты картой для вашего аккаунта — ${(denied.personalMonthlyLimitMinor / 100).toFixed(2)} BYN. Доступно сейчас — ${(denied.personalMonthlyRemainingMinor / 100).toFixed(2)} BYN.`,
            personal_monthly_limit_minor: denied.personalMonthlyLimitMinor,
            personal_monthly_remaining_minor: denied.personalMonthlyRemainingMinor,
          });
        }
        if (denied.reason === "personal_cooldown") {
          return res.status(409).json({
            error: denied.reason,
            message: `Оплата картой для вашего аккаунта будет доступна после ${denied.cooldownUntil}.`,
            cooldown_until: denied.cooldownUntil,
          });
        }
        return res.status(409).json({
          error: denied.reason || "daily_limit_exhausted",
          message: "Лимит оплаты по карте на сегодня уже занят другим заказом. Вы можете оформить этот заказ только за наличные.",
        });
      }
      const errorCode = String(error.code || error.message || "");
      if (error.payload?.error === "agreements_required") {
        return res.status(400).json(error.payload);
      }
      if (error.payload?.error === "min_delivery_amount_not_met") {
        return res.status(400).json(error.payload);
      }
      if (error.payload?.error === "wholesale_min_not_met") {
        return res.status(400).json(error.payload);
      }
      if (errorCode === "pickup_cells_full") {
        return res.status(409).json({
          error: "pickup_cells_full",
          message: "Свободных мест для заказов нет. Попробуйте позже.",
        });
      }
      if (
        errorCode === "telegram_username_required" ||
        errorCode === "telegram_username_not_verified" ||
        errorCode === "promo_and_loyalty_conflict" ||
        errorCode === "invalid_promo" ||
        errorCode === "loyalty_category_not_available" ||
        errorCode === "loyalty_balance_not_enough" ||
        errorCode === "loyalty_category_limit_exceeded" ||
        errorCode === "wholesale_price_unavailable"
      ) {
        return res.status(400).json({
          error: errorCode,
          message: error.userMessage || error.message || errorCode,
        });
      }
      console.error("[public] Create order error:", error);
      return res.status(500).json({
        error: "create_failed",
        message: error.message || "Не удалось создать заказ",
      });
    }
  },
);



// Validate promo code (public endpoint)
//
// Regular retail validation stays available without Telegram auth for CRM
// tooling. Customer-bound wholesale prizes require a verified Mini App
// identity before the UI may show a successful result.
publicRouter.post(
  "/api/promo/validate",
  publicMiniAppReadLimiter,
  optionalTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
    try {
      const { code, order_amount = 0, order_id, editing_order_id } = req.body;
      const wholesaleContext = resolveWholesaleContextOrSendError(req, res);
      if (!wholesaleContext && res.headersSent) {
        return;
      }
      const expectedCustomerId = resolveCustomerIdFromVerifiedAuth(req);
      const result = validatePromoCodeForOrder(code, Number(order_amount), {
        excludeOrderId:
          typeof editing_order_id === "string" && editing_order_id.trim()
            ? editing_order_id.trim()
            : typeof order_id === "string" && order_id.trim()
              ? order_id.trim()
              : null,
        expectedCustomerId,
        isWholesale: Boolean(wholesaleContext),
        requireCustomerForOwnedPromo: Boolean(wholesaleContext),
      });

      if (result.valid) {
        res.json({
          valid: true,
          discount_type: result.discount_type,
          discount_value: result.discount_value,
          calculated_discount: result.calculated_discount,
          description: result.description,
          customer_description: result.customer_description,
          manager_description: result.manager_description,
          has_gift: result.has_gift,
          valid_from_date: result.valid_from_date,
          duration_days: result.duration_days,
          effective_valid_until_date: result.effective_valid_until_date,
        });
      } else {
        res.json({
          valid: false,
          error: result.error,
          message: result.message,
        });
      }
    } catch (error) {
      console.error("[public] Validate promo error:", error);
      res.status(500).json({
        valid: false,
        error: "failed",
        message: "Ошибка проверки промокода",
      });
    }
  },
);

function resolveCustomerIdFromVerifiedAuth(req) {
  const telegramId = String(req.telegramAuth?.telegramId || "").trim();
  if (!telegramId) return null;
  return (
    db.prepare("SELECT id FROM customers WHERE telegram_id = ?").get(telegramId)?.id || null
  );
}

function upsertPublicCustomer({
  telegramId,
  telegramUsername,
  firstName,
  lastName,
  phone,
}) {
  if (!telegramId) {
    return null;
  }

  const existing = db
    .prepare("SELECT * FROM customers WHERE telegram_id = ?")
    .get(telegramId);

  if (existing) {
    db.prepare(
      `
      UPDATE customers
      SET telegram_username = ?,
          first_name = ?,
          last_name = ?,
          phone = COALESCE(?, phone),
          last_visit_at = DATETIME('now'),
          updated_at = DATETIME('now')
      WHERE id = ?
    `,
    ).run(
      telegramUsername || null,
      firstName || null,
      lastName || null,
      phone || null,
      existing.id,
    );

    // Активация превентивных банов: если @username клиента сменился и
    // именно по новому username админ повесил pending — переносим в активный блок.
    activatePendingBansForCustomer({
      id: existing.id,
      telegram_username: telegramUsername || existing.telegram_username,
    });
    activatePendingNotesForCustomer({
      id: existing.id,
      telegram_username: telegramUsername || existing.telegram_username,
    });
    activatePendingInviteBanForCustomer({
      id: existing.id,
      telegram_username: telegramUsername || existing.telegram_username,
    });
    return existing.id;
  }

  const customerId = generateId("cust");
  db.prepare(
    `
    INSERT INTO customers (
      id, telegram_id, telegram_username, first_name, last_name, phone,
      first_visit_at, last_visit_at, total_orders, total_spent
    ) VALUES (?, ?, ?, ?, ?, ?, DATETIME('now'), DATETIME('now'), 0, 0)
  `,
  ).run(
    customerId,
    telegramId,
    telegramUsername || null,
    firstName || null,
    lastName || null,
    phone || null,
  );

  // Свежесозданный клиент: проверяем есть ли pending-бан по его @username
  // (превентивный бан, оформленный админом до первого визита). Если есть —
  // переносим в customer_blocks с реальным customer_id.
  activatePendingBansForCustomer({
    id: customerId,
    telegram_username: telegramUsername,
  });
  activatePendingNotesForCustomer({
    id: customerId,
    telegram_username: telegramUsername,
  });
  activatePendingInviteBanForCustomer({
    id: customerId,
    telegram_username: telegramUsername,
  });

  return customerId;
}

function validatePublicOrderPreflight({
  items,
  customerId,
  normalizedPromoCode,
  wholesaleContext,
  deliveryType,
}) {
  const orderBuild = buildPublicOrderItems({
    items,
    customerId,
    promoCodeText: normalizedPromoCode,
    wholesaleContext,
  });

  if (deliveryType === "delivery") {
    const minDeliveryError = ensureMinDeliveryAmountSatisfied(orderBuild.totalAmount);
    if (minDeliveryError) {
      const error = new Error(minDeliveryError.message);
      error.code = minDeliveryError.error;
      error.payload = minDeliveryError;
      throw error;
    }
  }

  const wholesaleMinError = validateWholesaleMinimum(orderBuild.totalAmount, wholesaleContext);
  if (wholesaleMinError) {
    const error = new Error(wholesaleMinError.message);
    error.code = wholesaleMinError.error;
    error.payload = wholesaleMinError;
    throw error;
  }

  if (normalizedPromoCode) {
    const promoResult = validatePromoCodeForOrder(
      normalizedPromoCode,
      orderBuild.totalAmount,
      {
        expectedCustomerId: customerId || null,
        isWholesale: Boolean(wholesaleContext),
        requireCustomerForOwnedPromo: true,
      },
    );
    if (!promoResult.valid) {
      throwPromoValidationError(promoResult);
    }
  }

  return orderBuild;
}

function buildPublicOrderItems({
  items,
  customerId = null,
  promoCodeText = null,
  existingOrderId = null,
  wholesaleContext = null,
}) {
  let totalAmount = 0;
  let totalCost = 0;

  const preparedItems = items.map((item) => {
    const product = db
      .prepare("SELECT * FROM products WHERE id = ?")
      .get(item.product_id);
    if (!product) {
      throw new Error(`Товар не найден: ${item.product_id}`);
    }

    const quantity = Number(item.quantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("invalid_item_quantity");
    }

    let stockToCheck = product.stock;
    let variantData = null;

    if (item.variant_id) {
      variantData = db
        .prepare("SELECT * FROM product_variants WHERE id = ?")
        .get(item.variant_id);
      if (!variantData) {
        throw new Error(`Вариант не найден: ${item.variant_id}`);
      }
      stockToCheck = variantData.stock;
    } else if (product.has_variants) {
      stockToCheck = null;
    }

    if (stockToCheck !== null && Number(stockToCheck) < quantity) {
      const itemTitle = item.variant_name
        ? `${product.title} (${item.variant_name})`
        : product.title;
      throw new Error(`Недостаточно товара: ${itemTitle}`);
    }

    // Каталожная цена, какой она была бы без акции. Цену из тела запроса не
    // берём даже в крайнем случае: это данные покупателя, а не каталога.
    let basePricePerUnit = resolveCatalogUnitPrice(variantData?.price_rub, product.priceRub);
    if (basePricePerUnit <= 0) {
      const error = new Error(`Цена не найдена для товара: ${product.title}`);
      error.code = "catalog_price_unavailable";
      throw error;
    }

    let pricePerUnit = basePricePerUnit;

    if (wholesaleContext?.tier) {
      const wholesalePrice = getWholesaleUnitPriceForProduct(
        product,
        wholesaleContext.tier.id,
      );
      if (!Number.isFinite(Number(wholesalePrice)) || Number(wholesalePrice) <= 0) {
        const error = new Error(`Оптовая цена не найдена для товара: ${product.title}`);
        error.code = "wholesale_price_unavailable";
        throw error;
      }
      pricePerUnit = Number(wholesalePrice);
      // Оптовику скидки каталога не показывают, значит и снимать с них нечего.
      basePricePerUnit = pricePerUnit;
    } else {
      // Скидка каталога применяется только в рознице: у опта своя цена.
      // Базовую цену товара при этом не трогаем, на разнице между ней и
      // проданной ценой держится блокировка бонусов в loyalty.js.
      pricePerUnit = applyDiscountToPrice(
        pricePerUnit,
        resolveDiscountPrice({
          productId: product.id,
          variantId: variantData?.id || null,
          groupId: product.groupId || null,
        }),
      );
    }

    const costPerUnit = Number(product.cost_price || 0);
    const groupName = product.groupId
      ? db
          .prepare("SELECT name FROM category_groups WHERE id = ?")
          .get(product.groupId)?.name || null
      : null;

    totalAmount += Number(pricePerUnit) * quantity;
    totalCost += costPerUnit * quantity;

    return {
      id: item.id || generateId("oi"),
      product_id: item.product_id,
      variant_id: item.variant_id || null,
      product_title: item.variant_name
        ? `${product.title} - ${item.variant_name}`
        : product.title || "Без названия",
      group_name: groupName,
      base_product_title:
        item.product_title || product.title || "Без названия",
      base_product_id: item.product_id,
      variant_name: item.variant_name || null,
      quantity,
      price_per_unit: Number(pricePerUnit),
      base_price_per_unit: basePricePerUnit,
      catalog_discount_per_unit: roundMoney(basePricePerUnit - Number(pricePerUnit)),
      cost_per_unit: costPerUnit,
      manual_discount_amount: 0,
      loyalty_units_applied: Number(item.loyalty_units_applied || 0),
    };
  });

  if (wholesaleContext?.tier) {
    const finalizedItems = preparedItems.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      variant_id: item.variant_id || null,
      product_title: item.product_title,
      group_name: item.group_name || null,
      base_product_title: item.base_product_title,
      base_product_id: item.base_product_id,
      variant_name: item.variant_name || null,
      quantity: Number(item.quantity || 0),
      price_per_unit: Number(item.price_per_unit || 0),
      base_price_per_unit: Number(item.base_price_per_unit || 0),
      catalog_discount_per_unit: Number(item.catalog_discount_per_unit || 0),
      cost_per_unit: Number(item.cost_per_unit || 0),
      manual_discount_amount: 0,
      loyalty_discount_amount: 0,
      loyalty_units_applied: 0,
      discount_amount: 0,
      total_price: Number(item.price_per_unit || 0) * Number(item.quantity || 0),
      total_cost: Number(item.cost_per_unit || 0) * Number(item.quantity || 0),
    }));

    return {
      items: finalizedItems,
      totalAmount,
      totalCost,
      totalLoyaltyDiscount: 0,
      application: {
        items: finalizedItems,
        total_loyalty_discount: 0,
      },
    };
  }

  const application = buildLoyaltyApplication({
    customerId,
    items: preparedItems,
    promoCodeText,
    existingOrderId,
  });

  const finalizedItems = application.items.map((item) => ({
    id: item.id,
    product_id: item.product_id,
    variant_id: item.variant_id || null,
    product_title: item.product_title,
    group_name: item.group_name || null,
    base_product_title: item.base_product_title,
    base_product_id: item.base_product_id,
    variant_name: item.variant_name || null,
    quantity: Number(item.quantity || 0),
    price_per_unit: Number(item.price_per_unit || 0),
    base_price_per_unit: Number(item.base_price_per_unit || 0),
    catalog_discount_per_unit: Number(item.catalog_discount_per_unit || 0),
    cost_per_unit: Number(item.cost_per_unit || 0),
    manual_discount_amount: Number(item.manual_discount_amount || 0),
    loyalty_discount_amount: Number(item.loyalty_discount_amount || 0),
    loyalty_units_applied: Number(item.loyalty_units_applied || 0),
    discount_amount: Number(item.discount_amount || 0),
    total_price: Number(item.total_price || 0),
    total_cost: Number(item.cost_per_unit || 0) * Number(item.quantity || 0),
  }));

  return {
    items: finalizedItems,
    totalAmount,
    totalCost,
    totalLoyaltyDiscount: Number(application.total_loyalty_discount || 0),
    application,
  };
}

// Create order (public endpoint)
