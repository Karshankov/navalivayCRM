import { describe, it, vi, beforeEach, afterEach, expect } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import CrmReviews from "@/views/admin/crm/CrmReviews.vue";

type Wrapper = ReturnType<typeof mount>;
/** Страница рендерится без Teleport: ищем внутри обёртки, не в document. */
const q = (w: Wrapper, s: string) => w.find(s);
const qa = (w: Wrapper, s: string) => w.findAll(s);

const review = (over: Record<string, unknown> = {}) => ({
  id: "r1", order_id: "o1", order_number: 19307,
  group_name: "Картриджи для XROS", purchased_variant_name: "Xros 0.6 Ω",
  rating: 5, body_text: "Отличные картриджи, вкус передают хорошо",
  first_name: "Константин", telegram_username: "kostya",
  product_image_url: "/api/category-groups/g1/cover",
  created_at: "2026-11-21T18:00:00.000Z", ...over,
});

function stubFetch(items: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("pending-count")) return { ok: true, json: async () => ({ count: items.length }) };
    if (u.includes("product-reviews")) return { ok: true, json: async () => ({ items }) };
    if (u.includes("quick-tags")) return { ok: true, json: async () => ({ items: [] }) };
    if (u.includes("draws")) return { ok: true, json: async () => ({ items: [] }) };
    return { ok: true, json: async () => ({ items: [] }) };
  }));
}

describe("CrmReviews: очередь модерации", () => {
  beforeEach(() => { setActivePinia(createPinia()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  function mountPage() {
    return mount(CrmReviews, {
      global: { stubs: { RouterLink: { template: "<a><slot /></a>" } } },
    });
  }

  it("рисует карточку решения с оценкой, товаром и действиями", async () => {
    stubFetch([review()]);
    const w = mountPage();
    await flushPromises();

    console.log("карточек:", qa(w, ".crm-review-card").length);
    console.log("оценка:", q(w, ".crm-review-score b").text());
    console.log("товар:", q(w, ".crm-review-product").text().trim());
    console.log("автор:", q(w, ".crm-review-author").text().replace(/\s+/g, " ").trim());
    console.log("текст:", q(w, ".crm-review-body").text().trim());
    console.log("одобрить:", q(w, ".crm-review-approve").text().trim());
    console.log("отклонить:", q(w, ".crm-review-reject").text().trim());
    console.log("звёзд:", qa(w, ".crm-review-stars > span").length, "| выключенных:", qa(w, ".crm-review-stars .is-off").length);

    expect(qa(w, ".crm-review-card")).toHaveLength(1);
    expect(q(w, ".crm-review-score b").text()).toBe("5");
    expect(q(w, ".crm-review-product").text()).toContain("Картриджи для XROS");
    expect(q(w, ".crm-review-approve").exists()).toBe(true);
    w.unmount();
  });

  it("красит оценку по величине: низкая — красная, высокая — зелёная", async () => {
    stubFetch([
      review({ id: "a", rating: 1 }),
      review({ id: "b", rating: 3 }),
      review({ id: "c", rating: 5 }),
    ]);
    const w = mountPage();
    await flushPromises();

    const classes = qa(w, ".crm-review-score").map((n) => n.classes().find((c) => c.startsWith("crm-review-score--")));
    console.log("классы оценок:", classes.join(", "));
    expect(classes[0]).toBe("crm-review-score--low");
    expect(classes[1]).toBe("crm-review-score--mid");
    expect(classes[2]).toBe("crm-review-score--high");
    w.unmount();
  });

  it("показывает, что отзыв без текста — только оценка", async () => {
    stubFetch([review({ body_text: "   " })]);
    const w = mountPage();
    await flushPromises();

    console.log("пустой текст:", q(w, ".crm-review-body-empty").text().trim());
    expect(q(w, ".crm-review-body-empty").text()).toContain("без комментария");
    w.unmount();
  });

  it("пустая очередь показывает аккуратное состояние", async () => {
    stubFetch([]);
    const w = mountPage();
    await flushPromises();

    console.log("пусто:", q(w, ".crm-reviews-empty").text().replace(/\s+/g, " ").trim());
    console.log("карточек:", qa(w, ".crm-review-card").length);
    expect(q(w, ".crm-reviews-empty").exists()).toBe(true);
    expect(qa(w, ".crm-review-card")).toHaveLength(0);
    w.unmount();
  });

  it("кнопка одобрения открывает подтверждение, а не отправляет сразу", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, opts?: RequestInit) => {
      const u = String(url);
      if (opts?.method === "POST") {
        calls.push(u);
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (u.includes("pending-count")) return { ok: true, json: async () => ({ count: 1 }) };
      if (u.includes("product-reviews")) return { ok: true, json: async () => ({ items: [review()] }) };
      return { ok: true, json: async () => ({ items: [] }) };
    }));

    const w = mountPage();
    await flushPromises();

    await q(w, ".crm-review-approve").trigger("click");
    await flushPromises();

    // Логика не менялась: сначала подтверждение, запрос — только после него.
    console.log("POST до подтверждения:", calls.length);
    expect(calls).toHaveLength(0);

    // Модалка подтверждения открылась
    const modalText = w.text();
    console.log("подтверждение показано:", /одобр/i.test(modalText));
    expect(/одобр/i.test(modalText)).toBe(true);
    w.unmount();
  });
});
