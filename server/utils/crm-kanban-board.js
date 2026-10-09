import {
  enrichOrdersWithRelations,
  fetchOrderRowsByIds,
} from './crm-order-enrichment.js';

/** Заказы, которые показываются на канбане или в модалке «Отменённые». */
export const KANBAN_BOARD_SQL_FILTER = `(
  o.archived = 0
  AND (
    o.needs_manager_action = 1
    OR o.status IN ('new', 'in_progress', 'cancelled')
  )
)`;

function getLatestOrderActivityAt(db) {
  const latestRow = db
    .prepare(
      `
    SELECT MAX(COALESCE(updated_at, created_at)) AS latest_order_activity_at
    FROM orders
    WHERE archived = 0
  `,
    )
    .get();
  return latestRow?.latest_order_activity_at || null;
}

function listKanbanBoardOrderIds(db, limit = 200) {
  return db
    .prepare(
      `
    SELECT o.id
    FROM orders o
    WHERE ${KANBAN_BOARD_SQL_FILTER}
    ORDER BY COALESCE(o.updated_at, o.created_at) DESC, o.created_at DESC
    LIMIT ?
  `,
    )
    .all(limit)
    .map((row) => row.id);
}

/**
 * @param {{ db: import('better-sqlite3').Database, since?: string | null, changeLimit?: number, boardLimit?: number }} params
 */
export function buildKanbanBoardSync({
  db,
  since = null,
  changeLimit = 80,
  boardLimit = 200,
} = {}) {
  const latestOrderActivityAt = getLatestOrderActivityAt(db);
  const boardOrderIds = listKanbanBoardOrderIds(db, boardLimit);

  if (!since) {
    return {
      latestOrderActivityAt,
      boardOrderIds,
      changedOrderIds: boardOrderIds,
      removedOrderIds: [],
    };
  }

  const changedOrderIds = db
    .prepare(
      `
    SELECT o.id
    FROM orders o
    WHERE ${KANBAN_BOARD_SQL_FILTER}
      AND COALESCE(o.updated_at, o.created_at) > ?
    ORDER BY COALESCE(o.updated_at, o.created_at) DESC
    LIMIT ?
  `,
    )
    .all(since, changeLimit)
    .map((row) => row.id);

  const removedOrderIds = db
    .prepare(
      `
    SELECT o.id
    FROM orders o
    WHERE COALESCE(o.updated_at, o.created_at) > ?
      AND NOT ${KANBAN_BOARD_SQL_FILTER}
      AND (
        o.archived = 1
        OR o.status IN ('delivered', 'completed')
      )
  `,
    )
    .all(since)
    .map((row) => row.id);

  return {
    latestOrderActivityAt,
    boardOrderIds,
    changedOrderIds,
    removedOrderIds,
  };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ orderIds: string[] }} params
 */
export function fetchEnrichedOrdersByIds({ db, orderIds }) {
  const uniqueIds = [...new Set((orderIds || []).filter(Boolean))];
  if (!uniqueIds.length) return [];
  const rows = fetchOrderRowsByIds(db, uniqueIds);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = uniqueIds.map((id) => byId.get(id)).filter(Boolean);
  return enrichOrdersWithRelations(db, ordered);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ limit?: number }} [options]
 */
export function fetchKanbanBoardOrders({ db, limit = 200 } = {}) {
  const orderIds = listKanbanBoardOrderIds(db, limit);
  return fetchEnrichedOrdersByIds({ db, orderIds });
}
