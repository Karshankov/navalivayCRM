import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import LowStockFlavorsModal from "@/components/admin/LowStockFlavorsModal.vue";

const items = [
  // Ради этого случая и показываем склад: в рознице пусто, а запас есть.
  { id: "zero", name: "Нет в наличии", stock: 0, warehouse_stock: 8 },
  { id: "few", name: "Заканчивается", stock: 2, warehouse_stock: 0 },
  { id: "many", name: "Много", stock: 12, warehouse_stock: 3 },
];

function mountModal(overrides: Record<string, unknown> = {}) {
  return mount(LowStockFlavorsModal, {
    attachTo: document.body,
    props: {
      isOpen: true,
      groupName: "Тестовая линейка",
      items,
      loading: false,
      errorText: null,
      ...overrides,
    },
  });
}

describe("LowStockFlavorsModal", () => {
  it("показывает вкусы и остатки в переданном порядке", () => {
    const wrapper = mountModal();
    const rows = Array.from(document.querySelectorAll("ol li"));

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Остатки по вкусам");
    expect(rows.map((row) => row.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "Нет в наличии0 шт склад 8",
      "Заканчивается2 шт склад 0",
      "Много12 шт склад 3",
    ]);

    wrapper.unmount();
  });

  it("переносит длинное название цвета и не сжимает остаток", () => {
    const wrapper = mountModal({
      items: [{ id: "color", name: "VeryLongDeviceColorWithoutSpaces", stock: 1 }],
    });
    const row = document.querySelector("ol li");
    const name = row?.querySelector("span:first-child");
    const stock = row?.querySelector("span:last-child");

    expect(name?.classList.contains("break-words")).toBe(true);
    expect(name?.classList.contains("min-w-0")).toBe(true);
    expect(stock?.classList.contains("flex-shrink-0")).toBe(true);
    wrapper.unmount();
  });

  it("закрывается по Escape даже во время загрузки", async () => {
    const wrapper = mountModal({ items: [], loading: true });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });

  it("показывает ошибку с повтором и пустое состояние", async () => {
    const wrapper = mountModal({ items: [], errorText: "Не удалось загрузить остатки." });
    const retryButton = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Повторить"));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Не удалось загрузить остатки.");
    retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(wrapper.emitted("retry")).toHaveLength(1);

    await wrapper.setProps({ errorText: null, loading: true });
    await flushPromises();
    expect(document.activeElement).toBe(
      document.querySelector<HTMLButtonElement>('button[aria-label="Закрыть"]'),
    );

    await wrapper.setProps({ loading: false });
    expect(document.querySelector('[role="status"]')?.textContent).toContain("В этой линейке пока нет позиций");
    wrapper.unmount();
  });

  it("закрывается кнопкой и безопасным нажатием на фон", () => {
    const wrapper = mountModal();
    const closeButton = document.querySelector<HTMLButtonElement>('button[aria-label="Закрыть"]');
    closeButton?.click();
    expect(wrapper.emitted("close")).toHaveLength(1);

    const backdrop = document.querySelector<HTMLElement>('[aria-hidden="true"].absolute');
    backdrop?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    backdrop?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    expect(wrapper.emitted("close")).toHaveLength(2);
    wrapper.unmount();
  });

  it("удерживает фокус в окне и возвращает его на кнопку открытия", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const wrapper = mountModal();
    await flushPromises();

    const closeButton = document.querySelector<HTMLButtonElement>('button[aria-label="Закрыть"]');
    expect(document.activeElement).toBe(closeButton);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(closeButton);

    await wrapper.setProps({ isOpen: false });
    await flushPromises();
    expect(document.activeElement).toBe(opener);

    wrapper.unmount();
    opener.remove();
  });
});
