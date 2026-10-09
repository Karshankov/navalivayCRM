import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import TotalControlPanel from "@/components/admin/TotalControlPanel.vue";
import { useCrmStore } from "@/stores/crm";

describe("TotalControlPanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("показывает четыре дефицитные строки и открывает полный список с поиском", async () => {
    const store = useCrmStore();
    store.totalControlGroups = [{
      id: "g1",
      name: "Картриджи XROS",
      categoryId: "c1",
      categoryName: "Расходники",
      hasCoverImage: false,
      totalStock: 15,
      itemCount: 5,
      items: Array.from({ length: 5 }, (_, index) => ({
        id: `p${index}`,
        productId: `p${index}`,
        variantId: null,
        label: `Позиция ${index + 1}`,
        stock: index + 1,
      })),
    }];
    vi.spyOn(store, "fetchTotalControlGroups").mockResolvedValue(store.totalControlGroups);

    const wrapper = mount(TotalControlPanel, { attachTo: document.body });

    expect(wrapper.text()).toContain("15 шт");
    expect(wrapper.get("#total-control-items-g1").findAll("li")).toHaveLength(4);
    expect(wrapper.text()).not.toContain("—");

    const allItemsButton = wrapper.get("button[aria-haspopup='dialog']");
    expect(allItemsButton.text()).toContain("Все позиции · 5");
    await allItemsButton.trigger("click");
    await wrapper.vm.$nextTick();

    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog?.querySelectorAll("li")).toHaveLength(5);
    const search = dialog?.querySelector<HTMLInputElement>("input[type='search']");
    search!.value = "Позиция 5";
    search!.dispatchEvent(new Event("input", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(dialog?.querySelectorAll("li")).toHaveLength(1);
    wrapper.unmount();
  });

  it("объясняет пустое состояние", () => {
    const store = useCrmStore();
    vi.spyOn(store, "fetchTotalControlGroups").mockResolvedValue([]);

    const wrapper = mount(TotalControlPanel);

    expect(wrapper.get("[role='status']").text()).toContain("Включите «Тотальный контроль»");
  });

  it("предупреждает об ошибке поверх ранее загруженных данных", () => {
    const store = useCrmStore();
    store.totalControlGroups = [{
      id: "g1",
      name: "XROS",
      categoryId: null,
      categoryName: null,
      hasCoverImage: false,
      totalStock: 10,
      itemCount: 0,
      items: [],
    }];
    store.totalControlGroupsError = "Не удалось обновить остатки. Показаны последние загруженные данные.";
    vi.spyOn(store, "fetchTotalControlGroups").mockRejectedValue(new Error("network"));

    const wrapper = mount(TotalControlPanel);

    expect(wrapper.get("[role='alert']").text()).toContain("Показаны последние загруженные данные");
    expect(wrapper.text()).toContain("10 шт");
  });
});
