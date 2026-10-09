import express from 'express';
import { db } from '../db.js';
import { authMiddleware } from '../auth.js';

export const promoRouter = express.Router();

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeIsoDate(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeDurationDays(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const intValue = Math.trunc(n);
  if (intValue <= 0) return null;
  return intValue;
}

function computeEffectiveValidUntilDate(validFromDate, durationDays) {
  const start = normalizeIsoDate(validFromDate);
  const duration = normalizeDurationDays(durationDays);
  if (!start || !duration) return null;
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + duration - 1);
  return date.toISOString().slice(0, 10);
}

// =========================
// PROMO CODES (Промокоды) - Admin API
// =========================

// GET /api/admin/crm/promo-codes - список промокодов
promoRouter.get('/api/admin/crm/promo-codes', authMiddleware, (req, res) => {
  try {
    const { search, filter, source = 'regular', limit = 50, offset = 0 } = req.query;

    let whereClause = '1=1';
    const params = [];

    if (search) {
      whereClause += ' AND (pc.code LIKE ? OR pc.description LIKE ? OR pc.customer_description LIKE ? OR pc.manager_description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (filter === 'active') {
      whereClause += " AND pc.active = 1 AND (pc.valid_until IS NULL OR pc.valid_until >= DATETIME('now')) AND (pc.max_uses = 0 OR pc.current_uses < pc.max_uses)";
    } else if (filter === 'expired') {
      whereClause += " AND pc.valid_until IS NOT NULL AND pc.valid_until < DATETIME('now')";
    } else if (filter === 'exhausted') {
      whereClause += ' AND pc.max_uses > 0 AND pc.current_uses >= pc.max_uses';
    } else if (filter === 'inactive') {
      whereClause += ' AND pc.active = 0';
    }

    if (source === 'wheel') {
      whereClause += ` AND (
        pc.is_wheel_template = 1
        OR pc.wheel_owner_customer_id IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM wheel_spins ws
          WHERE ws.generated_promo_code_id = pc.id
          LIMIT 1
        )
      )`;
    } else if (source === 'regular') {
      whereClause += ` AND COALESCE(pc.is_wheel_template, 0) = 0
        AND pc.wheel_owner_customer_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM wheel_spins ws
          WHERE ws.generated_promo_code_id = pc.id
          LIMIT 1
        )`;
    }

    const promoCodesRaw = db.prepare(`
      SELECT
        pc.*,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM wheel_spins ws
            WHERE ws.generated_promo_code_id = pc.id
            LIMIT 1
          ) THEN 1
          ELSE 0
        END as is_wheel_generated,
        COALESCE(stats.reserved_uses, 0) as reserved_uses,
        COALESCE(stats.consumed_uses, 0) as consumed_uses
      FROM promo_codes pc
      LEFT JOIN (
        SELECT
          promo_code_id,
          SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) as reserved_uses,
          SUM(CASE WHEN status = 'consumed' THEN 1 ELSE 0 END) as consumed_uses
        FROM promo_usage
        GROUP BY promo_code_id
      ) stats ON stats.promo_code_id = pc.id
      WHERE ${whereClause}
      ORDER BY pc.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), parseInt(offset));
    const promoCodes = promoCodesRaw.map((promo) => ({
      ...promo,
      effective_valid_until_date: computeEffectiveValidUntilDate(
        promo.valid_from_date,
        promo.duration_days,
      ),
    }));

    const countResult = db.prepare(`
      SELECT COUNT(*) as total FROM promo_codes pc WHERE ${whereClause}
    `).get(...params);

    res.json({
      promo_codes: promoCodes,
      total: countResult.total,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('[promo] Get promo codes error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// GET /api/admin/crm/promo-codes/:id - детали промокода
promoRouter.get('/api/admin/crm/promo-codes/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    const promo = db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(id);
    if (!promo) {
      return res.status(404).json({ error: 'not_found' });
    }

    const usage = db.prepare(`
      SELECT 
        pu.*,
        o.order_number,
        c.telegram_username,
        c.first_name || ' ' || COALESCE(c.last_name, '') as customer_name
      FROM promo_usage pu
      LEFT JOIN orders o ON o.id = pu.order_id
      LEFT JOIN customers c ON c.id = pu.customer_id
      WHERE pu.promo_code_id = ?
        AND pu.status = 'consumed'
      ORDER BY pu.used_at DESC
    `).all(id);

    res.json({
      ...promo,
      effective_valid_until_date: computeEffectiveValidUntilDate(
        promo.valid_from_date,
        promo.duration_days,
      ),
      usage,
    });
  } catch (error) {
    console.error('[promo] Get promo code detail error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// GET /api/admin/crm/promo-codes/:id/usage - история использований
promoRouter.get('/api/admin/crm/promo-codes/:id/usage', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    const usage = db.prepare(`
      SELECT 
        pu.*,
        o.order_number,
        o.final_amount as order_amount,
        c.telegram_username,
        c.first_name || ' ' || COALESCE(c.last_name, '') as customer_name
      FROM promo_usage pu
      LEFT JOIN orders o ON o.id = pu.order_id
      LEFT JOIN customers c ON c.id = pu.customer_id
      WHERE pu.promo_code_id = ?
        AND pu.status = 'consumed'
      ORDER BY pu.used_at DESC
    `).all(id);

    res.json(usage);
  } catch (error) {
    console.error('[promo] Get promo usage error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// POST /api/admin/crm/promo-codes - создать промокод
promoRouter.post('/api/admin/crm/promo-codes', authMiddleware, (req, res) => {
  try {
    const {
      code,
      description,
      customer_description,
      manager_description,
      has_gift = 0,
      discount_type = 'fixed',
      discount_value,
      min_order_amount = 0,
      max_uses = 1,
      valid_from,
      valid_until,
      valid_from_date,
      duration_days,
      is_wheel_template = 0,
      active = true,
    } = req.body;

    if (!code || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ error: 'code_required', message: 'Код промокода обязателен' });
    }

    const normalizedHasGift = has_gift === true || has_gift === 1 || has_gift === '1' ? 1 : 0;
    const numericDiscountValue = Number(discount_value);
    if (discount_value === undefined || discount_value === null || !Number.isFinite(numericDiscountValue) || numericDiscountValue < 0) {
      return res.status(400).json({ error: 'invalid_discount', message: 'Значение скидки не может быть отрицательным' });
    }

    if (!normalizedHasGift && numericDiscountValue <= 0) {
      return res.status(400).json({ error: 'invalid_discount', message: 'Скидка должна быть больше 0, если промокод без подарка' });
    }

    if (!['fixed', 'percent'].includes(discount_type)) {
      return res.status(400).json({ error: 'invalid_discount_type', message: 'Тип скидки: fixed или percent' });
    }

    if (discount_type === 'percent' && numericDiscountValue > 100) {
      return res.status(400).json({ error: 'invalid_percent', message: 'Процент скидки не может быть больше 100' });
    }

    const normalizedFromDate = valid_from_date === undefined ? null : normalizeIsoDate(valid_from_date);
    if (valid_from_date !== undefined && valid_from_date !== null && valid_from_date !== '' && !normalizedFromDate) {
      return res.status(400).json({ error: 'invalid_valid_from_date', message: 'Дата начала должна быть в формате YYYY-MM-DD' });
    }
    const normalizedDuration = normalizeDurationDays(duration_days);
    if (duration_days !== undefined && duration_days !== null && duration_days !== '' && !normalizedDuration) {
      return res.status(400).json({ error: 'invalid_duration_days', message: 'Срок в днях должен быть целым числом больше 0' });
    }
    const normalizedWheelTemplate = is_wheel_template === true || is_wheel_template === 1 || is_wheel_template === '1' ? 1 : 0;
    if (normalizedWheelTemplate && (typeof description !== 'string' || !description.trim())) {
      return res.status(400).json({
        error: 'prize_title_required',
        message: 'Укажите название приза',
      });
    }
    if (normalizedDuration && !normalizedFromDate && !normalizedWheelTemplate) {
      return res.status(400).json({
        error: 'valid_from_date_required',
        message: 'Укажите дату начала действия промокода',
      });
    }

    const cleanCode = code.trim().toUpperCase();

    // Check uniqueness
    const existing = db.prepare('SELECT id FROM promo_codes WHERE code = ?').get(cleanCode);
    if (existing) {
      return res.status(409).json({ error: 'code_exists', message: 'Промокод с таким кодом уже существует' });
    }

    const id = generateId('promo');

    db.prepare(`
      INSERT INTO promo_codes (
        id, code, description, customer_description, manager_description, has_gift,
        discount_type, discount_value, min_order_amount, max_uses,
        valid_from, valid_until, valid_from_date, duration_days, active, is_wheel_template
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      cleanCode,
      description || null,
      customer_description || description || null,
      manager_description || null,
      normalizedHasGift,
      discount_type,
      numericDiscountValue,
      Number(min_order_amount) || 0,
      Number(max_uses) || 0,
      valid_from || null,
      valid_until || null,
      normalizedFromDate,
      normalizedDuration,
      active ? 1 : 0,
      normalizedWheelTemplate,
    );

    const promo = db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(id);
    res.json({
      ...promo,
      effective_valid_until_date: computeEffectiveValidUntilDate(
        promo.valid_from_date,
        promo.duration_days,
      ),
    });
  } catch (error) {
    console.error('[promo] Create promo code error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// PATCH /api/admin/crm/promo-codes/:id - обновить промокод
promoRouter.patch('/api/admin/crm/promo-codes/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'not_found' });
    }

    const {
      code,
      description,
      customer_description,
      manager_description,
      has_gift,
      discount_type,
      discount_value,
      min_order_amount,
      max_uses,
      valid_from,
      valid_until,
      valid_from_date,
      duration_days,
      active,
    } = req.body;

    const updates = {};

    if (code !== undefined) {
      if (typeof code !== 'string' || !code.trim()) {
        return res.status(400).json({ error: 'code_required', message: 'Код промокода обязателен' });
      }
      const cleanCode = code.trim().toUpperCase();
      // Check uniqueness (excluding self)
      const dup = db.prepare('SELECT id FROM promo_codes WHERE code = ? AND id != ?').get(cleanCode, id);
      if (dup) {
        return res.status(409).json({ error: 'code_exists', message: 'Промокод с таким кодом уже существует' });
      }
      updates.code = cleanCode;
    }

    if (description !== undefined) updates.description = description || null;
    if (Number(existing.is_wheel_template || 0) === 1 && description !== undefined) {
      if (typeof description !== 'string' || !description.trim()) {
        return res.status(400).json({
          error: 'prize_title_required',
          message: 'Укажите название приза',
        });
      }
      updates.description = description.trim();
    }
    if (customer_description !== undefined) updates.customer_description = customer_description || null;
    if (manager_description !== undefined) updates.manager_description = manager_description || null;
    if (has_gift !== undefined) {
      updates.has_gift = has_gift === true || has_gift === 1 || has_gift === '1' ? 1 : 0;
    }
    if (discount_type !== undefined) {
      if (!['fixed', 'percent'].includes(discount_type)) {
        return res.status(400).json({ error: 'invalid_discount_type' });
      }
      updates.discount_type = discount_type;
    }
    const nextHasGift = has_gift !== undefined ? updates.has_gift : Number(existing.has_gift || 0);
    const nextDiscountType = discount_type !== undefined ? discount_type : existing.discount_type;
    const nextDiscountValue = discount_value !== undefined ? Number(discount_value) : Number(existing.discount_value);
    if (!Number.isFinite(nextDiscountValue) || nextDiscountValue < 0) {
      return res.status(400).json({ error: 'invalid_discount', message: 'Значение скидки не может быть отрицательным' });
    }
    if (!nextHasGift && nextDiscountValue <= 0) {
      return res.status(400).json({ error: 'invalid_discount', message: 'Скидка должна быть больше 0, если промокод без подарка' });
    }
    if (nextDiscountType === 'percent' && nextDiscountValue > 100) {
      return res.status(400).json({ error: 'invalid_percent', message: 'Процент скидки не может быть больше 100' });
    }
    if (discount_value !== undefined) {
      updates.discount_value = nextDiscountValue;
    }
    if (min_order_amount !== undefined) updates.min_order_amount = Number(min_order_amount) || 0;
    if (max_uses !== undefined) updates.max_uses = Number(max_uses) || 0;
    if (valid_from !== undefined) updates.valid_from = valid_from || null;
    if (valid_until !== undefined) updates.valid_until = valid_until || null;
    if (valid_from_date !== undefined) {
      const normalizedFromDate = normalizeIsoDate(valid_from_date);
      if (valid_from_date !== null && valid_from_date !== '' && !normalizedFromDate) {
        return res.status(400).json({ error: 'invalid_valid_from_date', message: 'Дата начала должна быть в формате YYYY-MM-DD' });
      }
      updates.valid_from_date = normalizedFromDate;
    }
    if (duration_days !== undefined) {
      const normalizedDuration = normalizeDurationDays(duration_days);
      if (duration_days !== null && duration_days !== '' && !normalizedDuration) {
        return res.status(400).json({ error: 'invalid_duration_days', message: 'Срок в днях должен быть целым числом больше 0' });
      }
      updates.duration_days = normalizedDuration;
    }
    if ((valid_from_date !== undefined || duration_days !== undefined) && !Number(existing.is_wheel_template || 0)) {
      const nextFromDate = valid_from_date !== undefined ? updates.valid_from_date : existing.valid_from_date;
      const nextDuration = duration_days !== undefined ? updates.duration_days : existing.duration_days;
      if (nextDuration && !nextFromDate) {
        return res.status(400).json({
          error: 'valid_from_date_required',
          message: 'Укажите дату начала действия промокода',
        });
      }
    }
    if (active !== undefined) updates.active = active ? 1 : 0;

    const setClauses = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
    const values = Object.values(updates);

    if (setClauses) {
      db.prepare(`UPDATE promo_codes SET ${setClauses} WHERE id = ?`).run(...values, id);
    }

    const promo = db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(id);
    res.json({
      ...promo,
      effective_valid_until_date: computeEffectiveValidUntilDate(
        promo.valid_from_date,
        promo.duration_days,
      ),
    });
  } catch (error) {
    console.error('[promo] Update promo code error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// DELETE /api/admin/crm/promo-codes/:id - удалить промокод
promoRouter.delete('/api/admin/crm/promo-codes/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'not_found' });
    }

    // C1-BL: even if current_uses=0 means "never applied at checkout",
    // a promo can still be referenced by the wheel — either as a prize
    // template (is_wheel_template) or as the parent of an already
    // generated child code (wheel_spins.generated_promo_code_id).
    // Hard-deleting the row in that case turns wheel prizes into
    // landmines: the next spin matches the prize, generatePromoForPrize
    // returns null, and the customer's spin gets burned with no code.
    // 409 forces the manager to either remove the prize first or use
    // soft-delete via the "Скрыть" CRM action (active=0).
    const usedAsTemplate = db
      .prepare(
        'SELECT 1 FROM wheel_prizes WHERE promo_template_id = ? LIMIT 1',
      )
      .get(id);
    const usedAsGenerated = db
      .prepare(
        'SELECT 1 FROM wheel_spins WHERE generated_promo_code_id = ? LIMIT 1',
      )
      .get(id);
    if (usedAsTemplate || usedAsGenerated) {
      return res.status(409).json({
        error: 'in_use_by_wheel',
        message:
          'Промокод используется в рулетке. Можно только скрыть (отключить).',
      });
    }

    // If used - soft delete (deactivate), otherwise hard delete
    if (existing.current_uses > 0) {
      db.prepare('UPDATE promo_codes SET active = 0 WHERE id = ?').run(id);
    } else {
      db.prepare('DELETE FROM promo_codes WHERE id = ?').run(id);
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('[promo] Delete promo code error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});
