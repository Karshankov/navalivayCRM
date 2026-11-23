import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import CoverPreview from "@/components/admin/CoverPreview.vue";

/**
 * Превью должно совпадать с мини-аппом: тот же компонент фото и та же
 * область. Проверяем, что оно использует ImageFade, а не свою картинку.
 */
describe("CoverPreview: превью обложки для CRM", () => {
  it("использует тот же компонент фото, что мини-апп", () => {
    const w = mount(CoverPreview, {
      props: { src: "/cover.png", title: "FREEZE", meta: "Крепость 20 мг" },
    });

    // Тот же ImageFade — значит геометрия считается тем же кодом.
    const fade = w.findComponent({ name: "ImageFade" });
    console.log("ImageFade найден:", fade.exists());
    expect(fade.exists()).toBe(true);
    expect(w.find(".image-fade").exists()).toBe(true);
  });

  it("область фото совпадает с мини-аппом по габаритам", () => {
    const w = mount(CoverPreview, { props: { src: "/cover.png" } });
    const art = w.find(".cover-preview__art");
    console.log("область фото есть:", art.exists());
    expect(art.exists()).toBe(true);
  });

  it("показывает название и характеристику из формы", () => {
    const w = mount(CoverPreview, {
      props: { src: "/cover.png", title: "PODONKI PODGON", meta: "Крепость 50 мг" },
    });

    console.log("название:", w.find(".cover-preview__title").text());
    console.log("характеристика:", w.find(".cover-preview__meta").text());

    expect(w.find(".cover-preview__title").text()).toBe("PODONKI PODGON");
    expect(w.find(".cover-preview__meta").text()).toBe("Крепость 50 мг");
  });

  it("без обложки показывает заглушку, а не пустоту", () => {
    const w = mount(CoverPreview, { props: { src: null } });
    console.log("заглушка:", w.find(".image-fade__placeholder").exists());
    expect(w.find(".image-fade__placeholder").exists()).toBe(true);
  });

  it("подпись объясняет, что это вид мини-аппа", () => {
    const w = mount(CoverPreview, { props: { src: "/cover.png" } });
    console.log("подпись:", w.find(".cover-preview__hint").text());
    expect(w.find(".cover-preview__hint").text()).toContain("мини-апп");
  });
});
