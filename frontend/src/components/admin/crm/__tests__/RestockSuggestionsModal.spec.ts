import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import RestockSuggestionsModal from "@/components/admin/crm/RestockSuggestionsModal.vue";
import type { RestockCandidateGroup } from "@/stores/crm";

const AdminModalStub = defineComponent({
  props: ["isOpen", "title", "description", "size", "showActions"],
  emits: ["close", "cancel"],
  template: `<section v-if="isOpen" data-test="shell">
    <h2 data-test="shell-title">{{ title }}</h2>
    <p data-test="shell-desc">{{ description }}</p>
    <slot />
    <slot name="footer" />
  </section>`,
});

function makeGroups(): RestockCandidateGroup[] {
  return [
    {
      id: "g1",
      name: "PODONKI PODGON",
      categoryName: "Жидкости",
      itemCount: 2,
      items: [
        {
          key: "p1:",
          productId: "p1",
          variantId: null,
          productTitle: "Манго",
          variantName: null,
          displayName: "Манго",
          groupId: "g1",
          groupName: "PODONKI PODGON",
          categoryName: "Жидкости",
          retailStock: 0,
          warehouseStock: 5,
          draftTransferId: null,
          draftTransferNumber: null,
        },
        {
          key: "p2:v2",
          productId: "p2",
          variantId: "v2",
          productTitle: "Вишня",
          variantName: "Холодная",
          displayName: "Холодная",
          groupId: "g1",
          groupName: "PODONKI PODGON",
          categoryName: "Жидкости",
          retailStock: 2,
          warehouseStock: 3,
          // Позиция уже в черновике: вторую заявку заводить нельзя.
          draftTransferId: "t1",
          draftTransferNumber: 12,
        },
      ],
    },
  ];
}

function mountModal(overrides: Record<string, unknown> = {}) {
  const groups = (overrides.groups as RestockCandidateGroup[]) ?? makeGroups();
  return mount(RestockSuggestionsModal, {
    props: {
      isOpen: true,
      groups,
      totals: { itemCount: 2, groupCount: 1, draftItemCount: 1 },
      threshold: 0,
      loading: false,
      errorText: null,
      ...overrides,
    },
    global: { stubs: { AdminModal: AdminModalStub } },
  });
}

function qtyInputs(wrapper: ReturnType<typeof mountModal>) {
  return wrapper.findAll('[data-test="restock-qty"]');
}

describe("RestockSuggestionsModal", () => {
  it("показывает линейки, остатки и подставляет количество 1", () => {
    const wrapper = mountModal();

    expect(wrapper.get('[data-test="shell-title"]').text()).toBe("Заканчивается в рознице");
    expect(wrapper.get('[data-test="shell-desc"]').text()).toContain("в рознице 0 шт");
    expect(wrapper.findAll('[data-test="restock-group"]')).toHaveLength(1);

    const rowText = wrapper.get('[data-test="restock-item-p1:"]').text().replace(/\s+/g, " ");
    expect(rowText).toContain("Манго");
    expect(rowText).toContain("розница 0");
    expect(rowText).toContain("склад 5");

    const inputs = qtyInputs(wrapper);
    expect(inputs).toHaveLength(1);
    expect((inputs[0].element as HTMLInputElement).value).toBe("1");

    wrapper.unmount();
  });

  it("помечает позиции из черновика и не даёт их редактировать", () => {
    const wrapper = mountModal();

    const draftRow = wrapper.get('[data-test="restock-item-p2:v2"]');
    expect(draftRow.get('[data-test="restock-draft-chip"]').text()).toContain("в заявке №12");
    expect(draftRow.find('[data-test="restock-qty"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("уже в заявке на перемещение");

    wrapper.unmount();
  });

  it("ограничивает количество складским остатком", async () => {
    const wrapper = mountModal();
    const input = qtyInputs(wrapper)[0];

    await input.setValue("999");
    await input.trigger("change");
    expect((input.element as HTMLInputElement).value).toBe("5");

    await input.setValue("-4");
    await input.trigger("change");
    expect((input.element as HTMLInputElement).value).toBe("0");

    wrapper.unmount();
  });

  it("отдаёт выбранные позиции с количествами и пропускает нули", async () => {
    const wrapper = mountModal();
    const input = qtyInputs(wrapper)[0];

    await input.setValue("4");
    await input.trigger("change");
    await wrapper.get('[data-test="restock-submit"]').trigger("click");

    const payload = wrapper.emitted("transfer")?.[0]?.[0] as {
      items: Array<Record<string, unknown>>;
    };
    expect(payload.items).toEqual([
      {
        productId: "p1",
        variantId: null,
        displayName: "Манго",
        groupName: "PODONKI PODGON",
        categoryName: "Жидкости",
        warehouseStock: 5,
        quantity: 4,
      },
    ]);

    // Позиция из черновика в новую заявку не попадает.
    expect(payload.items).toHaveLength(1);

    wrapper.unmount();
  });

  it("блокирует создание, когда все количества нулевые", async () => {
    const wrapper = mountModal();
    const input = qtyInputs(wrapper)[0];

    await input.setValue("0");
    await input.trigger("change");

    const submit = wrapper.get('[data-test="restock-submit"]');
    expect(submit.attributes("disabled")).toBeDefined();
    await submit.trigger("click");
    expect(wrapper.emitted("transfer")).toBeUndefined();

    wrapper.unmount();
  });

  it("кнопка «макс» подставляет весь складской остаток", async () => {
    const wrapper = mountModal();

    await wrapper.get('[data-test="restock-max"]').trigger("click");

    const input = qtyInputs(wrapper)[0];
    expect((input.element as HTMLInputElement).value).toBe("5");
    expect(wrapper.get('[data-test="restock-submit"]').text()).toContain("1 поз.");
    expect(wrapper.get('[data-test="restock-submit"]').text()).toContain("5 шт");

    wrapper.unmount();
  });

  it("не теряет введённые количества при возврате из формы перемещения", async () => {
    const wrapper = mountModal();
    const input = qtyInputs(wrapper)[0];

    await input.setValue("4");
    await input.trigger("change");

    // Окно закрывается на время формы перемещения и открывается снова, если
    // менеджер передумал: набранные числа должны остаться.
    await wrapper.setProps({ isOpen: false });
    await wrapper.setProps({ isOpen: true });

    expect((qtyInputs(wrapper)[0].element as HTMLInputElement).value).toBe("4");

    wrapper.unmount();
  });

  it("объясняет, почему кнопка создания недоступна", async () => {
    const wrapper = mountModal();

    const submit = wrapper.get('[data-test="restock-submit"]');
    expect(submit.text()).toContain("1 поз.");

    await qtyInputs(wrapper)[0].setValue("0");
    await qtyInputs(wrapper)[0].trigger("change");

    expect(submit.text()).toBe("Выберите позиции");

    wrapper.unmount();
  });

  it("показывает пустое состояние, когда пополнять нечего", () => {
    const wrapper = mountModal({
      groups: [],
      totals: { itemCount: 0, groupCount: 0, draftItemCount: 0 },
    });

    expect(wrapper.find('[data-test="restock-empty"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="restock-submit"]').attributes("disabled")).toBeDefined();

    wrapper.unmount();
  });

  it("показывает ошибку и позволяет повторить запрос", async () => {
    const wrapper = mountModal({ errorText: "Не удалось загрузить список", groups: [] });

    expect(wrapper.text()).toContain("Не удалось загрузить список");
    await wrapper.get('[data-test="restock-retry"]').trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
    // Кнопка на месте, но по недогруженному списку создать заявку нельзя.
    expect(wrapper.get('[data-test="restock-submit"]').attributes("disabled")).toBeDefined();

    wrapper.unmount();
  });

  it("во время загрузки не показывает список и не даёт создать перемещение", () => {
    const wrapper = mountModal({ loading: true, groups: [] });

    expect(wrapper.text()).toContain("Считаем остатки");
    expect(wrapper.find('[data-test="restock-submit"]').attributes("disabled")).toBeDefined();

    wrapper.unmount();
  });

  it("сообщает о переходе ко всем перемещениям", async () => {
    const wrapper = mountModal();

    await wrapper.get('[data-test="restock-open-transfers"]').trigger("click");
    expect(wrapper.emitted("open-transfers")).toHaveLength(1);

    wrapper.unmount();
  });

  it("показывает поле порога со значением с бэка", () => {
    const wrapper = mountModal({ minVariants: 25 });

    const input = wrapper.get('[data-test="restock-min-variants"]').element as HTMLInputElement;
    expect(input.value).toBe("25");
    expect(wrapper.get('[data-test="restock-min-variants-hint"]').text()).toContain("из 25");

    wrapper.unmount();
  });

  it("сохраняет порог только при реальном изменении и обрезает границы", async () => {
    const wrapper = mountModal({ minVariants: 25 });
    const input = wrapper.get('[data-test="restock-min-variants"]');

    // То же значение — лишнего запроса нет.
    await input.setValue(25);
    await input.trigger("change");
    expect(wrapper.emitted("update-min-variants")).toBeUndefined();

    await input.setValue(40);
    await input.trigger("change");
    expect(wrapper.emitted("update-min-variants")).toEqual([[40]]);

    // Отрицательное значение превращается в 0.
    const fresh = mountModal({ minVariants: 25 });
    const freshInput = fresh.get('[data-test="restock-min-variants"]');
    await freshInput.setValue(-5);
    await freshInput.trigger("blur");
    expect(fresh.emitted("update-min-variants")).toEqual([[0]]);

    wrapper.unmount();
    fresh.unmount();
  });

  it("объясняет, что порог достигнут, и показывает ошибку сохранения", () => {
    const reached = mountModal({ minVariants: 2, totals: { itemCount: 2, groupCount: 1, draftItemCount: 1 } });
    expect(reached.get('[data-test="restock-min-variants-hint"]').text()).toContain("порог достигнут");
    reached.unmount();

    const failed = mountModal({ minVariants: 25, settingsError: "Не удалось сохранить порог" });
    expect(failed.get('[data-test="restock-min-variants-hint"]').text()).toBe(
      "Не удалось сохранить порог",
    );
    failed.unmount();
  });

  it("при пороге 0 подсказывает, что значок виден при любой непустой рознице", () => {
    const wrapper = mountModal({ minVariants: 0 });

    expect(wrapper.get('[data-test="restock-min-variants-hint"]').text()).toContain(
      "при любой непустой рознице",
    );

    wrapper.unmount();
  });
});