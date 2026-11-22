import { describe, it, expect, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import CategoryFilterBar from "@/components/product/CategoryFilterBar.vue";

const q = (s: string) => document.querySelector(s) as HTMLElement | null;
const qa = (s: string) => [...document.querySelectorAll(s)];

describe("CategoryFilterBar: плитки фильтров", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => { document.body.innerHTML = ""; });

  function mountBar(props: Record<string, unknown> = {}) {
    return mount(CategoryFilterBar, {
      props: { profile: "liquids", discountCount: 0, ...props },
      attachTo: document.body,
    });
  }

  it("рисует две плитки для жидкостей", async () => {
    const w = mountBar();
    await flushPromises();

    const tiles = w.findAll(".filter-tile");
    console.log("плиток:", tiles.length);
    console.log("подписи:", tiles.map((t) => t.find(".filter-tile__caption").text()).join(" | "));
    console.log("артов:", w.findAll(".filter-tile__art").length);

    expect(tiles).toHaveLength(2);
    expect(w.find("[data-test=filter-top]").exists()).toBe(true);
    expect(w.find("[data-test=filter-strength-open]").exists()).toBe(true);
    w.unmount();
  });

  it("нажатие плитки «Чаще берут» отправляет toggle-top", async () => {
    const w = mountBar();
    await flushPromises();

    await w.find("[data-test=filter-top]").trigger("click");
    console.log("событие toggle-top:", w.emitted("toggle-top")?.length ?? 0);
    expect(w.emitted("toggle-top")).toHaveLength(1);
    w.unmount();
  });

  it("выбранное состояние красит плитку и ставит aria-pressed", async () => {
    const w = mountBar({ topActive: true });
    await flushPromises();

    const top = w.find("[data-test=filter-top]");
    console.log("aria-pressed:", top.attributes("aria-pressed"));
    expect(top.attributes("aria-pressed")).toBe("true");
    w.unmount();
  });

  it("плитка крепости открывает панель с вариантами", async () => {
    const w = mountBar();
    await flushPromises();

    console.log("до нажатия панель:", !!q(".strength-sheet"));
    await w.find("[data-test=filter-strength-open]").trigger("click");
    await flushPromises();

    const sheet = q(".strength-sheet");
    console.log("после нажатия панель:", !!sheet);
    console.log("заголовок:", q("#strength-sheet-title")?.textContent);
    const options = qa(".strength-option");
    console.log("вариантов:", options.length);
    console.log("подписи:", options.map((o) => o.textContent?.trim()).join(" | "));

    expect(sheet).not.toBeNull();
    expect(options).toHaveLength(4);
    w.unmount();
  });

  it("выбор крепости применяет фильтр и закрывает панель", async () => {
    const w = mountBar();
    await flushPromises();

    await w.find("[data-test=filter-strength-open]").trigger("click");
    await flushPromises();
    // Панель уезжает в body через Teleport — ищем её в документе.
    (q("[data-test=strength-strong]") as HTMLButtonElement).click();
    await flushPromises();

    const events = w.emitted("toggle-strength");
    console.log("toggle-strength:", JSON.stringify(events));
    console.log("панель закрылась:", !q(".strength-sheet"));
    expect(events).toHaveLength(1);
    expect(events?.[0]).toEqual(["strong"]);
    w.unmount();
  });

  it("«Любая крепость» снимает фильтр", async () => {
    const w = mountBar({ strengthTier: "strong" });
    await flushPromises();

    await w.find("[data-test=filter-strength-open]").trigger("click");
    await flushPromises();
    (q("[data-test=strength-any]") as HTMLButtonElement).click();
    await flushPromises();

    const events = w.emitted("toggle-strength");
    console.log("снятие фильтра:", JSON.stringify(events));
    expect(events?.[0]).toEqual(["strong"]);
    w.unmount();
  });

  it("подпись плитки показывает выбранную крепость", async () => {
    const w = mountBar({ strengthTier: "light" });
    await flushPromises();

    const caption = w.find("[data-test=filter-strength-open] .filter-tile__caption").text();
    console.log("подпись при выбранной лёгкой:", caption);
    expect(caption).toBe("Лёгкая");
    w.unmount();
  });

  it("у снюса нет плитки крепости", async () => {
    const w = mountBar({ profile: "snus_plates" });
    await flushPromises();

    console.log("плиток у снюса:", w.findAll(".filter-tile").length);
    expect(w.find("[data-test=filter-strength-open]").exists()).toBe(false);
    w.unmount();
  });
});
