/**
 * Ключ верхнего <RouterView>.
 *
 * Проверяется ровно одно свойство: ключ меняется тогда и только тогда, когда
 * верхний RouterView начинает рисовать другой экран. Движение внутри экрана —
 * вкладка админки в строке запроса, раздел CRM во вложенном маршруте — ключ
 * менять не должно, иначе Vue пересоберёт весь экран и анимация разъедется.
 */

import { describe, expect, it } from "vitest";
import { topLevelViewKey, type KeyedRoute } from "@/router/view-key";

/** Маршрут в том виде, в каком его отдаёт Vue Router после разбора. */
function route(fullPath: string, matched: string[], params: Record<string, unknown> = {}): KeyedRoute {
  return { fullPath, params, matched: matched.map((path) => ({ path })) };
}

describe("ключ верхнего RouterView", () => {
  it("не меняется при переключении вкладок админки", () => {
    // Вкладка живёт в строке запроса: router.push({ path: '/admin', query: { tab } }).
    const products = route("/admin?tab=products", ["/admin"]);
    const settings = route("/admin?tab=settings", ["/admin"]);
    expect(topLevelViewKey(products)).toBe(topLevelViewKey(settings));
  });

  it("не меняется при переходе между разделами CRM", () => {
    // Вложенные записи рисует <RouterView> внутри AdminView, а не верхний.
    const orders = route("/admin/crm/orders", ["/admin", "/admin/crm/orders"]);
    const customers = route("/admin/crm/customers", ["/admin", "/admin/crm/customers"]);
    expect(topLevelViewKey(orders)).toBe(topLevelViewKey(customers));
  });

  it("не меняется при открытии карточки внутри раздела CRM", () => {
    // `:id` объявлен у дочерней записи, у корня `/admin` параметров нет.
    const list = route("/admin/crm/orders", ["/admin", "/admin/crm/orders"]);
    const card = route("/admin/crm/orders/7", ["/admin", "/admin/crm/orders/:id"], { id: "7" });
    expect(topLevelViewKey(card)).toBe(topLevelViewKey(list));
  });

  it("меняется при переходе на другой товар", () => {
    // `:id` объявлен у самой записи нулевой глубины — экран обязан пересобраться.
    const first = route("/p/1", ["/p/:id"], { id: "1" });
    const second = route("/p/2", ["/p/:id"], { id: "2" });
    expect(topLevelViewKey(first)).not.toBe(topLevelViewKey(second));
  });

  it("меняется при переходе на другую категорию", () => {
    const liquids = route("/category/liquids", ["/category/:slug"], { slug: "liquids" });
    const pods = route("/category/pods", ["/category/:slug"], { slug: "pods" });
    expect(topLevelViewKey(liquids)).not.toBe(topLevelViewKey(pods));
  });

  it("различает разные экраны верхнего уровня", () => {
    expect(topLevelViewKey(route("/", ["/"]))).not.toBe(topLevelViewKey(route("/profile", ["/profile"])));
  });

  it("учитывает все параметры записи, а не только первый", () => {
    const first = route("/opt/a/one", ["/opt/:code/:secret"], { code: "a", secret: "one" });
    const second = route("/opt/a/two", ["/opt/:code/:secret"], { code: "a", secret: "two" });
    expect(topLevelViewKey(first)).not.toBe(topLevelViewKey(second));
  });

  it("на маршруте без совпадений откатывается к полному пути", () => {
    expect(topLevelViewKey(route("/nowhere", []))).toBe("/nowhere");
  });
});
