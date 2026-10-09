import express from "express";
import rateLimit from "express-rate-limit";
import { db } from "../db.js";
import { authMiddleware } from "../auth.js";
import {
  buildLoyaltyApplication,
  getCustomerLoyaltySnapshot,
  getLoyaltyCategories,
  normalizeTelegramUsername,
  serializeLoyaltySnapshot,
} from "../loyalty.js";
import {
  isInsecureTelegramFallbackEnabled,
  requireTelegramMiniAppAuth,
} from "../telegram-miniapp-auth.js";

export const loyaltyRouter = express.Router();
const allowInsecureTelegramFallback = isInsecureTelegramFallbackEnabled();
const loyaltyReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
const loyaltyMutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function findCustomerByIdentity({ telegramId = "", telegramUsername = "" }) {
  const normalizedUsername = normalizeTelegramUsername(telegramUsername);

  let customer = null;
  if (telegramId) {
    customer = db
      .prepare("SELECT * FROM customers WHERE telegram_id = ?")
      .get(String(telegramId));
  }

  if (!customer && normalizedUsername) {
    customer = db
      .prepare(
        `
        SELECT *
        FROM customers
        WHERE LOWER(COALESCE(telegram_username, '')) = LOWER(?)
        LIMIT 1
      `,
      )
      .get(normalizedUsername);
  }

  return customer || null;
}

function loadMappingsForAdmin() {
  return db
    .prepare(
      `
      SELECT id, loyalty_category_id, category_id, group_id, created_at
      FROM loyalty_category_mappings
      ORDER BY created_at ASC
    `,
    )
    .all();
}

function loadAdminLoyaltyCategoriesPayload() {
  const categories = getLoyaltyCategories();
  const mappings = loadMappingsForAdmin();

  return categories.map((category) => ({
    ...category,
    mappings: mappings.filter(
      (mapping) => mapping.loyalty_category_id === category.id,
    ),
  }));
}

loyaltyRouter.get(
  "/api/loyalty/me",
  loyaltyReadLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
  try {
    const telegramId = String(req.telegramAuth?.telegramId || "").trim();
    const telegramUsername = normalizeTelegramUsername(req.telegramAuth?.telegramUsername);

    const customer = findCustomerByIdentity({
      telegramId,
      telegramUsername,
    });

    const snapshot = getCustomerLoyaltySnapshot(customer?.id || null);
    res.json({
      found: Boolean(customer),
      customer_id: customer?.id || null,
      telegram_username: customer?.telegram_username || normalizeTelegramUsername(telegramUsername) || null,
      ...serializeLoyaltySnapshot(snapshot),
    });
  } catch (error) {
    console.error("[loyalty] Failed to fetch loyalty snapshot:", error);
    res.status(500).json({
      error: "loyalty_me_failed",
      message: "Failed to load loyalty balances",
    });
  }
},
);

loyaltyRouter.post(
  "/api/loyalty/checkout-preview",
  loyaltyMutationLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
  try {
    const {
      promo_code,
      editing_order_id,
      items = [],
    } = req.body || {};

    if (!Array.isArray(items)) {
      return res.status(400).json({
        error: "items_required",
        message: "Items array is required",
      });
    }

    const customer = findCustomerByIdentity({
      telegramId: String(req.telegramAuth?.telegramId || "").trim(),
      telegramUsername: normalizeTelegramUsername(req.telegramAuth?.telegramUsername),
    });

    const application = buildLoyaltyApplication({
      customerId: customer?.id || null,
      items: items.map((item) => ({
        product_id: item.product_id,
        variant_id: item.variant_id || null,
        product_title: item.product_title || null,
        quantity: item.quantity,
        price_per_unit: item.price_per_unit,
        discount_amount: item.discount_amount,
        manual_discount_amount: item.manual_discount_amount,
        loyalty_units_applied: item.loyalty_units_applied,
      })),
      promoCodeText: promo_code || null,
      existingOrderId: editing_order_id || null,
    });

    res.json({
      customer_id: customer?.id || null,
      promo_blocked: application.promo_blocked,
      total_loyalty_discount: application.total_loyalty_discount,
      categories: application.categories,
    });
  } catch (error) {
    const knownErrors = new Set([
      "promo_and_loyalty_conflict",
      "loyalty_category_not_available",
      "loyalty_balance_not_enough",
      "loyalty_category_limit_exceeded",
    ]);
    if (knownErrors.has(error.message)) {
      return res.status(400).json({
        error: error.message,
        message: error.userMessage || error.message,
      });
    }
    console.error("[loyalty] Failed to build checkout preview:", error);
    res.status(500).json({
      error: "checkout_preview_failed",
      message: "Failed to build loyalty preview",
    });
  }
},
);

loyaltyRouter.get("/api/admin/crm/loyalty/categories", authMiddleware, (req, res) => {
  try {
    res.json({
      categories: loadAdminLoyaltyCategoriesPayload(),
    });
  } catch (error) {
    console.error("[loyalty] Failed to fetch admin loyalty categories:", error);
    res.status(500).json({ error: "failed", message: error.message });
  }
});

loyaltyRouter.patch(
  "/api/admin/crm/loyalty/categories/:id",
  authMiddleware,
  (req, res) => {
    try {
      const { id } = req.params;
      const {
        threshold,
        discount_amount,
        title,
        description,
        active,
      } = req.body || {};

      const exists = db
        .prepare("SELECT 1 FROM loyalty_categories WHERE id = ?")
        .get(id);
      if (!exists) {
        return res.status(404).json({ error: "not_found" });
      }

      db.prepare(
        `
        UPDATE loyalty_category_settings
        SET threshold = ?,
            discount_amount = ?,
            title = ?,
            description = ?,
            active = ?,
            updated_at = DATETIME('now')
        WHERE loyalty_category_id = ?
      `,
      ).run(
        Math.max(1, Math.floor(toNumber(threshold, 1))),
        Math.max(0, toNumber(discount_amount, 0)),
        String(title || "").trim() || "Loyalty category",
        description ? String(description).trim() : null,
        Number(active ? 1 : 0),
        id,
      );

      res.json(
        loadAdminLoyaltyCategoriesPayload().find((category) => category.id === id) || null,
      );
    } catch (error) {
      console.error("[loyalty] Failed to update category settings:", error);
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

loyaltyRouter.put(
  "/api/admin/crm/loyalty/categories/:id/mappings",
  authMiddleware,
  (req, res) => {
    try {
      const { id } = req.params;
      const { category_ids = [], group_ids = [] } = req.body || {};

      const exists = db
        .prepare("SELECT 1 FROM loyalty_categories WHERE id = ?")
        .get(id);
      if (!exists) {
        return res.status(404).json({ error: "not_found" });
      }

      const tx = db.transaction(() => {
        db.prepare("DELETE FROM loyalty_category_mappings WHERE loyalty_category_id = ?").run(id);

        const insertStmt = db.prepare(
          `
          INSERT INTO loyalty_category_mappings (id, loyalty_category_id, category_id, group_id)
          VALUES (?, ?, ?, ?)
        `,
        );

        for (const categoryId of Array.isArray(category_ids) ? category_ids : []) {
          if (!categoryId) continue;
          insertStmt.run(generateId("lmap"), id, String(categoryId), null);
        }

        for (const groupId of Array.isArray(group_ids) ? group_ids : []) {
          if (!groupId) continue;
          insertStmt.run(generateId("lmap"), id, null, String(groupId));
        }
      });

      tx();

      res.json(
        loadAdminLoyaltyCategoriesPayload().find((category) => category.id === id) || null,
      );
    } catch (error) {
      console.error("[loyalty] Failed to update mappings:", error);
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

loyaltyRouter.get("/api/admin/crm/loyalty/customers", authMiddleware, (req, res) => {
  try {
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";

    const whereClauses = [];
    const params = [];
    if (search) {
      whereClauses.push(
        "(c.telegram_username LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?)",
      );
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const customers = db
      .prepare(
        `
        SELECT
          c.id,
          c.telegram_username,
          c.first_name,
          c.last_name,
          c.last_visit_at,
          c.updated_at,
          c.last_order_at,
          (
            SELECT MAX(created_at)
            FROM customer_loyalty_ledger l
            WHERE l.customer_id = c.id
          ) AS loyalty_last_activity
        FROM customers c
        ${whereSql}
        ORDER BY COALESCE(c.last_order_at, c.last_visit_at, c.updated_at, c.created_at) DESC
        LIMIT 200
      `,
      )
      .all(...params);

    const snapshotByCustomer = new Map();
    for (const customer of customers) {
      snapshotByCustomer.set(customer.id, getCustomerLoyaltySnapshot(customer.id));
    }

    res.json({
      customers: customers.map((customer) => {
        const snapshot = snapshotByCustomer.get(customer.id) || [];
        return {
          id: customer.id,
          telegram_username: customer.telegram_username || null,
          first_name: customer.first_name || null,
          last_name: customer.last_name || null,
          last_activity_at:
            customer.loyalty_last_activity ||
            customer.last_order_at ||
            customer.last_visit_at ||
            customer.updated_at ||
            null,
          categories: snapshot.map((category) => ({
            key: category.key,
            balance: category.balance,
            available_bonus_count: category.available_bonus_count,
          })),
        };
      }),
    });
  } catch (error) {
    console.error("[loyalty] Failed to fetch loyalty customers:", error);
    res.status(500).json({ error: "failed", message: error.message });
  }
});

loyaltyRouter.get(
  "/api/admin/crm/loyalty/customers/:id/ledger",
  authMiddleware,
  (req, res) => {
    try {
      const { id } = req.params;
      const rows = db
        .prepare(
          `
          SELECT
            l.*,
            lc.key AS category_key,
            s.title AS category_title
          FROM customer_loyalty_ledger l
          JOIN loyalty_categories lc ON lc.id = l.loyalty_category_id
          JOIN loyalty_category_settings s ON s.loyalty_category_id = lc.id
          WHERE l.customer_id = ?
          ORDER BY l.created_at DESC
          LIMIT 200
        `,
        )
        .all(id);

      res.json({ entries: rows });
    } catch (error) {
      console.error("[loyalty] Failed to fetch customer ledger:", error);
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);
