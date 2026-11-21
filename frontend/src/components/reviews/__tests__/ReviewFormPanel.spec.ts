import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ReviewFormPanel from "@/components/reviews/ReviewFormPanel.vue";

const q = (s: string) => document.querySelector(s) as HTMLElement | null;
const qa = (s: string) => [...document.querySelectorAll(s)];

describe("ReviewFormPanel", () => {
  beforeEach(() => { document.body.innerHTML = ""; vi.stubGlobal("innerHeight", 800); });
  afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); });

  function mountForm() {
    return mount(ReviewFormPanel, {
      props: {
        open: true,
        orderId: "order_1",
        groupId: "grp_1",
        title: "Картриджи для XROS",
        subtitle: "Xros 0.6 Ω",
      },
    });
  }

  it("показывает товар и пять звёзд", async () => {
    const w = mountForm();
    await flushPromises();

    console.log("название:", q(".rw-product strong")?.textContent);
    console.log("подпись:", q(".rw-product p")?.textContent);
    console.log("звёзд:", qa(".rw-star").length);
    console.log("заголовок:", q(".rs-head h2")?.textContent);
    expect(q(".rw-product strong")?.textContent).toBe("Картриджи для XROS");
    expect(qa(".rw-star")).toHaveLength(5);
    w.unmount();
  });

  it("кнопка «Отправить» требует только оценку — текст необязателен", async () => {
    const w = mountForm();
    await flushPromises();

    const btn = () => q(".rw-submit") as HTMLButtonElement;
    const setRating = async (value: number) => {
      const radios = qa(".rw-radio") as HTMLInputElement[];
      radios[value - 1].checked = true;
      radios[value - 1].dispatchEvent(new Event("change", { bubbles: true }));
      await flushPromises();
    };

    console.log("без оценки — disabled:", btn().disabled);
    expect(btn().disabled).toBe(true);

    await setRating(5);
    console.log("только оценка — disabled:", btn().disabled, "| подсказка:", q(".rw-note span")?.textContent);
    expect(btn().disabled).toBe(false);
    expect(qa(".rw-star.rw-filled")).toHaveLength(5);
    w.unmount();
  });

  it("подсказка и счётчик меняются по правилам макета", async () => {
    const w = mountForm();
    await flushPromises();

    const setRating = async (value: number) => {
      const radios = qa(".rw-radio") as HTMLInputElement[];
      radios[value - 1].checked = true;
      radios[value - 1].dispatchEvent(new Event("change", { bubbles: true }));
      await flushPromises();
    };

    console.log("без оценки:", (q("#rw-comment") as HTMLTextAreaElement).placeholder);
    await setRating(2);
    console.log("оценка 2:", (q("#rw-comment") as HTMLTextAreaElement).placeholder);
    await setRating(3);
    console.log("оценка 3:", (q("#rw-comment") as HTMLTextAreaElement).placeholder);
    await setRating(5);
    console.log("оценка 5:", (q("#rw-comment") as HTMLTextAreaElement).placeholder);

    // Счётчик ведёт к максимуму; текст можно не писать вовсе
    const area = q("#rw-comment") as HTMLTextAreaElement;
    area.value = "Хороший товар";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    console.log("счётчик:", q(".rw-counter")?.textContent, "| подсказка:", q(".rw-note span")?.textContent);
    expect(q(".rw-counter")?.textContent).toBe("13 / 2000");
    expect(q(".rw-note span")?.textContent).toBe("Комментарий готов");

    area.value = "";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    console.log("пусто:", q(".rw-note span")?.textContent);
    expect(q(".rw-note span")?.textContent).toBe("Комментарий необязателен");
    w.unmount();
  });

  it("отправляет отзыв и сообщает наружу", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ review: { id: "r1", status: "pending" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const w = mountForm();
    await flushPromises();

    const radios = qa(".rw-radio") as HTMLInputElement[];
    radios[4].checked = true;
    radios[4].dispatchEvent(new Event("change", { bubbles: true }));
    const area = q("#rw-comment") as HTMLTextAreaElement;
    area.value = "Очень хороший картридж, вкус отличный";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();

    (q(".rw-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushPromises();

    console.log("запросов:", fetchMock.mock.calls.length);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    console.log("URL:", url, "| метод:", options.method);
    const body = JSON.parse(String(options.body));
    console.log("тело:", JSON.stringify(body));
    expect(url).toBe("/api/reviews");
    expect(body.rating).toBe(5);
    expect(body.order_id).toBe("order_1");
    expect(body.group_id).toBe("grp_1");

    console.log("событие submitted:", w.emitted("submitted")?.length ?? 0);
    expect(w.emitted("submitted")).toHaveLength(1);
    w.unmount();
  });

  it("показывает ошибку, если сервер отказал", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 400,
      json: async () => ({ message: "Отзыв на этот товар уже оставлен" }),
    })));

    const w = mountForm();
    await flushPromises();

    const radios = qa(".rw-radio") as HTMLInputElement[];
    radios[3].checked = true;
    radios[3].dispatchEvent(new Event("change", { bubbles: true }));
    const area = q("#rw-comment") as HTMLTextAreaElement;
    area.value = "Нормальный товар, но есть замечания";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();

    (q(".rw-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushPromises();

    console.log("ошибка:", q(".rw-submit-error")?.textContent?.trim());
    expect(q(".rw-submit-error")?.textContent).toContain("уже оставлен");
    w.unmount();
  });
});
