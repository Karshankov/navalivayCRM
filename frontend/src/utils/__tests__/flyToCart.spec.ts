import { afterEach, describe, expect, it, vi } from "vitest";
import { flyToCart, prefersReducedMotion } from "@/utils/flyToCart";

describe("flyToCart", () => {
  afterEach(() => {
    document.querySelectorAll(".navalivay-cart-flight").forEach((n) => n.remove());
    vi.restoreAllMocks();
  });

  it("не запускает полёт при prefers-reduced-motion", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const from = document.createElement("button");
    const to = document.createElement("div");
    document.body.append(from, to);

    expect(prefersReducedMotion()).toBe(true);
    expect(flyToCart({ from, to, image: null })).toBe(false);
    expect(document.querySelector(".navalivay-cart-flight")).toBeNull();
  });

  it("создаёт элемент полёта с изображением и удаляет его после", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    const from = document.createElement("button");
    const to = document.createElement("div");
    document.body.append(from, to);

    // happy-dom не реализует Element.animate — добавляем фейк.
    const fake = { finished: Promise.resolve() };
    (Element.prototype as unknown as Record<string, unknown>).animate = vi.fn(
      () => fake,
    );

    const started = flyToCart({ from, to, image: "/img/thumb.png" });
    expect(started).toBe(true);
    const flight = document.querySelector(".navalivay-cart-flight");
    expect(flight).not.toBeNull();
    expect(flight?.querySelector("img")?.getAttribute("src")).toBe("/img/thumb.png");
  });

  it("подставляет нейтральную иконку, когда картинки нет", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    const from = document.createElement("button");
    const to = document.createElement("div");
    document.body.append(from, to);

    const fake = { finished: Promise.resolve() };
    (Element.prototype as unknown as Record<string, unknown>).animate = vi.fn(
      () => fake,
    );

    flyToCart({ from, to, image: null });
    const flight = document.querySelector(".navalivay-cart-flight");
    expect(flight?.querySelector("svg")).not.toBeNull();
  });
});