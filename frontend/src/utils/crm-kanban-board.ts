import type { Order } from "@/stores/crm";

/** Соответствует server/utils/crm-kanban-board.js KANBAN_BOARD_SQL_FILTER */
export function isKanbanBoardOrder(
  order: Pick<Order, "status" | "needs_manager_action"> & { archived?: number },
): boolean {
  if (order.archived === 1) return false;
  if (order.needs_manager_action === 1) return true;
  return (
    order.status === "new" ||
    order.status === "in_progress" ||
    order.status === "cancelled"
  );
}
