import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import CategoryFilterBar from "@/components/product/CategoryFilterBar.vue";

/**
 * Версия из filters-fully-native.html: поиск, компактные плитки 50px
 * и крепость через нативный список системы.
 */
describe("CategoryFilterBar: нативные плитки", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => { document.body.innerHTML = ""; });

  function mountBar(props: Record<string, unknown> = {}) {
    return mount(CategoryFilterBar, {
      props: { profile: "liquids", discountCount: 0, ...props },
      attachTo: document.body,
    });
  }

  it("рисует поиск, ТОП-5 и выбор крепости", async () => {
    const w = mountBar();
    await flushPromises();

    console.log("поиск:", w.find("[data-test=filter-search]").exists());
    console.log("плейсхолдер:", w.find("[data-test=filter-search]").attributes("placeholder"));
    console.log("ТОП-5:", w.find("[data-test=filter-top]").exists());
    console.log("крепость:", w.find("[data-test=filter-strength]").exists());
    console.log("тип поля крепости:", w.find("[data-test=filter-strength]").element.tagName);

    expect(w.find("[data-test=filter-search]").exists()).toBe(true);
    expect(w.find("[data-test=filter-strength]").element.tagName).toBe("SELECT");
    w.unmount();
  });

  it("в списке крепости четыре варианта, первый — любой", async () => {
    const w = mountBar();
    await flushPromises();

    const options = w.findAll("[data-test=filter-strength] option");
    console.log("вариантов:", options.length);
    console.log("подписи:", options.map((o) => o.text()).join(" | "));

    expect(options).toHaveLength(4);
    expect(options[0].text()).toBe("Любая крепость");
    w.unmount();
  });

  it("нажатие ТОП-5 отправляет toggle-top", async () => {
    const w = mountBar();
    await flushPromises();

    await w.find("[data-test=filter-top]").trigger("change");
    console.log("событие toggle-top:", w.emitted("toggle-top")?.length ?? 0);
    expect(w.emitted("toggle-top")).toHaveLength(1);
    w.unmount();
  });

  it("выбор крепости применяет фильтр", async () => {
    const w = mountBar();
    await flushPromises();

    const select = w.find("[data-test=filter-strength]");
    await select.setValue("strong");
    await flushPromises();

    const events = w.emitted("toggle-strength");
    console.log("toggle-strength:", JSON.stringify(events));
    expect(events?.[0]).toEqual(["strong"]);
    w.unmount();
  });

  it("«Любая крепость» снимает фильтр", async () => {
    const w = mountBar({ strengthTier: "strong" });
    await flushPromises();

    await w.find("[data-test=filter-strength]").setValue("");
    await flushPromises();

    const events = w.emitted("toggle-strength");
    console.log("снятие:", JSON.stringify(events));
    expect(events?.[0]).toEqual(["strong"]);
    w.unmount();
  });

  it("подпись плитки показывает выбранную крепость", async () => {
    const w = mountBar({ strengthTier: "light" });
    await flushPromises();

    const caption = w.find(".filter-tile--strength .filter-tile__caption").text();
    console.log("подпись:", caption);
    console.log("плитка залита:", w.find(".filter-tile--strength").classes().includes("is-selected"));
    expect(caption).toBe("Лёгкая");
    w.unmount();
  });

  it("при выборе крепости поле синхронизируется с фильтром", async () => {
    const w = mountBar({ strengthTier: "very_strong" });
    await flushPromises();

    const value = (w.find("[data-test=filter-strength]").element as HTMLSelectElement).value;
    console.log("значение поля:", value);
    expect(value).toBe("very_strong");
    w.unmount();
  });

  it("поиск принимает ввод и очищается крестиком", async () => {
    const w = mountBar();
    await flushPromises();

    const input = w.find("[data-test=filter-search]");
    await input.setValue("вишня");
    await flushPromises();

    console.log("введено:", (input.element as HTMLInputElement).value);
    console.log("крестик:", w.find(".filter-search__clear").exists());
    expect(w.find(".filter-search__clear").exists()).toBe(true);

    await w.find(".filter-search__clear").trigger("click");
    await flushPromises();
    console.log("после очистки:", (w.find("[data-test=filter-search]").element as HTMLInputElement).value);
    expect((w.find("[data-test=filter-search]").element as HTMLInputElement).value).toBe("");
    w.unmount();
  });

  it("у снюса нет плитки крепости", async () => {
    const w = mountBar({ profile: "snus_plates" });
    await flushPromises();

    console.log("крепость у снюса:", w.find("[data-test=filter-strength]").exists());
    expect(w.find("[data-test=filter-strength]").exists()).toBe(false);
    w.unmount();
  });

  it("крестик поиска не виден, пока поле пустое", async () => {
    const w = mountBar();
    await flushPromises();

    console.log("крестик при пустом поле:", w.find(".filter-search__clear").exists());
    expect(w.find(".filter-search__clear").exists()).toBe(false);
    w.unmount();
  });
});
