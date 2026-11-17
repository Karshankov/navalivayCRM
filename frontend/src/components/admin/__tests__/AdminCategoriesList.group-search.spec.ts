import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import AdminCategoriesList from "@/components/admin/AdminCategoriesList.vue";

/**
 * Поиск во вкладке «Категории» ищет не только категории, но и линейки.
 *
 * Раньше поиск «PODONKI» ничего не находил, хотя линейка существует: нужно
 * было угадать категорию и открыть её. Теперь линейка находится сразу и по
 * нажатию открываются её настройки.
 */
const CATEGORIES = [
  { id: "c-1", name: "Жидкости", slug: "liquids", order: 1 },
  { id: "c-2", name: "Снюс", slug: "snus", order: 2 },
] as any;

const GROUPS = [
  { id: "g-1", categoryId: "c-1", name: "PODONKI BLOOD", slug: "podonki-blood", order: 1, productCount: 12 },
  { id: "g-2", categoryId: "c-1", name: "ПРИЗРАК", slug: "prizrak", order: 2, productCount: 7 },
  { id: "g-3", categoryId: "c-2", name: "SUPER PODONKI", slug: "super-podonki", order: 3, productCount: 24 },
  { id: "g-4", categoryId: "c-2", name: "CATSWILL", slug: "catswill", order: 4, productCount: 44 },
] as any;

function mountList() {
  return mount(AdminCategoriesList, {
    props: { categories: CATEGORIES, groups: GROUPS },
    global: { stubs: { Teleport: true } },
  });
}

async function search(wrapper: ReturnType<typeof mountList>, query: string) {
  const vm = wrapper.vm as any;
  vm.searchQuery = query;
  await wrapper.vm.$nextTick();
}

describe("AdminCategoriesList: поиск по линейкам", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("находит линейку по названию латиницей", async () => {
    const wrapper = mountList();
    await search(wrapper, "PODONKI");

    expect(wrapper.text()).toContain("PODONKI BLOOD");
    expect(wrapper.text()).toContain("SUPER PODONKI");
  });

  it("находит линейку по названию кириллицей", async () => {
    const wrapper = mountList();
    await search(wrapper, "ПРИЗРАК");

    expect(wrapper.text()).toContain("ПРИЗРАК");
  });

  it("не зависит от регистра", async () => {
    const wrapper = mountList();
    await search(wrapper, "podonki");

    expect(wrapper.text()).toContain("PODONKI BLOOD");
  });

  it("находит по части названия", async () => {
    const wrapper = mountList();
    await search(wrapper, "CATS");

    expect(wrapper.text()).toContain("CATSWILL");
  });

  it("показывает, в какой категории лежит линейка", async () => {
    const wrapper = mountList();
    await search(wrapper, "ПРИЗРАК");

    expect(wrapper.text()).toContain("Жидкости");
  });

  it("показывает число товаров в линейке", async () => {
    const wrapper = mountList();
    await search(wrapper, "CATSWILL");

    expect(wrapper.text()).toContain("44");
    expect(wrapper.text()).toContain("товара");
  });

  it("ставит линейки, начинающиеся с запроса, первыми", async () => {
    const wrapper = mountList();
    await search(wrapper, "PODONKI");

    const vm = wrapper.vm as any;
    const names = vm.matchedGroups.map((group: any) => group.name);
    // «PODONKI BLOOD» начинается с запроса, «SUPER PODONKI» — нет.
    expect(names[0]).toBe("PODONKI BLOOD");
  });

  it("открывает линейку по нажатию", async () => {
    const wrapper = mountList();
    await search(wrapper, "CATSWILL");

    const buttons = wrapper.findAll("button").filter((button) =>
      button.text().includes("CATSWILL"),
    );
    expect(buttons.length).toBeGreaterThan(0);
    await buttons[0].trigger("click");

    expect(wrapper.emitted("open-group")?.[0]?.[0]).toEqual({
      categoryId: "c-2",
      groupId: "g-4",
    });
  });

  it("не ищет по одной букве — иначе список забит", async () => {
    const wrapper = mountList();
    await search(wrapper, "P");

    const vm = wrapper.vm as any;
    expect(vm.matchedGroups).toHaveLength(0);
  });

  it("начинает искать с двух букв", async () => {
    const wrapper = mountList();
    await search(wrapper, "PO");

    const vm = wrapper.vm as any;
    expect(vm.matchedGroups.length).toBeGreaterThan(0);
  });

  it("по-прежнему находит категории", async () => {
    const wrapper = mountList();
    await search(wrapper, "Жидкости");

    expect(wrapper.text()).toContain("Жидкости");
    const vm = wrapper.vm as any;
    expect(vm.displayedCategories).toHaveLength(1);
  });

  it("категории и линейки находятся одним запросом", async () => {
    const wrapper = mountList();
    await search(wrapper, "Снюс");

    const vm = wrapper.vm as any;
    // Сама категория нашлась, а линейки с таким названием — нет.
    expect(vm.displayedCategories).toHaveLength(1);
    expect(vm.matchedGroups).toHaveLength(0);
  });

  it("сообщает, когда не нашлось ничего", async () => {
    const wrapper = mountList();
    await search(wrapper, "НЕСУЩЕСТВУЮЩЕЕ");

    expect(wrapper.text()).toContain("Ничего не нашлось");
  });

  it("не показывает сообщение об пустоте, когда нашлась линейка", async () => {
    const wrapper = mountList();
    await search(wrapper, "ПРИЗРАК");

    // Раньше это сообщение появлялось бы, потому что линейки не искались.
    expect(wrapper.text()).not.toContain("Ничего не нашлось");
  });

  it("без запроса линейки не показываются", () => {
    const wrapper = mountList();

    const vm = wrapper.vm as any;
    expect(vm.matchedGroups).toHaveLength(0);
  });
});
