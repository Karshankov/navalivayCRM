import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import CategoryFilterBar from "@/components/product/CategoryFilterBar.vue";

/**
 * Анимированная подсказка в поиске: печатается, держится, стирается
 * и сменяется следующей. Проверяем на фейковых таймерах.
 */
describe("CategoryFilterBar: подсказка в поиске", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function mountBar() {
    return mount(CategoryFilterBar, {
      props: { profile: "liquids", discountCount: 0 },
      attachTo: document.body,
    });
  }

  const hint = (w: ReturnType<typeof mountBar>) => w.find(".filter-search__hint-text").text();

  it("печатает первую фразу по буквам", async () => {
    const w = mountBar();
    await flushPromises();

    console.log("сразу после старта: «" + hint(w) + "»");
    expect(hint(w)).toBe("");

    // Первая фраза начинается через 400мс, дальше по 45мс на букву.
    await vi.advanceTimersByTimeAsync(400 + 45 * 5);
    const partial = hint(w);
    console.log("через 5 букв: «" + partial + "»");
    expect(partial.length).toBeGreaterThan(0);
    expect("ищите по вкусу".startsWith(partial)).toBe(true);

    w.unmount();
  });

  it("допечатывает первую фразу целиком", async () => {
    const w = mountBar();
    await flushPromises();

    const phrase = "ищите по вкусу";
    await vi.advanceTimersByTimeAsync(400 + 45 * phrase.length + 60);
    console.log("допечатано: «" + hint(w) + "»");
    expect(hint(w)).toBe(phrase);

    w.unmount();
  });

  it("после паузы стирает и переходит к следующей", async () => {
    const w = mountBar();
    await flushPromises();

    const first = "ищите по вкусу";
    // Допечатать, выдержать паузу, стереть.
    await vi.advanceTimersByTimeAsync(400 + 45 * first.length + 10);
    console.log("первая фраза: «" + hint(w) + "»");
    expect(hint(w)).toBe(first);

    await vi.advanceTimersByTimeAsync(1600 + 22 * first.length + 40);
    console.log("после стирания: «" + hint(w) + "»");

    // Началась вторая фраза — «малина».
    await vi.advanceTimersByTimeAsync(400 + 22 * 3);
    const second = hint(w);
    console.log("вторая фраза печатается: «" + second + "»");
    expect("малина".startsWith(second)).toBe(true);

    w.unmount();
  });

  it("длинная фраза про арбуз держится дольше короткой", async () => {
    const w = mountBar();
    await flushPromises();

    const SHORT = "ищите по вкусу";
    const LONG = "хотите что-то с арбузом? просто напишите";
    const TYPE = 45, ERASE = 22, HOLD = 1600, HOLD_LONG = 2400;

    /** Прокручивает время, пока фраза не допечатается целиком. */
    const advanceToPhrase = async (text: string) => {
      // Пока фраза короче нужной — идёт печать: шагаем по букве.
      for (let i = 0; i < 400; i += 1) {
        if (hint(w) === text) return true;
        await vi.advanceTimersByTimeAsync(TYPE);
      }
      return false;
    };

    // Добираемся до длинной фразы: короткая + «малина» + старт длинной.
    await vi.advanceTimersByTimeAsync(
      400 + TYPE * SHORT.length + HOLD + ERASE * SHORT.length + 320,
    );
    await vi.advanceTimersByTimeAsync(400 + TYPE * "малина".length + HOLD + ERASE * "малина".length + 320);

    const reached = await advanceToPhrase(LONG);
    console.log("допечатана длинная: " + reached);
    console.log("текст: «" + hint(w) + "»");
    expect(reached).toBe(true);

    // Короткой паузы не хватает: фраза всё ещё целая. Именно поэтому
    // для длинных стоит отдельная, удлинённая пауза.
    await vi.advanceTimersByTimeAsync(HOLD);
    console.log("через " + HOLD + "мс (короткая пауза) целая: «" + hint(w).slice(0, 22) + "…»");
    expect(hint(w)).toBe(LONG);

    // Она держится и дальше — значит пауза действительно длиннее.
    await vi.advanceTimersByTimeAsync(600);
    console.log("ещё через 600мс: «" + hint(w).slice(0, 22) + "…»");
    expect(hint(w).length).toBeGreaterThan(20);

    // В конце концов стирается.
    await vi.advanceTimersByTimeAsync(HOLD_LONG);
    console.log("после долгой паузы стёрлась: «" + hint(w) + "»");
    expect(hint(w).length).toBeLessThan(LONG.length);

    w.unmount();
  });

  it("подсказка исчезает, когда покупатель начал вводить", async () => {
    const w = mountBar();
    await flushPromises();

    await vi.advanceTimersByTimeAsync(400 + 55 * 10);
    console.log("до ввода подсказка есть:", w.find(".filter-search__hint").exists());
    expect(w.find(".filter-search__hint").exists()).toBe(true);

    await w.find("[data-test=filter-search]").setValue("виш");
    await flushPromises();

    console.log("после ввода подсказка:", w.find(".filter-search__hint").exists());
    expect(w.find(".filter-search__hint").exists()).toBe(false);

    w.unmount();
  });

  it("после очистки подсказка возвращается", async () => {
    const w = mountBar();
    await flushPromises();

    await w.find("[data-test=filter-search]").setValue("виш");
    await flushPromises();
    expect(w.find(".filter-search__hint").exists()).toBe(false);

    await w.find(".filter-search__clear").trigger("click");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(500);

    console.log("после очистки подсказка вернулась:", w.find(".filter-search__hint").exists());
    expect(w.find(".filter-search__hint").exists()).toBe(true);

    w.unmount();
  });

  it("подсказка недоступна скринридеру, у поля своя подпись", async () => {
    const w = mountBar();
    await flushPromises();

    const hintEl = w.find(".filter-search__hint");
    const input = w.find("[data-test=filter-search]");
    console.log("aria-hidden у подсказки:", hintEl.attributes("aria-hidden"));
    console.log("aria-label у поля:", input.attributes("aria-label"));

    expect(hintEl.attributes("aria-hidden")).toBe("true");
    expect(input.attributes("aria-label")).toBe("Поиск по вкусам");
    w.unmount();
  });

  it("таймеры останавливаются при размонтировании", async () => {
    const w = mountBar();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);

    w.unmount();
    const pending = vi.getTimerCount();
    console.log("таймеров после размонтирования:", pending);
    expect(pending).toBe(0);
  });
});
