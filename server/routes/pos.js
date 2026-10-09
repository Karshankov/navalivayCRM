import express from 'express';
import { db } from '../db.js';
import { authMiddleware } from '../auth.js';

/**
 * Касса (POS) намеренно живёт отдельно от каталога: название товара, цену и
 * себестоимость продавец печатает руками, ссылки на карточку товара здесь нет
 * и не должно быть.
 *
 * Отсюда следствие, которое выглядит как недоделка, но ей не является: скидки
 * каталога до кассы не доходят. Связывать её с каталогом ради подстановки
 * акционной цены не надо — модуль решает свою задачу и в таком виде.
 */
export const posRouter = express.Router();

// Helper для генерации ID
function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Helper для получения следующего номера продажи
function getNextSaleNumber() {
  const row = db.prepare('SELECT MAX(sale_number) as maxNum FROM pos_sales').get();
  return (row?.maxNum || 0) + 1;
}

function getPosCashAccount() {
  return db.prepare(`
    SELECT *
    FROM cash_accounts
    WHERE active = 1
    ORDER BY is_default DESC, created_at ASC
    LIMIT 1
  `).get();
}

function buildPosTransactionDescription(sale) {
  return `Продажа касса #${sale.sale_number}: ${sale.product_name}`;
}

function adjustAccountBalanceForTransaction(transaction, mode = 'apply') {
  if (!transaction?.account_id || !transaction?.amount) {
    return;
  }

  if (mode === 'apply') {
    if (transaction.type === 'income') {
      db.prepare('UPDATE cash_accounts SET balance = balance + ? WHERE id = ?')
        .run(transaction.amount, transaction.account_id);
    } else if (transaction.type === 'expense') {
      db.prepare('UPDATE cash_accounts SET balance = balance - ? WHERE id = ?')
        .run(transaction.amount, transaction.account_id);
    }
    return;
  }

  if (transaction.type === 'income') {
    db.prepare('UPDATE cash_accounts SET balance = balance - ? WHERE id = ?')
      .run(transaction.amount, transaction.account_id);
  } else if (transaction.type === 'expense') {
    db.prepare('UPDATE cash_accounts SET balance = balance + ? WHERE id = ?')
      .run(transaction.amount, transaction.account_id);
  }
}

function createPosCashTransaction(sale) {
  const account = getPosCashAccount();
  if (!account) {
    throw new Error('cash_account_not_found');
  }

  const transactionId = generateId('trans');

  db.prepare(`
    INSERT INTO cash_transactions (id, account_id, type, amount, description, employee_id)
    VALUES (?, ?, 'income', ?, ?, ?)
  `).run(
    transactionId,
    account.id,
    sale.price,
    buildPosTransactionDescription(sale),
    sale.employee_id || null,
  );

  adjustAccountBalanceForTransaction(
    { account_id: account.id, amount: sale.price, type: 'income' },
    'apply',
  );

  db.prepare('UPDATE pos_sales SET transaction_id = ? WHERE id = ?')
    .run(transactionId, sale.id);
}

function updatePosCashTransaction(sale) {
  if (!sale.transaction_id) {
    createPosCashTransaction(sale);
    return;
  }

  const transaction = db.prepare('SELECT * FROM cash_transactions WHERE id = ?').get(sale.transaction_id);
  if (!transaction) {
    db.prepare('UPDATE pos_sales SET transaction_id = NULL WHERE id = ?').run(sale.id);
    createPosCashTransaction(sale);
    return;
  }

  adjustAccountBalanceForTransaction(transaction, 'revert');

  db.prepare(`
    UPDATE cash_transactions
    SET amount = ?, description = ?, employee_id = ?
    WHERE id = ?
  `).run(
    sale.price,
    buildPosTransactionDescription(sale),
    sale.employee_id || null,
    transaction.id,
  );

  adjustAccountBalanceForTransaction(
    { ...transaction, amount: sale.price, type: 'income' },
    'apply',
  );
}

function deletePosCashTransaction(transactionId) {
  if (!transactionId) {
    return;
  }

  const transaction = db.prepare('SELECT * FROM cash_transactions WHERE id = ?').get(transactionId);
  if (!transaction) {
    return;
  }

  db.prepare('DELETE FROM cash_transactions WHERE id = ?').run(transactionId);
  adjustAccountBalanceForTransaction(transaction, 'revert');
}

// =========================
// POS SALES (Продажи через кассу)
// =========================

// Получить все POS-продажи (с фильтрами)
posRouter.get('/api/admin/pos/sales', authMiddleware, (req, res) => {
  try {
    const { status, from, to, limit = 100, offset = 0 } = req.query;

    let whereClause = '1=1';
    const params = [];

    if (status && ['completed', 'pending'].includes(status)) {
      whereClause += ' AND ps.status = ?';
      params.push(status);
    }

    if (from) {
      whereClause += ' AND ps.created_at >= ?';
      params.push(from);
    }

    if (to) {
      whereClause += ' AND ps.created_at < ?';
      params.push(to);
    }

    const sales = db.prepare(`
      SELECT 
        ps.*,
        e.first_name || ' ' || e.last_name as employee_name
      FROM pos_sales ps
      LEFT JOIN employees e ON e.id = ps.employee_id
      WHERE ${whereClause}
      ORDER BY ps.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit, 10), parseInt(offset, 10));

    const countResult = db.prepare(`
      SELECT COUNT(*) as total FROM pos_sales ps WHERE ${whereClause}
    `).get(...params);

    res.json({
      sales,
      total: countResult.total,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
  } catch (error) {
    console.error('[pos] Get sales error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Получить только отложенные чеки
posRouter.get('/api/admin/pos/pending', authMiddleware, (req, res) => {
  try {
    // LEFT JOIN customers — чтобы показывать привязанного клиента в списке
    // отложенных чеков (иначе кассир, возвращаясь к чеку через час, не
    // понимает чей это).
    const sales = db.prepare(`
      SELECT
        ps.*,
        e.first_name || ' ' || e.last_name as employee_name,
        c.first_name as customer_first_name,
        c.last_name as customer_last_name,
        c.phone as customer_phone,
        c.telegram_username as customer_telegram_username
      FROM pos_sales ps
      LEFT JOIN employees e ON e.id = ps.employee_id
      LEFT JOIN customers c ON c.id = ps.customer_id
      WHERE ps.status = 'pending'
      ORDER BY ps.created_at DESC
    `).all();

    res.json(sales);
  } catch (error) {
    console.error('[pos] Get pending sales error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Получить статистику POS за период
posRouter.get('/api/admin/pos/stats', authMiddleware, (req, res) => {
  try {
    const { from, to } = req.query;

    let whereClause = "status = 'completed'";
    const params = [];

    if (from) {
      whereClause += ' AND created_at >= ?';
      params.push(from);
    }

    if (to) {
      whereClause += ' AND created_at < ?';
      params.push(to);
    }

    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_sales,
        COALESCE(SUM(price), 0) as total_revenue,
        COALESCE(SUM(profit), 0) as total_profit,
        COALESCE(SUM(cost_price), 0) as total_cost
      FROM pos_sales
      WHERE ${whereClause}
    `).get(...params);

    const pendingCount = db.prepare(`
      SELECT COUNT(*) as count FROM pos_sales WHERE status = 'pending'
    `).get();

    res.json({
      ...stats,
      pending_count: pendingCount.count,
    });
  } catch (error) {
    console.error('[pos] Get stats error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Создать продажу
posRouter.post('/api/admin/pos/sales', authMiddleware, (req, res) => {
  try {
    const { product_name, price, cost_price, notes, employee_id, customer_id } = req.body;

    if (!product_name || typeof product_name !== 'string' || !product_name.trim()) {
      return res.status(400).json({ error: 'product_name_required' });
    }

    if (price === undefined || price === null || !Number.isFinite(Number(price)) || Number(price) <= 0) {
      return res.status(400).json({ error: 'invalid_price' });
    }

    // customer_id опционален — POS-чеки могут оставаться анонимными.
    // Если передан — проверяем что клиент существует, чтобы не получить
    // болтающуюся ссылку на удалённую запись.
    let resolvedCustomerId = null;
    if (customer_id) {
      const customer = db
        .prepare('SELECT id FROM customers WHERE id = ?')
        .get(String(customer_id));
      if (!customer) {
        return res.status(400).json({ error: 'invalid_customer_id' });
      }
      resolvedCustomerId = customer.id;
    }

    const id = generateId('pos');
    const saleNumber = getNextSaleNumber();
    const priceNum = Number(price);
    const now = new Date().toISOString();

    let status = 'pending';
    let profit = null;
    let costPriceNum = null;
    let completedAt = null;

    if (cost_price !== undefined && cost_price !== null && cost_price !== '') {
      costPriceNum = Number(cost_price);
      if (!Number.isFinite(costPriceNum)) {
        return res.status(400).json({ error: 'invalid_cost_price' });
      }

      status = 'completed';
      profit = priceNum - costPriceNum;
      completedAt = now;
    }

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO pos_sales (
          id, sale_number, product_name, price, cost_price, profit,
          status, notes, employee_id, customer_id, created_at, completed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        saleNumber,
        product_name.trim(),
        priceNum,
        costPriceNum,
        profit,
        status,
        notes || null,
        employee_id || null,
        resolvedCustomerId,
        now,
        completedAt,
      );

      let sale = db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(id);
      if (sale.status === 'completed') {
        createPosCashTransaction(sale);
        sale = db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(id);
      }

      return sale;
    });

    const sale = tx();
    res.json(sale);
  } catch (error) {
    console.error('[pos] Create sale error:', error);
    if (error.message === 'cash_account_not_found') {
      return res.status(400).json({ error: 'cash_account_not_found' });
    }
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Обновить продажу (дозаполнить себестоимость)
posRouter.patch('/api/admin/pos/sales/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { product_name, price, cost_price, notes } = req.body;

    const existing = db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'not_found' });
    }

    if (price !== undefined && (!Number.isFinite(Number(price)) || Number(price) <= 0)) {
      return res.status(400).json({ error: 'invalid_price' });
    }

    const tx = db.transaction(() => {
      const updates = {};
      const now = new Date().toISOString();

      if (product_name !== undefined) {
        updates.product_name = product_name.trim();
      }

      if (price !== undefined) {
        updates.price = Number(price);
      }

      if (notes !== undefined) {
        updates.notes = notes || null;
      }

      const nextPrice = updates.price !== undefined ? updates.price : existing.price;

      if (cost_price !== undefined && cost_price !== null && cost_price !== '') {
        const costPriceNum = Number(cost_price);
        if (!Number.isFinite(costPriceNum)) {
          throw new Error('invalid_cost_price');
        }

        updates.cost_price = costPriceNum;
        updates.profit = nextPrice - costPriceNum;
        updates.status = 'completed';
        updates.completed_at = existing.completed_at || now;
      } else if (updates.price !== undefined && existing.status === 'completed' && existing.cost_price !== null) {
        updates.profit = nextPrice - existing.cost_price;
      }

      const setClauses = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
      const values = Object.values(updates);

      if (setClauses) {
        db.prepare(`UPDATE pos_sales SET ${setClauses} WHERE id = ?`).run(...values, id);
      }

      let sale = db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(id);

      if (sale.status === 'completed') {
        updatePosCashTransaction(sale);
        sale = db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(id);
      } else if (sale.transaction_id) {
        deletePosCashTransaction(sale.transaction_id);
        db.prepare('UPDATE pos_sales SET transaction_id = NULL WHERE id = ?').run(id);
        sale = db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(id);
      }

      return sale;
    });

    const sale = tx();
    res.json(sale);
  } catch (error) {
    console.error('[pos] Update sale error:', error);
    if (error.message === 'cash_account_not_found' || error.message === 'invalid_cost_price') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'failed', message: error.message });
  }
});

// Удалить продажу
posRouter.delete('/api/admin/pos/sales/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM pos_sales WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'not_found' });
    }

    const tx = db.transaction(() => {
      if (existing.transaction_id) {
        deletePosCashTransaction(existing.transaction_id);
      }

      db.prepare('DELETE FROM pos_sales WHERE id = ?').run(id);
    });

    tx();

    res.json({ ok: true });
  } catch (error) {
    console.error('[pos] Delete sale error:', error);
    res.status(500).json({ error: 'failed', message: error.message });
  }
});
