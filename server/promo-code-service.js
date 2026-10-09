import { db } from "./db.js";
import { getTimeZoneDateParts } from "./utils/business-time.js";

export const PROMO_USAGE_RESERVED = "reserved";
export const PROMO_USAGE_CONSUMED = "consumed";

export function normalizePromoCode(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().toUpperCase()
    : null;
}

export function getPromoUsageStatsForPromo(
  promoCodeId,
  { excludeOrderId = null } = {},
) {
  if (!promoCodeId) {
    return {
      activeUses: 0,
      reservedUses: 0,
      consumedUses: 0,
    };
  }

  const params = [promoCodeId];
  let whereClause = "promo_code_id = ?";
  if (excludeOrderId) {
    whereClause += " AND order_id != ?";
    params.push(excludeOrderId);
  }

  const row = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(CASE WHEN status IN ('reserved', 'consumed') THEN 1 ELSE 0 END), 0) AS active_uses,
        COALESCE(SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END), 0) AS reserved_uses,
        COALESCE(SUM(CASE WHEN status = 'consumed' THEN 1 ELSE 0 END), 0) AS consumed_uses
      FROM promo_usage
      WHERE ${whereClause}
    `,
    )
    .get(...params);

  return {
    activeUses: Number(row?.active_uses || 0),
    reservedUses: Number(row?.reserved_uses || 0),
    consumedUses: Number(row?.consumed_uses || 0),
  };
}

export function syncPromoCodeUsageCounters(promoCodeId) {
  if (!promoCodeId) {
    return {
      activeUses: 0,
      reservedUses: 0,
      consumedUses: 0,
    };
  }

  const stats = getPromoUsageStatsForPromo(promoCodeId);
  db.prepare("UPDATE promo_codes SET current_uses = ? WHERE id = ?").run(
    stats.activeUses,
    promoCodeId,
  );
  return stats;
}

function resolvePromoUsageMeta(orderId, customerId, discountApplied) {
  if (customerId !== undefined && discountApplied !== undefined) {
    return {
      customerId: customerId || null,
      discountApplied: Number(discountApplied || 0),
    };
  }

  const order = db
    .prepare("SELECT customer_id, discount_amount FROM orders WHERE id = ?")
    .get(orderId);

  return {
    customerId:
      customerId !== undefined ? customerId || null : order?.customer_id || null,
    discountApplied:
      discountApplied !== undefined
        ? Number(discountApplied || 0)
        : Number(order?.discount_amount || 0),
  };
}

export function reservePromoUsageForOrder({
  promoCodeId,
  orderId,
  customerId,
  discountApplied,
  idFactory,
}) {
  if (!promoCodeId || !orderId) {
    return null;
  }

  const existingRows = db
    .prepare("SELECT promo_code_id FROM promo_usage WHERE order_id = ?")
    .all(orderId);
  const touchedPromoIds = new Set([
    promoCodeId,
    ...existingRows.map((row) => row.promo_code_id).filter(Boolean),
  ]);

  if (existingRows.length) {
    db.prepare("DELETE FROM promo_usage WHERE order_id = ?").run(orderId);
  }

  const usageMeta = resolvePromoUsageMeta(orderId, customerId, discountApplied);

  db.prepare(
    `
      INSERT INTO promo_usage (
        id, promo_code_id, order_id, customer_id, discount_applied, status, used_at
      )
      VALUES (?, ?, ?, ?, ?, 'reserved', NULL)
    `,
  ).run(
    (idFactory || defaultPromoUsageIdFactory)(),
    promoCodeId,
    orderId,
    usageMeta.customerId,
    usageMeta.discountApplied,
  );

  for (const touchedPromoId of touchedPromoIds) {
    syncPromoCodeUsageCounters(touchedPromoId);
  }

  return db.prepare("SELECT * FROM promo_usage WHERE order_id = ?").get(orderId);
}

export function consumePromoUsageForOrder({
  orderId,
  promoCodeId = null,
  customerId,
  discountApplied,
  consumedAt = null,
  idFactory,
}) {
  if (!orderId) {
    return null;
  }

  const finalConsumedAt = consumedAt || new Date().toISOString();
  const existingRows = db
    .prepare("SELECT promo_code_id FROM promo_usage WHERE order_id = ?")
    .all(orderId);

  if (existingRows.length) {
    db.prepare(
      `
      UPDATE promo_usage
      SET status = 'consumed',
          used_at = ?
      WHERE order_id = ?
    `,
    ).run(finalConsumedAt, orderId);

    for (const row of existingRows) {
      syncPromoCodeUsageCounters(row.promo_code_id);
      markWheelSpinAsUsedForPromo(row.promo_code_id, finalConsumedAt);
    }

    return db.prepare("SELECT * FROM promo_usage WHERE order_id = ?").get(orderId);
  }

  const resolvedPromoCodeId =
    promoCodeId ||
    db.prepare("SELECT promo_code_id FROM orders WHERE id = ?").get(orderId)
      ?.promo_code_id ||
    null;

  if (!resolvedPromoCodeId) {
    return null;
  }

  const usageMeta = resolvePromoUsageMeta(orderId, customerId, discountApplied);

  db.prepare(
    `
      INSERT INTO promo_usage (
        id, promo_code_id, order_id, customer_id, discount_applied, status, used_at
      )
      VALUES (?, ?, ?, ?, ?, 'consumed', ?)
    `,
  ).run(
    (idFactory || defaultPromoUsageIdFactory)(),
    resolvedPromoCodeId,
    orderId,
    usageMeta.customerId,
    usageMeta.discountApplied,
    finalConsumedAt,
  );

  syncPromoCodeUsageCounters(resolvedPromoCodeId);
  markWheelSpinAsUsedForPromo(resolvedPromoCodeId, finalConsumedAt);
  return db.prepare("SELECT * FROM promo_usage WHERE order_id = ?").get(orderId);
}

/**
 * S1: When a wheel-generated promo is actually consumed by an order, mark
 * the originating wheel_spin as `prize_used_at`. Safe to call with any
 * promo_code_id — non-wheel promos simply won't match and the UPDATE is
 * a no-op.
 *
 * Defensive: if the wheel_spins table doesn't exist yet (e.g. fresh DB
 * before migrations ran), swallow the error and continue. Promo
 * consumption must never fail because of a wheel-side issue.
 */
function markWheelSpinAsUsedForPromo(promoCodeId, consumedAt) {
  if (!promoCodeId) return;
  try {
    db.prepare(
      `UPDATE wheel_spins
       SET prize_used_at = ?
       WHERE generated_promo_code_id = ?
         AND prize_used_at IS NULL`,
    ).run(consumedAt, promoCodeId);
  } catch (error) {
    // Most likely "no such table" if migrations haven't run. Don't break
    // the promo flow over it; just log.
    console.warn(
      "[promo] failed to mark wheel spin as used:",
      error?.message || error,
    );
  }
}

export function releasePromoUsageForOrder(orderOrId) {
  const orderId =
    typeof orderOrId === "string"
      ? orderOrId
      : typeof orderOrId?.id === "string"
        ? orderOrId.id
        : null;

  if (!orderId) {
    return [];
  }

  const rows = db
    .prepare("SELECT promo_code_id FROM promo_usage WHERE order_id = ?")
    .all(orderId);

  if (!rows.length) {
    return [];
  }

  db.prepare("DELETE FROM promo_usage WHERE order_id = ?").run(orderId);

  const promoIds = [...new Set(rows.map((row) => row.promo_code_id).filter(Boolean))];
  for (const promoId of promoIds) {
    syncPromoCodeUsageCounters(promoId);
    // M4-CR: when a checkout is reverted (cancellation, manager rebuild),
    // the originating wheel prize should also unmark itself as used so
    // the customer sees the active promo again in "Мои призы". Symmetric
    // to markWheelSpinAsUsedForPromo. Defensive: swallow missing-table
    // on freshly seeded DBs.
    try {
      db.prepare(
        `UPDATE wheel_spins
         SET prize_used_at = NULL
         WHERE generated_promo_code_id = ?`,
      ).run(promoId);
    } catch (error) {
      console.warn(
        "[promo] failed to release wheel spin used flag:",
        error?.message || error,
      );
    }
  }

  return promoIds;
}

export function validatePromoCode(
  code,
  orderAmount,
  {
    excludeOrderId = null,
    expectedCustomerId = null,
    isWholesale = false,
    requireCustomerForOwnedPromo = false,
  } = {},
) {
  const cleanCode = normalizePromoCode(code);
  if (!cleanCode) {
    return { valid: false, error: "not_found", message: "Промокод не указан" };
  }

  const promo = db.prepare("SELECT * FROM promo_codes WHERE code = ?").get(cleanCode);

  if (!promo) {
    return { valid: false, error: "not_found", message: "Промокод не найден" };
  }

  if (!promo.active) {
    return { valid: false, error: "inactive", message: "Промокод неактивен" };
  }

  // S3: Wheel prize templates are internal blueprints for generating
  // per-customer promo codes via the roulette. They must NEVER be applied
  // directly at checkout — anyone who knew or guessed the template code
  // would otherwise get a working discount. Generated child codes are
  // written with is_wheel_template = 0 so this filter only catches the
  // template row itself.
  if (Number(promo.is_wheel_template || 0) === 1) {
    return {
      valid: false,
      error: "wheel_template_not_applicable",
      message: "Этот промокод нельзя применить вручную",
    };
  }

  // S2-N1: a wheel-generated child code is bound to its winner. Without
  // this guard the code behaves like a bearer token — anyone who sees
  // it from the friend's screen, leaks, etc. could redeem the prize.
  // The check is only enforced when both (a) the code carries an owner
  // and (b) the caller passed expectedCustomerId. Internal admin paths
  // that don't have a customer in scope (e.g. CRM testing) keep working.
  if (promo.wheel_owner_customer_id) {
    if (requireCustomerForOwnedPromo && !expectedCustomerId) {
      return {
        valid: false,
        error: "wheel_promo_auth_required",
        message: "Для этого промокода нужна подтвержденная авторизация Telegram",
      };
    }
    if (
      expectedCustomerId &&
      String(promo.wheel_owner_customer_id) !== String(expectedCustomerId)
    ) {
      return {
        valid: false,
        error: "wheel_promo_owner_mismatch",
        message: "Этот промокод привязан к другому клиенту",
      };
    }
  }

  const now = new Date().toISOString();

  if (promo.valid_from && now < promo.valid_from) {
    return {
      valid: false,
      error: "not_started",
      message: "Промокод еще не действует",
    };
  }

  if (promo.valid_until && now > promo.valid_until) {
    return {
      valid: false,
      error: "expired",
      message: "Срок действия промокода истек",
    };
  }

  const nowBusinessDate = getCurrentBusinessDateString();
  const validFromDate = normalizePromoDate(promo.valid_from_date);
  const durationDays = normalizeDurationDays(promo.duration_days);
  const validUntilDate =
    validFromDate && durationDays
      ? addDaysToIsoDate(validFromDate, durationDays - 1)
      : null;

  if (validFromDate && nowBusinessDate < validFromDate) {
    return {
      valid: false,
      error: "not_started",
      message: "Промокод еще не действует",
    };
  }

  if (validUntilDate && nowBusinessDate > validUntilDate) {
    return {
      valid: false,
      error: "expired",
      message: "Срок действия промокода истек",
    };
  }

  const usageStats = getPromoUsageStatsForPromo(promo.id, { excludeOrderId });
  if (promo.max_uses > 0 && usageStats.activeUses >= promo.max_uses) {
    return {
      valid: false,
      error: "max_uses_reached",
      message: "Промокод уже использован максимальное количество раз",
    };
  }

  const normalizedOrderAmount = Number(orderAmount || 0);
  if (promo.min_order_amount > 0 && normalizedOrderAmount < promo.min_order_amount) {
    return {
      valid: false,
      error: "min_amount_not_met",
      message: `Минимальная сумма заказа для этого промокода: ${promo.min_order_amount} BYN`,
    };
  }

  let calculatedDiscount = 0;
  if (promo.discount_type === "fixed") {
    calculatedDiscount = Math.min(Number(promo.discount_value || 0), normalizedOrderAmount);
  } else if (promo.discount_type === "percent") {
    calculatedDiscount =
      Math.round(normalizedOrderAmount * Number(promo.discount_value || 0)) / 100;
  }

  if (isWholesale && Number(promo.has_gift || 0) !== 1) {
    return {
      valid: false,
      error: "wholesale_gift_promo_required",
      message: "В оптовом заказе можно применить только промокод на подарок",
    };
  }

  // Оптовая цена уже специальная. Подарочный промокод сохраняем в заказе,
  // но денежную скидку из его шаблона к оптовой цене не применяем.
  if (isWholesale) {
    calculatedDiscount = 0;
  }

  return {
    valid: true,
    promo,
    discount_type: promo.discount_type,
    discount_value: promo.discount_value,
    calculated_discount: calculatedDiscount,
    description: promo.customer_description || promo.description,
    customer_description: promo.customer_description || promo.description || null,
    manager_description: promo.manager_description || null,
    has_gift: Number(promo.has_gift || 0),
    valid_from_date: validFromDate,
    duration_days: durationDays,
    effective_valid_until_date: validUntilDate,
    usage_stats: usageStats,
  };
}

function defaultPromoUsageIdFactory() {
  return `pu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getCurrentBusinessDateString() {
  const parts = getTimeZoneDateParts(new Date());
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function normalizePromoDate(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeDurationDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const intValue = Math.trunc(parsed);
  if (intValue <= 0) return null;
  return intValue;
}

function addDaysToIsoDate(isoDate, dayOffset) {
  const [year, month, day] = isoDate.split("-").map((part) => Number(part));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toISOString().slice(0, 10);
}
