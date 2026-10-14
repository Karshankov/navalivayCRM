import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "navalivay-crm-regressions-"));
const tempDbPath = path.join(tempDir, "test.db");

process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = "";
process.env.BUSINESS_TIMEZONE = "Europe/Minsk";

const { initDb, db } = await import("../db.js");
const { issueToken } = await import("../auth.js");
const { crmRouter } = await import("../routes/crm.js");
const { crmOperationsRouter } = await import("../routes/crm-operations.js");

initDb();

const app = express();
app.use(express.json());
app.use(crmRouter);
app.use(crmOperationsRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});

const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
const authToken = issueToken("test-admin");

// Сводка внутри окна проверок закрыта замком, и без пропуска половина тестов
// падала бы просто оттого, что их запустили днём.
const { issueDashboardToken } = await import("../utils/dashboard-access.js");
const dashboardToken = issueDashboardToken().token;

function authHeaders() {
  return {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
    "X-Dashboard-Token": dashboardToken,
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function insertCategory() {
  const categoryId = makeId("cat");
  db.prepare(
    `
      INSERT INTO categories (id, slug, name, [order])
      VALUES (?, ?, ?, ?)
    `,
  ).run(categoryId, categoryId, "Test Category", 1);
  return categoryId;
}

function insertProduct({
  stock,
  title = "Regression Product",
  price = 20,
  cost = 12,
}) {
  const categoryId = insertCategory();
  const productId = makeId("prod");
  db.prepare(
    `
      INSERT INTO products (id, categoryId, title, priceRub, cost_price, stock, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(productId, categoryId, title, price, cost, stock, "2026-03-24 20:00:00");

  return productId;
}

function insertOrder({
  orderNumber,
  status,
  stockDeducted,
  createdAt,
  paidAt = null,
  completedAt = null,
  items,
}) {
  const orderId = makeId("order");
  const normalizedItems = items.map((item) => ({
    productId: item.productId,
    productTitle: item.productTitle || "Regression Product",
    quantity: Number(item.quantity ?? 1),
    price: Number(item.price ?? 20),
    cost: Number(item.cost ?? 12),
  }));
  const totalAmount = normalizedItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const totalCost = normalizedItems.reduce(
    (sum, item) => sum + item.cost * item.quantity,
    0,
  );
  const profit = totalAmount - totalCost;

  db.prepare(
    `
      INSERT INTO orders (
        id, order_number, status, delivery_type, total_amount, final_amount, profit,
        stock_deducted, created_at, updated_at, paid_at, completed_at
      )
      VALUES (?, ?, ?, 'pickup', ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    orderId,
    orderNumber,
    status,
    totalAmount,
    totalAmount,
    profit,
    stockDeducted,
    createdAt,
    createdAt,
    paidAt,
    completedAt,
  );

  const insertItem = db.prepare(
    `
      INSERT INTO order_items (
        id, order_id, product_id, product_title, quantity,
        price_per_unit, cost_per_unit, total_price, total_cost
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );

  for (const item of normalizedItems) {
    insertItem.run(
      makeId("oi"),
      orderId,
      item.productId,
      item.productTitle,
      item.quantity,
      item.price,
      item.cost,
      item.price * item.quantity,
      item.cost * item.quantity,
    );
  }

  return orderId;
}

function insertPosSale({ saleNumber, price, costPrice, completedAt }) {
  const saleId = makeId("pos");
  db.prepare(
    `
      INSERT INTO pos_sales (
        id, sale_number, product_name, price, cost_price, profit, status, created_at, completed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?)
    `,
  ).run(
    saleId,
    saleNumber,
    `POS ${saleNumber}`,
    price,
    costPrice,
    price - costPrice,
    completedAt,
    completedAt,
  );

  return saleId;
}

function getProductStock(productId) {
  return db.prepare("SELECT stock FROM products WHERE id = ?").get(productId).stock;
}

function getOrder(orderId) {
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
}

function getCashAccountBalance(accountId = "acc_default") {
  return Number(
    db.prepare("SELECT balance FROM cash_accounts WHERE id = ?").get(accountId)
      ?.balance || 0,
  );
}

function getCashTransactionCountForOrder(orderId) {
  return Number(
    db
      .prepare("SELECT COUNT(*) as count FROM cash_transactions WHERE order_id = ?")
      .get(orderId)?.count || 0,
  );
}

function getOrderItems(orderId) {
  return db
    .prepare(
      `
        SELECT product_id, quantity, price_per_unit
        FROM order_items
        WHERE order_id = ?
        ORDER BY product_id
      `,
    )
    .all(orderId)
    .map((item) => ({
      product_id: item.product_id,
      quantity: Number(item.quantity),
      price_per_unit: Number(item.price_per_unit),
    }));
}

function assertOrderItems(orderId, expectedItems) {
  const actual = getOrderItems(orderId);
  const expected = expectedItems
    .map((item) => ({
      product_id: item.product_id,
      quantity: Number(item.quantity),
      price_per_unit: Number(item.price_per_unit),
    }))
    .sort((left, right) => left.product_id.localeCompare(right.product_id));

  assert.deepEqual(actual, expected);
}

async function patchOrder(orderId, payload) {
  return requestJson(`/api/admin/crm/orders/${orderId}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
}

async function fetchDashboardToday() {
  return requestJson("/api/admin/crm/dashboard?period=today", {
    method: "GET",
    headers: authHeaders(),
  });
}

async function fetchDashboardTodayTimeseries() {
  const res = await requestJson("/api/admin/crm/dashboard-timeseries?period=today", {
    method: "GET",
    headers: authHeaders(),
  });
  // Агрегируем почасовой ряд (рабочие часы 10:00–21:00) в один объект с
  // суммами, чтобы старые проверки totalSales/revenue/profit не зависели от
  // количества столбиков на графике.
  if (res.response.status === 200 && Array.isArray(res.data) && res.data.length > 1) {
    const agg = res.data.reduce((acc, curr) => ({
      orders: acc.orders + curr.orders,
      revenue: acc.revenue + curr.revenue,
      profit: acc.profit + curr.profit,
    }), { orders: 0, revenue: 0, profit: 0 });
    return { ...res, data: [agg] };
  }
  return res;
}

async function withMockedNow(isoString, fn) {
  const RealDate = global.Date;

  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(isoString);
        return;
      }

      super(...args);
    }

    static now() {
      return new RealDate(isoString).getTime();
    }

    static parse(value) {
      return RealDate.parse(value);
    }

    static UTC(...args) {
      return RealDate.UTC(...args);
    }
  }

  global.Date = MockDate;

  try {
    return await fn();
  } finally {
    global.Date = RealDate;
  }
}

async function testDashboardUsesBusinessDayBoundary() {
  const productId = insertProduct({ stock: 4 });

  insertOrder({
    orderNumber: 1000,
    status: "delivered",
    stockDeducted: 1,
    createdAt: "2026-03-24 20:30:00",
    paidAt: "2026-03-24 20:59:59",
    completedAt: "2026-03-24T20:59:59.000Z",
    items: [{ productId, quantity: 1, price: 20, cost: 12 }],
  });

  insertOrder({
    orderNumber: 1001,
    status: "delivered",
    stockDeducted: 1,
    createdAt: "2026-03-24 20:59:59",
    paidAt: "2026-03-24 21:00:00",
    completedAt: "2026-03-24T21:00:00.000Z",
    items: [{ productId, quantity: 1, price: 20, cost: 12 }],
  });

  insertPosSale({
    saleNumber: 2000,
    price: 10,
    costPrice: 4,
    completedAt: "2026-03-24 20:59:59",
  });

  insertPosSale({
    saleNumber: 2001,
    price: 15,
    costPrice: 8,
    completedAt: "2026-03-24 21:00:00",
  });

  await withMockedNow("2026-03-24T21:45:00.000Z", async () => {
    const dashboardToday = await requestJson("/api/admin/crm/dashboard?period=today", {
      method: "GET",
      headers: authHeaders(),
    });

    assert.equal(dashboardToday.response.status, 200);
    assert.equal(dashboardToday.data.stats.totalSales, 2);
    assert.equal(dashboardToday.data.stats.revenue, 35);
    assert.equal(dashboardToday.data.stats.profit, 15);

    const dashboardPreviousDay = await requestJson(
      "/api/admin/crm/dashboard?period=today&offset=-1",
      {
        method: "GET",
        headers: authHeaders(),
      },
    );

    assert.equal(dashboardPreviousDay.response.status, 200);
    assert.equal(dashboardPreviousDay.data.stats.totalSales, 2);
    assert.equal(dashboardPreviousDay.data.stats.revenue, 30);
    assert.equal(dashboardPreviousDay.data.stats.profit, 14);

    const timeseries = await requestJson(
      "/api/admin/crm/dashboard-timeseries?period=month&offset=0",
      {
        method: "GET",
        headers: authHeaders(),
      },
    );

    assert.equal(timeseries.response.status, 200);
    const day24 = timeseries.data.find((point) => point.label === "24");
    const day25 = timeseries.data.find((point) => point.label === "25");
    assert.equal(day24?.revenue, 30);
    assert.equal(day24?.profit, 14);
    assert.equal(day25?.revenue, 35);
    assert.equal(day25?.profit, 15);

    const todayTimeseries = await requestJson(
      "/api/admin/crm/dashboard-timeseries?period=today",
      {
        method: "GET",
        headers: authHeaders(),
      },
    );

    assert.equal(todayTimeseries.response.status, 200);
    // График за день показывает только рабочие часы магазина (10:00–21:00)
    assert.equal(todayTimeseries.data.length, 12);
    assert.equal(todayTimeseries.data[0]?.label, "10:00");
    assert.equal(todayTimeseries.data[todayTimeseries.data.length - 1]?.label, "21:00");
    // Продажи этого сценария приходятся на полночь Минска (00:00 следующего
    // дня) — вне рабочих часов, поэтому в почасовом ряду их нет. Итоги дня
    // при этом полностью учитываются дашбордом (проверки выше) и месячным
    // графиком (day24/day25 ниже по тесту).
    const totalTodayRev = todayTimeseries.data.reduce((sum, h) => sum + h.revenue, 0);
    const totalTodayProf = todayTimeseries.data.reduce((sum, h) => sum + h.profit, 0);
    assert.equal(totalTodayRev, 0);
    assert.equal(totalTodayProf, 0);

    const deliveredToday = await requestJson(
      "/api/admin/crm/orders/delivered?period=today&limit=10",
      {
        method: "GET",
        headers: authHeaders(),
      },
    );

    assert.equal(deliveredToday.response.status, 200);
    assert.equal(deliveredToday.data.orders.length, 1);
    assert.equal(deliveredToday.data.orders[0].order_number, 1001);
  });
}

async function testPackedStatusTransitionsWithItemsPayload() {
  const productId = insertProduct({ stock: 2 });
  const orderId = insertOrder({
    orderNumber: 1002,
    status: "new",
    stockDeducted: 0,
    createdAt: "2026-03-25 07:30:00",
    items: [{ productId, quantity: 1, price: 20, cost: 12 }],
  });

  const packed = await patchOrder(orderId, {
    status: "in_progress",
    discount_amount: 0,
    discount_percent: 0,
    items: [
      {
        product_id: productId,
        quantity: 1,
        price_per_unit: 20,
      },
    ],
  });

  assert.equal(packed.response.status, 200);
  assert.equal(packed.data.status, "in_progress");
  assert.equal(packed.data.stock_deducted, 1);
  assert.equal(getProductStock(productId), 1);
  const packedCell = db.prepare(
    `SELECT id, cell_number FROM order_pickup_cell_assignments
      WHERE order_id = ? AND released_at IS NULL`,
  ).get(orderId);
  assert.ok(packedCell);

  const savedAgain = await patchOrder(orderId, {
    status: "in_progress",
    notes: "unchanged items save",
    discount_amount: 0,
    discount_percent: 0,
    items: [
      {
        product_id: productId,
        quantity: 1,
        price_per_unit: 20,
      },
    ],
  });

  assert.equal(savedAgain.response.status, 200);
  assert.equal(savedAgain.data.stock_deducted, 1);
  assert.equal(getProductStock(productId), 1);

  const movedBackToNew = await patchOrder(orderId, {
    status: "new",
    discount_amount: 0,
    discount_percent: 0,
    items: [
      {
        product_id: productId,
        quantity: 1,
        price_per_unit: 20,
      },
    ],
  });

  assert.equal(movedBackToNew.response.status, 200);
  assert.equal(movedBackToNew.data.status, "new");
  assert.equal(movedBackToNew.data.stock_deducted, 0);
  assert.equal(getProductStock(productId), 2);
  const returnedToNewCell = db.prepare(
    `SELECT id, cell_number FROM order_pickup_cell_assignments
      WHERE order_id = ? AND released_at IS NULL`,
  ).get(orderId);
  assert.equal(returnedToNewCell.cell_number, packedCell.cell_number);
  assert.notEqual(returnedToNewCell.id, packedCell.id);
  assert.equal(movedBackToNew.data.pickup_cell_number, packedCell.cell_number);
}

async function testPackedOrderItemChangeRedeductsStock() {
  const oldProductId = insertProduct({ stock: 0, title: "Old Product" });
  const newProductId = insertProduct({ stock: 3, price: 25, title: "New Product" });
  const orderId = insertOrder({
    orderNumber: 1003,
    status: "in_progress",
    stockDeducted: 1,
    createdAt: "2026-03-25 07:50:00",
    items: [{ productId: oldProductId, quantity: 1, price: 20, cost: 12 }],
  });

  const changed = await patchOrder(orderId, {
    status: "in_progress",
    discount_amount: 0,
    discount_percent: 0,
    items: [
      {
        product_id: newProductId,
        quantity: 1,
        price_per_unit: 25,
      },
    ],
  });

  assert.equal(changed.response.status, 200);
  assert.equal(changed.data.stock_deducted, 1);
  assert.equal(getProductStock(oldProductId), 1);
  assert.equal(getProductStock(newProductId), 2);
  assertOrderItems(orderId, [
    { product_id: newProductId, quantity: 1, price_per_unit: 25 },
  ]);
}

async function testDeliveredOrderKeepsAndRestoresStockWithItemsPayload() {
  const productId = insertProduct({ stock: 0 });
  const orderId = insertOrder({
    orderNumber: 1004,
    status: "delivered",
    stockDeducted: 1,
    createdAt: "2026-03-25 08:00:00",
    paidAt: "2026-03-25 08:05:00",
    completedAt: "2026-03-25T08:05:00.000Z",
    items: [{ productId, quantity: 1, price: 20, cost: 12 }],
  });

  const unchangedSave = await patchOrder(orderId, {
    status: "delivered",
    discount_amount: 0,
    discount_percent: 0,
    items: [
      {
        product_id: productId,
        quantity: 1,
        price_per_unit: 20,
      },
    ],
  });

  assert.equal(unchangedSave.response.status, 200);
  assert.equal(unchangedSave.data.status, "delivered");
  assert.equal(unchangedSave.data.stock_deducted, 1);
  assert.equal(getProductStock(productId), 0);

  const cancelled = await patchOrder(orderId, {
    status: "cancelled",
    discount_amount: 0,
    discount_percent: 0,
    items: [
      {
        product_id: productId,
        quantity: 1,
        price_per_unit: 20,
      },
    ],
  });

  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.data.status, "cancelled");
  assert.equal(cancelled.data.stock_deducted, 0);
  assert.equal(getProductStock(productId), 1);
}

async function testCancellingWithChangedItemsDoesNotRedeductNewProduct() {
  const oldProductId = insertProduct({ stock: 0, title: "Cancelled Old Product" });
  const newProductId = insertProduct({ stock: 5, title: "Cancelled New Product" });
  const orderId = insertOrder({
    orderNumber: 1005,
    status: "delivered",
    stockDeducted: 1,
    createdAt: "2026-03-25 08:10:00",
    paidAt: "2026-03-25 08:15:00",
    completedAt: "2026-03-25T08:15:00.000Z",
    items: [{ productId: oldProductId, quantity: 1, price: 20, cost: 12 }],
  });

  const cancelled = await patchOrder(orderId, {
    status: "cancelled",
    discount_amount: 0,
    discount_percent: 0,
    items: [
      {
        product_id: newProductId,
        quantity: 2,
        price_per_unit: 20,
      },
    ],
  });

  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.data.status, "cancelled");
  assert.equal(cancelled.data.stock_deducted, 0);
  assert.equal(getProductStock(oldProductId), 1);
  assert.equal(getProductStock(newProductId), 5);
  assertOrderItems(orderId, [
    { product_id: newProductId, quantity: 2, price_per_unit: 20 },
  ]);
}

async function testInsufficientReplacementStockRollsBackAtomically() {
  const oldProductId = insertProduct({ stock: 0, title: "Atomic Old Product" });
  const newProductId = insertProduct({ stock: 1, title: "Atomic New Product" });
  const orderId = insertOrder({
    orderNumber: 1006,
    status: "delivered",
    stockDeducted: 1,
    createdAt: "2026-03-25 08:20:00",
    paidAt: "2026-03-25 08:25:00",
    completedAt: "2026-03-25T08:25:00.000Z",
    items: [{ productId: oldProductId, quantity: 1, price: 20, cost: 12 }],
  });

  const failed = await patchOrder(orderId, {
    status: "delivered",
    discount_amount: 0,
    discount_percent: 0,
    items: [
      {
        product_id: newProductId,
        quantity: 2,
        price_per_unit: 20,
      },
    ],
  });

  assert.equal(failed.response.status, 400);
  assert.match(String(failed.data?.error || ""), /Insufficient stock/);

  const order = getOrder(orderId);
  assert.equal(order.status, "delivered");
  assert.equal(order.stock_deducted, 1);
  assert.equal(getProductStock(oldProductId), 0);
  assert.equal(getProductStock(newProductId), 1);
  assertOrderItems(orderId, [
    { product_id: oldProductId, quantity: 1, price_per_unit: 20 },
  ]);
}

async function testIssuedOrderPaymentRollbackAndCancellationRestoreStock() {
  // Время внутри рабочих часов магазина (18:00 Минска), чтобы выдача заказа
  // попадала в почасовый график 10:00–21:00, и вне окна замка «Обзора»
  // (10:00–16:00), чтобы дашборд отвечал без X-Dashboard-Token.
  await withMockedNow("2026-10-14T15:00:00.000Z", async () => {
  const productId = insertProduct({ stock: 1, title: "Rollback Product" });
  const orderId = insertOrder({
    orderNumber: 1007,
    status: "in_progress",
    stockDeducted: 1,
    createdAt: "2026-10-14 09:00:00",
    items: [{ productId, quantity: 1, price: 20, cost: 12 }],
  });

  const dashboardBeforeIssue = await fetchDashboardToday();
  const timeseriesBeforeIssue = await fetchDashboardTodayTimeseries();

  assert.equal(dashboardBeforeIssue.response.status, 200);
  assert.equal(timeseriesBeforeIssue.response.status, 200);
  assert.equal(timeseriesBeforeIssue.data.length, 1);

  const baselineSales = Number(dashboardBeforeIssue.data.stats.totalSales || 0);
  const baselineRevenue = Number(dashboardBeforeIssue.data.stats.revenue || 0);
  const baselineProfit = Number(dashboardBeforeIssue.data.stats.profit || 0);
  const baselineTimeseriesOrders = Number(timeseriesBeforeIssue.data[0].orders || 0);
  const baselineTimeseriesRevenue = Number(timeseriesBeforeIssue.data[0].revenue || 0);
  const baselineTimeseriesProfit = Number(timeseriesBeforeIssue.data[0].profit || 0);

  const issued = await requestJson(`/api/admin/crm/orders/${orderId}/issue`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      payment_type: "cash",
      payment_account_id: "acc_default",
      amount: 20,
    }),
  });

  assert.equal(issued.response.status, 200);
  assert.equal(issued.data.order.status, "delivered");
  assert.equal(Number(issued.data.order.paid_amount), 20);
  assert.equal(getProductStock(productId), 1);
  assert.equal(getCashAccountBalance(), 20);
  assert.equal(getCashTransactionCountForOrder(orderId), 1);

  const deliveredIssued = await requestJson(
    `/api/admin/crm/orders/delivered?period=today&limit=10&search=1007`,
    {
      method: "GET",
      headers: authHeaders(),
    },
  );

  assert.equal(deliveredIssued.response.status, 200);
  assert.equal(deliveredIssued.data.orders.length, 1);
  assert.equal(deliveredIssued.data.orders[0].order_number, 1007);
  assert.equal(Number(deliveredIssued.data.stats.totalCount || 0), 1);
  assert.equal(Number(deliveredIssued.data.stats.totalAmount || 0), 20);

  const dashboardAfterIssue = await fetchDashboardToday();
  const timeseriesAfterIssue = await fetchDashboardTodayTimeseries();

  assert.equal(dashboardAfterIssue.response.status, 200);
  assert.equal(timeseriesAfterIssue.response.status, 200);
  assert.equal(timeseriesAfterIssue.data.length, 1); // так как fetchDashboardTodayTimeseries возвращает обертку с 1 элементом в тесте
  assert.equal(
    Number(dashboardAfterIssue.data.stats.totalSales || 0),
    baselineSales + 1,
  );
  assert.equal(
    Number(dashboardAfterIssue.data.stats.revenue || 0),
    baselineRevenue + 20,
  );
  assert.equal(
    Number(dashboardAfterIssue.data.stats.profit || 0),
    baselineProfit + 8,
  );
  assert.equal(
    Number(timeseriesAfterIssue.data[0].orders || 0),
    baselineTimeseriesOrders + 1,
  );
  assert.equal(
    Number(timeseriesAfterIssue.data[0].revenue || 0),
    baselineTimeseriesRevenue + 20,
  );
  assert.equal(
    Number(timeseriesAfterIssue.data[0].profit || 0),
    baselineTimeseriesProfit + 8,
  );

  const paymentRemoved = await requestJson(
    `/api/admin/crm/orders/${orderId}/payment`,
    {
      method: "DELETE",
      headers: authHeaders(),
    },
  );

  assert.equal(paymentRemoved.response.status, 200);
  assert.equal(paymentRemoved.data.status, "in_progress");
  assert.equal(paymentRemoved.data.pickup_cell_number, null);
  assert.equal(paymentRemoved.data.paid_amount, null);
  assert.equal(paymentRemoved.data.completed_at, null);
  assert.equal(getProductStock(productId), 1);
  assert.equal(getCashAccountBalance(), 0);
  assert.equal(getCashTransactionCountForOrder(orderId), 0);

  const deliveredAfterPaymentRollback = await requestJson(
    `/api/admin/crm/orders/delivered?period=today&limit=10&search=1007`,
    {
      method: "GET",
      headers: authHeaders(),
    },
  );

  assert.equal(deliveredAfterPaymentRollback.response.status, 200);
  assert.equal(deliveredAfterPaymentRollback.data.orders.length, 0);
  assert.equal(Number(deliveredAfterPaymentRollback.data.stats.totalCount || 0), 0);
  assert.equal(Number(deliveredAfterPaymentRollback.data.stats.totalAmount || 0), 0);

  const dashboardAfterPaymentRollback = await fetchDashboardToday();
  const timeseriesAfterPaymentRollback = await fetchDashboardTodayTimeseries();

  assert.equal(dashboardAfterPaymentRollback.response.status, 200);
  assert.equal(timeseriesAfterPaymentRollback.response.status, 200);
  assert.equal(timeseriesAfterPaymentRollback.data.length, 1); // 1 aggregate item from helper
  assert.equal(
    Number(dashboardAfterPaymentRollback.data.stats.totalSales || 0),
    baselineSales,
  );
  assert.equal(
    Number(dashboardAfterPaymentRollback.data.stats.revenue || 0),
    baselineRevenue,
  );
  assert.equal(
    Number(dashboardAfterPaymentRollback.data.stats.profit || 0),
    baselineProfit,
  );
  assert.equal(
    Number(timeseriesAfterPaymentRollback.data[0].orders || 0),
    baselineTimeseriesOrders,
  );
  assert.equal(
    Number(timeseriesAfterPaymentRollback.data[0].revenue || 0),
    baselineTimeseriesRevenue,
  );
  assert.equal(
    Number(timeseriesAfterPaymentRollback.data[0].profit || 0),
    baselineTimeseriesProfit,
  );

  const cancelled = await patchOrder(orderId, {
    status: "cancelled",
  });

  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.data.status, "cancelled");
  assert.equal(cancelled.data.stock_deducted, 0);
  assert.equal(getProductStock(productId), 2);

  const deliveredAfterCancellation = await requestJson(
    `/api/admin/crm/orders/delivered?period=today&limit=10&search=1007`,
    {
      method: "GET",
      headers: authHeaders(),
    },
  );

  assert.equal(deliveredAfterCancellation.response.status, 200);
  assert.equal(deliveredAfterCancellation.data.orders.length, 0);
  assert.equal(Number(deliveredAfterCancellation.data.stats.totalCount || 0), 0);
  assert.equal(Number(deliveredAfterCancellation.data.stats.totalAmount || 0), 0);

  const dashboardAfterCancellation = await fetchDashboardToday();
  const timeseriesAfterCancellation = await fetchDashboardTodayTimeseries();

  assert.equal(dashboardAfterCancellation.response.status, 200);
  assert.equal(timeseriesAfterCancellation.response.status, 200);
  assert.equal(timeseriesAfterCancellation.data.length, 1); // 1 aggregate item from helper
  assert.equal(
    Number(dashboardAfterCancellation.data.stats.totalSales || 0),
    baselineSales,
  );
  assert.equal(
    Number(dashboardAfterCancellation.data.stats.revenue || 0),
    baselineRevenue,
  );
  assert.equal(
    Number(dashboardAfterCancellation.data.stats.profit || 0),
    baselineProfit,
  );
  assert.equal(
    Number(timeseriesAfterCancellation.data[0].orders || 0),
    baselineTimeseriesOrders,
  );
  assert.equal(
    Number(timeseriesAfterCancellation.data[0].revenue || 0),
    baselineTimeseriesRevenue,
  );
  assert.equal(
    Number(timeseriesAfterCancellation.data[0].profit || 0),
    baselineTimeseriesProfit,
  );
  });
}

async function testCatalogPriceSnapshotSurvivesEdits() {
  const { saveDiscount } = await import("../utils/catalog-discounts.js");
  const productId = insertProduct({ stock: 5 });
  db.prepare("UPDATE products SET priceRub = 20 WHERE id = ?").run(productId);
  saveDiscount("product", productId, { price: 15, untilDate: null });

  // Заказ собираем через тот же обработчик, что и менеджер: снимок должен
  // проставиться сам.
  const created = await requestJson("/api/admin/crm/orders", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      status: "new",
      delivery_type: "pickup",
      items: [{ product_id: productId, quantity: 1 }],
    }),
  });
  assert.equal(created.response.status, 200);
  const orderId = created.data.id;

  const snapshot = () =>
    db.prepare(
      "SELECT price_per_unit, base_price_per_unit, catalog_discount_per_unit FROM order_items WHERE order_id = ?",
    ).get(orderId);

  assert.equal(Number(snapshot().price_per_unit), 15);
  assert.equal(Number(snapshot().base_price_per_unit), 20);
  assert.equal(Number(snapshot().catalog_discount_per_unit), 5);

  // Акция кончилась, а менеджер просто меняет статус. Форма при этом всегда
  // шлёт цену: пересчитай мы снимок, скидка магазина превратилась бы в отчёте
  // в уценку менеджера.
  saveDiscount("product", productId, { price: null });
  const patched = await patchOrder(orderId, {
    status: "in_progress",
    discount_amount: 0,
    discount_percent: 0,
    items: [{ product_id: productId, quantity: 1, price_per_unit: 15 }],
  });
  assert.equal(patched.response.status, 200);
  assert.equal(Number(snapshot().price_per_unit), 15);
  assert.equal(Number(snapshot().base_price_per_unit), 20);
  assert.equal(Number(snapshot().catalog_discount_per_unit), 5);

  // Менеджер сбрасывает цену руками. Снимок описывает каталог, а не его
  // решение, поэтому не меняется и здесь.
  const discounted = await patchOrder(orderId, {
    status: "in_progress",
    discount_amount: 0,
    discount_percent: 0,
    items: [{ product_id: productId, quantity: 1, price_per_unit: 10 }],
  });
  assert.equal(discounted.response.status, 200);
  assert.equal(Number(snapshot().price_per_unit), 10);
  assert.equal(Number(snapshot().base_price_per_unit), 20);
  assert.equal(Number(snapshot().catalog_discount_per_unit), 5);

  console.log("crm-regressions: снимок каталожной цены переживает правки заказа");
}

async function testOrderAdditionalCost() {
  const productId = insertProduct({ stock: 20, price: 58, cost: 40 });
  const orderId = insertOrder({
    orderNumber: 99001, status: 'new', stockDeducted: 0,
    createdAt: '2026-03-24 20:00:00',
    items: [{ productId, quantity: 1, price: 58, cost: 40 }],
  });
  assert.equal(Number(getOrder(orderId).additional_cost), 0);
  const { migrateOrderAdditionalCost } = await import('../migrations/add_order_additional_cost.js');
  migrateOrderAdditionalCost();
  assert.equal(Number(getOrder(orderId).additional_cost), 0);

  const added = await patchOrder(orderId, { additional_cost: 2 });
  assert.equal(added.response.status, 200);
  let order = getOrder(orderId);
  assert.equal(Number(order.total_amount), 58);
  assert.equal(Number(order.additional_cost), 2);
  assert.equal(Number(order.final_amount), 60);
  assert.equal(Number(order.profit), 20);
  assert.equal(Number(order.cash_due_minor), 6000);
  assert.equal(getProductStock(productId), 20);
  const beforeRepeat = getOrder(orderId);
  assert.equal((await patchOrder(orderId, { additional_cost: 2 })).response.status, 200);
  assert.equal(Number(getOrder(orderId).final_amount), Number(beforeRepeat.final_amount));
  assert.equal(Number(getOrder(orderId).profit), Number(beforeRepeat.profit));

  for (const additional_cost of [-1, 1.234, null, '2', {}, 1000000000]) {
    const before = getOrder(orderId);
    const rejected = await patchOrder(orderId, { additional_cost });
    assert.equal(rejected.response.status, 400, JSON.stringify(additional_cost));
    assert.deepEqual(getOrder(orderId), before, 'Invalid input must not change the order');
  }

  assert.equal((await patchOrder(orderId, {
    items: [{ product_id: productId, quantity: 2, price_per_unit: 58 }],
  })).response.status, 200);
  order = getOrder(orderId);
  assert.equal(Number(order.additional_cost), 2);
  assert.equal(Number(order.final_amount), 118);
  assert.equal(Number(order.profit), 38);

  assert.equal((await patchOrder(orderId, { discount_amount: 10, discount_percent: 10 })).response.status, 200);
  order = getOrder(orderId);
  assert.equal(Number(order.additional_cost), 2);
  assert.equal(Number(order.final_amount), 97.4);
  assert.equal(Number(order.profit), 17.4);
  assert.equal((await patchOrder(orderId, { additional_cost: 0 })).response.status, 200);
  assert.equal(Number(getOrder(orderId).final_amount), 95.4);
  assert.equal(Number(getOrder(orderId).profit), 15.4);

  db.prepare('UPDATE orders SET paid_amount = 1 WHERE id = ?').run(orderId);
  const beforePaidChange = getOrder(orderId);
  assert.equal((await patchOrder(orderId, { additional_cost: 3 })).response.status, 409);
  assert.deepEqual(getOrder(orderId), beforePaidChange);
  db.prepare("UPDATE orders SET paid_amount = 0, status = 'delivered' WHERE id = ?").run(orderId);
  const beforeDeliveredChange = getOrder(orderId);
  assert.equal((await patchOrder(orderId, { additional_cost: 3 })).response.status, 409);
  assert.deepEqual(getOrder(orderId), beforeDeliveredChange);

  const unauthenticated = await requestJson(`/api/admin/crm/orders/${orderId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ additional_cost: 3 }),
  });
  assert.equal(unauthenticated.response.status, 401);
  assert.deepEqual(getOrder(orderId), beforeDeliveredChange);
  console.log('crm-regressions: надбавка увеличивает итог и прибыль, сохраняется и валидируется');
}

async function testOrderCardAdditionalCost() {
  const productId = insertProduct({ stock: 5, price: 58, cost: 40 });
  const orderId = insertOrder({
    orderNumber: 99002, status: 'new', stockDeducted: 0,
    createdAt: '2026-03-24 20:00:00',
    items: [{ productId, quantity: 1, price: 58, cost: 40 }],
  });
  const operationId = makeId('card');
  db.prepare("UPDATE orders SET payment_type = 'card', card_amount_minor = 4500, cash_due_minor = 1300 WHERE id = ?").run(orderId);
  db.prepare(`INSERT INTO card_payment_operations
    (id, operation_type, operation_status, order_id, amount_minor, business_date)
    VALUES (?, 'order', 'reserved', ?, 4500, '2026-03-24')`).run(operationId, orderId);
  const operation = () => db.prepare('SELECT * FROM card_payment_operations WHERE id = ?').get(operationId);

  assert.equal((await patchOrder(orderId, { additional_cost: 2 })).response.status, 200);
  assert.equal(Number(getOrder(orderId).final_amount), 60);
  assert.equal(Number(getOrder(orderId).profit), 20);
  assert.equal(Number(getOrder(orderId).card_amount_minor), 4500);
  assert.equal(Number(getOrder(orderId).cash_due_minor), 1500);
  assert.equal(Number(operation().amount_minor), 4500);
  assert.equal(operation().operation_status, 'reserved');

  assert.equal((await patchOrder(orderId, { discount_amount: 50, additional_cost: 2 })).response.status, 200);
  assert.equal(Number(getOrder(orderId).final_amount), 10);
  assert.equal(Number(getOrder(orderId).card_amount_minor), 1000);
  assert.equal(Number(getOrder(orderId).cash_due_minor), 0);
  assert.equal(Number(operation().amount_minor), 1000);

  assert.equal((await patchOrder(orderId, { discount_amount: 58, additional_cost: 0 })).response.status, 200);
  assert.equal(Number(getOrder(orderId).final_amount), 0);
  assert.equal(Number(getOrder(orderId).card_amount_minor), 0);
  assert.equal(Number(getOrder(orderId).cash_due_minor), 0);
  assert.equal(operation().operation_status, 'reversed');
  assert.equal(getProductStock(productId), 5);
  console.log('crm-regressions: надбавка не увеличивает карточный резерв, снижение суммы освобождает резерв');
}

async function testOrderAuditRouteAndConflict() {
  const productId = insertProduct({ stock: 10, price: 20, cost: 12 });
  const orderId = insertOrder({
    orderNumber: 99003, status: 'new', stockDeducted: 0,
    createdAt: '2026-10-11 07:00:00',
    items: [{ productId, quantity: 1, price: 20, cost: 12 }],
  });
  const route = `/api/admin/crm/orders/${orderId}`;
  const auditRoute = `${route}/audit`;
  const journal = async () => {
    const result = await requestJson(auditRoute, { headers: authHeaders() });
    assert.equal(result.response.status, 200);
    assert.ok(Array.isArray(result.data));
    return result.data;
  };
  const patch = (body) => requestJson(route, {
    method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body),
  });
  assert.equal((await requestJson(auditRoute)).response.status, 401);
  assert.deepEqual(await journal(), [], 'Legacy rows must not acquire fabricated events');

  const first = await patch({ notes: 'Проверенный комментарий', expected_audit_revision: 0,
    actor_name: 'Поддельный автор', actor_type: 'customer' });
  assert.equal(first.response.status, 200);
  assert.equal(first.data.audit_revision, 1);
  const events = await journal();
  assert.equal(events.length, 1);
  assert.equal(events[0].field, 'notes');
  assert.equal(events[0].before, null);
  assert.equal(events[0].after, 'Проверенный комментарий');
  assert.equal(events[0].actor_type, 'admin');
  assert.equal(events[0].actor_name, 'test-admin');
  assert.match(events[0].occurred_at, /^\d{4}-\d{2}-\d{2}T.*\.\d{3}Z$/);

  const stale = await patch({ notes: 'Устаревшая правка', expected_audit_revision: 0 });
  assert.equal(stale.response.status, 409);
  assert.equal(getOrder(orderId).notes, 'Проверенный комментарий');
  assert.deepEqual(await journal(), events);
  assert.equal((await patch({ additional_cost: -1 })).response.status, 400);
  assert.deepEqual(await journal(), events);
  assert.equal((await patch({ notes: 'Проверенный комментарий', expected_audit_revision: 1 })).response.status, 200);
  assert.deepEqual(await journal(), events, 'Unchanged retry must not add events');
  assert.equal(getOrder(orderId).audit_revision, 1);

  const beforeFailure = getOrder(orderId);
  db.exec(`CREATE TRIGGER test_order_audit_failure BEFORE INSERT ON order_audit_events
    WHEN NEW.order_id = '${orderId}' BEGIN SELECT RAISE(ABORT, 'test_audit_failure'); END`);
  try {
    const failed = await patch({ notes: 'Не должен сохраниться', expected_audit_revision: 1 });
    assert.equal(failed.response.status, 500);
    assert.deepEqual(getOrder(orderId), beforeFailure, 'Audit failure must roll back the order');
    assert.deepEqual(await journal(), events);
  } finally {
    db.exec('DROP TRIGGER test_order_audit_failure');
  }
  assert.equal((await requestJson(auditRoute, { method: 'DELETE', headers: authHeaders() })).response.status, 404);
  assert.deepEqual(await journal(), events, 'The audit API is read-only');
  console.log('crm-regressions: аудит защищён авторизацией, конфликтом версии и атомарным откатом');
}

async function testUnifiedCardPaymentLedger() {
  const cases = [
    { label: 'reserved card', total: 20, cardMinor: 2000, number: 99101 },
    { label: 'mixed payment', total: 58, cardMinor: 4500, number: 99102 },
    { label: 'forced card', total: 20, cardMinor: null, number: 99103 },
    { label: 'legacy mixed rollback', total: 58, cardMinor: 4500, number: 99104, legacyCash: 13 },
  ];

  for (const scenario of cases) {
    const baseline = getCashAccountBalance();
    const productId = insertProduct({ stock: 5, price: scenario.total, cost: 12 });
    const orderId = insertOrder({
      orderNumber: scenario.number, status: 'in_progress', stockDeducted: 1,
      createdAt: '2026-10-11 07:00:00',
      items: [{ productId, quantity: 1, price: scenario.total, cost: 12 }],
    });
    const customerId = makeId('customer');
    const telegramId = String(990000000 + scenario.number);
    db.prepare('INSERT INTO customers (id, telegram_id) VALUES (?, ?)')
      .run(customerId, telegramId);
    db.prepare('UPDATE orders SET customer_id = ? WHERE id = ?').run(customerId, orderId);

    if (scenario.cardMinor !== null) {
      db.prepare(`UPDATE orders SET payment_type = 'card', card_amount_minor = ?, cash_due_minor = ? WHERE id = ?`)
        .run(scenario.cardMinor, Math.round(scenario.total * 100) - scenario.cardMinor, orderId);
      db.prepare(`INSERT INTO card_payment_operations
        (id, operation_type, operation_status, order_id, customer_telegram_id, amount_minor, business_date)
        VALUES (?, 'order', 'reserved', ?, ?, ?, '2026-10-11')`)
        .run(makeId('card'), orderId, telegramId, scenario.cardMinor);
    }

    const operation = () => db.prepare('SELECT * FROM card_payment_operations WHERE order_id = ?').get(orderId);
    const issue = (extra = {}) => requestJson(`/api/admin/crm/orders/${orderId}/issue`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ payment_type: 'card', amount: scenario.total, ...extra }),
    });
    const removePayment = () => requestJson(`/api/admin/crm/orders/${orderId}/payment`, {
      method: 'DELETE', headers: authHeaders(),
    });

    const beforeInvalidOrder = getOrder(orderId);
    const beforeInvalidOperation = operation();
    const invalidAccount = await issue({ payment_account_id: makeId('missing_account') });
    assert.equal(invalidAccount.response.status, 404, scenario.label);
    assert.equal(invalidAccount.data.error, 'account_not_found');
    assert.deepEqual(getOrder(orderId), beforeInvalidOrder);
    assert.deepEqual(operation(), beforeInvalidOperation);
    assert.equal(getCashAccountBalance(), baseline);
    assert.equal(getCashTransactionCountForOrder(orderId), 0);

    // Omitted account remains compatible with historical card-only callers.
    const issued = await issue();
    assert.equal(issued.response.status, 200, `${scenario.label}: ${JSON.stringify(issued.data)}`);
    assert.equal(issued.data.order.status, 'delivered');
    assert.equal(issued.data.order.payment_account_id, 'acc_default');
    assert.equal(Number(issued.data.order.paid_amount), scenario.total);
    assert.equal(getCashAccountBalance(), baseline + scenario.total);
    assert.equal(getCashTransactionCountForOrder(orderId), 1);
    const transaction = db.prepare('SELECT * FROM cash_transactions WHERE order_id = ?').get(orderId);
    assert.equal(transaction.type, 'income');
    assert.equal(transaction.account_id, 'acc_default');
    assert.equal(Number(transaction.amount), scenario.total);
    assert.equal(operation().operation_status, 'spent');
    assert.equal(Number(operation().amount_minor), scenario.cardMinor ?? Math.round(scenario.total * 100));

    const beforeRetryOrder = getOrder(orderId);
    const beforeRetryOperation = operation();
    const duplicate = await issue();
    assert.ok([400, 409].includes(duplicate.response.status), scenario.label);
    assert.deepEqual(getOrder(orderId), beforeRetryOrder);
    assert.deepEqual(operation(), beforeRetryOperation);
    assert.equal(getCashAccountBalance(), baseline + scenario.total);
    assert.equal(getCashTransactionCountForOrder(orderId), 1);

    if (scenario.legacyCash !== undefined) {
      // Simulate a historical cash-only posting in this isolated test database.
      // Cancellation must reverse that row, not recalculate the full payment.
      db.transaction(() => {
        db.prepare('UPDATE cash_transactions SET amount = ? WHERE id = ?')
          .run(scenario.legacyCash, transaction.id);
        db.prepare('UPDATE cash_accounts SET balance = balance - ? WHERE id = ?')
          .run(scenario.total - scenario.legacyCash, 'acc_default');
      })();
      assert.equal(getCashAccountBalance(), baseline + scenario.legacyCash);
    }

    const removed = await removePayment();
    assert.equal(removed.response.status, 200, scenario.label);
    assert.equal(getCashAccountBalance(), baseline);
    assert.equal(getCashTransactionCountForOrder(orderId), 0);
    assert.equal(operation().operation_status, 'reversed');
    assert.equal(getOrder(orderId).paid_amount, null);
    assert.equal(getOrder(orderId).status, 'in_progress');

    const beforeRepeatedRemoval = getOrder(orderId);
    const reversedOperation = operation();
    const repeatedRemoval = await removePayment();
    assert.equal(repeatedRemoval.response.status, 400);
    assert.equal(repeatedRemoval.data.error, 'payment_not_found');
    assert.deepEqual(getOrder(orderId), beforeRepeatedRemoval);
    assert.deepEqual(operation(), reversedOperation);
    assert.equal(getCashAccountBalance(), baseline);
    assert.equal(getCashTransactionCountForOrder(orderId), 0);
  }
  console.log('crm-regressions: общая касса учитывает полную оплату, повторные запросы и legacy-отмена не задваивают движения');
}

async function main() {
  await testUnifiedCardPaymentLedger();
  await testOrderAuditRouteAndConflict();
  await testOrderCardAdditionalCost();
  await testOrderAdditionalCost();
  await testDashboardUsesBusinessDayBoundary();
  await testPackedStatusTransitionsWithItemsPayload();
  await testPackedOrderItemChangeRedeductsStock();
  await testDeliveredOrderKeepsAndRestoresStockWithItemsPayload();
  await testCancellingWithChangedItemsDoesNotRedeductNewProduct();
  await testInsufficientReplacementStockRollsBackAtomically();
  await testIssuedOrderPaymentRollbackAndCancellationRestoreStock();
  await testCatalogPriceSnapshotSurvivesEdits();
  console.log("[crm-regressions] OK");
}

try {
  await main();
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
