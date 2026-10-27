import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import AdminProductsTable from "@/components/admin/AdminProductsTable.vue";

// Кнопка «Пересорт» в тулбаре: открывает инвентаризацию линейки с текущей
// точкой учёта (Розница/Склад), чтобы модалка сразу показывала нужные остатки.
describe("AdminProductsTable: кнопка «Пересорт»", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function mountTable(location: "retail" | "warehouse" = "retail") {
    return mount(AdminProductsTable, {
      props: {
        products: [],
        categories: [{ id: "c_1", name: "Жидкости" }],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 1 },
        location,
      },
      global: {
        stubs: { Teleport: true },
      },
    });
  }

  it("кнопка есть в тулбаре на обеих точках", () => {
    for (const location of ["retail", "warehouse"] as const) {
      const wrapper = mountTable(location);
      const button = wrapper.find('[data-test="inventory-check"]');
      expect(button.exists(), `кнопка должна быть на ${location}`).toBe(true);
      expect(button.text()).toContain("Пересорт");
    }
  });

  it("клик эмитит inventory-check с текущей точкой", async () => {
    const wrapper = mountTable("retail");
    await wrapper.find('[data-test="inventory-check"]').trigger("click");

    expect(wrapper.emitted("inventory-check")).toHaveLength(1);
    expect(wrapper.emitted("inventory-check")![0]).toEqual(["retail"]);
  });

  it("со склада кнопка эмитит warehouse", async () => {
    const wrapper = mountTable("warehouse");
    await wrapper.find('[data-test="inventory-check"]').trigger("click");

    expect(wrapper.emitted("inventory-check")![0]).toEqual(["warehouse"]);
  });
});