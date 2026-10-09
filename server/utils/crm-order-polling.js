import { REVIEW_STATUSES } from './product-reviews.js';

export function buildCrmOrderPollSummary({ db, newLimit = 100, actionLimit = 200 } = {}) {
  const newOrderRows = db.prepare(`
    SELECT id
    FROM orders
    WHERE archived = 0
      AND status = 'new'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(newLimit);

  const actionRequiredRows = db.prepare(`
    SELECT id
    FROM orders
    WHERE archived = 0
      AND needs_manager_action = 1
    ORDER BY updated_at DESC, created_at DESC
    LIMIT ?
  `).all(actionLimit);

  const latestRow = db.prepare(`
    SELECT MAX(COALESCE(updated_at, created_at)) AS latest_order_activity_at
    FROM orders
    WHERE archived = 0
  `).get();

  const pendingReviewRow = db.prepare(`
    SELECT COUNT(*) AS count
    FROM product_reviews
    WHERE status = ?
  `).get(REVIEW_STATUSES.PENDING);

  const latestMonthlyDrawRow = db.prepare(`
    SELECT
      d.id,
      d.period_key,
      d.drawn_at,
      (
        SELECT COUNT(*)
        FROM review_monthly_draw_winners w
        WHERE w.draw_id = d.id
          AND COALESCE(w.is_invalidated, 0) = 0
      ) AS winner_count
    FROM review_monthly_draws d
    WHERE d.status = 'completed'
    ORDER BY d.drawn_at DESC
    LIMIT 1
  `).get();

  const latestMonthlyDraw = latestMonthlyDrawRow
    ? {
        id: latestMonthlyDrawRow.id,
        period_key: latestMonthlyDrawRow.period_key,
        drawn_at: latestMonthlyDrawRow.drawn_at,
        winner_count: Number(latestMonthlyDrawRow.winner_count || 0),
      }
    : null;

  return {
    newOrderIds: newOrderRows.map((row) => row.id),
    actionRequiredIds: actionRequiredRows.map((row) => row.id),
    latestOrderActivityAt: latestRow?.latest_order_activity_at || null,
    pendingReviewCount: Number(pendingReviewRow?.count || 0),
    latestMonthlyDraw,
  };
}
