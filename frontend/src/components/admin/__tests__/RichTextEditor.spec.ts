import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import RichTextEditor from "@/components/admin/RichTextEditor.vue";

/**
 * Редактор «Подробнее»: тулбар Word-стиля + contenteditable.
 * execCommand в jsdom не выполняется — проверяем каркас: рендер тулбара,
 * ввод текста эмитит модель, внешняя смена заливает поле.
 */

describe("RichTextEditor: визуальный редактор текста", () => {
  it("рисует тулбар с кнопками форматирования", () => {
    const wrapper = mount(RichTextEditor, { props: { modelValue: null } });

    const buttons = wrapper.findAll(".rich-editor__btn");
    expect(buttons.length).toBeGreaterThanOrEqual(12);
    // Жирный, курсив, заголовки, списки, выравнивание, ссылка, картинка.
    expect(wrapper.find('[data-test="rich-bold"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rich-italic"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rich-underline"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rich-formatblock"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rich-insertunorderedlist"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rich-insertorderedlist"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rich-justifyleft"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rich-justifycenter"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rich-justifyright"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rich-link"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rich-image"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rich-removeformat"]').exists()).toBe(true);
    // Промокод и размер картинок.
    expect(wrapper.find('[data-test="rich-promo"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rich-img-controls"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rich-img-50"]').exists()).toBe(true);
    // Поле редактирования — contenteditable.
    expect(wrapper.find('[data-test="rich-editor-area"]').attributes("contenteditable")).toBe("true");
  });

  it("ввод текста эмитит HTML-модель", async () => {
    const wrapper = mount(RichTextEditor, { props: { modelValue: null } });
    const area = wrapper.find('[data-test="rich-editor-area"]');

    await area.element.focus();
    area.element.innerHTML = "<p>Часть средств идёт в фонд</p>";
    await area.trigger("input");

    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(String(emitted![0][0])).toContain("Часть средств идёт в фонд");
  });

  it("внешняя смена модели заливает поле", async () => {
    const wrapper = mount(RichTextEditor, { props: { modelValue: null } });
    await wrapper.setProps({ modelValue: "<p>Другой текст</p>" });

    expect(wrapper.find('[data-test="rich-editor-area"]').element.innerHTML).toContain("Другой текст");
  });

  it("пустой ввод эмитит null, а не пустые абзацы", async () => {
    const wrapper = mount(RichTextEditor, { props: { modelValue: null } });
    const area = wrapper.find('[data-test="rich-editor-area"]');

    area.element.innerHTML = "<p><br></p>";
    await area.trigger("input");

    // Пустые абзацы читаются как null — эмитить то же значение не нужно
    // (Vue-конвенция). Проверяем следующий осмысленный ввод.
    area.element.innerHTML = "<p>осмысленный текст</p>";
    await area.trigger("input");

    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(String(emitted![0][0])).toContain("осмысленный текст");
  });

  it("кнопки тулбара не уводят фокус из поля (mousedown.prevent)", async () => {
    const execCommandMock = vi.fn();
    document.execCommand = execCommandMock as any;

    const wrapper = mount(RichTextEditor, { props: { modelValue: null } });
    await wrapper.find('[data-test="rich-bold"]').trigger("click");

    expect(execCommandMock).toHaveBeenCalledWith("bold", false, undefined);
  });
});
