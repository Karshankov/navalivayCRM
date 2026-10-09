import { describe, expect, it } from "vitest";
import { buildAutoNotifyToast } from "@/utils/auto-notify-message";

describe("buildAutoNotifyToast", () => {
  it("shows info toast when notify is pending (deferred send)", () => {
    const toast = buildAutoNotifyToast(
      { pending: true },
      { actionDescription: "Заказ #1: собран" },
    );
    expect(toast.kind).toBe("info");
    expect(toast.message).toContain("отправляется");
  });

  it("shows info toast when retry is scheduled (userbot down)", () => {
    const toast = buildAutoNotifyToast(
      { pending: true, reason: "retry_scheduled" },
      { actionDescription: "Заказ #9074: собран" },
    );
    expect(toast.kind).toBe("info");
    expect(toast.message).toContain("Отправка отложена");
  });
});
