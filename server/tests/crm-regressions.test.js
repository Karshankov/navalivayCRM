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
  return requestJson("/api/admin/crm/dashboard-timeseries?period=today", {
    method: "GET",
    headers: authHeaders(),
  });
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
    assert.equal(todayTimeseries.data.length, 1);
    assert.equal(todayTimeseries.data[0]?.label, "25");
    assert.equal(todayTimeseries.data[0]?.revenue, 35);
    assert.equal(todayTimeseries.data[0]?.profit, 15);

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
  const productId = insertProduct({ stock: 1, title: "Rollback Product" });
  const orderId = insertOrder({
    orderNumber: 1007,
    status: "in_progress",
    stockDeducted: 1,
    createdAt: "2026-03-25 09:00:00",
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
  assert.equal(timeseriesAfterIssue.data.length, 1);
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
  assert.equal(timeseriesAfterPaymentRollback.data.length, 1);
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
  assert.equal(timeseriesAfterCancellation.data.length, 1);
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

async function main() {
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
