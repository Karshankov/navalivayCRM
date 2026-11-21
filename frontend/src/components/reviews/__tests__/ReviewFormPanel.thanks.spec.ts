import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ReviewFormPanel from "@/components/reviews/ReviewFormPanel.vue";

const q = (s: string) => document.querySelector(s) as HTMLElement | null;
const qa = (s: string) => [...document.querySelectorAll(s)];

/**
 * Переход между позициями: окно остаётся открытым, форма пересоздаётся
 * с затуханием. Отдельного экрана «Спасибо» больше нет.
 */
describe("ReviewFormPanel: переход к следующей позиции", () => {
  beforeEach(() => { document.body.innerHTML = ""; vi.stubGlobal("innerHeight", 800); });
  afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); });

  function mountForm(props: Record<string, unknown> = {}) {
    return mount(ReviewFormPanel, {
      props: {
        open: true,
        orderId: "order_1",
        groupId: "grp_1",
        title: "Испарители для URSA MINI",
        subtitle: "URSA MINI 1.0 Ω",
        ...props,
      },
    });
  }

  async function submitReview(rating = 5) {
    const radios = qa(".rw-radio") as HTMLInputElement[];
    radios[rating - 1].checked = true;
    radios[rating - 1].dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();
    (q(".rw-form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await flushPromises();
  }

  it("форма остаётся на месте после отправки — окно не сменяется экраном", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({}),
    })));

    const w = mountForm();
    await flushPromises();
    await submitReview();

    console.log("форма есть:", !!q(".rw-form"), "| экран «спасибо»:", !!q(".rw-thanks"));
    console.log("событие submitted:", w.emitted("submitted")?.length ?? 0);
    expect(q(".rw-form")).not.toBeNull();
    expect(q(".rw-thanks")).toBeNull();
    expect(w.emitted("submitted")).toHaveLength(1);
    w.unmount();
  });

  it("при смене позиции форма сбрасывается: оценка, текст, ключ", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({}),
    })));

    const w = mountForm();
    await flushPromises();

    const area = q("#rw-comment") as HTMLTextAreaElement;
    area.value = "Хорошая вещь, доволен";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    await submitReview(4);

    console.log("до смены — счётчик:", q(".rw-counter")?.textContent);
    expect(q(".rw-counter")?.textContent).toBe("21 / 2000");

    // Родитель отдаёт следующую позицию: меняются название и заказ
    await w.setProps({
      title: "СНЮС FAFF 75MG",
      subtitle: "Двойное яблоко",
      orderId: "order_2",
      groupId: "grp_2",
    });
    await flushPromises();

    console.log("после смены — товар:", q(".rw-product strong")?.textContent);
    console.log("после смены — счётчик:", q(".rw-counter")?.textContent);
    console.log("после смены — закрашено звёзд:", qa(".rw-star.rw-filled").length);
    console.log("после смены — кнопка disabled:", (q(".rw-submit") as HTMLButtonElement).disabled);

    expect(q(".rw-product strong")?.textContent).toBe("СНЮС FAFF 75MG");
    expect(q(".rw-product p")?.textContent).toBe("Двойное яблоко");
    expect(q(".rw-counter")?.textContent).toBe("0 / 2000");
    expect(qa(".rw-star.rw-filled")).toHaveLength(0);
    // Оценка сброшена — отправлять нечего
    expect((q(".rw-submit") as HTMLButtonElement).disabled).toBe(true);
    w.unmount();
  });

  it("отправка уходит на следующую позицию с её заказом", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const w = mountForm();
    await flushPromises();

    await w.setProps({ orderId: "order_2", groupId: "grp_2", title: "СНЮС FAFF 75MG" });
    await flushPromises();
    await submitReview(5);

    const [, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(options.body));
    console.log("тело запроса:", JSON.stringify(body));
    expect(body.order_id).toBe("order_2");
    expect(body.group_id).toBe("grp_2");
    expect(body.rating).toBe(5);
    w.unmount();
  });

  it("окно не закрывается само, пока есть что оценивать", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({}),
    })));

    const w = mountForm({ pendingCount: 3 });
    await flushPromises();
    await submitReview();

    await new Promise((r) => setTimeout(r, 600));
    console.log("после полусекунды — форма на месте:", !!q(".rw-form"));
    console.log("событие close:", w.emitted("close")?.length ?? 0);
    // Родитель решает закрывать ли окно; компонент сам его не закрывает
    expect(q(".rw-form")).not.toBeNull();
    expect(w.emitted("close")).toBeUndefined();
    w.unmount();
  });
});
