import { describe, expect, it } from "vitest";
import { isKanbanBoardOrder } from "@/utils/crm-kanban-board";

describe("isKanbanBoardOrder", () => {
  it("includes action-required and active kanban statuses", () => {
    expect(
      isKanbanBoardOrder({
        status: "new",
        needs_manager_action: 0,
      }),
    ).toBe(true);
    expect(
      isKanbanBoardOrder({
        status: "delivered",
        needs_manager_action: 1,
      }),
    ).toBe(true);
  });

  it("excludes delivered/completed and archived", () => {
    expect(
      isKanbanBoardOrder({
        status: "delivered",
        needs_manager_action: 0,
      }),
    ).toBe(false);
    expect(
      isKanbanBoardOrder({
        status: "new",
        needs_manager_action: 0,
        archived: 1,
      }),
    ).toBe(false);
  });
});
