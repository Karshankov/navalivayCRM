/**
 * Ширины колонок таблицы товаров.
 *
 * Ширина считается замером содержимого. Пока мерили только строки с данными,
 * узкая колонка вроде «Остаток» получала ширину по числу «3», а её заголовок,
 * набранный крупными буквами с разрядкой, вылезал на соседнюю колонку: кнопка
 * сортировки внутри заголовка не разрешает перенос строки.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import AdminProductsTable from "@/components/admin/AdminProductsTable.vue";

/** Ширина по числу знаков: у заголовков она заведомо больше, чем у чисел. */
const CHAR_WIDTH = 9;

function stubTextWidths() {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const text = (this.textContent || "").trim();
    const width = text.length * CHAR_WIDTH;
    return {
      width,
      height: 20,
      top: 0,
      left: 0,
      right: width,
      bottom: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

describe("AdminProductsTable: ширина колонок", () => {
  const originalRect = Element.prototype.getBoundingClientRect;

  beforeEach(() => {
    setActivePinia(createPinia());
    stubTextWidths();
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalRect;
    vi.restoreAllMocks();
  });

  it("колонка не уже своего заголовка, даже когда значения короткие", async () => {
    const wrapper = mount(AdminProductsTable, {
      props: {
        products: [
          {
            id: "p-1",
            title: "Ледяной персик",
            priceRub: 15,
            stock: 3,
            categoryId: "cat-1",
          },
        ],
        categories: [{ id: "cat-1", name: "Снюс и пластины" }],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      },
      attachTo: document.body,
      global: {
        stubs: {
          AdminSectionHero: { template: "<section><slot /></section>" },
          Teleport: true,
        },
      },
    });

    // Замер запускается в rAF, дождёмся его.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await wrapper.vm.$nextTick();

    const headerCells = wrapper.findAll("thead th");
    const stockHeader = headerCells.find((cell) => cell.text().includes("Остаток"));
    expect(stockHeader).toBeTruthy();

    const declaredWidth = Number(
      /width:\s*(\d+)px/.exec(stockHeader!.attributes("style") || "")?.[1] ?? 0,
    );
    const headerWidth = "Остаток".length * CHAR_WIDTH;

    expect(declaredWidth).toBeGreaterThanOrEqual(headerWidth);
    wrapper.unmount();
  });
});
