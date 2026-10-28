import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import AdminSignificanceMarksSection from "@/components/admin/AdminSignificanceMarksSection.vue";

const fetchMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

const marks = ref<any[]>([]);

import { ref } from "vue";

vi.mock("@/stores/admin", () => ({
  useAdminStore: () => ({
    significanceMarks: marks,
    fetchSignificanceMarks: fetchMock,
    createSignificanceMark: createMock,
    updateSignificanceMark: updateMock,
    deleteSignificanceMark: deleteMock,
  }),
  // types are erased at runtime; only used for type imports
}));

const DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4//8/AwAF/gL+py0/RAAAAABJRU5ErkJggg==";

const MARK = {
  id: "sigm_1",
  code: "social",
  title: "Социально значимый товар",
  description: "Часть средств идёт на благотворительность",
  icon: DATA_URL,
  color: "#16a34a",
  detailTitle: "О программе",
  detailBody: "Мы отдаём 1 BYN с каждой банки.",
  detailButtonText: "Подробнее",
  detailUrl: null,
  notifyText: "{имя}, спасибо!",
  active: true,
  sortOrder: 0,
};

function mountSection() {
  return mount(AdminSignificanceMarksSection, {
    global: {
      stubs: {
        AdminModal: {
          template: `<div class="modal-stub"><slot /><slot name="footer" /></div>`,
          props: ["isOpen", "title", "size", "showActions"],
        },
        Teleport: true,
      },
    },
  });
}

describe("AdminSignificanceMarksSection: пометки значимости", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    createMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
    marks.value = [];
  });

  it("пустое состояние ведёт к созданию первой пометки", async () => {
    fetchMock.mockResolvedValue([]);
    const wrapper = mountSection();
    await flushPromises();

    expect(wrapper.text()).toContain("Пометок пока нет");
    expect(wrapper.text()).toContain("Создать пометку");
  });

  it("показывает список с превью блока и переключателем активности", async () => {
    marks.value = [MARK];
    const wrapper = mountSection();
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain("Социально значимый товар");
    expect(text).toContain("Часть средств идёт на благотворительность");
    expect(text).toContain("Подробнее");
    expect(text).toContain("Сообщение после выдачи");
    // Превью блока использует цвет пометки.
    const preview = wrapper.find('[style*="rgb(22, 163, 74)"], [style*="#16a34a"]');
    expect(preview.exists()).toBe(true);
  });

  it("создание: валидация URL и отправка полей", async () => {
    fetchMock.mockResolvedValue([]);
    createMock.mockResolvedValue({ ...MARK, id: "sigm_2" });
    const wrapper = await (async () => {
      const w = mountSection();
      await flushPromises();
      return w;
    })();

    await wrapper.find('button[class*="bg-brand-dark"]').trigger("click");
    await flushPromises();

    // Модалка открылась (AdminModal застаблен, форма рендерится).
    expect(wrapper.find('[data-test="significance-mark-form"]').exists()).toBe(true);

    const title = wrapper.find('[data-test="mark-title"]');
    await title.setValue("Экологичная упаковка");

    // Иконку грузим как data-URL (FileReader в jsdom недоступен для stub-ввода).
    wrapper.vm.$.setupState.form.icon = DATA_URL;

    // Сохранение: активная пометка по умолчанию.
    await wrapper.find('[data-test="mark-save"]').trigger("click");
    await flushPromises();

    expect(createMock).toHaveBeenCalledTimes(1);
    const payload = createMock.mock.calls[0][0];
    expect(payload.title).toBe("Экологичная упаковка");
    expect(payload.icon).toBe(DATA_URL);
    expect(payload.color).toBe("#16a34a");
    expect(payload.active).toBe(true);
  });

  it("редактирование сохраняет изменения выбранной пометки", async () => {
    marks.value = [MARK];
    updateMock.mockResolvedValue({ ...MARK, active: false });
    const wrapper = mountSection();
    await flushPromises();

    await wrapper.findAll("button").find((b) => b.text() === "Выключить")!.trigger("click");
    await flushPromises();

    expect(updateMock).toHaveBeenCalledWith("sigm_1", { active: false });
  });

  it("удаление спрашивает подтверждение и снимает пометку", async () => {
    marks.value = [MARK];
    deleteMock.mockResolvedValue(undefined);
    const wrapper = mountSection();
    await flushPromises();

    await wrapper.findAll("button").find((b) => b.text() === "Удалить")!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("будет снята со всех линеек");
    // В подтверждении — последняя кнопка «Удалить» (в модалке, а не в карточке).
    const confirmDelete = wrapper
      .findAll("button")
      .filter((b) => b.text() === "Удалить")
      .pop()!;
    await confirmDelete.trigger("click");
    await flushPromises();

    expect(deleteMock).toHaveBeenCalledWith("sigm_1");
  });
});
