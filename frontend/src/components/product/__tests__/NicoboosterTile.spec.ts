import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import NicoboosterTile from "@/components/product/NicoboosterTile.vue";
import type { Product } from "@/stores/catalog";

const product = (over: Partial<Product> = {}): Product =>
  ({
    id: "p_yfduoe",
    title: "Никобустер",
    priceRub: 4,
    stock: 267,
    isAvailable: true,
    ...over,
  }) as Product;

describe("NicoboosterTile: плитка в стиле фильтров", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  function mountTile(props: Record<string, unknown> = {}) {
    return mount(NicoboosterTile, { props: { product: product(), ...props } });
  }

  it("показывает название и подпись, без цены в названии", async () => {
    const w = mountTile();

    console.log("название:", w.find(".nicobooster__title").text().trim());
    console.log("подпись:", w.find(".nicobooster__note").text());
    console.log("цена в названии:", w.find(".nicobooster__price").exists() ? "есть" : "убрана");

    expect(w.find(".nicobooster__title").text()).toBe("Никобустер");
    expect(w.find(".nicobooster__note").text()).toBe("+20мг к крепости");
    // Цена живёт только в кнопке: в названии её больше нет.
    expect(w.find(".nicobooster__price").exists()).toBe(false);
    w.unmount();
  });

  it("цена целая без хвоста нулей", async () => {
    const w = mountTile({ product: product({ priceRub: 4 }) });
    console.log("4 →", w.find(".nicobooster__add-price").text());
    expect(w.find(".nicobooster__add-price").text()).toBe("4 BYN");
    w.unmount();

    const w2 = mountTile({ product: product({ priceRub: 12.5 }) });
    console.log("12.5 →", w2.find(".nicobooster__add-price").text());
    expect(w2.find(".nicobooster__add-price").text()).toBe("12,50 BYN");
    w2.unmount();
  });

  it("пустая корзина — кнопка с ценой вместо плюса", async () => {
    const w = mountTile({ quantity: 0 });

    const btn = w.find("[data-test=nicobooster-add]");
    console.log("текст кнопки: «" + btn.text().replace(/\s+/g, " ").trim() + "»");
    console.log("цена в кнопке: «" + w.find(".nicobooster__add-price").text() + "»");
    console.log("aria-label: " + btn.attributes("aria-label"));
    console.log("счётчик:", w.find(".nicobooster__count").exists());

    // Покупателю видно цену ещё до нажатия — это главное в кнопке.
    expect(btn.text()).toContain("Добавить за");
    expect(w.find(".nicobooster__add-price").text()).toBe("4 BYN");
    expect(btn.attributes("aria-label")).toContain("за 4 BYN");
    expect(w.find(".nicobooster__count").exists()).toBe(false);
    w.unmount();
  });

  it("цена в кнопке берётся из товара", async () => {
    const w = mountTile({ product: product({ priceRub: 7 }) });
    const inButton = w.find(".nicobooster__add-price").text();
    console.log("цена товара 7 → в кнопке:", inButton);
    expect(inButton).toBe("7 BYN");
    w.unmount();
  });

  it("товар в корзине — счётчик и кнопки количества", async () => {
    const w = mountTile({ quantity: 3 });

    console.log("счётчик:", w.find(".nicobooster__count").text());
    console.log("кнопок количества:", w.findAll(".nicobooster__qty").length);
    console.log("кнопка добавления скрыта:", !w.find("[data-test=nicobooster-add]").exists());

    expect(w.find(".nicobooster__count").text()).toBe("3");
    expect(w.findAll(".nicobooster__qty")).toHaveLength(2);
    expect(w.find("[data-test=nicobooster-add]").exists()).toBe(false);
    w.unmount();
  });

  it("нажатия сообщают наружу — логика корзины не менялась", async () => {
    const w = mountTile({ quantity: 0 });
    await w.find("[data-test=nicobooster-add]").trigger("click");
    console.log("событие add:", w.emitted("add")?.length ?? 0);
    expect(w.emitted("add")).toHaveLength(1);
    w.unmount();

    const w2 = mountTile({ quantity: 2 });
    const qty = w2.findAll(".nicobooster__qty");
    await qty[0].trigger("click");
    await qty[1].trigger("click");
    console.log("убавить:", w2.emitted("decrement")?.length ?? 0);
    console.log("прибавить:", w2.emitted("increment")?.length ?? 0);
    expect(w2.emitted("decrement")).toHaveLength(1);
    expect(w2.emitted("increment")).toHaveLength(1);
    w2.unmount();
  });

  it("нет товара в наличии — кнопка приглушена", async () => {
    const w = mountTile({ canAdd: false });
    const btn = w.find("[data-test=nicobooster-add]");
    console.log("класс is-disabled:", btn.classes().includes("is-disabled"));
    expect(btn.classes()).toContain("is-disabled");
    w.unmount();
  });

  it("без товара плитка не рисуется", async () => {
    const w = mountTile({ product: null });
    console.log("плитка при пустом товаре:", w.find(".nicobooster").exists());
    expect(w.find(".nicobooster").exists()).toBe(false);
    w.unmount();
  });
});
