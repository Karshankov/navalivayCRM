import { describe, it, vi, beforeEach, afterEach, expect } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ReviewsFeedPanel from "@/components/reviews/ReviewsFeedPanel.vue";

const q = (s: string) => document.querySelector(s) as HTMLElement | null;
const qa = (s: string) => [...document.querySelectorAll(s)];

describe("панель отзывов в карточке товара", () => {
  beforeEach(() => { document.body.innerHTML = ""; vi.stubGlobal("innerHeight", 800); });
  afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); });

  it("запрашивает отзывы конкретной линейки", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return { ok: true, json: async () => ({ review_count: 170, average_rating: 4.9, items: [{
        id: "r1", rating: 5, body_text: "Отличные картриджи", group_id: "cg_1hubzb",
        group_name: "Картриджи для XROS", product_image_url: null,
        purchased_variant_name: "Xros 0.6 Ω",
        reviewer: { display_name: "Константин", photo_url: null, is_anonymous: false, is_viewer: false },
        created_at: "2026-11-21T18:00:00.000Z", approved_at: null,
      }] }) };
    }));

    const w = mount(ReviewsFeedPanel, {
      props: { open: true, groupId: "cg_1hubzb", heading: "О линейке «Картриджи для XROS»" },
    });
    await flushPromises();

    console.log("запрос:", urls[0]);
    console.log("заголовок:", q(".rs-head p")?.textContent?.trim());
    console.log("карточек:", qa(".rs-review").length);
    console.log("автор:", q(".rs-author strong")?.textContent);
    console.log("товар:", q(".rs-product-name")?.textContent);
    console.log("теги на экране:", qa(".rs-review .rs-tags, .rs-tag").length);

    expect(urls[0]).toContain("group_id=cg_1hubzb");
    expect(q(".rs-head p")?.textContent).toContain("Картриджи для XROS");
    expect(qa(".rs-review")).toHaveLength(1);
    w.unmount();
  });

  it("на главной запрашивает все отзывы, без фильтра", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return { ok: true, json: async () => ({ review_count: 1234, average_rating: 4.9, items: [] }) };
    }));

    const w = mount(ReviewsFeedPanel, { props: { open: true } });
    await flushPromises();

    console.log("запрос:", urls[0]);
    console.log("фильтра нет:", !urls[0].includes("group_id"));
    expect(urls[0]).not.toContain("group_id");
    w.unmount();
  });

  it("при смене линейки перезагружает отзывы", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return { ok: true, json: async () => ({ review_count: 1, average_rating: 5, items: [] }) };
    }));

    const w = mount(ReviewsFeedPanel, { props: { open: true, groupId: "grp_a" } });
    await flushPromises();
    console.log("первый запрос:", urls[0]);

    await w.setProps({ groupId: "grp_b" });
    await flushPromises();
    console.log("после смены:", urls[urls.length - 1]);
    console.log("запросов всего:", urls.length);

    expect(urls.some((u) => u.includes("grp_b"))).toBe(true);
    w.unmount();
  });
});
