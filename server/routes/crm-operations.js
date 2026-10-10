import crypto from "node:crypto";
import express from "express";
import { db } from "../db.js";
import {
  applyDiscountToPrice,
  resolveDiscountPrice,
} from "../utils/catalog-discounts.js";
import { authMiddleware } from "../auth.js";
import { archiveOldDeliveredOrders } from "../cleanup-delivered-orders.js";
import {
  getBusinessPeriodRange,
  toSqliteUtcString,
} from "../utils/business-time.js";
import {
  applyOrderLoyaltyReservations,
  awardLoyaltyForOrder,
  buildLoyaltyApplication,
  releaseOrderLoyaltyReservations,
} from "../loyalty.js";
import { accrueWheelSpinsForOrder } from "../wheel/wheel-service.js";
import {
  consumePromoUsageForOrder,
  releasePromoUsageForOrder,
  reservePromoUsageForOrder,
} from "../promo-code-service.js";
import {
  autoNotifyForStatusChange,
  autoNotifyOrderAcceptedAfterRecipientWarmup,
} from "../utils/auto-notify.js";
import { buildCrmOrderPollSummary } from "../utils/crm-order-polling.js";
import { buildCrmOrdersSearch } from "../utils/crm-order-search.js";
import {
  describeAutoNotifyReason,
  enrichOrdersWithRelations,
} from "../utils/crm-order-enrichment.js";
import {
  buildKanbanBoardSync,
  fetchEnrichedOrdersByIds,
  fetchKanbanBoardOrders,
} from "../utils/crm-kanban-board.js";
import { buildTotalControlGroups } from "../utils/total-control-groups.js";
import { resolveCatalogUnitPrice } from "../utils/order-line-pricing.js";
import { syncGroupParking } from "../utils/group-parking.js";
import { attachFirstOrderToReferral } from "../utils/referral-authorization.js";
import {
  assignLowestAvailablePickupCell,
  getActivePickupCellAssignment,
  getPickupCellCapacity,
  listPickupCells,
  releaseActivePickupCell,
  restartPickupCellAssignmentCycle,
  setPickupCellCapacity,
} from "../utils/pickup-cells.js";
import {
  StaffServiceError,
  createShiftRequiredMiddleware,
  createStaffActorMiddleware,
  getStaffOperationReplay,
  isStaffTrackingEnabled,
  recheckActiveShiftProof,
  recheckStaffActorProof,
  recordSystemStaffEvent,
  runStaffIdempotentOperation,
  sendStaffServiceError,
  storeStaffOperationResult,
} from "../utils/staff-service.js";
import {
  enqueueInternalNotificationForGroup,
} from "../utils/internal-notifications.js";
import { roundMoney } from "../utils/money.js";
import {
  forceIssueCardPayment,
  issueCardOrder,
  reverseCardOrder,
} from "../utils/card-payment-service.js";

export const crmOperationsRouter = express.Router();
const requireOrderShift = createShiftRequiredMiddleware();
const requireDocumentActor = createStaffActorMiddleware();

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (!["actor_pin", "pin"].includes(key)) {
          result[key] = stableValue(value[key]);
        }
        return result;
      }, {});
  }
  return value;
}

function staffOperationName(base, body) {
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(body || {})))
    .digest("hex");
  return `${base}:${fingerprint}`;
}

function requestIdempotencyKey(req) {
  return String(req.get("Idempotency-Key") || "").trim() || null;
}

function unwrapStaffOperation(result) {
  if (
    result
    && typeof result === "object"
    && Object.hasOwn(result, "replayed")
    && Object.hasOwn(result, "result")
  ) {
    return result;
  }
  return { replayed: false, result };
}

function recheckOrderShift(req) {
  if (!isStaffTrackingEnabled()) return null;
  return recheckActiveShiftProof(req.staffShiftProof);
}

function recheckDocumentActor(req) {
  if (!isStaffTrackingEnabled()) return null;
  return recheckStaffActorProof(req.staffActorProof);
}

function isStaffServiceError(error) {
  return error instanceof StaffServiceError
    || String(error?.code || "").startsWith("staff_")
    || ["shift_required", "shift_expired", "idempotency_key_conflict"].includes(
      error?.code,
  );
}

function getCreatedOrderPayload(orderId) {
  const order = db
    .prepare("SELECT * FROM orders WHERE id = ?")
    .get(orderId);
  if (!order) return null;
  const orderItems = db
    .prepare(`
      SELECT oi.*, p.description as product_description
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `)
    .all(orderId);
  const pickupCell = getActivePickupCellAssignment(orderId);
  return {
    ...order,
    pickup_cell_number: pickupCell?.cell_number ?? null,
    pickup_cell_assignment_id: pickupCell?.id ?? null,
    items: orderItems,
  };
}

crmOperationsRouter.get(
  "/api/admin/crm/total-control-groups",
  authMiddleware,
  (_req, res) => {
    try {
      res.json({ items: buildTotalControlGroups(db) });
    } catch (error) {
      console.error("[crm] Get total control groups error:", error);
      res.status(500).json({ error: "total_control_groups_failed" });
    }
  },
);

// Helper для генерации ID
function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Helper для получения следующего номера
function getNextNumber(table, field) {
  const row = db.prepare(`SELECT MAX(${field}) as maxNum FROM ${table}`).get();
  return (row?.maxNum || 0) + 1;
}

function orderInventoryTarget(item) {
  const product = db
    .prepare("SELECT id, title, has_variants, stock FROM products WHERE id = ?")
    .get(item?.product_id);
  if (!product) {
    throw new StaffServiceError("inventory_target_missing", 409);
  }
  const hasVariants = Number(product.has_variants || 0) === 1;
  if (item?.variant_id) {
    if (!hasVariants) {
      throw new StaffServiceError("inventory_target_mismatch", 409);
    }
    const variant = db.prepare(`
      SELECT id, product_id, stock
      FROM product_variants
      WHERE id = ? AND product_id = ?
    `).get(item.variant_id, item.product_id);
    if (!variant) {
      throw new StaffServiceError("inventory_target_missing", 409);
    }
    return {
      table: "product_variants",
      id: variant.id,
      stock: Number(variant.stock || 0),
      title: item.product_title || product.title || item.product_id,
    };
  }
  if (hasVariants) {
    throw new StaffServiceError("inventory_target_missing", 409);
  }
  return {
    table: "products",
    id: product.id,
    stock: Number(product.stock || 0),
    title: item?.product_title || product.title || product.id,
  };
}

function adjustOrderItemStock(item, delta) {
  const quantity = Number(item?.quantity || 0);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new StaffServiceError("invalid_item_quantity", 400);
  }
  const target = orderInventoryTarget(item);
  const amount = Number(delta);
  if (!Number.isInteger(amount) || amount === 0) {
    throw new StaffServiceError("invalid_stock_adjustment", 500);
  }
  if (amount < 0 && target.stock < Math.abs(amount)) {
    throw new Error(`Недостаточно товара на складе: ${target.title}`);
  }
  const updated = amount < 0
    ? db.prepare(`
        UPDATE ${target.table}
        SET stock = stock + ?
        WHERE id = ? AND stock >= ?
      `).run(amount, target.id, Math.abs(amount))
    : db.prepare(`
        UPDATE ${target.table}
        SET stock = stock + ?
        WHERE id = ?
      `).run(amount, target.id);
  if (updated.changes !== 1) {
    throw new StaffServiceError("inventory_conflict", 409);
  }
  return target;
}

function recordStatusChange(orderId, previousStatus, newStatus, note) {
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
    console.warn("[crm] Failed to record status history:", error.message);
  }
}

function getProductTotalStock(productId) {
  const product = db
    .prepare("SELECT stock, warehouse_stock, has_variants FROM products WHERE id = ?")
    .get(productId);
  if (!product) return 0;
  return Number(product.has_variants || 0) === 1
    ? Number(db.prepare(`
        SELECT COALESCE(SUM(stock + warehouse_stock), 0) AS total
        FROM product_variants
        WHERE product_id = ?
      `).get(productId)?.total || 0)
    : Number(product.stock || 0) + Number(product.warehouse_stock || 0);
}

function syncGroupsForProducts(productIds) {
  const ids = Array.from(new Set(productIds.filter(Boolean).map(String)));
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  const groups = db.prepare(`
    SELECT DISTINCT groupId
    FROM products
    WHERE id IN (${placeholders}) AND groupId IS NOT NULL
  `).all(...ids);
  for (const row of groups) {
    try {
      syncGroupParking(row.groupId);
    } catch (error) {
      console.error("[crm] Procurement group parking sync failed:", error);
    }
  }
}

// Helper для расчета средней себестоимости (метод CloudShop)
function calculateAverageCost(productId, newQuantity, newCostPerUnit) {
  const product = db
    .prepare("SELECT cost_price FROM products WHERE id = ?")
    .get(productId);

  if (!product) return newCostPerUnit;

  const currentStock = getProductTotalStock(productId);
  const currentCost = product.cost_price || 0;

  if (currentStock === 0) {
    return newCostPerUnit;
  }

  const totalCost = currentStock * currentCost + newQuantity * newCostPerUnit;
  const totalQuantity = currentStock + newQuantity;

  return roundMoney(totalCost / totalQuantity);
}

function applyDiscounts(totalAmount, discountAmount, discountPercent) {
  let finalAmount = Number(totalAmount || 0) - Number(discountAmount || 0);
  if (finalAmount < 0) {
    finalAmount = 0;
  }

  const percent = Number(discountPercent || 0);
  if (percent > 0) {
    finalAmount = finalAmount * (1 - percent / 100);
  }

  return finalAmount < 0 ? 0 : finalAmount;
}

function buildAdminOrderItemsWithLoyalty({
  items,
  customerId = null,
  promoCodeText = null,
}) {
  let totalAmount = 0;
  let totalCost = 0;

  const preparedItems = items.map((item) => {
    if (!item || !item.product_id) {
      throw new Error("invalid_item");
    }

    const product = db
      .prepare("SELECT * FROM products WHERE id = ?")
      .get(item.product_id);
    if (!product) {
      throw new Error(`Product not found: ${item.product_id}`);
    }

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("invalid_item_quantity");
    }
    const rawManualDiscount = Number(
      item.manual_discount_amount ?? item.discount_amount ?? 0,
    );
    if (!Number.isFinite(rawManualDiscount) || rawManualDiscount < 0) {
      throw new Error("invalid_item_discount");
    }
    const manualDiscountAmount = rawManualDiscount;

    let variantData = null;
    if (item.variant_id) {
      if (Number(product.has_variants || 0) !== 1) {
        throw new Error("variant_not_allowed");
      }
      variantData = db
        .prepare("SELECT * FROM product_variants WHERE id = ?")
        .get(item.variant_id);
      if (!variantData) {
        throw new Error(`Variant not found: ${item.variant_id}`);
      }
      if (String(variantData.product_id) !== String(item.product_id)) {
        throw new Error("variant_product_mismatch");
      }
    } else if (Number(product.has_variants || 0) === 1) {
      throw new Error("variant_required");
    }

    // Цену, названную менеджером, уважаем: он может продать дешевле. Если он её
    // не назвал, подставляем каталожную со скидкой, чтобы касса считала так же,
    // как витрина.
    const basePricePerUnit = resolveCatalogUnitPrice(variantData?.price_rub, product.priceRub);
    const catalogPricePerUnit = applyDiscountToPrice(
      basePricePerUnit,
      resolveDiscountPrice({
        productId: product.id,
        variantId: variantData?.id || null,
        groupId: product.groupId || null,
      }),
    );
    const pricePerUnit = Number(
      item.price_per_unit !== undefined ? item.price_per_unit : catalogPricePerUnit,
    );
    if (!Number.isFinite(pricePerUnit) || pricePerUnit < 0) {
      throw new Error("invalid_item_price");
    }
    const costPerUnit = Number(product.cost_price || 0);

    totalAmount += pricePerUnit * quantity;
    totalCost += costPerUnit * quantity;

    let groupName = item.group_name || null;
    if (!groupName && product.groupId) {
      groupName =
        db.prepare("SELECT name FROM category_groups WHERE id = ?").get(product.groupId)
          ?.name || null;
    }

    let variantName = item.variant_name || null;
    if (item.variant_id && !variantName) {
      variantName = variantData?.name || null;
    }

    const baseProductTitle =
      item.base_product_title || product.title || "Без названия";
    const productTitle = variantName
      ? `${baseProductTitle} - ${variantName}`
      : item.product_title || product.title || "Без названия";

    return {
      id: item.id || generateId("oi"),
      product_id: item.product_id,
      variant_id: item.variant_id || null,
      product_title: productTitle,
      group_name: groupName,
      base_product_id: item.base_product_id || item.product_id || null,
      base_product_title: baseProductTitle,
      variant_name: variantName,
      quantity,
      price_per_unit: pricePerUnit,
      // Снимок описывает каталог, а не решение менеджера: скидку считаем от
      // каталожной цены, даже если продали по своей. Иначе уценка менеджера
      // выглядела бы в отчёте акцией магазина.
      base_price_per_unit: basePricePerUnit,
      catalog_discount_per_unit: roundMoney(basePricePerUnit - catalogPricePerUnit),
      cost_per_unit: costPerUnit,
      manual_discount_amount: manualDiscountAmount,
      loyalty_units_applied: Number(item.loyalty_units_applied || 0),
    };
  });

  const application = buildLoyaltyApplication({
    customerId,
    items: preparedItems,
    promoCodeText,
  });

  return {
    items: application.items.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      variant_id: item.variant_id || null,
      product_title: item.product_title,
      group_name: item.group_name || null,
      base_product_id: item.base_product_id || null,
      base_product_title: item.base_product_title || null,
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
    })),
    totalAmount,
    totalCost,
    totalLoyaltyDiscount: Number(application.total_loyalty_discount || 0),
    application,
  };
}

// =========================
// ORDERS (Заказы)
// =========================
crmOperationsRouter.get(
  "/api/admin/crm/pickup-cells/settings",
  authMiddleware,
  (_req, res) => {
    res.json({ capacity: getPickupCellCapacity() });
  },
);

crmOperationsRouter.patch(
  "/api/admin/crm/pickup-cells/settings",
  authMiddleware,
  (req, res) => {
    try {
      res.json(setPickupCellCapacity(req.body?.capacity));
    } catch (error) {
      const status = error.code === "pickup_cell_capacity_in_use" ? 409 : 400;
      res.status(status).json({
        error: error.code || "invalid_pickup_cell_capacity",
        message: error.message,
        cell_number: error.cell_number || null,
        order_id: error.order_id || null,
      });
    }
  },
);

crmOperationsRouter.get(
  "/api/admin/crm/pickup-cells",
  authMiddleware,
  (_req, res) => {
    try {
      res.json(listPickupCells());
    } catch (error) {
      console.error("[crm] Get pickup cells error:", error);
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

crmOperationsRouter.get("/api/admin/crm/orders/poll-summary", authMiddleware, (req, res) => {
  try {
    const summary = buildCrmOrderPollSummary({ db });
    res.json(summary);
  } catch (error) {
    console.error("[crm] Get orders poll summary error:", error);
    res.status(500).json({ error: "failed", message: error.message });
  }
});

// Канбан: только релевантные заказы (без delivered/completed), полный payload для карточек.
crmOperationsRouter.get("/api/admin/crm/orders/board", authMiddleware, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 200);
    const orders = fetchKanbanBoardOrders({ db, limit });
    res.json({
      orders,
      pagination: {
        page: 1,
        limit,
        total: orders.length,
        totalPages: 1,
      },
    });
  } catch (error) {
    console.error("[crm] Get kanban board orders error:", error);
    res.status(500).json({ error: "failed", message: error.message });
  }
});

// Инкрементальная синхронизация канбана после poll-summary (только изменённые id).
crmOperationsRouter.get("/api/admin/crm/orders/board-sync", authMiddleware, (req, res) => {
  try {
    const since = req.query.since ? String(req.query.since).trim() : null;
    const sync = buildKanbanBoardSync({ db, since: since || null });
    const orders = fetchEnrichedOrdersByIds({ db, orderIds: sync.changedOrderIds });
    res.json({
      ...sync,
      orders,
    });
  } catch (error) {
    console.error("[crm] Get kanban board sync error:", error);
    res.status(500).json({ error: "failed", message: error.message });
  }
});

crmOperationsRouter.get("/api/admin/crm/orders", authMiddleware, (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;

    const whereClauses = [];
    const params = [];

    if (status) {
      whereClauses.push("o.status = ?");
      params.push(status);
    }

    // Показываем только неархивные заказы
    whereClauses.push("o.archived = 0");

    let orderByClause = "o.created_at DESC";
    let orderByParams = [];

    if (search) {
      const searchTerm = String(search).trim();
      if (searchTerm) {
        const searchSpec = buildCrmOrdersSearch({
          searchTerm,
          pickupCellCapacity: getPickupCellCapacity(),
        });
        whereClauses.push(searchSpec.whereClause);
        params.push(...searchSpec.params);
        orderByClause = searchSpec.orderBy;
        orderByParams = searchSpec.orderByParams;
      }
    }

    const whereClause =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const countSql = `SELECT COUNT(*) as count FROM orders o LEFT JOIN customers c ON c.id = o.customer_id ${whereClause}`;
    const total = db.prepare(countSql).get(...params).count;

    const ordersSql = `
      SELECT
        o.*,
        COALESCE(o.telegram_username, c.telegram_username) as telegram_username,
        c.first_name || ' ' || COALESCE(c.last_name, '') as customer_name,
        c.telegram_id as customer_telegram_id,
        c.notes as customer_notes,
        COALESCE(cpa.enabled, 0) as customer_card_payment_enabled,
        COALESCE(pc.has_gift, 0) as promo_has_gift,
        pc.manager_description as promo_manager_description,
        pc.customer_description as promo_customer_description,
        CASE WHEN ue.access_hash IS NOT NULL THEN 1 ELSE 0 END as has_userbot_access
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN card_payment_accounts cpa ON cpa.telegram_id = c.telegram_id
      LEFT JOIN promo_codes pc ON pc.id = o.promo_code_id
      LEFT JOIN userbot_entities ue ON ue.telegram_id = c.telegram_id
      ${whereClause}
      ORDER BY ${orderByClause}
      LIMIT ? OFFSET ?
    `;

    const orders = db
      .prepare(ordersSql)
      .all(...params, ...orderByParams, parseInt(limit), offset);

    const ordersWithItems = enrichOrdersWithRelations(db, orders);

    res.json({
      orders: ordersWithItems,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("[crm] Get orders error:", error);
    res.status(500).json({ error: "failed", message: error.message });
  }
});

// Архивные заказы
crmOperationsRouter.get(
  "/api/admin/crm/orders/archived",
  authMiddleware,
  (req, res) => {
    try {
      const { status, page = 1, limit = 20, search } = req.query;

      const whereClauses = ["o.archived = 1"];
      const params = [];

      if (status) {
        whereClauses.push("o.status = ?");
        params.push(status);
      }

      if (search) {
        const searchTerm = String(search).trim();
        if (searchTerm) {
          whereClauses.push(
            "(CAST(o.order_number AS TEXT) LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.telegram_username LIKE ? OR o.telegram_username LIKE ?)",
          );
          const likePattern = `%${searchTerm}%`;
          params.push(
            likePattern,
            likePattern,
            likePattern,
            likePattern,
            likePattern,
          );
        }
      }

      const whereClause =
        whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const countSql = `SELECT COUNT(*) as count FROM orders o LEFT JOIN customers c ON c.id = o.customer_id ${whereClause}`;
      const total =
        params.length > 0
          ? db.prepare(countSql).get(...params).count
          : db
              .prepare(
                `SELECT COUNT(*) as count FROM orders o WHERE o.archived = 1`,
              )
              .get().count;

      const ordersSql = `
      SELECT 
        o.*,
        COALESCE(o.telegram_username, c.telegram_username) as telegram_username,
        c.first_name || ' ' || COALESCE(c.last_name, '') as customer_name,
        COALESCE(pc.has_gift, 0) as promo_has_gift,
        pc.manager_description as promo_manager_description,
        pc.customer_description as promo_customer_description
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN promo_codes pc ON pc.id = o.promo_code_id
      ${whereClause}
      ORDER BY o.completed_at DESC, o.created_at DESC
      LIMIT ? OFFSET ?
    `;

      const orders =
        params.length > 0
          ? db.prepare(ordersSql).all(...params, parseInt(limit), offset)
          : db
              .prepare(
                `
          SELECT 
            o.*,
            COALESCE(o.telegram_username, c.telegram_username) as telegram_username,
            c.first_name || ' ' || COALESCE(c.last_name, '') as customer_name,
            COALESCE(pc.has_gift, 0) as promo_has_gift,
            pc.manager_description as promo_manager_description,
            pc.customer_description as promo_customer_description
          FROM orders o
          LEFT JOIN customers c ON c.id = o.customer_id
          LEFT JOIN promo_codes pc ON pc.id = o.promo_code_id
          WHERE o.archived = 1
          ORDER BY o.completed_at DESC, o.created_at DESC
          LIMIT ? OFFSET ?
        `,
              )
              .all(parseInt(limit), offset);

      let ordersWithItems = orders;
      if (orders.length > 0) {
        const orderIds = orders.map((order) => order.id);
        const placeholders = orderIds.map(() => "?").join(",");
        const itemsRows = db
          .prepare(
            `
        SELECT oi.*, p.description as product_description 
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id IN (${placeholders})
      `,
          )
          .all(...orderIds);

        const itemsByOrder = itemsRows.reduce((acc, item) => {
          const list = acc.get(item.order_id) || [];
          list.push(item);
          acc.set(item.order_id, list);
          return acc;
        }, new Map());

        ordersWithItems = orders.map((order) => ({
          ...order,
          items: itemsByOrder.get(order.id) || [],
        }));
      }

      res.json({
        orders: ordersWithItems,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error("[crm] Get archived orders error:", error);
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

// Доставленные заказы (включая архивные) - MUST be before /orders/:id
crmOperationsRouter.get(
  "/api/admin/crm/orders/delivered",
  authMiddleware,
  (req, res) => {
    try {
      const { page = 1, limit = 100, search, period = "all" } = req.query;

      const whereClauses = ["o.status IN ('delivered','completed')"];
      const params = [];

      // Серверная фильтрация по периоду
      if (period === "today") {
        const { start, end } = getBusinessPeriodRange("today");
        whereClauses.push(
          "datetime(COALESCE(o.completed_at, o.paid_at, o.updated_at, o.created_at)) >= ? AND datetime(COALESCE(o.completed_at, o.paid_at, o.updated_at, o.created_at)) < ?",
        );
        params.push(toSqliteUtcString(start), toSqliteUtcString(end));
      } else if (period === "week") {
        whereClauses.push("COALESCE(o.completed_at, o.paid_at, o.updated_at, o.created_at) >= DATETIME('now', '-7 days')");
      } else if (period === "month") {
        whereClauses.push("COALESCE(o.completed_at, o.paid_at, o.updated_at, o.created_at) >= DATETIME('now', '-30 days')");
      }

      if (search) {
        const searchTerm = String(search).trim();
        if (searchTerm) {
          whereClauses.push(
            "(CAST(o.order_number AS TEXT) LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.telegram_username LIKE ? OR o.telegram_username LIKE ?)",
          );
          const likePattern = `%${searchTerm}%`;
          params.push(likePattern, likePattern, likePattern, likePattern, likePattern);
        }
      }

      const whereClause = `WHERE ${whereClauses.join(" AND ")}`;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const countSql = `SELECT COUNT(*) as count FROM orders o LEFT JOIN customers c ON c.id = o.customer_id ${whereClause}`;
      const total = db.prepare(countSql).get(...params).count;

      const ordersSql = `
        SELECT
          o.*,
          COALESCE(o.telegram_username, c.telegram_username) as telegram_username,
          c.first_name || ' ' || COALESCE(c.last_name, '') as customer_name,
          COALESCE(pc.has_gift, 0) as promo_has_gift,
          pc.manager_description as promo_manager_description,
          pc.customer_description as promo_customer_description
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN promo_codes pc ON pc.id = o.promo_code_id
        ${whereClause}
        ORDER BY COALESCE(o.completed_at, o.paid_at, o.updated_at, o.created_at) DESC
        LIMIT ? OFFSET ?
      `;

      const orders = db.prepare(ordersSql).all(...params, parseInt(limit), offset);

      // Считаем статистику по ВСЕМ заказам периода (не только по странице)
      const statsSql = `
        SELECT
          COUNT(*) as totalCount,
          COALESCE(SUM(CASE WHEN o.discount_amount > 0 THEN o.total_amount - o.discount_amount ELSE o.total_amount END), 0) as totalAmount,
          SUM(CASE WHEN o.delivery_type = 'delivery' THEN 1 ELSE 0 END) as deliveryCount,
          COALESCE(SUM(CASE WHEN o.delivery_type = 'delivery' THEN (CASE WHEN o.discount_amount > 0 THEN o.total_amount - o.discount_amount ELSE o.total_amount END) ELSE 0 END), 0) as deliveryAmount,
          SUM(CASE WHEN o.delivery_type = 'pickup' OR o.delivery_type IS NULL THEN 1 ELSE 0 END) as pickupCount,
          COALESCE(SUM(CASE WHEN o.delivery_type = 'pickup' OR o.delivery_type IS NULL THEN (CASE WHEN o.discount_amount > 0 THEN o.total_amount - o.discount_amount ELSE o.total_amount END) ELSE 0 END), 0) as pickupAmount
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        ${whereClause}
      `;
      const stats = db.prepare(statsSql).get(...params);

      let ordersWithItems = orders;
      if (orders.length > 0) {
        const orderIds = orders.map((order) => order.id);
        const placeholders = orderIds.map(() => "?").join(",");
        const itemsRows = db
          .prepare(
            `SELECT oi.*, p.description as product_description
            FROM order_items oi
            LEFT JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id IN (${placeholders})`,
          )
          .all(...orderIds);

        const itemsByOrder = itemsRows.reduce((acc, item) => {
          const list = acc.get(item.order_id) || [];
          list.push(item);
          acc.set(item.order_id, list);
          return acc;
        }, new Map());

        ordersWithItems = orders.map((order) => ({
          ...order,
          items: itemsByOrder.get(order.id) || [],
        }));
      }

      res.json({
        orders: ordersWithItems,
        stats,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error("[crm] Fetch delivered orders error:", error);
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

crmOperationsRouter.get(
  "/api/admin/crm/orders/:id",
  authMiddleware,
  (req, res) => {
    try {
      const { id } = req.params;

      const order = db
        .prepare(
          `
      SELECT 
        o.*,
        COALESCE(o.telegram_username, c.telegram_username) as telegram_username,
        c.first_name,
        c.last_name,
        c.phone,
        COALESCE(pc.has_gift, 0) as promo_has_gift,
        pc.manager_description as promo_manager_description,
        pc.customer_description as promo_customer_description
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN promo_codes pc ON pc.id = o.promo_code_id
      WHERE o.id = ?
    `,
        )
        .get(id);

      if (!order) {
        return res.status(404).json({ error: "not_found" });
      }

      const items = db
        .prepare(
          `
      SELECT oi.*, p.description as product_description 
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `,
        )
        .all(id);

      const pickupCell = getActivePickupCellAssignment(id);
      res.json({
        ...order,
        pickup_cell_number: pickupCell?.cell_number ?? null,
        pickup_cell_assignment_id: pickupCell?.id ?? null,
        items,
      });
    } catch (error) {
      console.error("[crm] Get order error:", error);
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

// Создание заказа (свободная продажа или из корзины)
crmOperationsRouter.post(
  "/api/admin/crm/orders",
  authMiddleware,
  requireOrderShift,
  (req, res) => {
    try {
      const {
        customer_id,
        delivery_type = "pickup",
        delivery_address,
        items,
        discount_amount = 0,
        discount_percent = 0,
        notes,
      } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "items_required" });
      }

      const trackingEnabled = isStaffTrackingEnabled();
      const idempotencyKey = trackingEnabled
        ? requestIdempotencyKey(req)
        : null;
      if (trackingEnabled && !idempotencyKey) {
        throw new StaffServiceError("idempotency_key_required", 400);
      }
      const idempotencyOperation = staffOperationName("order.create", req.body);
      const earlyReplay = trackingEnabled && idempotencyKey
        ? getStaffOperationReplay({
            key: idempotencyKey,
            operation: idempotencyOperation,
          })
        : null;
      if (earlyReplay) {
        const replayPayload = getCreatedOrderPayload(earlyReplay.entity_id);
        if (!replayPayload) {
          throw new StaffServiceError("idempotency_entity_missing", 409);
        }
        return res.json(replayPayload);
      }

      let orderId = generateId("order");
      let orderNumber = null;

      // Рассчитываем суммы
      let totalAmount = 0;
      let totalCost = 0;
      let itemsSubtotal = 0;

      let orderItems = items.map((item) => {
        if (!item || !item.product_id) {
          throw new Error("invalid_item");
        }
        const product = db
          .prepare("SELECT * FROM products WHERE id = ?")
          .get(item.product_id);
        if (!product) {
          throw new Error(`Product not found: ${item.product_id}`);
        }
        const quantity = Number(item.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0) {
          throw new Error("invalid_item_quantity");
        }

        // Проверяем наличие на складе и получаем данные варианта
        // Для вариантов - проверяем сток варианта, для обычных товаров - сток продукта
        let variantData = null;
        if (item.variant_id) {
          if (Number(product.has_variants || 0) !== 1) {
            throw new Error("variant_not_allowed");
          }
          variantData = db
            .prepare("SELECT * FROM product_variants WHERE id = ?")
            .get(item.variant_id);
          if (!variantData) {
            throw new Error(`Variant not found: ${item.variant_id}`);
          }
          if (
            String(variantData.product_id) !== String(item.product_id)
          ) {
            throw new Error("variant_product_mismatch");
          }
          if (variantData.stock < quantity) {
            throw new Error(
              `Insufficient stock for variant ${item.variant_id}`,
            );
          }
        } else if (Number(product.has_variants || 0) === 1) {
          throw new Error("variant_required");
        } else if (product.stock < quantity) {
          throw new Error(`Insufficient stock for ${product.title}`);
        }

        // Для товаров с вариантами: base_product = сам product, variant_name = имя варианта
        let baseProductId = null;
        let baseProductTitle = null;
        let variantName = null;

        if (item.variant_id && variantData) {
          // variant_id указан — product_id это базовый продукт
          baseProductId = item.product_id;
          baseProductTitle = product.title || "Без названия";
          variantName = variantData.name || null;
        }

        const pricePerUnit = item.price_per_unit || product.priceRub;
        const costPerUnit = product.cost_price || 0;
        const itemDiscount = item.discount_amount || 0;
        const totalPrice = pricePerUnit * quantity - itemDiscount;
        const totalItemCost = costPerUnit * quantity;

        totalAmount += pricePerUnit * quantity;
        itemsSubtotal += totalPrice;
        totalCost += totalItemCost;

        // Получаем group_name для отображения линейки
        let groupName = null;
        if (product.groupId) {
          const group = db
            .prepare("SELECT name FROM category_groups WHERE id = ?")
            .get(product.groupId);
          if (group) {
            groupName = group.name;
          }
        }

        // product_title включает имя варианта (цвет) для корректного отображения
        const productTitle = variantName
          ? `${product.title} - ${variantName}`
          : product.title || "Без названия";

        return {
          id: generateId("oi"),
          product_id: item.product_id,
          variant_id: item.variant_id || null,
          product_title: productTitle,
          variant_name: variantName,
          group_name: groupName,
          base_product_id: baseProductId,
          base_product_title: baseProductTitle,
          quantity,
          price_per_unit: pricePerUnit,
          cost_per_unit: costPerUnit,
          discount_amount: itemDiscount,
          total_price: totalPrice,
          total_cost: totalItemCost,
        };
      });

      // Применяем скидки
      const orderBuild = buildAdminOrderItemsWithLoyalty({
        items,
        customerId: customer_id || null,
      });
      orderItems = orderBuild.items;
      totalAmount = Number(orderBuild.totalAmount || 0);
      totalCost = Number(orderBuild.totalCost || 0);
      itemsSubtotal = orderItems.reduce(
        (sum, item) => sum + Number(item.total_price || 0),
        0,
      );

      const finalAmount = applyDiscounts(
        itemsSubtotal,
        discount_amount,
        discount_percent,
      );
      const profit = roundMoney(finalAmount - totalCost);

      // Создаем заказ в транзакции
      const tx = db.transaction(() => {
        const shiftActor = recheckOrderShift(req);
        if (trackingEnabled && idempotencyKey) {
          const replay = getStaffOperationReplay({
            key: idempotencyKey,
            operation: idempotencyOperation,
          });
          if (replay) {
            return { id: replay.entity_id, replayed: true };
          }
        }
        orderNumber = getNextNumber("orders", "order_number");
        // Вставляем заказ
        db.prepare(
          `
        INSERT INTO orders (
          id, order_number, customer_id, employee_id, status, delivery_type, delivery_address,
          total_amount, discount_amount, discount_percent, final_amount, profit, notes
        ) VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        ).run(
          orderId,
          orderNumber,
          customer_id || null,
          shiftActor?.employeeId || null,
          delivery_type,
          delivery_address || null,
          totalAmount,
          discount_amount,
          discount_percent,
          finalAmount,
          profit,
          notes || null,
        );

        attachFirstOrderToReferral(customer_id, orderId);

        // Вставляем позиции
        const itemStmt = db.prepare(`
        INSERT INTO order_items (
          id, order_id, product_id, variant_id, product_title, group_name, base_product_id, base_product_title, variant_name, quantity,
          price_per_unit, base_price_per_unit, catalog_discount_per_unit,
          cost_per_unit, manual_discount_amount, loyalty_discount_amount, loyalty_units_applied, discount_amount, total_price, total_cost
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

        for (const item of orderItems) {
          itemStmt.run(
            item.id,
            orderId,
            item.product_id,
            item.variant_id,
            item.product_title,
            item.group_name,
            item.base_product_id,
            item.base_product_title,
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

          // ВАЖНО: НЕ списываем сток при создании заказа!
          // Сток списывается только при переходе в статус "Собран" (in_progress)
          // Это защита от абуза - конкуренты могут создавать фейковые заказы
        }

        // Обновляем статистику клиента
        applyOrderLoyaltyReservations({
          customerId: customer_id || null,
          orderId,
          application: orderBuild.application,
        });

        if (customer_id) {
          db.prepare(
            `
          UPDATE customers 
          SET total_orders = total_orders + 1,
              total_spent = total_spent + ?,
              last_order_at = DATETIME('now'),
              updated_at = DATETIME('now')
          WHERE id = ?
        `,
          ).run(finalAmount, customer_id);
        }

        assignLowestAvailablePickupCell(orderId);

        if (trackingEnabled && idempotencyKey) {
          storeStaffOperationResult({
            key: idempotencyKey,
            operation: idempotencyOperation,
            entityType: "order",
            entityId: orderId,
            response: { id: orderId },
          });
        }

        return { id: orderId, replayed: false };
      });

      const createResult = tx.immediate();
      orderId = createResult.id;

      const createdPayload = getCreatedOrderPayload(orderId);
      if (!createdPayload) {
        throw new StaffServiceError("idempotency_entity_missing", 409);
      }
      if (!createResult.replayed) {
        recordStatusChange(
          orderId,
          null,
          createdPayload.status,
          "Создан заказ",
        );
      }

      res.json(createdPayload);

      if (customer_id && !createResult.replayed) {
        setImmediate(() => {
          void autoNotifyOrderAcceptedAfterRecipientWarmup({ orderId }).catch((notifyErr) => {
            console.error("[crm] deferred order-accepted notify error:", notifyErr);
          });
        });
      }
    } catch (error) {
      console.error("[crm] Create order error:", error);
      if (isStaffServiceError(error)) {
        return sendStaffServiceError(res, error);
      }
      if (error.code === "pickup_cells_full") {
        return res.status(409).json({
          error: "pickup_cells_full",
          message: "Свободных ячеек нет. Освободите место и повторите.",
        });
      }
      const clientErrors = new Set([
        "items_required",
        "invalid_item",
        "invalid_item_quantity",
        "invalid_item_discount",
        "invalid_item_price",
        "variant_not_allowed",
        "variant_required",
        "variant_product_mismatch",
        "promo_and_loyalty_conflict",
        "loyalty_category_not_available",
        "loyalty_balance_not_enough",
        "loyalty_category_limit_exceeded",
      ]);
      const isClientError =
        clientErrors.has(error.message) ||
        error.message.startsWith("Insufficient stock") ||
        error.message.startsWith("Product not found") ||
        error.message.startsWith("Variant not found");
      if (isClientError) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

// Обновление заказа (редактирование, статус)
crmOperationsRouter.patch(
  "/api/admin/crm/orders/:id",
  authMiddleware,
  requireOrderShift,
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        status,
        delivery_address,
        notes,
        items,
        discount_amount,
        discount_percent,
        payment_type,
        payment_account_id,
        paid_amount,
        payment_notes,
        reactivate,
      } = req.body || {};

      if (
        payment_type !== undefined &&
        payment_type !== null &&
        payment_type !== "cash"
      ) {
        return res.status(400).json({ error: "invalid_payment_type" });
      }

      const allowedStatuses = [
        "new",
        "in_progress",
        "completed",
        "delivered",
        "cancelled",
      ];
      if (status !== undefined && !allowedStatuses.includes(status)) {
        return res.status(400).json({ error: "invalid_status" });
      }
      let order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
      if (!order) {
        return res.status(404).json({ error: "not_found" });
      }

      const shouldUpdateDiscount =
        discount_amount !== undefined || discount_percent !== undefined;
      const updatedDiscountAmount =
        discount_amount !== undefined
          ? Number(discount_amount)
          : Number(order.discount_amount || 0);
      const updatedDiscountPercent =
        discount_percent !== undefined
          ? Number(discount_percent)
          : Number(order.discount_percent || 0);

      let desiredStatus = order.status;
      if (reactivate && order.status === "cancelled") {
        // После отмены заказ собирается заново: старое место уже могло быть занято.
        desiredStatus = "new";
      }
      if (status !== undefined) {
        desiredStatus = status;
      }

      let statusChangeNote = null;
      const hasItemsPayload = Array.isArray(items);
      const workingStatuses = ["in_progress", "completed", "delivered"];

      // Захват «реального» статуса до транзакции для anti-double-notify (см.
      // ниже). Заполняется первой инструкцией внутри tx(), чтобы значение
      // отражало состояние БД на момент после получения write-лока, а не
      // снимок из строки 904 (он мог устареть, если параллельный PATCH
      // успел зафиксироваться).
      let statusAtTxStart = order.status;

      const tx = db.transaction(() => {
        const shiftActor = recheckOrderShift(req);
        // Перечитываем статус под write-лок'ом транзакции. better-sqlite3
        // в WAL-режиме выполняет db.transaction() как IMMEDIATE — write-лок
        // берётся при первой записи, но мы хотим дополнительно убедиться,
        // что дальнейшие проверки `order.status` соответствуют реальности
        // на момент старта транзакции. Это закрывает race window:
        //
        //   PATCH A:  SELECT order (status='new') ... begin tx ... commit
        //   PATCH B:  SELECT order (status='new', стейл!) ... begin tx (после A)
        //
        // Без этого re-read обе транзакции считали бы, что статус был 'new',
        // и обе вызывали бы auto-notify, отправляя клиенту дубль.
        const fresh = db
          .prepare("SELECT * FROM orders WHERE id = ?")
          .get(id);
        if (fresh) {
          order = fresh;
          statusAtTxStart = fresh.status;
          desiredStatus = fresh.status;
          if (reactivate && fresh.status === "cancelled") {
            desiredStatus = "new";
          }
          if (status !== undefined) {
            desiredStatus = status;
          }
        }

        // Выдача идёт только через свой эндпоинт, иначе её некому записать.
        if (
          isStaffTrackingEnabled()
          && ["completed", "delivered"].includes(desiredStatus)
          && desiredStatus !== statusAtTxStart
        ) {
          throw new StaffServiceError("issue_endpoint_required", 409);
        }

        if (
          desiredStatus === "in_progress" &&
          statusAtTxStart !== "in_progress"
        ) {
          assignLowestAvailablePickupCell(id);
        }
        if (
          reactivate &&
          desiredStatus === "new" &&
          statusAtTxStart === "cancelled"
        ) {
          assignLowestAvailablePickupCell(id);
        }

        const updateFields = [];
        const updateValues = [];

        if (
          shiftActor
          && desiredStatus === "in_progress"
          && statusAtTxStart !== "in_progress"
        ) {
          updateFields.push("assembled_by_employee_id = ?");
          updateValues.push(shiftActor.employeeId);
          updateFields.push("assembled_at = ?");
          updateValues.push(new Date().toISOString());
        }

        if (delivery_address !== undefined) {
          updateFields.push("delivery_address = ?");
          updateValues.push(delivery_address || null);
        }
        if (notes !== undefined) {
          updateFields.push("notes = ?");
          updateValues.push(notes || null);
        }
        if (payment_type !== undefined) {
          updateFields.push("payment_type = ?");
          updateValues.push(payment_type || null);
          if (
            payment_type === "cash" &&
            !["delivered", "cancelled"].includes(order.status) &&
            Number(order.paid_amount || 0) <= 0
          ) {
            // Explicit cash selection releases the card reservation before
            // the order is updated, so it immediately becomes available again.
            reverseCardOrder(id);
            updateFields.push("card_amount_minor = 0");
            updateFields.push(
              "cash_due_minor = CAST(ROUND(COALESCE(final_amount, total_amount, 0) * 100) AS INTEGER)",
            );
          }
        }
        if (payment_account_id !== undefined) {
          updateFields.push("payment_account_id = ?");
          updateValues.push(payment_account_id || null);
        }
        if (payment_notes !== undefined) {
          updateFields.push("payment_notes = ?");
          updateValues.push(payment_notes || null);
        }
        if (paid_amount !== undefined) {
          const parsedPaid = Number(paid_amount) || 0;
          if (parsedPaid < 0) {
            throw new Error("invalid_paid_amount");
          }
          if (parsedPaid === 0) {
            updateFields.push("paid_amount = NULL");
            updateFields.push("paid_at = NULL");
          } else {
            updateFields.push("paid_amount = ?");
            updateValues.push(parsedPaid);
            updateFields.push("paid_at = DATETIME('now')");
          }
        }

        if (reactivate || status !== undefined) {
          updateFields.push("status = ?");
          updateValues.push(desiredStatus);

          // СПИСАНИЕ СТОКА: При переходе в "рабочий" статус (in_progress, completed, delivered)
          // если сток еще не был списан
          if (
            workingStatuses.includes(desiredStatus) &&
            !order.stock_deducted &&
            !hasItemsPayload
          ) {
            const orderItems = db
              .prepare("SELECT * FROM order_items WHERE order_id = ?")
              .all(id);

            // Сначала проверяем, что товар/вариант всё ещё существует и
            // относится к нужному товару. Затем списываем условным UPDATE.
            for (const item of orderItems) {
              const target = orderInventoryTarget(item);
              if (target.stock < Number(item.quantity || 0)) {
                throw new Error(
                  `Недостаточно товара на складе: ${target.title}`,
                );
              }
            }

            // Теперь списываем сток
            for (const item of orderItems) {
              adjustOrderItemStock(item, -Number(item.quantity));
            }
            updateFields.push("stock_deducted = 1");
          }

          if (
            !workingStatuses.includes(desiredStatus) &&
            order.stock_deducted &&
            desiredStatus !== "cancelled" &&
            !hasItemsPayload
          ) {
            const orderItems = db
              .prepare("SELECT * FROM order_items WHERE order_id = ?")
              .all(id);
            for (const item of orderItems) {
              adjustOrderItemStock(item, Number(item.quantity));
            }
            updateFields.push("stock_deducted = 0");
          }

          if (desiredStatus === "cancelled" && order.status !== "cancelled") {
            reverseCardOrder(id);
            updateFields.push("previous_status = ?");
            updateValues.push(order.status);
            releaseOrderLoyaltyReservations(id);
            updateFields.push("cancelled_at = DATETIME('now')");
            statusChangeNote = "Заказ отменён";

            // ВОЗВРАТ СТОКА: При отмене заказа, если сток был списан
            if (order.stock_deducted && !hasItemsPayload) {
              const orderItems = db
                .prepare("SELECT * FROM order_items WHERE order_id = ?")
                .all(id);
              for (const item of orderItems) {
                adjustOrderItemStock(item, Number(item.quantity));
              }
              updateFields.push("stock_deducted = 0");
            }

            // ОТКАТ ПРОМОКОДА: При отмене заказа возвращаем использование промокода
            if (order.promo_code_id) {
              releasePromoUsageForOrder(id);
            }
          } else if (desiredStatus !== "cancelled") {
            updateFields.push("previous_status = NULL");
            updateFields.push("cancelled_at = NULL");
            if (order.status === "cancelled") {
              statusChangeNote = "Заказ восстановлен";
            }
          }

          if (["completed", "delivered"].includes(desiredStatus)) {
            updateFields.push("completed_at = DATETIME('now')");
          } else if (
            order.status === "completed" ||
            order.status === "delivered"
          ) {
            updateFields.push("completed_at = NULL");
          }
        }

        if (updateFields.length > 0) {
          updateFields.push("updated_at = DATETIME('now')");
          updateValues.push(id);
          db.prepare(
            `UPDATE orders SET ${updateFields.join(", ")} WHERE id = ?`,
          ).run(...updateValues);
        }

        if (Array.isArray(items)) {
          // Проверяем, изменились ли позиции (product_id, variant_id, quantity)
          // Если позиции не изменились, не нужно возвращать и списывать сток заново
          const oldItems = db
            .prepare(`
              SELECT product_id, variant_id, quantity, base_price_per_unit, catalog_discount_per_unit
              FROM order_items WHERE order_id = ? ORDER BY product_id, variant_id
            `)
            .all(id);

          // Снимок каталожной цены при правке заказа не пересчитываем.
          // Менеджер сохраняет карточку и ради одной смены статуса, а форма
          // всегда шлёт цену: пересчитай мы снимок после конца акции, скидка
          // магазина в отчёте превратилась бы в уценку менеджера.
          const oldSnapshots = new Map(
            oldItems.map((old) => [
              `${old.product_id}::${old.variant_id || ""}`,
              old,
            ]),
          );
          
          const newItemsSorted = [...items]
            .map((item) => ({
              product_id: item.product_id,
              variant_id: item.variant_id || null,
              quantity: Number(item.quantity || 0),
            }))
            .sort((a, b) => {
              if (a.product_id !== b.product_id) return a.product_id.localeCompare(b.product_id);
              return (a.variant_id || '').localeCompare(b.variant_id || '');
            });
          
          const oldItemsSorted = oldItems
            .map((item) => ({
              product_id: item.product_id,
              variant_id: item.variant_id || null,
              quantity: Number(item.quantity || 0),
            }))
            .sort((a, b) => {
              if (a.product_id !== b.product_id) return a.product_id.localeCompare(b.product_id);
              return (a.variant_id || '').localeCompare(b.variant_id || '');
            });
          
          const itemsChanged =
            newItemsSorted.length !== oldItemsSorted.length ||
            newItemsSorted.some((newItem, idx) => {
              const oldItem = oldItemsSorted[idx];
              return (
                !oldItem ||
                newItem.product_id !== oldItem.product_id ||
                newItem.variant_id !== oldItem.variant_id ||
                newItem.quantity !== oldItem.quantity
              );
            });
          
          // Возвращаем старый сток ТОЛЬКО если позиции изменились И сток был ранее списан
          // Сохраняем информацию о старых позициях для правильной проверки стока
          const oldItemsMap = new Map();
          const shouldRestoreDeductedStock =
            order.stock_deducted &&
            (itemsChanged || !workingStatuses.includes(desiredStatus));
          if (shouldRestoreDeductedStock) {
            for (const oldItem of oldItems) {
              // Сохраняем количество для каждого варианта/товара
              const key = oldItem.variant_id || oldItem.product_id;
              oldItemsMap.set(key, oldItem.quantity);
              adjustOrderItemStock(oldItem, Number(oldItem.quantity));
            }
          }

          releaseOrderLoyaltyReservations(id);
          const orderBuild = buildAdminOrderItemsWithLoyalty({
            items,
            customerId: order.customer_id || null,
            promoCodeText: order.promo_code_text || null,
          });
          const rebuiltItems = orderBuild.items;
          const shouldKeepExistingDeduction =
            workingStatuses.includes(desiredStatus) &&
            order.stock_deducted &&
            !itemsChanged;
          const shouldDeductUpdatedItems =
            workingStatuses.includes(desiredStatus) &&
            (!order.stock_deducted || itemsChanged);
          const nextStockDeducted =
            shouldKeepExistingDeduction || shouldDeductUpdatedItems ? 1 : 0;

          db.prepare("DELETE FROM order_items WHERE order_id = ?").run(id);

          let totalAmount = Number(orderBuild.totalAmount || 0);
          let totalCost = Number(orderBuild.totalCost || 0);
          let itemsSubtotal = 0;

          const itemStmt = db.prepare(`
          INSERT INTO order_items (
            id, order_id, product_id, variant_id, product_title, group_name, base_product_id, base_product_title, variant_name, quantity,
            price_per_unit, base_price_per_unit, catalog_discount_per_unit,
            cost_per_unit, manual_discount_amount, loyalty_discount_amount, loyalty_units_applied, discount_amount, total_price, total_cost
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

          for (const item of rebuiltItems) {
            if (!item || !item.product_id) {
              throw new Error("invalid_item");
            }

            const product = db
              .prepare("SELECT * FROM products WHERE id = ?")
              .get(item.product_id);
            if (!product) {
              throw new Error(`Product not found: ${item.product_id}`);
            }

            const quantity = Number(item.quantity || 0);
            if (!Number.isInteger(quantity) || quantity <= 0) {
              throw new Error("invalid_item_quantity");
            }
            const inventoryTarget = orderInventoryTarget({
              ...item,
              quantity,
            });

            const pricePerUnit = Number(
              item.price_per_unit !== undefined
                ? item.price_per_unit
                : product.priceRub,
            );
            // У позиции, которая в заказе уже была, снимок остаётся прежним.
            // Новая позиция получает свежий, посчитанный из каталога.
            const oldSnapshot = oldSnapshots.get(
              `${item.product_id}::${item.variant_id || ""}`,
            );
            const basePricePerUnit = oldSnapshot?.base_price_per_unit != null
              ? Number(oldSnapshot.base_price_per_unit)
              : Number(item.base_price_per_unit || 0);
            const catalogDiscountPerUnit = oldSnapshot?.base_price_per_unit != null
              ? Number(oldSnapshot.catalog_discount_per_unit || 0)
              : Number(item.catalog_discount_per_unit || 0);
            const costPerUnit = Number(product.cost_price || 0);
            const itemDiscount = Number(item.discount_amount || 0);

            // Проверяем сток ТОЛЬКО если заказ уже был собран (stock_deducted = 1) И позиции изменились
            // Если stock_deducted = 0, сток не будет списываться, проверка не нужна
            // Если позиции не изменились, сток уже списан, проверка не нужна
            if (shouldDeductUpdatedItems) {
              if (inventoryTarget.stock < quantity) {
                throw new Error(
                  `Insufficient stock for ${inventoryTarget.title}`,
                );
              }
            }

            const totalPrice = pricePerUnit * quantity - itemDiscount;
            const totalItemCost = costPerUnit * quantity;

            totalAmount += pricePerUnit * quantity;
            itemsSubtotal += totalPrice;
            totalCost += totalItemCost;

            let groupName = item.group_name || null;
            if (!groupName && product.groupId) {
              const group = db
                .prepare("SELECT name FROM category_groups WHERE id = ?")
                .get(product.groupId);
              if (group) {
                groupName = group.name;
              }
            }

            // Получаем variant_name из запроса или из БД, если variant_id есть
            let variantName = item.variant_name || null;
            if (item.variant_id && !variantName) {
              const variant = db
                .prepare("SELECT name FROM product_variants WHERE id = ?")
                .get(item.variant_id);
              if (variant) {
                variantName = variant.name;
              }
            }

            itemStmt.run(
              item.id || generateId("oi"),
              id,
              item.product_id,
              item.variant_id || null,
              product.title || "Без названия",
              item.group_name || groupName,
              item.base_product_id || null,
              item.base_product_title || null,
              item.variant_name || variantName,
              quantity,
              pricePerUnit,
              basePricePerUnit,
              catalogDiscountPerUnit,
              costPerUnit,
              Number(item.manual_discount_amount || 0),
              Number(item.loyalty_discount_amount || 0),
              Number(item.loyalty_units_applied || 0),
              itemDiscount,
              totalPrice,
              totalItemCost,
            );

            // Списываем сток ТОЛЬКО если заказ уже был собран (stock_deducted = 1) И позиции изменились
            // Если позиции не изменились, сток уже списан, не нужно списывать заново
            if (shouldDeductUpdatedItems) {
              adjustOrderItemStock(
                { ...item, quantity },
                -quantity,
              );
            }
          }

          applyOrderLoyaltyReservations({
            customerId: order.customer_id || null,
            orderId: id,
            application: orderBuild.application,
          });
          totalAmount = Number(orderBuild.totalAmount || 0);
          totalCost = Number(orderBuild.totalCost || 0);

          const finalAmount = applyDiscounts(
            itemsSubtotal,
            updatedDiscountAmount,
            updatedDiscountPercent,
          );
          const profit = roundMoney(finalAmount - totalCost);

          db.prepare(
            `
          UPDATE orders
          SET total_amount = ?, final_amount = ?, profit = ?,
              discount_amount = ?, discount_percent = ?, updated_at = DATETIME('now')
          WHERE id = ?
        `,
          ).run(
            totalAmount,
            finalAmount,
            profit,
            updatedDiscountAmount,
            updatedDiscountPercent,
            id,
          );
          db.prepare(
            `UPDATE orders SET stock_deducted = ?, updated_at = DATETIME('now') WHERE id = ?`,
          ).run(nextStockDeducted, id);
        } else if (shouldUpdateDiscount) {
          const totals = db
            .prepare(
              `
              SELECT 
                COALESCE(SUM(total_price), 0) as items_subtotal,
                COALESCE(SUM(total_cost), 0) as total_cost
              FROM order_items
              WHERE order_id = ?
            `,
            )
            .get(id);
          const itemsSubtotal = Number(totals?.items_subtotal || 0);
          const totalCost = Number(totals?.total_cost || 0);
          const finalAmount = applyDiscounts(
            itemsSubtotal,
            updatedDiscountAmount,
            updatedDiscountPercent,
          );
          const profit = roundMoney(finalAmount - totalCost);

          db.prepare(
            `
          UPDATE orders
          SET discount_amount = ?, discount_percent = ?, final_amount = ?, profit = ?, updated_at = DATETIME('now')
          WHERE id = ?
        `,
          ).run(
            updatedDiscountAmount,
            updatedDiscountPercent,
            finalAmount,
            profit,
            id,
          );
        }

        if (order.promo_code_id) {
          const updatedPromoOrder = db
            .prepare("SELECT discount_amount, completed_at FROM orders WHERE id = ?")
            .get(id);

          if (desiredStatus === "cancelled") {
            releasePromoUsageForOrder(id);
          } else if (["completed", "delivered"].includes(desiredStatus)) {
            consumePromoUsageForOrder({
              orderId: id,
              promoCodeId: order.promo_code_id,
              customerId: order.customer_id || null,
              discountApplied: Number(updatedPromoOrder?.discount_amount || 0),
              consumedAt: updatedPromoOrder?.completed_at || new Date().toISOString(),
              idFactory: () => generateId("pu"),
            });
          } else if (
            order.status === "cancelled" ||
            ["completed", "delivered"].includes(order.status)
          ) {
            reservePromoUsageForOrder({
              promoCodeId: order.promo_code_id,
              orderId: id,
              customerId: order.customer_id || null,
              discountApplied: Number(updatedPromoOrder?.discount_amount || 0),
              idFactory: () => generateId("pu"),
            });
          }
        }

        if (desiredStatus !== statusAtTxStart) {
          if (["delivered", "completed"].includes(desiredStatus)) {
            releaseActivePickupCell(id, "issued");
          } else if (desiredStatus === "cancelled") {
            releaseActivePickupCell(id, "cancelled_by_manager");
          } else if (desiredStatus === "new" && !reactivate) {
            if (statusAtTxStart === "in_progress") {
              restartPickupCellAssignmentCycle(id, "returned_to_new");
            } else {
              releaseActivePickupCell(id, "returned_to_new");
            }
          }
        }

        if (desiredStatus === "delivered") {
          awardLoyaltyForOrder(id);
          try {
            accrueWheelSpinsForOrder(id);
          } catch (wheelError) {
            console.error("[wheel] accrual on PATCH /orders/:id failed", wheelError);
          }
        } else if (desiredStatus === "completed") {
          // `completed` is a CRM-internal transitional state. Loyalty
          // historically also fired here for tier upgrades on
          // not-yet-issued orders, but wheel accrual must wait for the
          // physical `delivered` step (see docs/wheel-architecture.md
          // and S10 audit note).
          awardLoyaltyForOrder(id);
        }
      });

      tx.immediate();

      const updated = db
        .prepare(
          `
          SELECT
            o.*,
            COALESCE(o.telegram_username, c.telegram_username) as telegram_username,
            c.first_name,
            c.last_name,
            c.phone,
            COALESCE(pc.has_gift, 0) as promo_has_gift,
            pc.manager_description as promo_manager_description,
            pc.customer_description as promo_customer_description
          FROM orders o
          LEFT JOIN customers c ON c.id = o.customer_id
          LEFT JOIN promo_codes pc ON pc.id = o.promo_code_id
          WHERE o.id = ?
        `,
        )
        .get(id);
      const updatedItems = db
        .prepare(`
          SELECT oi.*, p.description as product_description 
          FROM order_items oi
          LEFT JOIN products p ON oi.product_id = p.id
          WHERE oi.order_id = ?
        `)
        .all(id);

      // Используем statusAtTxStart (свежее SELECT под write-лок'ом транзакции),
      // а не order.status (снимок до tx). См. комментарий внутри tx().
      if (updated.status !== statusAtTxStart) {
        recordStatusChange(
          id,
          statusAtTxStart,
          updated.status,
          statusChangeNote || "Изменение статуса",
        );
      }

      // Авто-уведомление клиенту при смене статуса (Костя 8.05.2026: «нужно
      // нажали собрано → ему отослалось»). Любая ошибка отправки не должна
      // ломать PATCH — фронт показывает плашку по полю auto_notification.
      //
      // Anti-double-notify: сравниваем updated.status со statusAtTxStart
      // (статус под write-лок'ом транзакции), а не с order.status (снимок
      // ДО tx). Это гарантирует, что при двух параллельных PATCH одного
      // заказа auto-notify сработает только у того запроса, чей tx реально
      // выполнил переход. Второй увидит updated.status === statusAtTxStart
      // и пропустит отправку — клиенту не уйдёт дубль.
      //
      // Race window (acknowledged): tx() со сменой статуса уже зафиксирован
      // выше, recordStatusChange() — отдельная вставка после tx(). Если
      // процесс упадёт здесь, в БД может оказаться new статус без записи
      // в bot_message_log, а у клиента — отправленное сообщение Telegram
      // (или наоборот). Это допустимо: альтернатива (sendMessage внутри
      // транзакции SQLite) держала бы блокировку на сетевом таймауте, что
      // куда хуже. Менеджер видит факт отправки/skip в UI по плашке
      // saveSuccess сразу после ответа, может перезапустить через
      // /bot/send-custom если что-то не дошло.
      const statusChanged = updated.status !== statusAtTxStart;
      const activePickupCell = getActivePickupCellAssignment(id);
      res.json({
        ...updated,
        pickup_cell_number: activePickupCell?.cell_number ?? null,
        pickup_cell_assignment_id: activePickupCell?.id ?? null,
        items: updatedItems,
        auto_notification: statusChanged ? { pending: true } : null,
      });

      if (statusChanged) {
        setImmediate(() => {
          void autoNotifyForStatusChange({
            orderId: id,
            newStatus: updated.status,
            previousStatus: statusAtTxStart,
            reactivate: Boolean(reactivate),
          }).catch((notifyErr) => {
            console.error("[crm] deferred auto-notify error:", notifyErr);
          });
        });
      }
    } catch (error) {
      console.error("[crm] Update order error:", error);
      if (isStaffServiceError(error)) {
        return sendStaffServiceError(res, error);
      }
      if (error.code === "pickup_cells_full") {
        return res.status(409).json({
          error: "pickup_cells_full",
          message: "Свободных ячеек нет. Выдайте или разберите заказ и повторите.",
        });
      }
      const clientErrors = new Set([
        "invalid_payment_type",
        "invalid_status",
        "invalid_paid_amount",
        "invalid_item",
        "invalid_item_quantity",
        "invalid_item_discount",
        "invalid_item_price",
        "variant_not_allowed",
        "variant_required",
        "variant_product_mismatch",
        "invalid_quantity",
        "invalid_cost",
        "items_required",
        "promo_and_loyalty_conflict",
        "loyalty_category_not_available",
        "loyalty_balance_not_enough",
        "loyalty_category_limit_exceeded",
      ]);

      // Проверяем клиентские ошибки (которые должны вернуть 400, а не 500)
      const isClientError =
        clientErrors.has(error.message) ||
        error.message.startsWith("Недостаточно товара") ||
        error.message.startsWith("Insufficient stock") ||
        error.message.startsWith("Product not found") ||
        error.message.startsWith("Variant not found");

      if (isClientError) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

// История статусов заказа (must be after /delivered to avoid route conflict)
crmOperationsRouter.get(
  "/api/admin/crm/orders/:id/history",
  authMiddleware,
  (req, res) => {
    try {
      const { id } = req.params;
      const history = db
        .prepare(
          `SELECT * FROM order_status_history WHERE order_id = ? ORDER BY changed_at DESC`,
        )
        .all(id);
      res.json(history);
    } catch (error) {
      console.error("[crm] Fetch order history error:", error);
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

// Resolve manager action (менеджер подтвердил что увидел изменение/отмену)
crmOperationsRouter.post(
  "/api/admin/crm/orders/:id/resolve-action",
  authMiddleware,
  requireOrderShift,
  (req, res) => {
    try {
      const { id } = req.params;

      const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
      if (!order) {
        return res.status(404).json({ error: "not_found" });
      }

      if (!order.needs_manager_action) {
        return res.status(400).json({ error: "no_action_required" });
      }

      const tx = db.transaction(() => {
        recheckOrderShift(req);
        const freshOrder = db
          .prepare("SELECT * FROM orders WHERE id = ?")
          .get(id);
        if (!freshOrder || !freshOrder.needs_manager_action) {
          throw new StaffServiceError("no_action_required", 409);
        }
        Object.assign(order, freshOrder);
        if (order.manager_action_type === "modified") {
          // Измененный заказ - возвращаем в "Новые" для пересборки
          // Если сток был списан (заказ был собран до изменения), возвращаем сток
          if (order.stock_deducted) {
            const orderItems = db
              .prepare("SELECT * FROM order_items WHERE order_id = ?")
              .all(id);
            for (const item of orderItems) {
              adjustOrderItemStock(item, Number(item.quantity));
            }
          }

          const resolved = db.prepare(
            `UPDATE orders SET
              needs_manager_action = 0,
              manager_action_resolved_at = DATETIME('now'),
              status = 'new',
              stock_deducted = 0,
              updated_at = DATETIME('now')
            WHERE id = ? AND needs_manager_action = 1`,
          ).run(id);
          if (resolved.changes !== 1) {
            throw new StaffServiceError("no_action_required", 409);
          }

          // Физическое место сохраняется, но создаётся новый цикл назначения:
          // повторная сборка должна отправить клиенту новое уведомление.
          restartPickupCellAssignmentCycle(id, "customer_modification_resolved");

          recordStatusChange(id, order.status, "new", "Менеджер принял изменения, заказ на пересборку");
        } else if (order.manager_action_type === "cancelled_by_customer") {
          // Отмененный покупателем - просто сбрасываем флаг, заказ остается cancelled
          const resolved = db.prepare(
            `UPDATE orders SET
              needs_manager_action = 0,
              manager_action_resolved_at = DATETIME('now'),
              updated_at = DATETIME('now')
            WHERE id = ? AND needs_manager_action = 1`,
          ).run(id);
          if (resolved.changes !== 1) {
            throw new StaffServiceError("no_action_required", 409);
          }

          releaseActivePickupCell(id, "customer_cancellation_resolved");

          recordStatusChange(id, order.status, order.status, "Менеджер подтвердил отмену, заказ разобран");
        } else {
          // Неизвестный тип - просто сбрасываем флаг
          const resolved = db.prepare(
            `UPDATE orders SET
              needs_manager_action = 0,
              manager_action_resolved_at = DATETIME('now'),
              updated_at = DATETIME('now')
            WHERE id = ? AND needs_manager_action = 1`,
          ).run(id);
          if (resolved.changes !== 1) {
            throw new StaffServiceError("no_action_required", 409);
          }
        }
      });

      tx.immediate();

      const updated = db
        .prepare(
          `
          SELECT
            o.*,
            COALESCE(o.telegram_username, c.telegram_username) as telegram_username,
            c.first_name,
            c.last_name,
            c.phone,
            COALESCE(pc.has_gift, 0) as promo_has_gift,
            pc.manager_description as promo_manager_description,
            pc.customer_description as promo_customer_description
          FROM orders o
          LEFT JOIN customers c ON c.id = o.customer_id
          LEFT JOIN promo_codes pc ON pc.id = o.promo_code_id
          WHERE o.id = ?
        `,
        )
        .get(id);
      const updatedItems = db
        .prepare(`
          SELECT oi.*, p.description as product_description
          FROM order_items oi
          LEFT JOIN products p ON oi.product_id = p.id
          WHERE oi.order_id = ?
        `)
        .all(id);

      const customerName = (() => {
        if (!updated.customer_id) return null;
        const c = db.prepare("SELECT first_name, last_name FROM customers WHERE id = ?").get(updated.customer_id);
        return c ? `${c.first_name || ''} ${c.last_name || ''}`.trim() : null;
      })();

      res.json({ ...updated, customer_name: customerName, items: updatedItems });
    } catch (error) {
      console.error("[crm] Resolve manager action error:", error);
      if (isStaffServiceError(error)) {
        return sendStaffServiceError(res, error);
      }
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

// Выдача заказа с фиксацией оплаты
crmOperationsRouter.post(
  "/api/admin/crm/orders/:id/issue",
  authMiddleware,
  requireOrderShift,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { payment_type, payment_account_id, amount, payment_notes } =
        req.body;

      if (!payment_type || !["cash", "card"].includes(payment_type)) {
        return res.status(400).json({ error: "invalid_payment_type" });
      }

      if (payment_type === "cash" && !payment_account_id) {
        return res.status(400).json({ error: "payment_account_required" });
      }

      const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
      if (!order) {
        return res.status(404).json({ error: "not_found" });
      }

      const parsedAmount = amount === undefined
        ? Number(order.final_amount || order.total_amount || 0)
        : Number(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: "invalid_amount" });
      }

      if (order.status !== "in_progress" && order.status !== "completed") {
        return res.status(400).json({ error: "invalid_status_state" });
      }

      if (order.paid_amount && Number(order.paid_amount) > 0) {
        return res.status(400).json({ error: "already_paid" });
      }

      const account = payment_account_id
        ? db
          .prepare("SELECT * FROM cash_accounts WHERE id = ? AND active = 1")
          .get(payment_account_id)
        : null;
      if (payment_type === "cash" && !account) {
        return res.status(404).json({ error: "account_not_found" });
      }

      const description = `Оплата заказа #${order.order_number} (${payment_type === "card" ? "карта" : "наличные"})`;
      const transactionId = generateId("trans");
      let previousStatus = order.status;
      let cashAmount = parsedAmount;

      const tx = db.transaction(() => {
        const shiftActor = recheckOrderShift(req);
        const freshOrder = db
          .prepare("SELECT * FROM orders WHERE id = ?")
          .get(id);
        if (!freshOrder) {
          throw new StaffServiceError("not_found", 404);
        }
        if (
          freshOrder.status !== "in_progress"
          && freshOrder.status !== "completed"
        ) {
          throw new StaffServiceError("invalid_status_state", 409);
        }
        if (Number(freshOrder.paid_amount || 0) > 0) {
          throw new StaffServiceError("already_paid", 409);
        }
        previousStatus = freshOrder.status;
        const totalAmount = Number(
          freshOrder.final_amount || freshOrder.total_amount || 0,
        );
        const reservedCard = db.prepare(`
          SELECT amount_minor
          FROM card_payment_operations
          WHERE order_id = ? AND operation_type = 'order' AND operation_status = 'reserved'
        `).get(id);

        if (payment_type === "card") {
          if (reservedCard && Number(reservedCard.amount_minor || 0) > 0) {
            // Заказ оформлялся как карточный: резерва хватает, проводим его.
            const cardAmount = Number(reservedCard.amount_minor) / 100;
            cashAmount = Math.max(0, totalAmount - cardAmount);
            if (cashAmount > 0 && !account) {
              throw new StaffServiceError("payment_account_required", 400);
            }
            issueCardOrder(id, new Date());
          } else {
            // Принудительная оплата картой: клиент платит картой по решению
            // магазина, хотя заказ оформлялся за наличные и карты может не
            // быть разрешено. Списываем с дневного и месячного лимита,
            // ставим паузу аккаунту. Личные лимиты не проверяем — это
            // осознанное решение менеджера (войти в положение клиента).
            const customerRow = freshOrder.customer_id
              ? db.prepare("SELECT telegram_id FROM customers WHERE id = ?").get(freshOrder.customer_id)
              : null;
            const customerTelegramId = String(
              customerRow?.telegram_id || "",
            ).trim();
            if (!customerTelegramId) {
              throw new StaffServiceError("customer_telegram_id_required", 400);
            }
            forceIssueCardPayment({
              orderId: id,
              telegramId: customerTelegramId,
              amountMinor: Math.round(totalAmount * 100),
              note: payment_notes || null,
              actorUsername: req.user?.u || "admin",
            });
            cashAmount = 0;
          }
        } else if (reservedCard) {
          // A seller may convert a card reservation to cash before issue.
          reverseCardOrder(id, new Date());
          cashAmount = parsedAmount;
        }

        const completedAt = new Date().toISOString();
        const issued = db.prepare(
          `
        UPDATE orders
        SET status = 'delivered',
            previous_status = ?,
            payment_type = ?,
            payment_account_id = ?,
            paid_amount = ?,
            paid_at = DATETIME('now'),
            payment_notes = ?,
            completed_at = ?,
            issued_by_employee_id = ?,
            issued_at = ?,
            updated_at = DATETIME('now')
        WHERE id = ?
          AND status IN ('in_progress', 'completed')
          AND COALESCE(paid_amount, 0) <= 0
      `,
        ).run(
          previousStatus,
          payment_type,
            payment_account_id || null,
            payment_type === "card" ? totalAmount : parsedAmount,
          payment_notes || null,
          completedAt,
          shiftActor?.employeeId || null,
          completedAt,
          id,
        );
        if (issued.changes !== 1) {
          throw new StaffServiceError("already_paid", 409);
        }

        if (cashAmount > 0) {
          db.prepare(
            `
          INSERT INTO cash_transactions (
            id, account_id, type, amount, description, order_id, employee_id
          )
          VALUES (?, ?, 'income', ?, ?, ?, ?)
        `,
          ).run(
            transactionId,
            payment_account_id,
            cashAmount,
            description,
            id,
            shiftActor?.employeeId || null,
          );

          db.prepare(
            "UPDATE cash_accounts SET balance = balance + ? WHERE id = ?",
          ).run(cashAmount, payment_account_id);
        }

        releaseActivePickupCell(id, "issued");

        consumePromoUsageForOrder({
          orderId: id,
          promoCodeId: freshOrder.promo_code_id || null,
          customerId: freshOrder.customer_id || null,
          discountApplied: Number(freshOrder.discount_amount || 0),
          consumedAt: completedAt,
          idFactory: () => generateId("pu"),
        });

        awardLoyaltyForOrder(id);
        try {
          accrueWheelSpinsForOrder(id);
        } catch (wheelError) {
          console.error("[wheel] accrual on /issue failed", wheelError);
        }
      });

      tx.immediate();

      const updatedOrder = db
        .prepare(
          `
      SELECT 
        o.*,
        c.telegram_username,
        c.first_name || ' ' || COALESCE(c.last_name, '') as customer_name
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.id = ?
    `,
        )
        .get(id);

      const transaction = cashAmount > 0
        ? db.prepare(
          `
      SELECT 
        ct.*,
        ca.name as account_name
      FROM cash_transactions ct
      JOIN cash_accounts ca ON ca.id = ct.account_id
      WHERE ct.id = ?
    `,
        )
        .get(transactionId)
        : null;

      recordStatusChange(
        id,
        previousStatus,
        updatedOrder.status,
        "Выдача заказа",
      );

      // Авто-уведомление клиенту о выдаче (Pavel 10.05.2026: «когда пробил
      // заказ — не отправляет»). Раньше /issue имел отдельный поток без
      // вызова auto-notify, поэтому статус delivered шёл молча. Сейчас
      // дёргаем тот же helper что в PATCH /orders/:id.
      const statusChangedOnIssue = updatedOrder.status !== previousStatus;
      res.json({
        order: updatedOrder,
        transaction,
        auto_notification: statusChangedOnIssue ? { pending: true } : null,
      });

      if (statusChangedOnIssue) {
        setImmediate(() => {
          void autoNotifyForStatusChange({
            orderId: id,
            newStatus: updatedOrder.status,
            previousStatus,
            reactivate: false,
          }).catch((notifyErr) => {
            console.error("[crm] deferred /issue auto-notify error:", notifyErr);
          });
        });
      }
    } catch (error) {
      console.error("[crm] Issue order error:", error);
      if (isStaffServiceError(error)) {
        return sendStaffServiceError(res, error);
      }
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

// Удаление оплаты заказа
crmOperationsRouter.delete(
  "/api/admin/crm/orders/:id/payment",
  authMiddleware,
  requireOrderShift,
  (req, res) => {
    try {
      const { id } = req.params;

      const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
      if (!order) {
        return res.status(404).json({ error: "not_found" });
      }

      if (!order.paid_amount || Number(order.paid_amount) <= 0) {
        return res.status(400).json({ error: "payment_not_found" });
      }

      const transactions = db
        .prepare("SELECT * FROM cash_transactions WHERE order_id = ?")
        .all(id);
      const hasCardOperation = Boolean(db.prepare(`
        SELECT 1 FROM card_payment_operations
        WHERE order_id = ? AND operation_type = 'order'
          AND operation_status IN ('spent', 'reserved')
        LIMIT 1
      `).get(id));

      if (!transactions.length && !hasCardOperation) {
        return res.status(400).json({ error: "transaction_not_found" });
      }

      let restoredStatus = order.previous_status || "in_progress";
      const hadPickupCellHistory = Boolean(
        db.prepare(
          `SELECT 1 FROM order_pickup_cell_assignments WHERE order_id = ? LIMIT 1`,
        ).get(id),
      );

      const tx = db.transaction(() => {
        recheckOrderShift(req);
        const freshOrder = db
          .prepare("SELECT * FROM orders WHERE id = ?")
          .get(id);
        if (!freshOrder || Number(freshOrder.paid_amount || 0) <= 0) {
          throw new StaffServiceError("payment_not_found", 409);
        }
        restoredStatus = freshOrder.previous_status || "in_progress";
        const freshTransactions = db
          .prepare("SELECT * FROM cash_transactions WHERE order_id = ?")
          .all(id);
        const freshHasCardOperation = Boolean(db.prepare(`
          SELECT 1 FROM card_payment_operations
          WHERE order_id = ? AND operation_type = 'order'
            AND operation_status IN ('spent', 'reserved')
          LIMIT 1
        `).get(id));
        if (!freshTransactions.length && !freshHasCardOperation) {
          throw new StaffServiceError("transaction_not_found", 409);
        }
        if (freshHasCardOperation) reverseCardOrder(id);
        for (const transaction of freshTransactions) {
          db.prepare("DELETE FROM cash_transactions WHERE id = ?").run(
            transaction.id,
          );

          if (transaction.account_id && transaction.amount) {
            if (transaction.type === "income") {
              db.prepare(
                "UPDATE cash_accounts SET balance = balance - ? WHERE id = ?",
              ).run(transaction.amount, transaction.account_id);
            } else if (transaction.type === "expense") {
              db.prepare(
                "UPDATE cash_accounts SET balance = balance + ? WHERE id = ?",
              ).run(transaction.amount, transaction.account_id);
            }
          }
        }

        db.prepare(
          `
        UPDATE orders
        SET status = ?,
            payment_type = NULL,
            payment_account_id = NULL,
            paid_amount = NULL,
            paid_at = NULL,
            payment_notes = NULL,
            previous_status = NULL,
            completed_at = NULL,
            issued_by_employee_id = NULL,
            issued_at = NULL,
            card_amount_minor = 0,
            cash_due_minor = CAST(ROUND(COALESCE(final_amount, total_amount, 0) * 100) AS INTEGER),
            updated_at = DATETIME('now')
        WHERE id = ?
      `,
        ).run(restoredStatus, id);

        // Старый собранный заказ без истории ячеек остаётся legacy-заказом.
        if (restoredStatus === "in_progress" && hadPickupCellHistory) {
          assignLowestAvailablePickupCell(id);
        }

        if (freshOrder.promo_code_id) {
          if (["completed", "delivered"].includes(restoredStatus)) {
            consumePromoUsageForOrder({
              orderId: id,
              promoCodeId: freshOrder.promo_code_id,
              customerId: freshOrder.customer_id || null,
              discountApplied: Number(freshOrder.discount_amount || 0),
              idFactory: () => generateId("pu"),
            });
          } else {
            reservePromoUsageForOrder({
              promoCodeId: freshOrder.promo_code_id,
              orderId: id,
              customerId: freshOrder.customer_id || null,
              discountApplied: Number(freshOrder.discount_amount || 0),
              idFactory: () => generateId("pu"),
            });
          }
        }
      });

      tx.immediate();

      const updatedOrder = db
        .prepare("SELECT * FROM orders WHERE id = ?")
        .get(id);
      const updatedItems = db
        .prepare(`
          SELECT oi.*, p.description as product_description 
          FROM order_items oi
          LEFT JOIN products p ON oi.product_id = p.id
          WHERE oi.order_id = ?
        `)
        .all(id);

      recordStatusChange(
        id,
        order.status,
        updatedOrder.status,
        "Оплата отменена",
      );

      const restoredCell = getActivePickupCellAssignment(id);
      res.json({
        ...updatedOrder,
        pickup_cell_number: restoredCell?.cell_number ?? null,
        pickup_cell_assignment_id: restoredCell?.id ?? null,
        items: updatedItems,
      });
    } catch (error) {
      console.error("[crm] Remove order payment error:", error);
      if (isStaffServiceError(error)) {
        return sendStaffServiceError(res, error);
      }
      if (error.code === "pickup_cells_full") {
        return res.status(409).json({
          error: "pickup_cells_full",
          message: "Свободных ячеек нет. Нельзя вернуть заказ в собранные.",
        });
      }
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

// =========================
// PROCUREMENTS (Закупки)
// =========================
crmOperationsRouter.get(
  "/api/admin/crm/procurements",
  authMiddleware,
  (req, res) => {
    try {
      const procurements = db
        .prepare(
          `
      SELECT
        p.*,
        legacy_employee.first_name || ' ' || legacy_employee.last_name
          AS employee_name,
        creator.first_name || ' ' || creator.last_name
          AS created_by_name,
        acceptor.first_name || ' ' || acceptor.last_name
          AS accepted_by_name
      FROM procurements p
      LEFT JOIN employees legacy_employee ON legacy_employee.id = p.employee_id
      LEFT JOIN employees creator ON creator.id = p.created_by_employee_id
      LEFT JOIN employees acceptor ON acceptor.id = p.accepted_by_employee_id
      ORDER BY p.created_at DESC
    `,
        )
        .all();

      res.json(procurements);
    } catch (error) {
      console.error("[crm] Get procurements error:", error);
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

crmOperationsRouter.get(
  "/api/admin/crm/procurements/:id",
  authMiddleware,
  (req, res) => {
    try {
      const { id } = req.params;

      const procurement = db.prepare(`
        SELECT
          procurement.*,
          legacy_employee.first_name || ' ' || legacy_employee.last_name
            AS employee_name,
          creator.first_name || ' ' || creator.last_name
            AS created_by_name,
          acceptor.first_name || ' ' || acceptor.last_name
            AS accepted_by_name
        FROM procurements AS procurement
        LEFT JOIN employees AS legacy_employee
          ON legacy_employee.id = procurement.employee_id
        LEFT JOIN employees AS creator
          ON creator.id = procurement.created_by_employee_id
        LEFT JOIN employees AS acceptor
          ON acceptor.id = procurement.accepted_by_employee_id
        WHERE procurement.id = ?
      `).get(id);
      if (!procurement) {
        return res.status(404).json({ error: "not_found" });
      }

      const items = db
        .prepare(
          `
      SELECT pi.*,
             CASE WHEN pv.name IS NOT NULL THEN p.title || ' (' || pv.name || ')' ELSE p.title END as product_title,
             p.stock, p.warehouse_stock, p.cost_price as product_cost_price, p.min_stock, cg.name as group_name,
             pv.name as variant_name, pv.stock as variant_stock,
             pv.warehouse_stock as variant_warehouse_stock,
             CASE
               WHEN COALESCE(p.has_variants, 0) = 1 THEN (
                 SELECT COALESCE(SUM(all_variants.stock + all_variants.warehouse_stock), 0)
                 FROM product_variants all_variants
                 WHERE all_variants.product_id = p.id
               )
               ELSE COALESCE(p.stock, 0) + COALESCE(p.warehouse_stock, 0)
             END as base_total_stock,
             COALESCE(
               (SELECT url FROM product_images WHERE productId = pi.product_id AND variant_id = pi.variant_id ORDER BY position LIMIT 1),
               (SELECT url FROM product_images WHERE productId = pi.product_id AND variant_id IS NULL ORDER BY position LIMIT 1),
               (SELECT url FROM product_images WHERE productId = pi.product_id ORDER BY position LIMIT 1),
               cg.cover_image,
               (SELECT cover_image FROM categories WHERE id = p.categoryId)
             ) as product_image
      FROM procurement_items pi
      JOIN products p ON p.id = pi.product_id
      LEFT JOIN category_groups cg ON cg.id = p.groupId
      LEFT JOIN product_variants pv ON pv.id = pi.variant_id
      WHERE pi.procurement_id = ?
    `,
        )
        .all(id);

      res.json({ ...procurement, items });
    } catch (error) {
      console.error("[crm] Get procurement error:", error);
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

// Создание закупки
crmOperationsRouter.post(
  "/api/admin/crm/procurements",
  authMiddleware,
  requireDocumentActor,
  (req, res) => {
    try {
      const { supplier_name, items, notes } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "items_required" });
      }

      let procurementId = generateId("proc");
      let procurementNumber = null;
      const trackingEnabled = isStaffTrackingEnabled();
      const idempotencyKey = trackingEnabled
        ? requestIdempotencyKey(req)
        : null;
      if (trackingEnabled && !idempotencyKey) {
        throw new StaffServiceError("idempotency_key_required", 400);
      }

      let totalAmount = 0;

      const executeCreate = () => {
        const tx = db.transaction(() => {
        const actor = recheckDocumentActor(req);
        procurementNumber = getNextNumber(
          "procurements",
          "procurement_number",
        );
        // Создаем закупку
        db.prepare(
          `
        INSERT INTO procurements (
          id, procurement_number, employee_id, created_by_employee_id,
          supplier_name, total_amount, status, notes
        )
        VALUES (?, ?, ?, ?, ?, 0, 'draft', ?)
      `,
        ).run(
          procurementId,
          procurementNumber,
          actor?.employeeId || null,
          actor?.employeeId || null,
          supplier_name || null,
          notes || null,
        );

        // Добавляем позиции
        for (const item of items) {
          // Проверяем, это вариант или обычный товар
          let productId = item.product_id;
          let variantId = item.variant_id || null;
          
          // Если передан variant_id, получаем product_id из варианта
          if (variantId) {
            const variant = db
              .prepare("SELECT product_id FROM product_variants WHERE id = ?")
              .get(variantId);
            if (!variant) throw new Error('variant_not_found');
            if (String(productId) !== String(variant.product_id)) throw new Error('variant_product_mismatch');
          }
          
          const product = db
            .prepare("SELECT * FROM products WHERE id = ?")
            .get(productId);
          if (!product) {
            throw new Error(`Product not found: ${productId}`);
          }
          if (Number(product.has_variants || 0) === 1 && !variantId) throw new Error('variant_required');
          if (Number(product.has_variants || 0) === 0 && variantId) throw new Error('variant_not_allowed');

          const quantity = Number(item.quantity || 0);
          const costPerUnit = Number(item.cost_per_unit || 0);
          const warehouseQuantity = Number(item.warehouse_quantity || 0);
          if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('invalid_quantity');
          if (!Number.isFinite(costPerUnit) || costPerUnit < 0) throw new Error('invalid_cost');
          if (!Number.isInteger(warehouseQuantity) || warehouseQuantity < 0 || warehouseQuantity > quantity) {
            throw new Error('invalid_warehouse_quantity');
          }
          const totalCost = quantity * costPerUnit;
          totalAmount += totalCost;

          db.prepare(
            `
          INSERT INTO procurement_items (id, procurement_id, product_id, variant_id, quantity, warehouse_quantity, cost_per_unit, total_cost)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
          ).run(
            generateId("pi"),
            procurementId,
            productId,
            variantId,
            quantity,
            warehouseQuantity,
            costPerUnit,
            totalCost,
          );
        }

        // Обновляем общую сумму
        db.prepare("UPDATE procurements SET total_amount = ? WHERE id = ?").run(
          totalAmount,
          procurementId,
        );

        if (actor) {
          const eventKey = `procurement:${procurementId}:created`;
          recordSystemStaffEvent({
            employeeId: actor.employeeId,
            eventType: "procurement_created",
            entityType: "procurement",
            entityId: procurementId,
            idempotencyKey: eventKey,
            sourceNumber: procurementNumber,
            sourceType: "procurement",
            sourceName: supplier_name || "Без поставщика",
            payload: {
              total_amount: totalAmount,
              item_count: items.length,
            },
          });
          enqueueInternalNotificationForGroup(db, {
            eventGroup: "documents",
            uniqueKey: eventKey,
            eventType: "procurement.created",
            payload: {
              document_number: procurementNumber,
              employee_name: actor.employeeName,
            },
          });
        }
        });

        tx();
        return { id: procurementId };
      };

      if (trackingEnabled) {
        const operation = staffOperationName("procurement.create", req.body);
        const operationResult = unwrapStaffOperation(
          runStaffIdempotentOperation({
            key: idempotencyKey,
            operation,
            entityType: "procurement",
            execute: executeCreate,
          }),
        );
        procurementId = operationResult.result.id;
      } else {
        executeCreate();
      }

      const procurement = db
        .prepare("SELECT * FROM procurements WHERE id = ?")
        .get(procurementId);
      const procurementItems = db
        .prepare(
          `
      SELECT pi.*,
             CASE WHEN pv.name IS NOT NULL THEN p.title || ' (' || pv.name || ')' ELSE p.title END as product_title,
             p.stock, p.warehouse_stock, p.cost_price as product_cost_price, p.min_stock, cg.name as group_name,
             pv.name as variant_name, pv.stock as variant_stock,
             pv.warehouse_stock as variant_warehouse_stock,
             CASE
               WHEN COALESCE(p.has_variants, 0) = 1 THEN (
                 SELECT COALESCE(SUM(all_variants.stock + all_variants.warehouse_stock), 0)
                 FROM product_variants all_variants
                 WHERE all_variants.product_id = p.id
               )
               ELSE COALESCE(p.stock, 0) + COALESCE(p.warehouse_stock, 0)
             END as base_total_stock,
             COALESCE(
               (SELECT url FROM product_images WHERE productId = pi.product_id AND variant_id = pi.variant_id ORDER BY position LIMIT 1),
               (SELECT url FROM product_images WHERE productId = pi.product_id AND variant_id IS NULL ORDER BY position LIMIT 1),
               (SELECT url FROM product_images WHERE productId = pi.product_id ORDER BY position LIMIT 1),
               cg.cover_image,
               (SELECT cover_image FROM categories WHERE id = p.categoryId)
             ) as product_image
      FROM procurement_items pi
      JOIN products p ON p.id = pi.product_id
      LEFT JOIN category_groups cg ON cg.id = p.groupId
      LEFT JOIN product_variants pv ON pv.id = pi.variant_id
      WHERE pi.procurement_id = ?
    `,
        )
        .all(procurementId);

      res.json({ ...procurement, items: procurementItems });
    } catch (error) {
      console.error("[crm] Create procurement error:", error);
      if (isStaffServiceError(error)) {
        return sendStaffServiceError(res, error);
      }
      if ([
        "invalid_quantity",
        "invalid_cost",
        "invalid_warehouse_quantity",
        "variant_not_found",
        "variant_product_mismatch",
        "variant_required",
        "variant_not_allowed",
      ].includes(error.message)) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

// Обновление черновика закупки
crmOperationsRouter.patch(
  "/api/admin/crm/procurements/:id",
  authMiddleware,
  (req, res) => {
    try {
      const { id } = req.params;
      const { supplier_name, notes, items } = req.body || {};

      let procurement = db
        .prepare("SELECT * FROM procurements WHERE id = ?")
        .get(id);
      if (!procurement) {
        return res.status(404).json({ error: "not_found" });
      }

      if (procurement.status !== "draft") {
        return res.status(400).json({ error: "edit_not_allowed" });
      }

      const tx = db.transaction(() => {
        const freshProcurement = db
          .prepare("SELECT * FROM procurements WHERE id = ?")
          .get(id);
        if (!freshProcurement) {
          throw new StaffServiceError("not_found", 404);
        }
        if (freshProcurement.status !== "draft") {
          throw new StaffServiceError("edit_not_allowed", 409);
        }
        procurement = freshProcurement;

        if (supplier_name !== undefined || notes !== undefined) {
          const updatedMetadata = db.prepare(
            `
          UPDATE procurements
          SET supplier_name = ?, notes = ?
          WHERE id = ? AND status = 'draft'
        `,
          ).run(
            supplier_name !== undefined
              ? supplier_name || null
              : procurement.supplier_name,
            notes !== undefined ? notes || null : procurement.notes,
            id,
          );
          if (updatedMetadata.changes !== 1) {
            throw new StaffServiceError("edit_not_allowed", 409);
          }
        }

        if (Array.isArray(items)) {
          if (items.length === 0) {
            throw new Error("items_required");
          }

          db.prepare(
            "DELETE FROM procurement_items WHERE procurement_id = ?",
          ).run(id);

          let totalAmount = 0;
          const itemStmt = db.prepare(`
          INSERT INTO procurement_items (id, procurement_id, product_id, variant_id, quantity, warehouse_quantity, cost_per_unit, total_cost)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

          for (const item of items) {
            if (!item || !item.product_id) {
              throw new Error("invalid_item");
            }

            // Проверяем, это вариант или обычный товар
            let productId = item.product_id;
            let variantId = item.variant_id || null;
            
            // Если передан variant_id, получаем product_id из варианта
            if (variantId) {
              const variant = db
                .prepare("SELECT product_id FROM product_variants WHERE id = ?")
                .get(variantId);
              if (!variant) throw new Error("variant_not_found");
              if (String(productId) !== String(variant.product_id)) throw new Error("variant_product_mismatch");
            }

            const product = db
              .prepare("SELECT * FROM products WHERE id = ?")
              .get(productId);
            if (!product) {
              throw new Error(`Product not found: ${productId}`);
            }
            if (Number(product.has_variants || 0) === 1 && !variantId) throw new Error("variant_required");
            if (Number(product.has_variants || 0) === 0 && variantId) throw new Error("variant_not_allowed");

            const quantity = Number(item.quantity || 0);
            const costPerUnit = Number(item.cost_per_unit || 0);
            const warehouseQuantity = Number(item.warehouse_quantity || 0);

            if (!Number.isInteger(quantity) || quantity <= 0) {
              throw new Error("invalid_quantity");
            }

            if (!Number.isFinite(costPerUnit) || costPerUnit < 0) {
              throw new Error("invalid_cost");
            }
            if (!Number.isInteger(warehouseQuantity) || warehouseQuantity < 0 || warehouseQuantity > quantity) {
              throw new Error("invalid_warehouse_quantity");
            }

            const totalCost = costPerUnit * quantity;
            totalAmount += totalCost;

            itemStmt.run(
              generateId("pi"),
              id,
              productId,
              variantId,
              quantity,
              warehouseQuantity,
              costPerUnit,
              totalCost,
            );
          }

          const updatedTotal = db.prepare(
            "UPDATE procurements SET total_amount = ? WHERE id = ? AND status = 'draft'",
          ).run(totalAmount, id);
          if (updatedTotal.changes !== 1) {
            throw new StaffServiceError("edit_not_allowed", 409);
          }
        }
      });

      tx.immediate();

      const updated = db
        .prepare("SELECT * FROM procurements WHERE id = ?")
        .get(id);
      const updatedItems = db
        .prepare(
          `
      SELECT pi.*,
             CASE WHEN pv.name IS NOT NULL THEN p.title || ' (' || pv.name || ')' ELSE p.title END as product_title,
             p.stock, p.warehouse_stock, p.cost_price as product_cost_price, p.min_stock, cg.name as group_name,
             pv.name as variant_name, pv.stock as variant_stock,
             pv.warehouse_stock as variant_warehouse_stock,
             CASE
               WHEN COALESCE(p.has_variants, 0) = 1 THEN (
                 SELECT COALESCE(SUM(all_variants.stock + all_variants.warehouse_stock), 0)
                 FROM product_variants all_variants
                 WHERE all_variants.product_id = p.id
               )
               ELSE COALESCE(p.stock, 0) + COALESCE(p.warehouse_stock, 0)
             END as base_total_stock,
             COALESCE(
               (SELECT url FROM product_images WHERE productId = pi.product_id AND variant_id = pi.variant_id ORDER BY position LIMIT 1),
               (SELECT url FROM product_images WHERE productId = pi.product_id AND variant_id IS NULL ORDER BY position LIMIT 1),
               (SELECT url FROM product_images WHERE productId = pi.product_id ORDER BY position LIMIT 1),
               cg.cover_image,
               (SELECT cover_image FROM categories WHERE id = p.categoryId)
             ) as product_image
      FROM procurement_items pi
      JOIN products p ON p.id = pi.product_id
      LEFT JOIN category_groups cg ON cg.id = p.groupId
      LEFT JOIN product_variants pv ON pv.id = pi.variant_id
      WHERE pi.procurement_id = ?
    `,
        )
        .all(id);

      res.json({ ...updated, items: updatedItems });
    } catch (error) {
      console.error("[crm] Update procurement error:", error);
      if (isStaffServiceError(error)) {
        return sendStaffServiceError(res, error);
      }
      const clientErrors = new Set([
        "items_required",
        "invalid_item",
        "invalid_quantity",
        "invalid_cost",
        "invalid_warehouse_quantity",
        "variant_not_found",
        "variant_product_mismatch",
        "variant_required",
        "variant_not_allowed",
        "edit_not_allowed",
      ]);
      if (clientErrors.has(error.message)) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

// Удаление закупки
crmOperationsRouter.delete(
  "/api/admin/crm/procurements/:id",
  authMiddleware,
  (req, res) => {
    try {
      const { id } = req.params;

      let procurement = db
        .prepare("SELECT * FROM procurements WHERE id = ?")
        .get(id);
      if (!procurement) {
        return res.status(404).json({ error: "not_found" });
      }

      let items = db
        .prepare("SELECT * FROM procurement_items WHERE procurement_id = ? ORDER BY rowid ASC")
        .all(id);

      const tx = db.transaction(() => {
        const freshProcurement = db
          .prepare("SELECT * FROM procurements WHERE id = ?")
          .get(id);
        if (!freshProcurement) {
          throw new StaffServiceError("not_found", 404);
        }
        procurement = freshProcurement;
        items = db
          .prepare(
            "SELECT * FROM procurement_items WHERE procurement_id = ? ORDER BY rowid ASC",
          )
          .all(id);

        if (procurement.status === "completed") {
          for (const item of [...items].reverse()) {
            const product = db
              .prepare("SELECT * FROM products WHERE id = ?")
              .get(item.product_id);
            if (!product) {
              continue;
            }
            if (Number(product.has_variants || 0) === 1 && !item.variant_id) {
              throw new StaffServiceError("inventory_target_missing", 409);
            }

            const quantity = Number(item.quantity || 0);
            const warehouseQuantity = Number(item.warehouse_quantity || 0);
            const retailQuantity = quantity - warehouseQuantity;
            const costPerUnit = Number(item.cost_per_unit || 0);
            const stockTable = item.variant_id ? "product_variants" : "products";
            const stockId = item.variant_id || item.product_id;
            const stockRow = db.prepare(`
              SELECT stock, warehouse_stock FROM ${stockTable} WHERE id = ?
            `).get(stockId);

            if (
              !stockRow
              || Number(stockRow.stock || 0) < retailQuantity
              || Number(stockRow.warehouse_stock || 0) < warehouseQuantity
            ) {
              throw new Error(`insufficient_stock_to_rollback:${product.id}`);
            }

            const currentTotalStock = getProductTotalStock(item.product_id);
            const previousStock = currentTotalStock - quantity;
            let previousCost = 0;
            if (previousStock > 0) {
              const currentCost = Number(product.cost_price || 0);
              previousCost = roundMoney(
                (currentCost * currentTotalStock - quantity * costPerUnit) /
                  previousStock,
              );
              if (previousCost < 0) {
                previousCost = 0;
              }
            }

            db.prepare(
              `UPDATE ${stockTable}
               SET stock = stock - ?, warehouse_stock = warehouse_stock - ?
               WHERE id = ?`,
            ).run(retailQuantity, warehouseQuantity, stockId);
            db.prepare('UPDATE products SET cost_price = ? WHERE id = ?').run(
              previousStock > 0 ? previousCost : 0,
              item.product_id,
            );
          }

          if (procurement.expense_transaction_id) {
            const transaction = db
              .prepare("SELECT * FROM cash_transactions WHERE id = ?")
              .get(procurement.expense_transaction_id);
            if (transaction) {
              db.prepare("DELETE FROM cash_transactions WHERE id = ?").run(
                transaction.id,
              );
              if (transaction.account_id && transaction.amount) {
                if (transaction.type === "expense") {
                  db.prepare(
                    "UPDATE cash_accounts SET balance = balance + ? WHERE id = ?",
                  ).run(transaction.amount, transaction.account_id);
                } else if (transaction.type === "income") {
                  db.prepare(
                    "UPDATE cash_accounts SET balance = balance - ? WHERE id = ?",
                  ).run(transaction.amount, transaction.account_id);
                }
              }
            }
          }
        }

        db.prepare(
          "DELETE FROM procurement_items WHERE procurement_id = ?",
        ).run(id);
        const deleted = db.prepare(
          "DELETE FROM procurements WHERE id = ?",
        ).run(id);
        if (deleted.changes !== 1) {
          throw new StaffServiceError("procurement_conflict", 409);
        }
      });

      tx.immediate();
      syncGroupsForProducts(items.map((item) => item.product_id));

      res.json({ ok: true });
    } catch (error) {
      console.error("[crm] Delete procurement error:", error);
      if (isStaffServiceError(error)) {
        return sendStaffServiceError(res, error);
      }
      if (
        error.message &&
        error.message.startsWith("insufficient_stock_to_rollback")
      ) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

// Удаление оплаты по закупке
crmOperationsRouter.delete(
  "/api/admin/crm/procurements/:id/payment",
  authMiddleware,
  (req, res) => {
    try {
      const { id } = req.params;

      const procurement = db
        .prepare("SELECT * FROM procurements WHERE id = ?")
        .get(id);
      if (!procurement) {
        return res.status(404).json({ error: "not_found" });
      }

      if (!procurement.expense_transaction_id) {
        return res.status(400).json({ error: "payment_not_found" });
      }

      const transaction = db
        .prepare("SELECT * FROM cash_transactions WHERE id = ?")
        .get(procurement.expense_transaction_id);

      const tx = db.transaction(() => {
        if (transaction) {
          db.prepare("DELETE FROM cash_transactions WHERE id = ?").run(
            transaction.id,
          );
          if (transaction.account_id && transaction.amount) {
            if (transaction.type === "expense") {
              db.prepare(
                "UPDATE cash_accounts SET balance = balance + ? WHERE id = ?",
              ).run(transaction.amount, transaction.account_id);
            } else if (transaction.type === "income") {
              db.prepare(
                "UPDATE cash_accounts SET balance = balance - ? WHERE id = ?",
              ).run(transaction.amount, transaction.account_id);
            }
          }
        }

        db.prepare(
          "UPDATE procurements SET expense_transaction_id = NULL WHERE id = ?",
        ).run(id);
      });

      tx();

      const updated = db
        .prepare("SELECT * FROM procurements WHERE id = ?")
        .get(id);
      res.json(updated);
    } catch (error) {
      console.error("[crm] Remove procurement payment error:", error);
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

// Подтверждение закупки (увеличение остатков)
crmOperationsRouter.post(
  "/api/admin/crm/procurements/:id/complete",
  authMiddleware,
  requireDocumentActor,
  (req, res) => {
    try {
      const { id } = req.params;

      const procurement = db
        .prepare("SELECT * FROM procurements WHERE id = ?")
        .get(id);
      if (!procurement) {
        return res.status(404).json({ error: "not_found" });
      }

      if (procurement.status === "completed") {
        return res.status(400).json({ error: "already_completed" });
      }

      let items = db
        .prepare("SELECT * FROM procurement_items WHERE procurement_id = ? ORDER BY rowid ASC")
        .all(id);

      const tx = db.transaction(() => {
        const actor = recheckDocumentActor(req);
        const freshProcurement = db
          .prepare("SELECT * FROM procurements WHERE id = ?")
          .get(id);
        if (!freshProcurement) {
          throw new StaffServiceError("not_found", 404);
        }
        if (freshProcurement.status === "completed") {
          throw new StaffServiceError("already_completed", 409);
        }
        if (freshProcurement.status !== "draft") {
          throw new StaffServiceError("invalid_status", 409);
        }
        items = db
          .prepare(
            "SELECT * FROM procurement_items WHERE procurement_id = ? ORDER BY rowid ASC",
          )
          .all(id);
        if (!items.length) {
          throw new StaffServiceError("items_required", 409);
        }
        for (const item of items) {
          const product = db
            .prepare("SELECT id, has_variants FROM products WHERE id = ?")
            .get(item.product_id);
          if (!product) {
            throw new StaffServiceError("product_not_found", 409);
          }
          const quantity = Number(item.quantity || 0);
          const warehouseQuantity = Number(item.warehouse_quantity || 0);
          const costPerUnit = Number(item.cost_per_unit || 0);
          if (
            !Number.isInteger(quantity)
            || quantity <= 0
            || !Number.isInteger(warehouseQuantity)
            || warehouseQuantity < 0
            || warehouseQuantity > quantity
            || !Number.isFinite(costPerUnit)
            || costPerUnit < 0
          ) {
            throw new StaffServiceError("invalid_procurement_item", 409);
          }
          if (Number(product.has_variants || 0) === 1 && !item.variant_id) {
            throw new StaffServiceError("variant_required", 409);
          }
          if (Number(product.has_variants || 0) === 0 && item.variant_id) {
            throw new StaffServiceError("variant_not_allowed", 409);
          }
          const retailQuantity = quantity - warehouseQuantity;
          const avgCost = calculateAverageCost(
            item.product_id,
            quantity,
            costPerUnit,
          );
          // Проверяем, это вариант или обычный товар
          if (item.variant_id) {
            const variant = db.prepare(
              "SELECT id FROM product_variants WHERE id = ? AND product_id = ?",
            ).get(item.variant_id, item.product_id);
            if (!variant) {
              throw new StaffServiceError("variant_not_found", 409);
            }
            const updatedVariant = db.prepare(
              `UPDATE product_variants
               SET stock = stock + ?, warehouse_stock = warehouse_stock + ?
               WHERE id = ? AND product_id = ?`
            ).run(
              retailQuantity,
              warehouseQuantity,
              item.variant_id,
              item.product_id,
            );
            if (updatedVariant.changes !== 1) {
              throw new StaffServiceError("variant_not_found", 409);
            }

            const updatedProduct = db.prepare(
              `UPDATE products SET cost_price = ? WHERE id = ?`
            ).run(avgCost, item.product_id);
            if (updatedProduct.changes !== 1) {
              throw new StaffServiceError("product_not_found", 409);
            }
          } else {
            const updatedProduct = db.prepare(
              `
            UPDATE products 
            SET stock = stock + ?,
                warehouse_stock = warehouse_stock + ?,
                cost_price = ?
            WHERE id = ?
          `,
            ).run(retailQuantity, warehouseQuantity, avgCost, item.product_id);
            if (updatedProduct.changes !== 1) {
              throw new StaffServiceError("product_not_found", 409);
            }
          }
        }

        // Обновляем статус закупки
        const completed = db.prepare(
          `
        UPDATE procurements 
        SET status = 'completed',
            completed_at = DATETIME('now'),
            accepted_by_employee_id = ?
        WHERE id = ? AND status = 'draft'
      `,
        ).run(actor?.employeeId || null, id);
        if (completed.changes !== 1) {
          throw new StaffServiceError("already_completed", 409);
        }

        // Списываем деньги из кассы. Кассы по умолчанию может не оказаться:
        // тогда приёмку надо остановить, а не принять молча. Иначе товар
        // приходит на склад, expense_transaction_id остаётся пустым, деньги из
        // кассы не уходят, и расхождение всплывает только при сверке.
        const defaultAccount = db
          .prepare("SELECT id FROM cash_accounts WHERE is_default = 1 AND active = 1 LIMIT 1")
          .get();
        if (!defaultAccount) {
          throw new StaffServiceError("cash_account_required", 409);
        }

        const transId = generateId("trans");
        db.prepare(
          `
          INSERT INTO cash_transactions (
            id, account_id, type, amount, description, employee_id
          )
          VALUES (?, ?, 'expense', ?, ?, ?)
        `,
        ).run(
          transId,
          defaultAccount.id,
          freshProcurement.total_amount,
          `Закупка #${procurement.procurement_number}`,
          actor?.employeeId || null,
        );

        db.prepare(
          "UPDATE cash_accounts SET balance = balance - ? WHERE id = ?",
        ).run(freshProcurement.total_amount, defaultAccount.id);

        db.prepare(
          `
          UPDATE procurements
          SET expense_transaction_id = ?
          WHERE id = ?
        `,
        ).run(transId, id);

        if (actor) {
          const eventKey = `procurement:${id}:accepted`;
          recordSystemStaffEvent({
            employeeId: actor.employeeId,
            eventType: "procurement_accepted",
            entityType: "procurement",
            entityId: id,
            idempotencyKey: eventKey,
            sourceNumber: freshProcurement.procurement_number,
            sourceType: "procurement",
            sourceName: freshProcurement.supplier_name || "Без поставщика",
            payload: {
              total_amount: Number(freshProcurement.total_amount || 0),
              item_count: items.length,
            },
          });
          enqueueInternalNotificationForGroup(db, {
            eventGroup: "documents",
            uniqueKey: eventKey,
            eventType: "procurement.accepted",
            payload: {
              document_number: freshProcurement.procurement_number,
              employee_name: actor.employeeName,
            },
          });
        }
      });

      tx.immediate();
      syncGroupsForProducts(items.map((item) => item.product_id));

      const updated = db
        .prepare("SELECT * FROM procurements WHERE id = ?")
        .get(id);
      res.json(updated);
    } catch (error) {
      console.error("[crm] Complete procurement error:", error);
      if (isStaffServiceError(error)) {
        return sendStaffServiceError(res, error);
      }
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

// =========================
// ARCHIVING (Архивация старых заказов)
// =========================
crmOperationsRouter.post(
  "/api/admin/crm/archive-delivered-orders",
  authMiddleware,
  requireOrderShift,
  (req, res) => {
    try {
      console.log("[crm] Manual archiving triggered");
      let result = null;
      const tx = db.transaction(() => {
        recheckOrderShift(req);
        result = archiveOldDeliveredOrders();
        if (result?.error) {
          throw new Error(result.error);
        }
      });
      tx.immediate();
      res.json({
        ok: true,
        ...result,
      });
    } catch (error) {
      console.error("[crm] Manual archiving error:", error);
      if (isStaffServiceError(error)) {
        return sendStaffServiceError(res, error);
      }
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

// Debug endpoint для проверки delivered заказов
crmOperationsRouter.get(
  "/api/admin/crm/debug-delivered-orders",
  authMiddleware,
  (req, res) => {
    try {
      const now = new Date();
      const { start: startOfToday } = getBusinessPeriodRange("today");

      const orders = db
        .prepare(
          `
      SELECT
        id,
        order_number,
        status,
        completed_at,
        created_at,
        CASE
          WHEN completed_at IS NULL THEN 'NULL'
          WHEN completed_at < ? THEN 'OLD (should be deleted)'
          ELSE 'TODAY (should be visible)'
        END as classification
      FROM orders
      WHERE status = 'delivered'
      ORDER BY completed_at DESC
      LIMIT 20
    `,
        )
        .all(startOfToday.toISOString());

      res.json({
        currentTime: now.toISOString(),
        startOfToday: startOfToday.toISOString(),
        orders,
      });
    } catch (error) {
      console.error("[crm] Debug endpoint error:", error);
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

// Исправление completed_at для delivered заказов где он NULL
crmOperationsRouter.post(
  "/api/admin/crm/fix-delivered-completed-at",
  authMiddleware,
  requireOrderShift,
  (req, res) => {
    try {
      console.log("[crm] Fixing delivered orders without completed_at");

      let ordersToFix = [];

      const tx = db.transaction(() => {
        recheckOrderShift(req);
        ordersToFix = db
          .prepare(
            `
          SELECT id, order_number, created_at, completed_at, paid_at
          FROM orders
          WHERE status = 'delivered' AND completed_at IS NULL
        `,
          )
          .all();
        for (const order of ordersToFix) {
          const completedDate = order.paid_at || order.created_at;
          let isoDate;

          if (completedDate && completedDate.includes("T")) {
            isoDate = completedDate;
          } else if (completedDate) {
            isoDate = new Date(completedDate + " UTC").toISOString();
          } else {
            isoDate = new Date().toISOString();
          }

          db.prepare("UPDATE orders SET completed_at = ? WHERE id = ?").run(
            isoDate,
            order.id,
          );
        }
      });

      tx.immediate();

      res.json({
        ok: true,
        fixed: ordersToFix.length,
        ...(ordersToFix.length === 0
          ? { message: "No orders to fix" }
          : {}),
      });
    } catch (error) {
      console.error("[crm] Fix completed_at error:", error);
      if (isStaffServiceError(error)) {
        return sendStaffServiceError(res, error);
      }
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

// Продолжение следует...
