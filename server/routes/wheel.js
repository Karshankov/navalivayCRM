import express from "express";
import rateLimit from "express-rate-limit";
import { db } from "../db.js";
import { authMiddleware } from "../auth.js";
import {
  isInsecureTelegramFallbackEnabled,
  requireTelegramMiniAppAuth,
} from "../telegram-miniapp-auth.js";
import { normalizeTelegramUsername } from "../loyalty.js";
import { resolveWholesaleContextFromRequest } from "../wholesale-service.js";
import {
  accrueWheelSpinsForOrder,
  createPrize,
  deletePrize,
  getAdminDashboard,
  getWheelAccessState,
  getCustomerWheelState,
  getWheelSettings,
  listAdminRarityRules,
  listAdminPrizes,
  listAdminSpinAudit,
  listAdminSpins,
  listRarities,
  registerCustomerProfitForEpicPools,
  setFeedConsent,
  spinWheelForCustomer,
  prizeDisplayTitle,
  prizeDisplayDescription,
  spinPrizeDisplayTitle,
  spinPrizeDisplayDescription,
  updateRarityRule,
  updatePrize,
  updateWheelSettings,
  validatePrizePayload,
  validateRarityRulePayload,
  validateWheelSettingsPayload,
} from "../wheel/wheel-service.js";

export const wheelRouter = express.Router();

/**
 * Detect whether a thrown error came from the wheel_spins idempotency
 * UNIQUE index. Round 4 fix: previously the route inlined a substring
 * match on the SQLite error message, but better-sqlite3 does not
 * guarantee the index name is in the message — partial-index UNIQUE
 * violations sometimes surface as "UNIQUE constraint failed:
 * wheel_spins.customer_id, wheel_spins.idempotency_key" (column form,
 * no index name). We now key on `error.code` which better-sqlite3
 * always sets to a `SQLITE_CONSTRAINT*` token.
 *
 * Exported so the route test can verify the predicate against the
 * different error-message shapes SQLite produces in the wild without
 * having to spawn a real race.
 */
export function isWheelIdempotencyConflict(error, idempotencyKey) {
  if (!idempotencyKey) return false;
  const errorCode = String(error?.code || "");
  if (!errorCode) return false;
  return (
    errorCode === "SQLITE_CONSTRAINT_UNIQUE" ||
    errorCode === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    errorCode.startsWith("SQLITE_CONSTRAINT")
  );
}

const allowInsecureTelegramFallback = isInsecureTelegramFallbackEnabled();

// S2-N6: even when ALLOW_INSECURE_TELEGRAM_AUTH is on (staging dev tools),
// the wheel feed still ships real customer first names and Telegram
// avatars. That's PII in a context where the consumer of the API may
// not have a verified Telegram identity. Operators can opt out via
// WHEEL_FEED_REDACT_PII=1 (defaults to staging-on / production-off).
// Production keeps the original behaviour because customers there
// are always behind initData verification.
const wheelFeedRedactPii =
  process.env.WHEEL_FEED_REDACT_PII === "1" ||
  (allowInsecureTelegramFallback && process.env.WHEEL_FEED_REDACT_PII !== "0");

const wheelReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

const wheelSpinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

function findCustomerFromAuth(req) {
  const telegramId = String(req.telegramAuth?.telegramId || "").trim();
  const telegramUsername = normalizeTelegramUsername(req.telegramAuth?.telegramUsername);
  if (telegramId) {
    const byId = db
      .prepare("SELECT * FROM customers WHERE telegram_id = ?")
      .get(telegramId);
    if (byId) return byId;
  }
  if (telegramUsername) {
    return db
      .prepare(
        "SELECT * FROM customers WHERE LOWER(COALESCE(telegram_username, '')) = LOWER(?) LIMIT 1",
      )
      .get(telegramUsername);
  }
  return null;
}

/**
 * Resolve wholesale context for wheel routes.
 *
 * B4 fix: previously this checked only that the headers were present,
 * which let any retail client forge `X-Wholesale-Code` /
 * `X-Wholesale-Secret` from DevTools and read the wholesale prize pool.
 * Now we delegate to resolveWholesaleContextFromRequest which validates
 * tier+secret against wholesale_tiers. On read endpoints we fall back
 * to retail (return false) instead of 403, so stale or malformed
 * headers do not break UX — the customer simply sees the retail wheel.
 */
function isValidatedWholesaleRequest(req) {
  try {
    const context = resolveWholesaleContextFromRequest(req);
    return Boolean(context?.isWholesale);
  } catch (_error) {
    // Bad creds (wrong tier/secret pair, missing half of the pair, etc.)
    // are treated as retail rather than rejected outright. If the legit
    // wholesale link is broken the customer can still browse.
    return false;
  }
}

// P3: structured admin-action logger. The actor is whichever username
// jwt-decoded into req.user; if the route bypassed auth in tests we
// fall back to "unknown". Mirrors logWheelEvent in wheel-service.js
// but keeps the actor binding here so the service stays admin-agnostic.
function logAdminAction(req, action, entityId, payload = null) {
  try {
    const actor = req?.user?.u || req?.user?.username || "unknown";
    console.log(
      JSON.stringify({
        ev: "wheel_admin_action",
        ts: new Date().toISOString(),
        actor_id: actor,
        action,
        entity_id: entityId || null,
        payload: payload || null,
      }),
    );
  } catch (_error) {
    // Never let logging crash the response.
  }
}

wheelRouter.get(
  "/api/wheel/state",
  wheelReadLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
    try {
      const customer = findCustomerFromAuth(req);
      const isWholesale = isValidatedWholesaleRequest(req);
      const state = getCustomerWheelState(customer?.id || null, {
        isWholesale,
        telegramUsername: req.telegramAuth?.telegramUsername || "",
      });
      // S2-N6: when the request authenticated only via the insecure
      // fallback (no verified Telegram identity), strip avatars/names
      // from the public feed before responding. The feed becomes a list
      // of "Гость → Приз" entries that still proves the wheel is alive
      // without leaking real customer PII to anonymous staging callers.
      const usedInsecureFallback = req.telegramAuth?.source === "insecure";
      if (wheelFeedRedactPii && usedInsecureFallback) {
        state.feed = state.feed.map((entry) => ({
          ...entry,
          first_name: "Гость",
          last_initial: "",
          photo: null,
        }));
      }
      res.json({
        customer_id: customer?.id || null,
        is_wholesale: isWholesale,
        ...state,
      });
    } catch (error) {
      console.error("[wheel] state failed", error);
      res.status(500).json({ error: "wheel_state_failed", message: error.message });
    }
  },
);

wheelRouter.post(
  "/api/wheel/spin",
  wheelSpinLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
    // Hoisted so the catch block can see them when responding to a
    // late-arriving idempotency UNIQUE conflict.
    let idempotencyKey = "";
    let isWholesale = false;
    try {
      const customer = findCustomerFromAuth(req);
      if (!customer?.id) {
        return res
          .status(404)
          .json({ error: "customer_not_found", message: "Клиент не найден" });
      }
      isWholesale = isValidatedWholesaleRequest(req);
      const access = getWheelAccessState(req.telegramAuth?.telegramUsername || "");
      if (!access.is_allowed) {
        return res.status(403).json({
          error: "wheel_locked",
          message: "Рулетка пока доступна только участникам тестирования",
        });
      }

      // P1: idempotency. Mini App network is flaky and a retried POST
      // would otherwise consume a second spin. Header is optional —
      // legacy clients keep working — but recommended for any frontend
      // that retries. We accept length 16-128 to leave room for both
      // crypto.randomUUID() (36 chars) and shorter NanoID-like keys
      // while rejecting obvious abuse (1-byte keys would collide
      // across customers; 1MB keys would balloon the index).
      const rawIdempotencyKey =
        typeof req.get === "function"
          ? req.get("Idempotency-Key") || req.get("idempotency-key")
          : null;
      idempotencyKey =
        typeof rawIdempotencyKey === "string"
          ? rawIdempotencyKey.trim()
          : "";
      if (idempotencyKey && (idempotencyKey.length < 16 || idempotencyKey.length > 128)) {
        return res
          .status(400)
          .json({ error: "invalid_idempotency_key", message: "Idempotency-Key length 16-128" });
      }

      // Lookup an existing spin for the same (customer_id,
      // idempotency_key) BEFORE the transaction — if found, return its
      // payload verbatim. This is safe because wheel_spins rows are
      // append-only post-commit, so the data we return is exactly what
      // the original POST returned.
      if (idempotencyKey) {
        const existing = db
          .prepare(
            `SELECT s.*,
                    CASE WHEN s.rarity_code = 'nothing' THEN 'Без выигрыша' ELSE p.title END AS prize_title,
                    CASE WHEN s.rarity_code = 'nothing' THEN NULL ELSE p.description END AS prize_description,
                    CASE WHEN s.rarity_code = 'nothing' THEN NULL ELSE p.image_url END AS prize_image_url
             FROM wheel_spins s
             LEFT JOIN wheel_prizes p ON p.id = s.prize_id
             WHERE s.customer_id = ? AND s.idempotency_key = ?`,
          )
          .get(customer.id, idempotencyKey);
        if (existing) {
          const balanceRow = db
            .prepare(
              "SELECT spins_available, accumulated_retail_byn, accumulated_wholesale_byn FROM wheel_customer_balances WHERE customer_id = ?",
            )
            .get(customer.id);
          return res.json({
            spin_id: existing.id,
            prize: {
              id: existing.prize_id,
              title: existing.prize_title,
              description: existing.prize_description,
              image_url: existing.prize_image_url,
              rarity_code: existing.rarity_code,
            },
            is_epic_release: Boolean(existing.is_epic_release),
            is_pity_release: Boolean(existing.is_pity_release),
            promo_code: existing.rarity_code === "nothing" ? null : existing.generated_promo_code || null,
            promo_valid_until: existing.rarity_code === "nothing" ? null : existing.promo_valid_until || null,
            animation_seed: Number(existing.seed_for_animation || 0),
            spins_left: Number(balanceRow?.spins_available || 0),
            accumulated_byn: isWholesale
              ? Number(balanceRow?.accumulated_wholesale_byn || 0)
              : Number(balanceRow?.accumulated_retail_byn || 0),
            idempotent_replay: true,
          });
        }
      }

      const result = spinWheelForCustomer({
        customerId: customer.id,
        isWholesale,
        idempotencyKey: idempotencyKey || null,
      });

      const balanceRow = db
        .prepare(
          "SELECT spins_available, accumulated_retail_byn, accumulated_wholesale_byn FROM wheel_customer_balances WHERE customer_id = ?",
        )
        .get(customer.id);

      res.json({
        spin_id: result.spinId,
        prize: {
          id: result.prize.id,
          title: result.prize.title,
          description: result.prize.description,
          image_url: result.prize.image_url,
          rarity_code: result.prize.rarity_code,
        },
        is_epic_release: Boolean(result.isEpicRelease),
        is_pity_release: Boolean(result.isPityRelease),
        promo_code: result.promo?.code || null,
        promo_valid_until: result.promo?.validUntil || null,
        animation_seed: result.seed,
        spins_left: balanceRow?.spins_available || 0,
        accumulated_byn: isWholesale
          ? Number(balanceRow?.accumulated_wholesale_byn || 0)
          : Number(balanceRow?.accumulated_retail_byn || 0),
      });
    } catch (error) {
      // P1 race: two simultaneous POSTs with the same Idempotency-Key
      // both pass the pre-transaction lookup, then the second INSERT
      // hits the UNIQUE index. Treat that as "the other request won"
      // and return its row instead of bubbling a 500.
      //
      // Round 4 fix: previously this matched on `error.message.includes(
      // "idx_wheel_spins_idempotency")`, but better-sqlite3 does not
      // guarantee the index name is in the message. SQLite UNIQUE
      // partial-index violations sometimes surface as "UNIQUE
      // constraint failed: wheel_spins.customer_id,
      // wheel_spins.idempotency_key" (column form, no index name).
      // Switching to error.code === SQLITE_CONSTRAINT_UNIQUE catches
      // both forms; we then re-lookup the (customer_id,
      // idempotency_key) row to confirm it exists. If the lookup
      // misses, the UNIQUE conflict was on a different column → we
      // bubble the original 500 so the bug is not silently masked.
      const isIdempotencyConflict = isWheelIdempotencyConflict(error, idempotencyKey);
      if (isIdempotencyConflict) {
        const customerForReplay = findCustomerFromAuth(req);
        const customerIdForReplay = customerForReplay?.id;
        if (customerIdForReplay) {
          const replay = db
            .prepare(
              `SELECT s.*,
                      p.title AS prize_title_stored,
                      p.description AS prize_description_stored,
                      pc.description AS promo_description,
                      pc.customer_description AS promo_customer_description,
                      pc.code AS promo_template_code,
                      CASE WHEN s.rarity_code = 'nothing' THEN NULL ELSE p.image_url END AS prize_image_url
               FROM wheel_spins s
               LEFT JOIN wheel_prizes p ON p.id = s.prize_id
               LEFT JOIN promo_codes pc ON pc.id = p.promo_template_id
               WHERE s.customer_id = ? AND s.idempotency_key = ?`,
            )
            .get(customerIdForReplay, idempotencyKey);
          if (replay) {
            const balanceRow = db
              .prepare(
                "SELECT spins_available, accumulated_retail_byn, accumulated_wholesale_byn FROM wheel_customer_balances WHERE customer_id = ?",
              )
              .get(customerIdForReplay);
            return res.json({
              spin_id: replay.id,
              prize: {
                id: replay.prize_id,
                title: spinPrizeDisplayTitle(replay),
                description: spinPrizeDisplayDescription(replay),
                image_url: replay.prize_image_url,
                rarity_code: replay.rarity_code,
              },
              is_epic_release: Boolean(replay.is_epic_release),
              is_pity_release: Boolean(replay.is_pity_release),
              promo_code: replay.rarity_code === "nothing" ? null : replay.generated_promo_code || null,
              promo_valid_until: replay.rarity_code === "nothing" ? null : replay.promo_valid_until || null,
              animation_seed: Number(replay.seed_for_animation || 0),
              spins_left: Number(balanceRow?.spins_available || 0),
              accumulated_byn: isWholesale
                ? Number(balanceRow?.accumulated_wholesale_byn || 0)
                : Number(balanceRow?.accumulated_retail_byn || 0),
              idempotent_replay: true,
            });
          }
        }
        // No matching spin found for this (customer_id,
        // idempotency_key) → the UNIQUE conflict was unrelated to our
        // partial index. Fall through to the generic error handler so
        // the underlying bug is visible instead of masquerading as a
        // successful replay of a non-existent spin.
      }

      const knownErrors = new Set([
        "not_enough_spins",
        "no_prizes_configured",
        "no_prizes_available",
        "customer_required",
      ]);
      if (knownErrors.has(error.code)) {
        return res
          .status(400)
          .json({ error: error.code, message: error.message });
      }
      console.error("[wheel] spin failed", error);
      res.status(500).json({ error: "wheel_spin_failed", message: error.message });
    }
  },
);

/**
 * Q6: persist the customer's live-feed PII consent (or refusal). The
 * frontend posts here both from the first-visit modal and the toggle
 * in ProfileView. Body: { consent: boolean }. Anonymous callers (no
 * customer row) get 404.
 */
wheelRouter.post(
  "/api/wheel/feed-consent",
  wheelReadLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
    try {
      const customer = findCustomerFromAuth(req);
      if (!customer?.id) {
        return res
          .status(404)
          .json({ error: "customer_not_found", message: "Клиент не найден" });
      }
      const access = getWheelAccessState(req.telegramAuth?.telegramUsername || "");
      if (!access.is_allowed) {
        return res.status(403).json({
          error: "wheel_locked",
          message: "Рулетка пока доступна только участникам тестирования",
        });
      }
      const consent = Boolean(req.body?.consent);
      const result = setFeedConsent(customer.id, consent);
      if (!result) {
        return res
          .status(404)
          .json({ error: "customer_not_found", message: "Клиент не найден" });
      }
      res.json({ success: true, ...result });
    } catch (error) {
      console.error("[wheel] feed-consent failed", error);
      res.status(500).json({ error: "wheel_feed_consent_failed", message: error.message });
    }
  },
);

wheelRouter.get(
  "/api/wheel/my-prizes",
  wheelReadLimiter,
  requireTelegramMiniAppAuth({ allowInsecureFallback: allowInsecureTelegramFallback }),
  (req, res) => {
    try {
      const customer = findCustomerFromAuth(req);
      if (!customer?.id) {
        return res.json({ prizes: [] });
      }
      const access = getWheelAccessState(req.telegramAuth?.telegramUsername || "");
      if (!access.is_allowed) {
        return res.status(403).json({
          error: "wheel_locked",
          message: "Рулетка пока доступна только участникам тестирования",
        });
      }
      const status = String(req.query?.status || "all");
      let where = "s.customer_id = ? AND s.rarity_code != 'nothing'";
      if (status === "active") {
        where +=
          " AND s.prize_used_at IS NULL AND (s.promo_valid_until IS NULL OR DATE(s.promo_valid_until) >= DATE('now'))";
      } else if (status === "used") {
        where += " AND s.prize_used_at IS NOT NULL";
      } else if (status === "expired") {
        where +=
          " AND s.prize_used_at IS NULL AND s.promo_valid_until IS NOT NULL AND DATE(s.promo_valid_until) < DATE('now')";
      }

      const rows = db
        .prepare(
          `SELECT s.*,
                  p.title AS prize_title,
                  p.description AS prize_description,
                  p.rarity_code AS prize_rarity_code,
                  p.promo_template_id,
                  pc.code AS promo_template_code,
                  pc.description AS promo_description,
                  pc.customer_description AS promo_customer_description,
                  p.image_url AS prize_image_url,
                  r.label AS rarity_label,
                  r.bg_color AS rarity_bg,
                  r.text_color AS rarity_text
           FROM wheel_spins s
           JOIN wheel_prizes p ON p.id = s.prize_id
           LEFT JOIN promo_codes pc ON pc.id = p.promo_template_id
           LEFT JOIN wheel_rarities r ON r.code = s.rarity_code
           WHERE ${where}
           ORDER BY s.spun_at DESC
           LIMIT 100`,
        )
        .all(customer.id);

      res.json({
        prizes: rows.map((row) => ({
          spin_id: row.id,
          prize_title: spinPrizeDisplayTitle(row),
          prize_description: spinPrizeDisplayDescription(row),
          prize_image_url: row.prize_image_url,
          rarity_code: row.rarity_code,
          rarity_label: row.rarity_label,
          rarity_bg: row.rarity_bg,
          rarity_text: row.rarity_text,
          promo_code: row.generated_promo_code,
          promo_valid_until: row.promo_valid_until,
          spun_at: row.spun_at,
          prize_used_at: row.prize_used_at,
          is_epic_release: Boolean(row.is_epic_release),
        })),
      });
    } catch (error) {
      console.error("[wheel] my prizes failed", error);
      res.status(500).json({ error: "wheel_my_prizes_failed", message: error.message });
    }
  },
);

wheelRouter.get(
  "/api/admin/crm/wheel/settings",
  authMiddleware,
  (req, res) => {
    try {
      res.json(getWheelSettings());
    } catch (error) {
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

wheelRouter.put(
  "/api/admin/crm/wheel/settings",
  authMiddleware,
  (req, res) => {
    try {
      // S5: surface validation errors as 400 with details so the CRM
      // can show actionable feedback instead of a generic toast.
      const { errors } = validateWheelSettingsPayload(req.body || {});
      if (errors.length) {
        return res.status(400).json({ error: "validation_failed", details: errors });
      }
      const updated = updateWheelSettings(req.body || {});
      logAdminAction(req, "update_settings", null, req.body || {});
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

// S17: dedicated endpoint for the rarity dictionary so CrmWheel can
// populate the prize-form select even before any prizes exist. Without
// this, the manager could not save the very first prize because the
// rarity dropdown was empty.
wheelRouter.get(
  "/api/admin/crm/wheel/rarities",
  authMiddleware,
  (req, res) => {
    try {
      res.json({ rarities: listAdminRarityRules() });
    } catch (error) {
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

wheelRouter.put(
  "/api/admin/crm/wheel/rarities/:code",
  authMiddleware,
  (req, res) => {
    try {
      const { errors } = validateRarityRulePayload(req.params.code, req.body || {});
      if (errors.length) {
        return res.status(400).json({ error: "validation_failed", details: errors });
      }
      const updated = updateRarityRule(req.params.code, req.body || {});
      if (!updated) {
        return res.status(404).json({ error: "not_found" });
      }
      logAdminAction(req, "update_rarity_rule", req.params.code, req.body || {});
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

wheelRouter.get(
  "/api/admin/crm/wheel/prizes",
  authMiddleware,
  (req, res) => {
    try {
      res.json({
        prizes: listAdminPrizes(),
      });
    } catch (error) {
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

wheelRouter.post(
  "/api/admin/crm/wheel/prizes",
  authMiddleware,
  (req, res) => {
    try {
      const { errors } = validatePrizePayload(req.body || {});
      if (errors.length) {
        return res.status(400).json({ error: "validation_failed", details: errors });
      }
      const created = createPrize(req.body || {});
      logAdminAction(req, "create_prize", created?.id || null, req.body || {});
      res.json(created);
    } catch (error) {
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

wheelRouter.put(
  "/api/admin/crm/wheel/prizes/:id",
  authMiddleware,
  (req, res) => {
    try {
      // C3-CR: load the row first so validatePrizePayload can fall back
      // to existing values for fields the partial PATCH didn't touch.
      const existing = db
        .prepare("SELECT * FROM wheel_prizes WHERE id = ?")
        .get(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }
      const { errors } = validatePrizePayload(req.body || {}, {
        isUpdate: true,
        existing,
      });
      if (errors.length) {
        return res.status(400).json({ error: "validation_failed", details: errors });
      }
      const updated = updatePrize(req.params.id, req.body || {});
      if (!updated) {
        return res.status(404).json({ error: "not_found" });
      }
      logAdminAction(req, "update_prize", req.params.id, req.body || {});
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

wheelRouter.delete(
  "/api/admin/crm/wheel/prizes/:id",
  authMiddleware,
  (req, res) => {
    try {
      deletePrize(req.params.id);
      logAdminAction(req, "delete_prize", req.params.id, null);
      res.json({ ok: true });
    } catch (error) {
      if (Number(error?.status || 0) === 404) {
        return res.status(404).json({ error: error.code || "not_found" });
      }
      if (Number(error?.status || 0) === 409) {
        return res.status(409).json({
          error: error.code || "conflict",
          message: error.message,
        });
      }
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

wheelRouter.get(
  "/api/admin/crm/wheel/dashboard",
  authMiddleware,
  (req, res) => {
    try {
      res.json(getAdminDashboard());
    } catch (error) {
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

wheelRouter.get(
  "/api/admin/crm/wheel/spins",
  authMiddleware,
  (req, res) => {
    try {
      const { limit, offset, customer_id, rarity } = req.query || {};
      res.json(
        listAdminSpins({
          limit,
          offset,
          customerId: customer_id || null,
          rarity: rarity || null,
        }),
      );
    } catch (error) {
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

wheelRouter.get(
  "/api/admin/crm/wheel/audit",
  authMiddleware,
  (req, res) => {
    try {
      // Read-only export for probability audits. The service returns raw
      // JSON decision blobs (effective chance map, RNG roll, availability)
      // so another agent can verify distribution math without querying
      // sensitive promo/auth data.
      const { limit, offset, from, to, rarity } = req.query || {};
      res.json(
        listAdminSpinAudit({
          limit,
          offset,
          from: from || null,
          to: to || null,
          rarity: rarity || null,
        }),
      );
    } catch (error) {
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);

wheelRouter.post(
  "/api/admin/crm/wheel/recompute-customer/:id",
  authMiddleware,
  (req, res) => {
    try {
      const customerId = String(req.params.id || "").trim();
      if (!customerId) {
        return res.status(400).json({ error: "customer_required" });
      }
      // S10: only delivered orders accrue spins on the wheel. Match the
      // canonical filter so this admin tool replays exactly the same
      // set of orders the live accrual hook would have processed.
      //
      // S6: thanks to the wheel_balance_ledger introduced in B3, this
      // loop is now safely idempotent — replaying delivered orders that
      // have already been ledger-recorded is a no-op. Manager sees
      // accrued_spins = 0 in that case.
      const orders = db
        .prepare(
          `SELECT id FROM orders
           WHERE customer_id = ?
             AND status = 'delivered'
           ORDER BY COALESCE(completed_at, created_at) ASC`,
        )
        .all(customerId);
      let accruedSpins = 0;
      for (const order of orders) {
        const result = accrueWheelSpinsForOrder(order.id);
        if (result.accrued) accruedSpins += Number(result.spins_added || 0);
      }
      const epic = registerCustomerProfitForEpicPools(customerId);
      res.json({ ok: true, accrued_spins: accruedSpins, pools_updated: epic.updated });
    } catch (error) {
      res.status(500).json({ error: "failed", message: error.message });
    }
  },
);
