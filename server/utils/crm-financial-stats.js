import { toSqliteUtcString } from './business-time.js';

/** Shared authoritative financial totals for Overview and financial-day closing.
 * Preserve the existing paid_at and POS completed_at filters and stored profits.
 * Ledger corrections, owner distributions and account transfers are NOT sales.
 */
export function queryCrmFinancialStats(database, { start, end }) {
  const from = toSqliteUtcString(start);
  const until = toSqliteUtcString(end);
  const orders = database.prepare(`
    SELECT
      COALESCE(COUNT(o.id), 0) AS total_sales,
      COALESCE(SUM(COALESCE(o.final_amount, o.total_amount)), 0) AS revenue,
      COALESCE(SUM(COALESCE(o.profit, 0)), 0) AS profit,
      COALESCE(COUNT(DISTINCT o.customer_id), 0) AS unique_customers
    FROM orders o
    WHERE o.status IN ('completed', 'delivered')
      AND o.paid_at IS NOT NULL
      AND o.paid_at >= ? AND o.paid_at < ?
  `).get(from, until);
  const pos = database.prepare(`
    SELECT
      COALESCE(COUNT(*), 0) AS total_sales,
      COALESCE(SUM(price), 0) AS revenue,
      COALESCE(SUM(profit), 0) AS profit
    FROM pos_sales
    WHERE status = 'completed'
      AND datetime(completed_at) >= ? AND datetime(completed_at) < ?
  `).get(from, until);
  return {
    total_sales: (orders.total_sales || 0) + (pos.total_sales || 0),
    revenue: (orders.revenue || 0) + (pos.revenue || 0),
    profit: (orders.profit || 0) + (pos.profit || 0),
    unique_customers: orders.unique_customers || 0,
  };
}
