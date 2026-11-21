import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ReviewsFeedPanel from "@/components/reviews/ReviewsFeedPanel.vue";

/**
 * Панель рендерится через Teleport to="body", поэтому wrapper.find её
 * не видит — ищем в document, куда Teleport и переносит разметку.
 */
function q<T extends Element = HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function qa(selector: string): Element[] {
  return [...document.querySelectorAll(selector)];
}

function jsonResponse(data: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => data };
}

function buildFeed(overrides: Record<string, unknown> = {}) {
  return {
    review_count: 1232,
    average_rating: 4.9,
    items: [
      {
        id: "r1",
        rating: 5,
        body_text: "Всё понравилось, вкус отличный",
        group_id: "grp1",
        group_name: "PODONKI PODGON",
        purchased_variant_name: "Вишня",
        quick_tag_labels: [],
        reviewer: { display_name: "Покупатель", photo_url: null, is_anonymous: true, is_viewer: false },
        created_at: "2026-11-20T10:00:00.000Z",
        approved_at: "2026-11-20T10:00:00.000Z",
      },
      {
        id: "r2",
        rating: 4,
        body_text: "Хорошо, но чуть течёт",
        group_id: "grp2",
        group_name: "PODONKI BLOOD",
        purchased_variant_name: null,
        quick_tag_labels: [],
        reviewer: { display_name: "Мария К.", photo_url: null, is_anonymous: false, is_viewer: false },
        created_at: "2026-11-19T10:00:00.000Z",
        approved_at: "2026-11-19T10:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("ReviewsFeedPanel", () => {
  // Каждый тест монтирует свой Teleport в body: без очистки разметка
  // предыдущего теста остаётся и селекторы находят чужие узлы.
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.stubGlobal("innerHeight", 800);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  /** Даёт промисам и таймерам дойти до конца, включая закрытие панели. */
  async function settle(ms = 450) {
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, ms));
    await flushPromises();
  }

  it("загружает отзывы при открытии и показывает реальные числа", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(buildFeed()));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ReviewsFeedPanel, { props: { open: false } });
    expect(q(".rs-panel")).toBeNull();

    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    console.log("URL запроса:", url);
    expect(url).toContain("/api/reviews/feed");

    // Блок с оценкой из панели убран: 4,9 и количество живут только
    // в плитке на главной, внутри списка их не показываем.
    console.log("блок оценки в панели:", q(".rs-summary") ? "есть" : "убран");
    expect(q(".rs-summary")).toBeNull();
    console.log("счётчик в списке:", q(".rs-tools strong")?.textContent);
    expect(q(".rs-tools strong")?.textContent).toBe("Все отзывы · 1232");

    const reviews = qa(".rs-review");
    console.log("отзывов на экране:", reviews.length);
    expect(reviews).toHaveLength(2);
    console.log("товар первого:", q(".rs-product-name")?.textContent);
    expect(q(".rs-product-name")?.textContent).toBe("PODONKI PODGON — Вишня");
    expect(q(".rs-panel")?.textContent).toContain("PODONKI BLOOD");
    expect(q(".rs-panel")?.textContent).toContain("Покупатель");
    expect(q(".rs-panel")?.textContent).toContain("Мария К.");

    wrapper.unmount();
  });

  it("панель открывается малым положением и разворачивается на весь экран", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(buildFeed())));
    const wrapper = mount(ReviewsFeedPanel, { props: { open: true } });
    await flushPromises();

    console.log("классы панели при открытии:", q(".rs-shell")?.className);
    expect(q(".rs-shell--full")).toBeNull();

    // Жест вверх по полоске разворачивает панель
    const grip = q(".rs-grip")!;
    const pointer = (type: string, clientY: number) => {
      const event = new Event(type, { bubbles: true }) as PointerEvent;
      Object.assign(event, { clientY, pointerId: 1, pointerType: "touch", button: 0 });
      grip.dispatchEvent(event);
    };

    pointer("pointerdown", 600);
    pointer("pointermove", 500);
    await wrapper.vm.$nextTick();
    const dragged = q<HTMLElement>(".rs-panel")?.style.height;
    console.log("высота при перетаскивании:", dragged);
    // Панель следует за пальцем: вверх потянули — стала выше малой (512)
    expect(dragged).not.toBe("");
    expect(parseFloat(dragged || "0")).toBeGreaterThan(512);

    pointer("pointerup", 500);
    await flushPromises();
    console.log("классы после жеста вверх:", q(".rs-shell")?.className);
    expect(q(".rs-shell--full")).not.toBeNull();

    wrapper.unmount();
  });

  it("закрывается крестиком", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(buildFeed())));
    const wrapper = mount(ReviewsFeedPanel, { props: { open: true } });
    await flushPromises();

    q<HTMLElement>(".rs-close")!.click();
    await settle();
    console.log("close после крестика:", wrapper.emitted("close")?.length ?? 0);
    expect(wrapper.emitted("close")).toHaveLength(1);

    wrapper.unmount();
  });

  it("закрывается по маске", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(buildFeed())));
    const wrapper = mount(ReviewsFeedPanel, { props: { open: true } });
    await flushPromises();

    q<HTMLElement>(".rs-mask")!.click();
    await settle();
    console.log("close после маски:", wrapper.emitted("close")?.length ?? 0);
    expect(wrapper.emitted("close")).toHaveLength(1);

    wrapper.unmount();
  });

  it("закрывается по Escape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(buildFeed())));
    const wrapper = mount(ReviewsFeedPanel, { props: { open: true } });
    await flushPromises();

    q<HTMLElement>(".rs-panel")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await settle();
    console.log("close после Escape:", wrapper.emitted("close")?.length ?? 0);
    expect(wrapper.emitted("close")).toHaveLength(1);

    wrapper.unmount();
  });

  it("показывает пустое состояние, когда отзывов нет", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ review_count: 0, average_rating: null, items: [] }),
    ));
    const wrapper = mount(ReviewsFeedPanel, { props: { open: true } });
    await flushPromises();

    console.log("пусто:", Boolean(q(".rs-empty")));
    expect(q(".rs-empty")).not.toBeNull();
    // Блока оценки больше нет — проверяем, что пустой список читается
    // по своему сообщению, а не по нулям в агрегате.
    expect(q(".rs-summary")).toBeNull();
    expect(q(".rs-empty")?.textContent).toContain("Пока нет отзывов");

    wrapper.unmount();
  });

  it("показывает ошибку и даёт повторить", async () => {
    let attempt = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) return jsonResponse({}, false);
      return jsonResponse(buildFeed());
    }));

    const wrapper = mount(ReviewsFeedPanel, { props: { open: true } });
    await settle(0);

    console.log("ошибка:", q(".rs-state")?.textContent?.trim());
    expect(q(".rs-state")?.textContent).toContain("Не удалось загрузить отзывы");

    q<HTMLElement>(".rs-reset")!.click();
    await settle(0);
    console.log("после повтора отзывов:", qa(".rs-review").length);
    expect(qa(".rs-review")).toHaveLength(2);

    wrapper.unmount();
  });

  it("форматирует дату как ДД.ММ.ГГГГ и подпись с «—» только при варианте", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(buildFeed())));
    const wrapper = mount(ReviewsFeedPanel, { props: { open: true } });
    await flushPromises();

    const dates = qa(".rs-author time").map((n) => n.textContent);
    console.log("даты:", dates.join(", "));
    expect(dates[0]).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);

    const products = qa(".rs-product-name").map((n) => n.textContent);
    console.log("товары:", products.join(" | "));
    // Второй отзыв без варианта — без тире в конце
    expect(products[1]).toBe("PODONKI BLOOD");

    wrapper.unmount();
  });
});
