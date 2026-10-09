import express from 'express';
import { db } from '../db.js';
import { authMiddleware } from '../auth.js';
import {
  computeCashPacingMonthProjection,
  ensureDateInMonth,
  formatDateKey,
  normalizeMonthKey,
  parseMonthKey,
} from '../utils/cash-pacing.js';
import { getTimeZoneDateParts } from '../utils/business-time.js';
import { searchProductsForCrm } from '../services/product-search-service.js';

export const crmFinanceRouter = express.Router();

// Helper для генерации ID
function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Helper для получения следующего номера
function getNextNumber(table, field) {
  const row = db.prepare(`SELECT MAX(${field}) as maxNum FROM ${table}`).get();
  return (row?.maxNum || 0) + 1;
}

/**
 * Число из строки запроса, пригодное для LIMIT/OFFSET.
 *
 * Без этого ?limit=abc даёт NaN, который better-sqlite3 отказывается
 * привязывать, и запрос падает в 500; а ?limit=99999999 вытаскивает весь
 * денежный журнал магазина одним ответом.
 */
function clampQueryInt(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function getLinkedPosSaleByTransactionId(transactionId) {
  return db.prepare(`
    SELECT id, sale_number
    FROM pos_sales
    WHERE transaction_id = ?
    LIMIT 1
  `).get(transactionId);
}

function resolveWriteOffProduct(item) {
  const explicitVariantId =
    typeof item?.variant_id === "string" && item.variant_id.trim()
      ? item.variant_id.trim()
      : null;
  const lookupId =
    explicitVariantId ||
    (typeof item?.product_id === "string" ? item.product_id.trim() : "");

  if (!lookupId) {
    throw new Error("invalid_item");
  }

  const variant = db
    .prepare(
      `
        SELECT v.*, p.cost_price, p.title as product_title
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        WHERE v.id = ?
      `,
    )
    .get(lookupId);

  if (variant) {
    return {
      productId: variant.product_id,
      variantId: variant.id,
      title: `${variant.product_title} (${variant.name})`,
      stock: Number(variant.stock || 0),
      costPerUnit: Number(variant.cost_price || 0),
    };
  }

  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(lookupId);
  if (!product) {
    throw new Error(`Product not found: ${lookupId}`);
  }

  return {
    productId: product.id,
    variantId: null,
    title: product.title,
    stock: Number(product.stock || 0),
    costPerUnit: Number(product.cost_price || 0),
  };
}

function sanitizeOptionalText(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized : null;
}

function toRequiredPositiveNumber(value, errorCode) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new Error(errorCode);
  }

  return numericValue;
}

function toNonNegativeNumber(value, errorCode) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new Error(errorCode);
  }

  return numericValue;
}

function getCashPacingMonthRowById(monthId) {
  return db.prepare('SELECT * FROM cash_pacing_months WHERE id = ?').get(monthId);
}

function getCashPacingItemsByMonthId(monthId) {
  return db.prepare(`
    SELECT *
    FROM cash_pacing_items
    WHERE month_id = ?
    ORDER BY effective_from ASC, created_at ASC
  `).all(monthId);
}

function getCashPacingDailyFactsByMonthId(monthId) {
  return db.prepare(`
    SELECT *
    FROM cash_pacing_daily_facts
    WHERE month_id = ?
    ORDER BY fact_date ASC
  `).all(monthId);
}

function createCashPacingMonthTitle(monthKey) {
  return `План ${monthKey}`;
}

function serializeCashPacingProjection(projection) {
  return {
    items: projection.items.map(({ retail_total_raw, ...item }) => item),
    daily_facts: projection.dailyFacts,
    daily_plan: projection.dailyPlan,
    summary: projection.summary,
  };
}

function buildCashPacingMonthDetail(monthRow) {
  const projection = computeCashPacingMonthProjection({
    month: monthRow,
    items: getCashPacingItemsByMonthId(monthRow.id),
    dailyFacts: getCashPacingDailyFactsByMonthId(monthRow.id),
  });

  return {
    month: monthRow,
    ...serializeCashPacingProjection(projection),
  };
}

function buildCashPacingMonthListItem(monthRow) {
  const projection = computeCashPacingMonthProjection({
    month: monthRow,
    items: getCashPacingItemsByMonthId(monthRow.id),
    dailyFacts: getCashPacingDailyFactsByMonthId(monthRow.id),
  });

  return {
    month: monthRow,
    summary: projection.summary,
  };
}

function getDefaultCurrentMonthKey() {
  const parts = getTimeZoneDateParts();
  return formatDateKey(parts.year, parts.month, 1).slice(0, 7);
}

function getCurrentBusinessDateKey() {
  const parts = getTimeZoneDateParts();
  return formatDateKey(parts.year, parts.month, parts.day);
}

function validateCashPacingAdditionDate(monthKey, entryType, effectiveFrom) {
  if (entryType !== 'addition') {
    return;
  }

  const currentMonthKey = getDefaultCurrentMonthKey();
  if (monthKey !== currentMonthKey) {
    return;
  }

  const currentDateKey = getCurrentBusinessDateKey();
  if (effectiveFrom <= currentDateKey) {
    throw new Error('addition_starts_next_day');
  }
}

function validateCashPacingFactDate(monthKey, factDate) {
  const currentMonthKey = getDefaultCurrentMonthKey();
  if (monthKey > currentMonthKey) {
    throw new Error('future_fact_date');
  }

  if (monthKey === currentMonthKey) {
    const currentDateKey = getCurrentBusinessDateKey();
    if (factDate > currentDateKey) {
      throw new Error('future_fact_date');
    }
  }
}

// =========================
// WRITE-OFFS (Списания)
// =========================
crmFinanceRouter.get('/api/admin/crm/write-offs', authMiddleware, (req, res) => {
  try {
    const writeOffs = db.prepare(`
      SELECT w.*, e.first_name || ' ' || e.last_name as employee_name
      FROM write_offs w
      LEFT JOIN employees e ON e.id = w.employee_id
      ORDER BY w.created_at DESC
    `).all();

    res.json(writeOffs);
  } catch (error) {
    console.error('[crm] Get write-offs error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmFinanceRouter.get('/api/admin/crm/write-offs/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    
    const writeOff = db.prepare('SELECT * FROM write_offs WHERE id = ?').get(id);
    if (!writeOff) {
      return res.status(404).json({ error: 'not_found' });
    }

    const items = db.prepare(`
      SELECT wi.*, 
        CASE WHEN wi.variant_id IS NOT NULL 
          THEN p.title || ' (' || v.name || ')'
          ELSE p.title 
        END as product_title,
        COALESCE(v.stock, p.stock) as stock,
        v.name as variant_name,
        g.name as group_name
      FROM writeoff_items wi
      JOIN products p ON p.id = wi.product_id
      LEFT JOIN product_variants v ON v.id = wi.variant_id
      LEFT JOIN category_groups g ON g.id = p.groupId
      WHERE wi.writeoff_id = ?
    `).all(id);

    res.json({ ...writeOff, items });
  } catch (error) {
    console.error('[crm] Get write-off error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Создание списания
crmFinanceRouter.post('/api/admin/crm/write-offs', authMiddleware, (req, res) => {
  try {
    const { reason, items, notes } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'reason_required' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items_required' });
    }

    const writeOffId = generateId('wo');
    const writeOffNumber = getNextNumber('write_offs', 'writeoff_number');

    const tx = db.transaction(() => {
      // Создаем списание
      db.prepare(`
        INSERT INTO write_offs (id, writeoff_number, reason, notes)
        VALUES (?, ?, ?, ?)
      `).run(writeOffId, writeOffNumber, reason, notes || null);

      // Добавляем позиции и уменьшаем остатки
      for (const item of items) {
        const quantity = Number(item?.quantity || 0);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new Error("invalid_quantity");
        }

        const resolved = resolveWriteOffProduct(item);
        if (resolved.stock < quantity) {
          throw new Error(`Insufficient stock for ${resolved.title}`);
        }

        const totalCost = resolved.costPerUnit * quantity;

        db.prepare(`
          INSERT INTO writeoff_items (id, writeoff_id, product_id, variant_id, quantity, cost_per_unit, total_cost)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          generateId('wi'),
          writeOffId,
          resolved.productId,
          resolved.variantId,
          quantity,
          resolved.costPerUnit,
          totalCost,
        );

        if (resolved.variantId) {
          db.prepare('UPDATE product_variants SET stock = stock - ? WHERE id = ?')
            .run(quantity, resolved.variantId);
        } else {
          db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
            .run(quantity, resolved.productId);
        }
      }
    });

    tx();

    const writeOff = db.prepare('SELECT * FROM write_offs WHERE id = ?').get(writeOffId);
    const writeOffItems = db.prepare(`
      SELECT wi.*, 
        CASE WHEN wi.variant_id IS NOT NULL 
          THEN p.title || ' (' || v.name || ')'
          ELSE p.title 
        END as product_title,
        v.name as variant_name,
        g.name as group_name
      FROM writeoff_items wi
      JOIN products p ON p.id = wi.product_id
      LEFT JOIN product_variants v ON v.id = wi.variant_id
      LEFT JOIN category_groups g ON g.id = p.groupId
      WHERE wi.writeoff_id = ?
    `).all(writeOffId);

    res.json({ ...writeOff, items: writeOffItems });
  } catch (error) {
    console.error('[crm] Create write-off error:', error);
    const clientErrors = new Set(['reason_required', 'items_required', 'invalid_item', 'invalid_quantity']);
    if (clientErrors.has(error.message) || error.message?.startsWith('Insufficient stock') || error.message?.startsWith('Product not found')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Обновление списания
crmFinanceRouter.patch('/api/admin/crm/write-offs/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { reason, notes, items } = req.body || {};

    const writeOff = db.prepare('SELECT * FROM write_offs WHERE id = ?').get(id);
    if (!writeOff) {
      return res.status(404).json({ error: 'not_found' });
    }

    const tx = db.transaction(() => {
      if (reason !== undefined || notes !== undefined) {
        db.prepare(`
          UPDATE write_offs
          SET reason = ?, notes = ?
          WHERE id = ?
        `).run(
          reason !== undefined ? reason : writeOff.reason,
          notes !== undefined ? notes : writeOff.notes,
          id
        );
      }

      if (Array.isArray(items)) {
        if (items.length === 0) {
          throw new Error('items_required');
        }

        // Восстанавливаем остатки старых позиций
        const existingItems = db.prepare('SELECT * FROM writeoff_items WHERE writeoff_id = ?').all(id);
        for (const existing of existingItems) {
          if (existing.variant_id) {
            db.prepare('UPDATE product_variants SET stock = stock + ? WHERE id = ?')
              .run(existing.quantity, existing.variant_id);
          } else {
            db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?')
              .run(existing.quantity, existing.product_id);
          }
        }

        db.prepare('DELETE FROM writeoff_items WHERE writeoff_id = ?').run(id);

        for (const item of items) {
          if (!item || !item.product_id) {
            throw new Error('invalid_item');
          }

          const quantity = Number(item.quantity || 0);
          if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error('invalid_quantity');
          }

          const resolved = resolveWriteOffProduct(item);
          if (resolved.stock < quantity) {
            throw new Error(`Insufficient stock for ${resolved.title}`);
          }

          const totalCost = resolved.costPerUnit * quantity;

          db.prepare(`
            INSERT INTO writeoff_items (id, writeoff_id, product_id, variant_id, quantity, cost_per_unit, total_cost)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(generateId('wi'), id, resolved.productId, resolved.variantId, quantity, resolved.costPerUnit, totalCost);

          if (resolved.variantId) {
            db.prepare('UPDATE product_variants SET stock = stock - ? WHERE id = ?')
              .run(quantity, resolved.variantId);
          } else {
            db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
              .run(quantity, resolved.productId);
          }
        }
      }
    });

    tx();

    const updated = db.prepare('SELECT * FROM write_offs WHERE id = ?').get(id);
    const updatedItems = db.prepare(`
      SELECT wi.*, 
        CASE WHEN wi.variant_id IS NOT NULL 
          THEN p.title || ' (' || v.name || ')'
          ELSE p.title 
        END as product_title,
        COALESCE(v.stock, p.stock) as stock,
        v.name as variant_name,
        g.name as group_name
      FROM writeoff_items wi
      JOIN products p ON p.id = wi.product_id
      LEFT JOIN product_variants v ON v.id = wi.variant_id
      LEFT JOIN category_groups g ON g.id = p.groupId
      WHERE wi.writeoff_id = ?
    `).all(id);

    res.json({ ...updated, items: updatedItems });
  } catch (error) {
    console.error('[crm] Update write-off error:', error);
    const clientErrors = new Set(['items_required', 'invalid_item', 'invalid_quantity']);
    if (clientErrors.has(error.message) || error.message?.startsWith('Insufficient stock') || error.message?.startsWith('Product not found')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Удаление списания
crmFinanceRouter.delete('/api/admin/crm/write-offs/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    const writeOff = db.prepare('SELECT * FROM write_offs WHERE id = ?').get(id);
    if (!writeOff) {
      return res.status(404).json({ error: 'not_found' });
    }

    const items = db.prepare('SELECT * FROM writeoff_items WHERE writeoff_id = ?').all(id);

    const tx = db.transaction(() => {
      for (const item of items) {
        if (item.variant_id) {
          // Восстанавливаем остаток варианта
          db.prepare('UPDATE product_variants SET stock = stock + ? WHERE id = ?')
            .run(item.quantity, item.variant_id);
        } else {
          // Восстанавливаем остаток обычного товара
          db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?')
            .run(item.quantity, item.product_id);
        }
      }

      db.prepare('DELETE FROM writeoff_items WHERE writeoff_id = ?').run(id);
      db.prepare('DELETE FROM write_offs WHERE id = ?').run(id);
    });

    tx();

    res.json({ ok: true });
  } catch (error) {
    console.error('[crm] Delete write-off error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// =========================
// CASH ACCOUNTS (Счета/кассы)
// =========================
crmFinanceRouter.get('/api/admin/crm/cash-accounts', authMiddleware, (req, res) => {
  try {
    const accounts = db.prepare('SELECT * FROM cash_accounts WHERE active = 1 ORDER BY is_default DESC, created_at ASC').all();
    res.json(accounts);
  } catch (error) {
    console.error('[crm] Get cash accounts error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmFinanceRouter.post('/api/admin/crm/cash-accounts', authMiddleware, (req, res) => {
  try {
    const { is_default = false } = req.body ?? {};
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const rawBalance = req.body?.balance;
    const balance =
      rawBalance === undefined || rawBalance === null || rawBalance === '' ? 0 : Number(rawBalance);

    if (!name) {
      return res.status(400).json({ error: 'name_required' });
    }

    // Колонка balance объявлена REAL, но SQLite положит в неё и строку: без этой
    // проверки счёт с balance = 'много' переживёт вставку, а первое же
    // balance = balance - ? превратит остаток в NULL.
    if (!Number.isFinite(balance)) {
      return res.status(400).json({ error: 'invalid_balance' });
    }

    const id = generateId('acc');

    const tx = db.transaction(() => {
      // Если это дефолтный счет, убираем флаг у других
      if (is_default) {
        db.prepare('UPDATE cash_accounts SET is_default = 0').run();
      }

      db.prepare(`
        INSERT INTO cash_accounts (id, name, balance, is_default, active)
        VALUES (?, ?, ?, ?, 1)
      `).run(id, name, balance, is_default ? 1 : 0);

      // Стартовый остаток заводится транзакцией, а не только числом в колонке:
      // иначе сумма движений по счёту никогда не сойдётся с его остатком, и при
      // сверке кассы эта разница неотличима от потерянной транзакции.
      if (balance !== 0) {
        db.prepare(`
          INSERT INTO cash_transactions (id, account_id, type, amount, description)
          VALUES (?, ?, ?, ?, 'Начальный остаток')
        `).run(generateId('trans'), id, balance > 0 ? 'income' : 'expense', Math.abs(balance));
      }
    });

    tx();

    const account = db.prepare('SELECT * FROM cash_accounts WHERE id = ?').get(id);
    res.json(account);
  } catch (error) {
    console.error('[crm] Create cash account error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmFinanceRouter.patch('/api/admin/crm/cash-accounts/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { name, is_default } = req.body ?? {};

    const account = db.prepare('SELECT * FROM cash_accounts WHERE id = ?').get(id);
    if (!account) {
      return res.status(404).json({ error: 'not_found' });
    }

    const nextName = name === undefined ? account.name : String(name).trim();
    if (!nextName) {
      return res.status(400).json({ error: 'name_required' });
    }

    // Явный false обязан снимать флаг: молча вернуть прежнее значение и ответить
    // 200 — тихий отказ, вызывающий считает, что всё получилось.
    const nextIsDefault = is_default === undefined ? Boolean(account.is_default) : Boolean(is_default);

    // Кассой по умолчанию может быть только видимый счёт: приёмка закупки ищет
    // её среди active = 1 и без неё останавливается.
    if (nextIsDefault && !account.active) {
      return res.status(409).json({ error: 'account_hidden' });
    }

    const tx = db.transaction(() => {
      if (nextIsDefault) {
        db.prepare('UPDATE cash_accounts SET is_default = 0').run();
      } else if (account.is_default) {
        // Флаг не снимается в пустоту, а передаётся: магазин без кассы по
        // умолчанию не сможет принять закупку.
        const heir = db
          .prepare('SELECT id FROM cash_accounts WHERE id != ? AND active = 1 ORDER BY created_at ASC, id ASC LIMIT 1')
          .get(id);
        if (!heir) {
          throw new Error('default_required');
        }
        db.prepare('UPDATE cash_accounts SET is_default = 1 WHERE id = ?').run(heir.id);
      }

      db.prepare(`
        UPDATE cash_accounts
        SET name = ?, is_default = ?
        WHERE id = ?
      `).run(nextName, nextIsDefault ? 1 : 0, id);
    });

    tx();

    const updated = db.prepare('SELECT * FROM cash_accounts WHERE id = ?').get(id);
    res.json(updated);
  } catch (error) {
    if (error.message === 'default_required') {
      return res.status(409).json({ error: 'default_required' });
    }
    console.error('[crm] Update cash account error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Удаление счёта. Счёт не стирается из базы, а помечается active = 0.
//
// Стереть строку нельзя по двум причинам, обе видны в схеме:
// 1) cash_transactions.account_id объявлен ON DELETE CASCADE
//    (migrations/add_crm_tables.js:151), а внешние ключи включены
//    (server/db.js:91) — удаление счёта молча унесло бы весь его денежный
//    журнал, включая оплаты заказов и закупки;
// 2) orders.payment_account_id ссылается на cash_accounts без ON DELETE
//    (migrations/add_payment_fields_to_orders.js:15), то есть NO ACTION —
//    у счёта, которым хоть раз оплатили заказ, удаление строки падает на
//    внешнем ключе и превращается в невнятную 500.
//
// Раньше здесь стоял запрет «сначала удалите все транзакции». Он невыполним:
// транзакции заказов и продаж через кассу не удаляются ни ручкой
// DELETE /cash-transactions/:id (409 linked_order / linked_pos_sale), ни из
// интерфейса — там кнопки выключены. Счёт, принявший хоть одну оплату,
// оставался в CRM навсегда.
//
// Что видно пользователю: счёт исчезает из списка (GET фильтрует active = 1)
// и из всех выпадающих списков, а его транзакции остаются в журнале под
// прежним названием счёта.
crmFinanceRouter.delete('/api/admin/crm/cash-accounts/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    const account = db.prepare('SELECT * FROM cash_accounts WHERE id = ?').get(id);
    if (!account) {
      return res.status(404).json({ error: 'not_found' });
    }

    // Повторное удаление уже скрытого счёта — не ошибка, а тот же результат.
    if (!account.active) {
      return res.json({ ok: true });
    }

    // Последний счёт убирать нельзя: без него закупки и оплаты некуда проводить.
    const accountsCount = db.prepare('SELECT COUNT(*) as count FROM cash_accounts WHERE active = 1').get();
    if (accountsCount.count <= 1) {
      return res.status(409).json({
        error: 'last_account',
        message: 'Невозможно удалить последний счёт'
      });
    }

    const tx = db.transaction(() => {
      // Флаг «по умолчанию» обязан остаться ровно у одного живого счёта:
      // приёмка закупки ищет кассу именно по нему (crm-operations.js:3415)
      // и молча не списывает деньги, если не нашла.
      if (account.is_default) {
        const heir = db
          .prepare('SELECT id FROM cash_accounts WHERE id != ? AND active = 1 ORDER BY created_at ASC, id ASC LIMIT 1')
          .get(id);
        if (!heir) {
          throw new Error('no_default_heir');
        }
        db.prepare('UPDATE cash_accounts SET is_default = 1 WHERE id = ?').run(heir.id);
      }

      db.prepare('UPDATE cash_accounts SET active = 0, is_default = 0 WHERE id = ?').run(id);
    });

    tx();

    res.json({ ok: true });
  } catch (error) {
    console.error('[crm] Delete cash account error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// =========================
// CASH TRANSACTIONS (Движения денег)
// =========================
crmFinanceRouter.get('/api/admin/crm/cash-transactions', authMiddleware, (req, res) => {
  try {
    const { account_id, type } = req.query;
    const limit = clampQueryInt(req.query.limit, 50, 500);
    const offset = clampQueryInt(req.query.offset, 0, 1000000);
    
    let whereClause = '';
    const params = [];
    
    if (account_id) {
      whereClause = 'WHERE ct.account_id = ?';
      params.push(account_id);
    }
    
    if (type && whereClause) {
      whereClause += ' AND ct.type = ?';
      params.push(type);
    } else if (type) {
      whereClause = 'WHERE ct.type = ?';
      params.push(type);
    }

    const transactions = params.length > 0
      ? db.prepare(`
          SELECT 
            ct.*,
            ca.name as account_name,
            e.first_name || ' ' || e.last_name as employee_name,
            ps.id as pos_sale_id,
            ps.sale_number as pos_sale_number
          FROM cash_transactions ct
          JOIN cash_accounts ca ON ca.id = ct.account_id
          LEFT JOIN employees e ON e.id = ct.employee_id
          LEFT JOIN pos_sales ps ON ps.transaction_id = ct.id
          ${whereClause}
          ORDER BY ct.created_at DESC
          LIMIT ? OFFSET ?
        `).all(...params, limit, offset)
      : db.prepare(`
          SELECT 
            ct.*,
            ca.name as account_name,
            e.first_name || ' ' || e.last_name as employee_name,
            ps.id as pos_sale_id,
            ps.sale_number as pos_sale_number
          FROM cash_transactions ct
          JOIN cash_accounts ca ON ca.id = ct.account_id
          LEFT JOIN employees e ON e.id = ct.employee_id
          LEFT JOIN pos_sales ps ON ps.transaction_id = ct.id
          ORDER BY ct.created_at DESC
          LIMIT ? OFFSET ?
        `).all(limit, offset);

    res.json(transactions);
  } catch (error) {
    console.error('[crm] Get transactions error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Ручное добавление прихода/расхода
crmFinanceRouter.post('/api/admin/crm/cash-transactions', authMiddleware, (req, res) => {
  try {
    const { account_id, type, amount, description } = req.body;

    if (!account_id || !type || !amount) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    if (!['income', 'expense'].includes(type)) {
      return res.status(400).json({ error: 'invalid_type' });
    }

    const account = db.prepare('SELECT * FROM cash_accounts WHERE id = ? AND active = 1').get(account_id);
    if (!account) {
      return res.status(404).json({ error: 'account_not_found' });
    }

    const id = generateId('trans');

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO cash_transactions (id, account_id, type, amount, description)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, account_id, type, amount, description || null);

      // Обновляем баланс счета
      if (type === 'income') {
        db.prepare('UPDATE cash_accounts SET balance = balance + ? WHERE id = ?')
          .run(amount, account_id);
      } else {
        db.prepare('UPDATE cash_accounts SET balance = balance - ? WHERE id = ?')
          .run(amount, account_id);
      }
    });

    tx();

    const transaction = db.prepare(`
      SELECT 
        ct.*,
        ca.name as account_name
      FROM cash_transactions ct
      JOIN cash_accounts ca ON ca.id = ct.account_id
      WHERE ct.id = ?
    `).get(id);

    res.json(transaction);
  } catch (error) {
    console.error('[crm] Create transaction error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmFinanceRouter.patch('/api/admin/crm/cash-transactions/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { account_id, type, amount, description } = req.body || {};

    const existing = db.prepare('SELECT * FROM cash_transactions WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'not_found' });
    }

    if (existing.order_id) {
      return res.status(409).json({ error: 'linked_order' });
    }

    const linkedPosSale = getLinkedPosSaleByTransactionId(id);
    if (linkedPosSale) {
      return res.status(409).json({ error: 'linked_pos_sale' });
    }

    const nextAccountId = account_id ?? existing.account_id;
    const nextType = type ?? existing.type;
    const nextAmount = amount !== undefined ? Number(amount) : existing.amount;
    const nextDescription = description !== undefined ? (description ? String(description) : null) : existing.description;

    if (!['income', 'expense'].includes(nextType)) {
      return res.status(400).json({ error: 'invalid_type' });
    }

    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      return res.status(400).json({ error: 'invalid_amount' });
    }

    const account = db.prepare('SELECT * FROM cash_accounts WHERE id = ? AND active = 1').get(nextAccountId);
    if (!account) {
      return res.status(404).json({ error: 'account_not_found' });
    }

    const tx = db.transaction(() => {
      if (existing.type === 'income') {
        db.prepare('UPDATE cash_accounts SET balance = balance - ? WHERE id = ?')
          .run(existing.amount, existing.account_id);
      } else if (existing.type === 'expense') {
        db.prepare('UPDATE cash_accounts SET balance = balance + ? WHERE id = ?')
          .run(existing.amount, existing.account_id);
      }

      if (nextType === 'income') {
        db.prepare('UPDATE cash_accounts SET balance = balance + ? WHERE id = ?')
          .run(nextAmount, nextAccountId);
      } else {
        db.prepare('UPDATE cash_accounts SET balance = balance - ? WHERE id = ?')
          .run(nextAmount, nextAccountId);
      }

      db.prepare(`
        UPDATE cash_transactions
        SET account_id = ?, type = ?, amount = ?, description = ?
        WHERE id = ?
      `).run(nextAccountId, nextType, nextAmount, nextDescription, id);
    });

    tx();

    const transaction = db.prepare(`
      SELECT 
        ct.*,
        ca.name as account_name,
        e.first_name || ' ' || e.last_name as employee_name
      FROM cash_transactions ct
      JOIN cash_accounts ca ON ca.id = ct.account_id
      LEFT JOIN employees e ON e.id = ct.employee_id
      WHERE ct.id = ?
    `).get(id);

    res.json(transaction);
  } catch (error) {
    console.error('[crm] Update transaction error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmFinanceRouter.delete('/api/admin/crm/cash-transactions/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    const transaction = db.prepare('SELECT * FROM cash_transactions WHERE id = ?').get(id);
    if (!transaction) {
      return res.status(404).json({ error: 'not_found' });
    }

    if (transaction.order_id) {
      return res.status(409).json({ error: 'linked_order' });
    }

    const linkedPosSale = getLinkedPosSaleByTransactionId(id);
    if (linkedPosSale) {
      return res.status(409).json({ error: 'linked_pos_sale' });
    }

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM cash_transactions WHERE id = ?').run(id);

      if (transaction.account_id && transaction.amount) {
        if (transaction.type === 'income') {
          db.prepare('UPDATE cash_accounts SET balance = balance - ? WHERE id = ?')
            .run(transaction.amount, transaction.account_id);
        } else if (transaction.type === 'expense') {
          db.prepare('UPDATE cash_accounts SET balance = balance + ? WHERE id = ?')
            .run(transaction.amount, transaction.account_id);
        }
      }
    });

    tx();

    res.json({ ok: true });
  } catch (error) {
    console.error('[crm] Delete transaction error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// =========================
// CASH PACING (План пробития кассы)
// =========================
crmFinanceRouter.get('/api/admin/crm/cash-pacing/months', authMiddleware, (req, res) => {
  try {
    const months = db.prepare(`
      SELECT *
      FROM cash_pacing_months
      ORDER BY month_key DESC, created_at DESC
    `).all();

    res.json({
      months: months.map(buildCashPacingMonthListItem),
      suggested_month_key: getDefaultCurrentMonthKey(),
    });
  } catch (error) {
    console.error('[crm] Get cash pacing months error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmFinanceRouter.post('/api/admin/crm/cash-pacing/months', authMiddleware, (req, res) => {
  try {
    const monthKey = normalizeMonthKey(req.body?.month_key || getDefaultCurrentMonthKey());
    const existingMonth = db.prepare('SELECT id FROM cash_pacing_months WHERE month_key = ?').get(monthKey);
    if (existingMonth) {
      return res.status(409).json({ error: 'month_exists' });
    }

    const monthId = generateId('cpm');
    const title = sanitizeOptionalText(req.body?.title) || createCashPacingMonthTitle(monthKey);
    const notes = sanitizeOptionalText(req.body?.notes);

    db.prepare(`
      INSERT INTO cash_pacing_months (id, month_key, title, notes)
      VALUES (?, ?, ?, ?)
    `).run(monthId, monthKey, title, notes);

    res.json(buildCashPacingMonthDetail(getCashPacingMonthRowById(monthId)));
  } catch (error) {
    console.error('[crm] Create cash pacing month error:', error);
    if (error.message === 'invalid_month_key') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmFinanceRouter.get('/api/admin/crm/cash-pacing/months/:id', authMiddleware, (req, res) => {
  try {
    const month = getCashPacingMonthRowById(req.params.id);
    if (!month) {
      return res.status(404).json({ error: 'not_found' });
    }

    res.json(buildCashPacingMonthDetail(month));
  } catch (error) {
    console.error('[crm] Get cash pacing month error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmFinanceRouter.patch('/api/admin/crm/cash-pacing/months/:id', authMiddleware, (req, res) => {
  try {
    const month = getCashPacingMonthRowById(req.params.id);
    if (!month) {
      return res.status(404).json({ error: 'not_found' });
    }

    const title = req.body?.title !== undefined
      ? sanitizeOptionalText(req.body.title) || createCashPacingMonthTitle(month.month_key)
      : month.title;
    const notes = req.body?.notes !== undefined ? sanitizeOptionalText(req.body.notes) : month.notes;

    db.prepare(`
      UPDATE cash_pacing_months
      SET title = ?, notes = ?, updated_at = DATETIME('now')
      WHERE id = ?
    `).run(title, notes, month.id);

    res.json(buildCashPacingMonthDetail(getCashPacingMonthRowById(month.id)));
  } catch (error) {
    console.error('[crm] Update cash pacing month error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmFinanceRouter.post('/api/admin/crm/cash-pacing/months/:id/items', authMiddleware, (req, res) => {
  try {
    const month = getCashPacingMonthRowById(req.params.id);
    if (!month) {
      return res.status(404).json({ error: 'month_not_found' });
    }

    const title = sanitizeOptionalText(req.body?.title);
    if (!title) {
      return res.status(400).json({ error: 'title_required' });
    }

    const quantity = toRequiredPositiveNumber(req.body?.quantity, 'invalid_quantity');
    const costWithVat = toNonNegativeNumber(req.body?.cost_with_vat, 'invalid_cost_with_vat');
    const markupPercent = toNonNegativeNumber(req.body?.markup_percent, 'invalid_markup_percent');
    const entryType = req.body?.entry_type === 'addition' ? 'addition' : 'base';
    const { year, month: monthNumber } = parseMonthKey(month.month_key);
    const defaultEffectiveFrom = formatDateKey(year, monthNumber, 1);
    const effectiveFrom = ensureDateInMonth(req.body?.effective_from || defaultEffectiveFrom, month.month_key);
    validateCashPacingAdditionDate(month.month_key, entryType, effectiveFrom);
    const note = sanitizeOptionalText(req.body?.note);

    db.prepare(`
      INSERT INTO cash_pacing_items (
        id, month_id, entry_type, title, quantity, cost_with_vat, markup_percent, effective_from, note
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      generateId('cpi'),
      month.id,
      entryType,
      title,
      quantity,
      costWithVat,
      markupPercent,
      effectiveFrom,
      note,
    );

    res.json(buildCashPacingMonthDetail(month));
  } catch (error) {
    console.error('[crm] Create cash pacing item error:', error);
    const clientErrors = new Set([
      'invalid_quantity',
      'invalid_cost_with_vat',
      'invalid_markup_percent',
      'invalid_date_key',
      'date_out_of_month',
      'addition_starts_next_day',
    ]);
    if (clientErrors.has(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmFinanceRouter.patch('/api/admin/crm/cash-pacing/items/:itemId', authMiddleware, (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM cash_pacing_items WHERE id = ?').get(req.params.itemId);
    if (!item) {
      return res.status(404).json({ error: 'not_found' });
    }

    const month = getCashPacingMonthRowById(item.month_id);
    if (!month) {
      return res.status(404).json({ error: 'month_not_found' });
    }

    const nextTitle = req.body?.title !== undefined ? sanitizeOptionalText(req.body.title) : item.title;
    if (!nextTitle) {
      return res.status(400).json({ error: 'title_required' });
    }

    const nextQuantity = req.body?.quantity !== undefined
      ? toRequiredPositiveNumber(req.body.quantity, 'invalid_quantity')
      : Number(item.quantity);
    const nextCostWithVat = req.body?.cost_with_vat !== undefined
      ? toNonNegativeNumber(req.body.cost_with_vat, 'invalid_cost_with_vat')
      : Number(item.cost_with_vat);
    const nextMarkupPercent = req.body?.markup_percent !== undefined
      ? toNonNegativeNumber(req.body.markup_percent, 'invalid_markup_percent')
      : Number(item.markup_percent);
    const nextEntryType = req.body?.entry_type === 'addition'
      ? 'addition'
      : req.body?.entry_type === 'base'
        ? 'base'
        : item.entry_type;
    const nextEffectiveFrom = req.body?.effective_from !== undefined
      ? ensureDateInMonth(req.body.effective_from, month.month_key)
      : item.effective_from;
    validateCashPacingAdditionDate(month.month_key, nextEntryType, nextEffectiveFrom);
    const nextNote = req.body?.note !== undefined ? sanitizeOptionalText(req.body.note) : item.note;

    db.prepare(`
      UPDATE cash_pacing_items
      SET entry_type = ?, title = ?, quantity = ?, cost_with_vat = ?, markup_percent = ?, effective_from = ?, note = ?, updated_at = DATETIME('now')
      WHERE id = ?
    `).run(
      nextEntryType,
      nextTitle,
      nextQuantity,
      nextCostWithVat,
      nextMarkupPercent,
      nextEffectiveFrom,
      nextNote,
      item.id,
    );

    res.json(buildCashPacingMonthDetail(month));
  } catch (error) {
    console.error('[crm] Update cash pacing item error:', error);
    const clientErrors = new Set([
      'invalid_quantity',
      'invalid_cost_with_vat',
      'invalid_markup_percent',
      'invalid_date_key',
      'date_out_of_month',
      'addition_starts_next_day',
    ]);
    if (clientErrors.has(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmFinanceRouter.delete('/api/admin/crm/cash-pacing/items/:itemId', authMiddleware, (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM cash_pacing_items WHERE id = ?').get(req.params.itemId);
    if (!item) {
      return res.status(404).json({ error: 'not_found' });
    }

    const month = getCashPacingMonthRowById(item.month_id);
    if (!month) {
      return res.status(404).json({ error: 'month_not_found' });
    }

    db.prepare('DELETE FROM cash_pacing_items WHERE id = ?').run(item.id);

    res.json(buildCashPacingMonthDetail(month));
  } catch (error) {
    console.error('[crm] Delete cash pacing item error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmFinanceRouter.post('/api/admin/crm/cash-pacing/months/:id/daily-facts', authMiddleware, (req, res) => {
  try {
    const month = getCashPacingMonthRowById(req.params.id);
    if (!month) {
      return res.status(404).json({ error: 'month_not_found' });
    }

    const factDate = ensureDateInMonth(req.body?.fact_date, month.month_key);
    validateCashPacingFactDate(month.month_key, factDate);
    const actualAmount = toNonNegativeNumber(req.body?.actual_amount, 'invalid_actual_amount');
    const note = sanitizeOptionalText(req.body?.note);
    const existingFact = db.prepare(`
      SELECT *
      FROM cash_pacing_daily_facts
      WHERE month_id = ? AND fact_date = ?
    `).get(month.id, factDate);

    if (existingFact) {
      db.prepare(`
        UPDATE cash_pacing_daily_facts
        SET actual_amount = ?, note = ?, updated_at = DATETIME('now')
        WHERE id = ?
      `).run(actualAmount, note, existingFact.id);
    } else {
      db.prepare(`
        INSERT INTO cash_pacing_daily_facts (id, month_id, fact_date, actual_amount, note)
        VALUES (?, ?, ?, ?, ?)
      `).run(generateId('cpf'), month.id, factDate, actualAmount, note);
    }

    res.json(buildCashPacingMonthDetail(month));
  } catch (error) {
    console.error('[crm] Upsert cash pacing fact error:', error);
    const clientErrors = new Set(['invalid_actual_amount', 'invalid_date_key', 'date_out_of_month', 'future_fact_date']);
    if (clientErrors.has(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

crmFinanceRouter.delete('/api/admin/crm/cash-pacing/months/:id/daily-facts/:factDate', authMiddleware, (req, res) => {
  try {
    const month = getCashPacingMonthRowById(req.params.id);
    if (!month) {
      return res.status(404).json({ error: 'month_not_found' });
    }

    const factDate = ensureDateInMonth(req.params.factDate, month.month_key);
    db.prepare(`
      DELETE FROM cash_pacing_daily_facts
      WHERE month_id = ? AND fact_date = ?
    `).run(month.id, factDate);

    res.json(buildCashPacingMonthDetail(month));
  } catch (error) {
    console.error('[crm] Delete cash pacing fact error:', error);
    const clientErrors = new Set(['invalid_date_key', 'date_out_of_month']);
    if (clientErrors.has(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// =========================
// VISIT TRACKING (Отслеживание посещений)
// =========================
// Логирование посещений (публичный endpoint)
crmFinanceRouter.post('/api/visits/log', (req, res) => {
  try {
    const {
      telegram_id,
      telegram_username,
      first_name,
      last_name,
      page_path,
      action
    } = req.body || {};

    if (!telegram_id) {
      return res.status(400).json({ error: 'telegram_id_required' });
    }

    const telegramId = String(telegram_id);
    const username = typeof telegram_username === 'string' && telegram_username.trim() !== ''
      ? telegram_username.trim()
      : null;
    const firstName = typeof first_name === 'string' && first_name.trim() !== ''
      ? first_name.trim()
      : null;
    const lastName = typeof last_name === 'string' && last_name.trim() !== ''
      ? last_name.trim()
      : null;
    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      let customer = db.prepare('SELECT id FROM customers WHERE telegram_id = ?').get(telegramId);

      if (!customer) {
        const customerId = generateId('cust');
        db.prepare(`
          INSERT INTO customers (
            id, telegram_id, telegram_username, first_name, last_name,
            first_visit_at, last_visit_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          customerId,
          telegramId,
          username,
          firstName,
          lastName,
          now,
          now,
          now,
          now
        );
        customer = { id: customerId };
      } else {
        db.prepare(`
          UPDATE customers
          SET telegram_username = COALESCE(?, telegram_username),
              first_name = CASE WHEN ? IS NOT NULL THEN ? ELSE first_name END,
              last_name = CASE WHEN ? IS NOT NULL THEN ? ELSE last_name END,
              first_visit_at = COALESCE(first_visit_at, ?),
              last_visit_at = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          username,
          firstName,
          firstName,
          lastName,
          lastName,
          now,
          now,
          now,
          customer.id
        );
      }

      const customerId = customer.id;

      const logId = generateId('visit');
      db.prepare(`
        INSERT INTO visit_logs (id, customer_id, telegram_id, telegram_username, page_path, action)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        logId,
        customerId,
        telegramId,
        username,
        typeof page_path === 'string' ? page_path : null,
        typeof action === 'string' ? action : null
      );

      const stats = db.prepare(`
        SELECT
          COUNT(*) AS total_orders,
          COALESCE(SUM(final_amount), 0) AS total_spent,
          MAX(created_at) AS last_order_at
        FROM orders
        WHERE customer_id = ?
      `).get(customerId);

      db.prepare(`
        UPDATE customers
        SET total_orders = ?,
            total_spent = ?,
            last_order_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        Number(stats?.total_orders ?? 0),
        Number(stats?.total_spent ?? 0),
        stats?.last_order_at ?? null,
        now,
        customerId
      );
    });

    tx();

    res.json({ ok: true });
  } catch (error) {
    console.error('[visits] Log visit error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Получение visit logs для клиента (для админки)
crmFinanceRouter.get('/api/admin/crm/visit-logs', authMiddleware, (req, res) => {
  try {
    const { customer_id, telegram_id } = req.query;
    
    let whereClause = '';
    const params = [];
    
    if (customer_id) {
      whereClause = 'WHERE customer_id = ?';
      params.push(customer_id);
    } else if (telegram_id) {
      whereClause = 'WHERE telegram_id = ?';
      params.push(telegram_id);
    }

    const logs = params.length > 0
      ? db.prepare(`
          SELECT * FROM visit_logs
          ${whereClause}
          ORDER BY visited_at DESC
          LIMIT 100
        `).all(...params)
      : db.prepare(`
          SELECT * FROM visit_logs
          ORDER BY visited_at DESC
          LIMIT 100
        `).all();

    res.json(logs);
  } catch (error) {
    console.error('[crm] Get visit logs error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// =========================
// PRODUCTS SEARCH FOR CRM (Поиск товаров для CRM)
// =========================
crmFinanceRouter.get('/api/admin/crm/products/search', authMiddleware, async (req, res) => {
  try {
    const requestStartedAt = Date.now();
    const { search, limit = 25, offset = 0 } = req.query;
    const location = req.query.location === 'warehouse'
      ? 'warehouse'
      : req.query.location === 'retail'
        ? 'retail'
        : undefined;
    const trimmedSearch = typeof search === 'string' ? search.trim() : '';
    const cleanProducts = await searchProductsForCrm({
      search: trimmedSearch,
      limit: Number(limit),
      offset: Number(offset),
      location,
    });
    
    if (trimmedSearch) {
      const totalMs = Date.now() - requestStartedAt;
      console.info('[crm] product search timing', {
        search: trimmedSearch,
        limit: Number(limit),
        resultCount: cleanProducts.length,
        totalMs,
      });
    }
    
    res.json(cleanProducts);
  } catch (error) {
    console.error('[crm] Search products error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// =========================
// PRODUCTS LOW STOCK (Товары с минимальным остатком)
// =========================
crmFinanceRouter.get('/api/admin/crm/products/low-stock', authMiddleware, (req, res) => {
  try {
    // Получаем обычные товары с низким остатком
    const regularProducts = db.prepare(`
      SELECT 
        p.*,
        c.name as category_name,
        g.name as group_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.categoryId
      LEFT JOIN category_groups g ON g.id = p.groupId
      WHERE p.has_variants = 0 AND p.min_stock > 0 AND p.stock <= p.min_stock
      ORDER BY (p.stock - p.min_stock) ASC
    `).all();
    
    // Получаем ВАРИАНТЫ (не товары!) с низким остатком
    const lowStockVariants = db.prepare(`
      SELECT 
        v.id,
        v.product_id,
        v.name as variant_name,
        v.color_code,
        v.price_rub,
        v.stock,
        p.id as base_product_id,
        p.title as base_product_title,
        p.cost_price,
        p.min_stock,
        p.categoryId,
        c.name as category_name,
        p.groupId,
        g.name as group_name
      FROM product_variants v
      INNER JOIN products p ON p.id = v.product_id
      LEFT JOIN categories c ON c.id = p.categoryId
      LEFT JOIN category_groups g ON g.id = p.groupId
      WHERE p.has_variants = 1 AND p.min_stock > 0 AND v.stock <= p.min_stock
      ORDER BY (v.stock - p.min_stock) ASC
    `).all();
    
    // Преобразуем варианты в формат, похожий на обычные товары
    const variantsAsProducts = lowStockVariants.map(v => ({
      id: v.id, // ID варианта
      product_id: v.product_id, // ID базового товара
      title: `${v.base_product_title} (${v.variant_name})`, // Название с цветом
      variant_name: v.variant_name,
      color_code: v.color_code,
      priceRub: v.price_rub,
      cost_price: v.cost_price,
      stock: v.stock, // Остаток конкретного варианта
      min_stock: v.min_stock,
      categoryId: v.categoryId,
      category_name: v.category_name,
      groupId: v.groupId,
      group_name: v.group_name,
      has_variants: 0, // Помечаем как обычный товар для фронтенда
      is_variant: true // Флаг для отличия
    }));
    
    // Объединяем и сортируем
    const allProducts = [...regularProducts, ...variantsAsProducts].sort((a, b) => {
      const stockA = Number(a.stock || 0);
      const stockB = Number(b.stock || 0);
      const minA = Number(a.min_stock || 0);
      const minB = Number(b.min_stock || 0);
      return (stockA - minA) - (stockB - minB);
    });

    res.json(allProducts);
  } catch (error) {
    console.error('[crm] Get low stock products error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});
