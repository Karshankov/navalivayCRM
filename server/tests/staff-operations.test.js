import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "navalivay-staff-operations-"),
);
process.env.DATABASE_FILE = path.join(tempDir, "test.db");
process.env.BOT_TOKEN = "";
process.env.STAFF_PIN_BCRYPT_ROUNDS = "4";
process.env.SESSION_SECRET =
  "staff-operations-tests-secret-at-least-32-characters";

const { db, initDb } = await import("../db.js");
const { migrateStaffManagement } = await import(
  "../migrations/add_staff_management.js"
);
const { migrateInternalNotifications } = await import(
  "../migrations/add_internal_notifications.js"
);

initDb();
migrateStaffManagement(db);
migrateInternalNotifications(db);

const {
  createStaffPinCredentials,
  setStaffTrackingEnabled,
} = await import(
  "../utils/staff-service.js"
);
const { issueToken } = await import("../auth.js");
const { adminRouter } = await import("../routes/admin.js");
const { crmOperationsRouter } = await import("../routes/crm-operations.js");

async function addEmployee({ id, pin, firstName, role = "employee" } = {}) {
  const credentials = await createStaffPinCredentials(pin);
  db.prepare(
    `
    INSERT INTO employees (
      id, username, password_hash, first_name, last_name, position, active,
      role, pin_hash, pin_fingerprint, pin_updated_at
    )
    VALUES (?, ?, ?, ?, 'Тестович', 'Сотрудник', 1, ?, ?, ?, DATETIME('now'))
  `,
  ).run(
    id,
    `user_${id}`,
    credentials.hash,
    firstName,
    role,
    credentials.hash,
    credentials.fingerprint,
  );
}

function closeActiveShift() {
  db.prepare(
    `
    UPDATE staff_shifts
    SET status = 'closed',
        ended_at = COALESCE(ended_at, DATETIME('now')),
        updated_at = DATETIME('now')
    WHERE status = 'active'
  `,
  ).run();
}

function openTestShift(employeeId, suffix = Date.now()) {
  closeActiveShift();
  const employee = db
    .prepare(
      `
    SELECT first_name, last_name
    FROM employees
    WHERE id = ?
  `,
    )
    .get(employeeId);
  const shiftId = `shift_test_${employeeId}_${suffix}`;
  db.prepare(
    `
    INSERT INTO staff_shifts (
      id, employee_id, employee_name_snapshot, business_date,
      planned_start_at, planned_end_at, started_at, status,
      created_by_employee_id, created_at, updated_at
    )
    VALUES (
      ?, ?, ?, '2026-07-23',
      '2026-07-23T07:00:00.000Z', '2099-01-01T00:00:00.000Z',
      '2026-07-23T07:00:00.000Z', 'active', ?,
      '2026-07-23T07:00:00.000Z', '2026-07-23T07:00:00.000Z'
    )
  `,
  ).run(
    shiftId,
    employeeId,
    `${employee.first_name} ${employee.last_name}`.trim(),
    employeeId,
  );
  return shiftId;
}

function productStock() {
  return db
    .prepare(
      `
    SELECT stock, warehouse_stock
    FROM products
    WHERE id = 'staff_product'
  `,
    )
    .get();
}

function eventCount(entityType, entityId, eventType = null) {
  const suffix = eventType ? " AND event_type = ?" : "";
  const args = eventType
    ? [entityType, entityId, eventType]
    : [entityType, entityId];
  return db
    .prepare(
      `
    SELECT COUNT(*) AS count
    FROM staff_events
    WHERE entity_type = ? AND entity_id = ?${suffix}
  `,
    )
    .get(...args).count;
}

function outboxCount(eventType = null) {
  if (!eventType) {
    return db
      .prepare(
        `
      SELECT COUNT(*) AS count FROM internal_notification_outbox
    `,
      )
      .get().count;
  }
  return db
    .prepare(
      `
    SELECT COUNT(*) AS count
    FROM internal_notification_outbox
    WHERE event_type = ?
  `,
    )
    .get(eventType).count;
}

await addEmployee({
  id: "employee_a",
  pin: "1111",
  firstName: "Анна",
  role: "manager",
});
await addEmployee({
  id: "employee_b",
  pin: "2222",
  firstName: "Борис",
});

db.exec(`
  INSERT INTO categories (id, slug, name, [order])
  VALUES ('staff_category', 'staff-category', 'Тестовая категория', 900);

  INSERT INTO category_groups (id, categoryId, slug, name, [order])
  VALUES (
    'staff_group', 'staff_category', 'staff-group',
    'Тестовая линейка', 900
  );

  INSERT INTO products (
    id, categoryId, groupId, title, priceRub, cost_price, stock,
    warehouse_stock, has_variants, createdAt
  )
  VALUES (
    'staff_product', 'staff_category', 'staff_group', 'Тестовый товар',
    20, 5, 100, 50, 0, DATETIME('now')
  );

  INSERT INTO products (
    id, categoryId, groupId, title, priceRub, cost_price, stock,
    warehouse_stock, has_variants, createdAt
  )
  VALUES (
    'staff_variant_product', 'staff_category', 'staff_group',
    'Вариативный товар', 30, 7, 0, 0, 1, DATETIME('now')
  );

  INSERT INTO products (
    id, categoryId, groupId, title, priceRub, cost_price, stock,
    warehouse_stock, has_variants, createdAt
  )
  VALUES (
    'staff_other_variant_product', 'staff_category', 'staff_group',
    'Другой вариативный товар', 35, 9, 0, 0, 1, DATETIME('now')
  );

  INSERT INTO product_variants (
    id, product_id, name, price_rub, stock, warehouse_stock, position, created_at
  )
  VALUES (
    'staff_variant_order', 'staff_variant_product', 'Для заказа',
    30, 8, 2, 0, DATETIME('now')
  );

  INSERT INTO product_variants (
    id, product_id, name, price_rub, stock, warehouse_stock, position, created_at
  )
  VALUES (
    'staff_other_variant', 'staff_other_variant_product', 'Чужой вариант',
    35, 6, 1, 0, DATETIME('now')
  );

  UPDATE internal_notification_settings
  SET enabled = 1
  WHERE event_group = 'documents';

  INSERT INTO internal_notification_recipients (
    event_group, telegram_id, telegram_username, display_name, confirmed_at
  )
  VALUES (
    'documents', '123456789', 'manager_test', 'Руководитель', DATETIME('now')
  );
`);

const app = express();
app.use(express.json());
app.use(adminRouter);
app.use(crmOperationsRouter);
const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const token = issueToken("staff-operations-test");

async function requestJson(url, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    response,
    data: await response.json(),
  };
}

function orderBody(quantity = 1) {
  return {
    delivery_type: "pickup",
    items: [
      {
        product_id: "staff_product",
        quantity,
        price_per_unit: 20,
      },
    ],
  };
}

function procurementBody({
  actorEmployeeId = "employee_a",
  actorPin = "1111",
  quantity = 2,
  notes = null,
} = {}) {
  return {
    supplier_name: "Тестовый поставщик",
    notes,
    actor_employee_id: actorEmployeeId,
    actor_pin: actorPin,
    items: [
      {
        product_id: "staff_product",
        quantity,
        warehouse_quantity: 1,
        cost_per_unit: 6,
      },
    ],
  };
}

function transferBody({
  actorEmployeeId = "employee_a",
  actorPin = "1111",
  quantity = 2,
  comment = null,
} = {}) {
  return {
    source_location: "retail",
    destination_location: "warehouse",
    comment,
    actor_employee_id: actorEmployeeId,
    actor_pin: actorPin,
    items: [{ product_id: "staff_product", quantity }],
  };
}

try {
  console.log("staff operations: disabled flag keeps legacy behavior");
  setStaffTrackingEnabled(false);
  closeActiveShift();
  const legacyOrder = await requestJson("/api/admin/crm/orders", {
    method: "POST",
    body: orderBody(),
  });
  assert.equal(legacyOrder.response.status, 200);
  assert.equal(legacyOrder.data.employee_id, null);

  const legacyProcurement = await requestJson("/api/admin/crm/procurements", {
    method: "POST",
    body: {
      supplier_name: "Старый режим",
      items: [
        {
          product_id: "staff_product",
          quantity: 1,
          warehouse_quantity: 0,
          cost_per_unit: 5,
        },
      ],
    },
  });
  assert.equal(legacyProcurement.response.status, 200);
  assert.equal(eventCount("procurement", legacyProcurement.data.id), 0);

  console.log("staff operations: every order mutation requires a shift");
  setStaffTrackingEnabled(true);
  const ordersBeforeGate = db
    .prepare(
      `
    SELECT COUNT(*) AS count FROM orders
  `,
    )
    .get().count;
  const blockedOrder = await requestJson("/api/admin/crm/orders", {
    method: "POST",
    body: orderBody(),
  });
  assert.equal(blockedOrder.response.status, 409);
  assert.equal(blockedOrder.data.error, "shift_required");
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM orders").get().count,
    ordersBeforeGate,
  );
  const blockedOrderEdit = await requestJson(
    `/api/admin/crm/orders/${legacyOrder.data.id}`,
    {
      method: "PATCH",
      body: { notes: "Не должно сохраниться" },
    },
  );
  assert.equal(blockedOrderEdit.response.status, 409);
  assert.equal(blockedOrderEdit.data.error, "shift_required");
  assert.equal(
    db.prepare("SELECT notes FROM orders WHERE id = ?").get(legacyOrder.data.id)
      .notes,
    null,
  );
  for (const maintenancePath of [
    "/api/admin/crm/archive-delivered-orders",
    "/api/admin/crm/fix-delivered-completed-at",
  ]) {
    const blockedMaintenance = await requestJson(maintenancePath, {
      method: "POST",
    });
    assert.equal(blockedMaintenance.response.status, 409);
    assert.equal(blockedMaintenance.data.error, "shift_required");
  }

  console.log("staff operations: order create, assemble and issue attribution");
  openTestShift("employee_a", "orders");
  const orderWithoutIdempotency = await requestJson("/api/admin/crm/orders", {
    method: "POST",
    body: orderBody(),
  });
  assert.equal(orderWithoutIdempotency.response.status, 400);
  assert.equal(orderWithoutIdempotency.data.error, "idempotency_key_required");
  const createdOrder = await requestJson("/api/admin/crm/orders", {
    method: "POST",
    headers: { "Idempotency-Key": "staff-order-create-1" },
    body: {
      ...orderBody(2),
      employee_id: "employee_b",
    },
  });
  assert.equal(createdOrder.response.status, 200);
  assert.equal(createdOrder.data.employee_id, "employee_a");
  const orderId = createdOrder.data.id;

  const replayedOrder = await requestJson("/api/admin/crm/orders", {
    method: "POST",
    headers: { "Idempotency-Key": "staff-order-create-1" },
    body: {
      ...orderBody(2),
      employee_id: "employee_b",
    },
  });
  assert.equal(replayedOrder.response.status, 200);
  assert.equal(replayedOrder.data.id, orderId);
  assert.equal(
    db
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM orders
      WHERE id = ?
    `,
      )
      .get(orderId).count,
    1,
  );

  const conflictingOrderReplay = await requestJson("/api/admin/crm/orders", {
    method: "POST",
    headers: { "Idempotency-Key": "staff-order-create-1" },
    body: orderBody(3),
  });
  assert.equal(conflictingOrderReplay.response.status, 409);
  assert.equal(conflictingOrderReplay.data.error, "idempotency_key_conflict");

  const orderWithoutRequiredVariant = await requestJson(
    "/api/admin/crm/orders",
    {
      method: "POST",
      headers: {
        "Idempotency-Key": "staff-order-variant-required-1",
      },
      body: {
        delivery_type: "pickup",
        items: [
          {
            product_id: "staff_variant_product",
            quantity: 1,
            price_per_unit: 30,
          },
        ],
      },
    },
  );
  assert.equal(orderWithoutRequiredVariant.response.status, 400);
  assert.equal(orderWithoutRequiredVariant.data.error, "variant_required");
  const orderWithForeignVariant = await requestJson(
    "/api/admin/crm/orders",
    {
      method: "POST",
      headers: {
        "Idempotency-Key": "staff-order-foreign-variant-1",
      },
      body: {
        delivery_type: "pickup",
        items: [
          {
            product_id: "staff_variant_product",
            variant_id: "staff_other_variant",
            quantity: 1,
            price_per_unit: 30,
          },
        ],
      },
    },
  );
  assert.equal(orderWithForeignVariant.response.status, 400);
  assert.equal(
    orderWithForeignVariant.data.error,
    "variant_product_mismatch",
  );
  const orderWithFractionalQuantity = await requestJson(
    "/api/admin/crm/orders",
    {
      method: "POST",
      headers: {
        "Idempotency-Key": "staff-order-fractional-quantity-1",
      },
      body: orderBody(1.5),
    },
  );
  assert.equal(orderWithFractionalQuantity.response.status, 400);
  assert.equal(
    orderWithFractionalQuantity.data.error,
    "invalid_item_quantity",
  );

  console.log("staff operations: deleted variant cannot corrupt order stock");
  const variantOrder = await requestJson("/api/admin/crm/orders", {
    method: "POST",
    headers: { "Idempotency-Key": "staff-order-deleted-variant-1" },
    body: {
      delivery_type: "pickup",
      items: [
        {
          product_id: "staff_variant_product",
          variant_id: "staff_variant_order",
          quantity: 2,
          price_per_unit: 30,
        },
      ],
    },
  });
  assert.equal(variantOrder.response.status, 200);
  db.prepare("DELETE FROM product_variants WHERE id = ?")
    .run("staff_variant_order");
  const parentBeforeBrokenAssembly = db.prepare(`
    SELECT stock, warehouse_stock
    FROM products
    WHERE id = 'staff_variant_product'
  `).get();
  const brokenVariantAssembly = await requestJson(
    `/api/admin/crm/orders/${variantOrder.data.id}`,
    {
      method: "PATCH",
      body: { status: "in_progress" },
    },
  );
  assert.equal(brokenVariantAssembly.response.status, 409);
  assert.equal(
    brokenVariantAssembly.data.error,
    "inventory_target_missing",
  );
  assert.deepEqual(
    db.prepare(`
      SELECT status, stock_deducted
      FROM orders
      WHERE id = ?
    `).get(variantOrder.data.id),
    { status: "new", stock_deducted: 0 },
  );
  assert.deepEqual(
    db.prepare(`
      SELECT stock, warehouse_stock
      FROM products
      WHERE id = 'staff_variant_product'
    `).get(),
    parentBeforeBrokenAssembly,
  );

  const beforeAssembly = productStock();
  const assembledOrder = await requestJson(`/api/admin/crm/orders/${orderId}`, {
    method: "PATCH",
    body: { status: "in_progress" },
  });
  assert.equal(assembledOrder.response.status, 200);
  const assembledRow = db
    .prepare(
      `
    SELECT assembled_by_employee_id, assembled_at
    FROM orders
    WHERE id = ?
  `,
    )
    .get(orderId);
  assert.equal(assembledRow.assembled_by_employee_id, "employee_a");
  assert.ok(assembledRow.assembled_at);
  assert.equal(productStock().stock, beforeAssembly.stock - 2);

  const bypassIssue = await requestJson(`/api/admin/crm/orders/${orderId}`, {
    method: "PATCH",
    body: { status: "delivered" },
  });
  assert.equal(bypassIssue.response.status, 409);
  assert.equal(bypassIssue.data.error, "issue_endpoint_required");
  const bypassIssueAsCompleted = await requestJson(
    `/api/admin/crm/orders/${orderId}`,
    {
      method: "PATCH",
      body: { status: "completed" },
    },
  );
  assert.equal(bypassIssueAsCompleted.response.status, 409);
  assert.equal(
    bypassIssueAsCompleted.data.error,
    "issue_endpoint_required",
  );
  assert.deepEqual(
    db
      .prepare(
        `
      SELECT status, issued_by_employee_id
      FROM orders
      WHERE id = ?
    `,
      )
      .get(orderId),
    { status: "in_progress", issued_by_employee_id: null },
  );

  openTestShift("employee_b", "issue");
  const issueRequests = await Promise.all([
    requestJson(`/api/admin/crm/orders/${orderId}/issue`, {
      method: "POST",
      body: {
        payment_type: "cash",
        payment_account_id: "acc_default",
        amount: 40,
      },
    }),
    requestJson(`/api/admin/crm/orders/${orderId}/issue`, {
      method: "POST",
      body: {
        payment_type: "cash",
        payment_account_id: "acc_default",
        amount: 40,
      },
    }),
  ]);
  assert.equal(
    issueRequests.filter((item) => item.response.status === 200).length,
    1,
  );
  assert.equal(
    issueRequests.filter((item) => [400, 409].includes(item.response.status))
      .length,
    1,
  );
  const issuedOrder = issueRequests.find(
    (item) => item.response.status === 200,
  );
  assert.equal(issuedOrder.response.status, 200);
  assert.equal(issuedOrder.data.order.issued_by_employee_id, "employee_b");
  assert.ok(issuedOrder.data.order.issued_at);
  assert.equal(issuedOrder.data.transaction.employee_id, "employee_b");
  assert.equal(
    db
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM cash_transactions
      WHERE order_id = ?
    `,
      )
      .get(orderId).count,
    1,
  );

  const editIssuedOrder = await requestJson(
    `/api/admin/crm/orders/${orderId}`,
    {
      method: "PATCH",
      body: {
        status: "delivered",
        notes: "Комментарий после выдачи",
      },
    },
  );
  assert.equal(editIssuedOrder.response.status, 200);
  assert.equal(editIssuedOrder.data.status, "delivered");
  assert.equal(editIssuedOrder.data.notes, "Комментарий после выдачи");
  assert.equal(
    db
      .prepare(
        `
      SELECT COUNT(*) AS count
      FROM cash_transactions
      WHERE order_id = ?
    `,
      )
      .get(orderId).count,
    1,
  );

  closeActiveShift();
  const blockedPaymentRollback = await requestJson(
    `/api/admin/crm/orders/${orderId}/payment`,
    { method: "DELETE" },
  );
  assert.equal(blockedPaymentRollback.response.status, 409);
  assert.equal(blockedPaymentRollback.data.error, "shift_required");
  assert.equal(
    db.prepare("SELECT status FROM orders WHERE id = ?").get(orderId).status,
    "delivered",
  );

  console.log("staff operations: procurement creator and acceptor");
  const procurementWithoutIdempotency = await requestJson(
    "/api/admin/crm/procurements",
    {
      method: "POST",
      body: procurementBody(),
    },
  );
  assert.equal(procurementWithoutIdempotency.response.status, 400);
  assert.equal(
    procurementWithoutIdempotency.data.error,
    "idempotency_key_required",
  );
  const procurementPinOnlyBody = procurementBody();
  delete procurementPinOnlyBody.actor_employee_id;
  const procurementWithoutSelectedEmployee = await requestJson(
    "/api/admin/crm/procurements",
    {
      method: "POST",
      headers: { "Idempotency-Key": "staff-procurement-pin-only" },
      body: procurementPinOnlyBody,
    },
  );
  assert.equal(procurementWithoutSelectedEmployee.response.status, 400);
  assert.equal(
    procurementWithoutSelectedEmployee.data.error,
    "staff_employee_required",
  );
  const procurementCreate = await requestJson("/api/admin/crm/procurements", {
    method: "POST",
    headers: { "Idempotency-Key": "staff-procurement-create-1" },
    body: procurementBody(),
  });
  assert.equal(procurementCreate.response.status, 200);
  const procurementId = procurementCreate.data.id;
  assert.equal(procurementCreate.data.created_by_employee_id, "employee_a");
  assert.equal(
    eventCount("procurement", procurementId, "procurement_created"),
    1,
  );
  assert.equal(outboxCount("procurement.created"), 1);

  // Счётчик в карточке считается по документам, а не по журналу: журнал
  // неизменяемый и про удаление закупки ничего не знает.
  const countProcurements = (employeeId) => db.prepare(`
    SELECT COUNT(*) AS count FROM procurements WHERE created_by_employee_id = ?
  `).get(employeeId).count;
  assert.equal(countProcurements("employee_a"), 1);
  assert.equal(
    eventCount("procurement", procurementId, "procurement_created"),
    1,
    "событие создания остаётся в журнале навсегда",
  );

  const procurementDraftEdit = await requestJson(
    `/api/admin/crm/procurements/${procurementId}`,
    {
      method: "PATCH",
      body: { notes: "Черновик уточнён без повторного ПИН" },
    },
  );
  assert.equal(procurementDraftEdit.response.status, 200);
  assert.equal(
    procurementDraftEdit.data.notes,
    "Черновик уточнён без повторного ПИН",
  );

  const procurementReplay = await requestJson("/api/admin/crm/procurements", {
    method: "POST",
    headers: { "Idempotency-Key": "staff-procurement-create-1" },
    body: procurementBody(),
  });
  assert.equal(procurementReplay.response.status, 200);
  assert.equal(procurementReplay.data.id, procurementId);
  assert.equal(eventCount("procurement", procurementId), 1);
  assert.equal(outboxCount("procurement.created"), 1);

  const wrongPin = await requestJson("/api/admin/crm/procurements", {
    method: "POST",
    body: procurementBody({ actorPin: "9999" }),
  });
  assert.equal(wrongPin.response.status, 401);
  assert.equal(wrongPin.data.error, "invalid_staff_credentials");

  db.prepare(
    `
    UPDATE employees
    SET active = 0, deactivated_at = DATETIME('now')
    WHERE id = 'employee_b'
  `,
  ).run();
  const deactivatedActor = await requestJson("/api/admin/crm/procurements", {
    method: "POST",
    body: procurementBody({
      actorEmployeeId: "employee_b",
      actorPin: "2222",
    }),
  });
  assert.equal(deactivatedActor.response.status, 401);
  assert.equal(deactivatedActor.data.error, "invalid_staff_credentials");
  db.prepare(
    `
    UPDATE employees
    SET active = 1, deactivated_at = NULL
    WHERE id = 'employee_b'
  `,
  ).run();

  const stockBeforeProcurement = productStock();
  const procurementCompleteWithoutSelectedEmployee = await requestJson(
    `/api/admin/crm/procurements/${procurementId}/complete`,
    {
      method: "POST",
      body: { actor_pin: "2222" },
    },
  );
  assert.equal(
    procurementCompleteWithoutSelectedEmployee.response.status,
    400,
  );
  assert.equal(
    procurementCompleteWithoutSelectedEmployee.data.error,
    "staff_employee_required",
  );
  assert.deepEqual(productStock(), stockBeforeProcurement);
  const completeRequests = await Promise.all([
    requestJson(`/api/admin/crm/procurements/${procurementId}/complete`, {
      method: "POST",
      body: {
        actor_employee_id: "employee_b",
        actor_pin: "2222",
      },
    }),
    requestJson(`/api/admin/crm/procurements/${procurementId}/complete`, {
      method: "POST",
      body: {
        actor_employee_id: "employee_b",
        actor_pin: "2222",
      },
    }),
  ]);
  assert.deepEqual(
    completeRequests.map((item) => item.response.status).sort(),
    [200, 400],
  );
  const completedProcurement = db
    .prepare(
      `
    SELECT created_by_employee_id, accepted_by_employee_id
    FROM procurements
    WHERE id = ?
  `,
    )
    .get(procurementId);
  assert.deepEqual(completedProcurement, {
    created_by_employee_id: "employee_a",
    accepted_by_employee_id: "employee_b",
  });
  assert.equal(productStock().stock, stockBeforeProcurement.stock + 1);
  assert.equal(
    productStock().warehouse_stock,
    stockBeforeProcurement.warehouse_stock + 1,
  );
  assert.equal(eventCount("procurement", procurementId), 2);
  assert.equal(outboxCount("procurement.accepted"), 1);
  const editCompletedProcurement = await requestJson(
    `/api/admin/crm/procurements/${procurementId}`,
    {
      method: "PATCH",
      body: { notes: "Нельзя менять после оприходования" },
    },
  );
  assert.equal(editCompletedProcurement.response.status, 400);
  assert.equal(editCompletedProcurement.data.error, "edit_not_allowed");

  const deleteCompletedProcurement = await Promise.all([
    requestJson(
      `/api/admin/crm/procurements/${procurementId}`,
      { method: "DELETE" },
    ),
    requestJson(
      `/api/admin/crm/procurements/${procurementId}`,
      { method: "DELETE" },
    ),
  ]);
  assert.deepEqual(
    deleteCompletedProcurement
      .map((result) => result.response.status)
      .sort((left, right) => left - right),
    [200, 404],
  );
  assert.equal(
    db.prepare("SELECT 1 FROM procurements WHERE id = ?").get(procurementId),
    undefined,
  );
  assert.deepEqual(productStock(), stockBeforeProcurement);
  // Журнал помнит и создание, и оприходование: он неизменяемый.
  assert.equal(eventCount("procurement", procurementId), 2);
  // А счётчик в карточке считается по документам, поэтому удалённая закупка
  // из него уходит и работа не приписывается сотруднику задним числом.
  assert.equal(countProcurements("employee_a"), 0);

  console.log(
    "staff operations: deleted variant cannot corrupt procurement stock",
  );
  db.prepare(`
    INSERT INTO product_variants (
      id, product_id, name, price_rub, stock, warehouse_stock, position, created_at
    ) VALUES (
      'staff_variant_procurement', 'staff_variant_product', 'Для закупки',
      30, 4, 1, 0, DATETIME('now')
    )
  `).run();
  const variantProcurement = await requestJson(
    "/api/admin/crm/procurements",
    {
      method: "POST",
      headers: {
        "Idempotency-Key": "staff-procurement-deleted-variant-1",
      },
      body: {
        supplier_name: "Поставщик варианта",
        actor_employee_id: "employee_a",
        actor_pin: "1111",
        items: [
          {
            product_id: "staff_variant_product",
            variant_id: "staff_variant_procurement",
            quantity: 3,
            warehouse_quantity: 1,
            cost_per_unit: 8,
          },
        ],
      },
    },
  );
  assert.equal(variantProcurement.response.status, 200);
  const variantProcurementId = variantProcurement.data.id;
  db.prepare("DELETE FROM product_variants WHERE id = ?")
    .run("staff_variant_procurement");
  const variantParentBeforeComplete = db.prepare(`
    SELECT stock, warehouse_stock, cost_price
    FROM products
    WHERE id = 'staff_variant_product'
  `).get();
  const acceptedEventsBeforeBrokenVariant = outboxCount(
    "procurement.accepted",
  );
  const brokenVariantComplete = await requestJson(
    `/api/admin/crm/procurements/${variantProcurementId}/complete`,
    {
      method: "POST",
      body: {
        actor_employee_id: "employee_b",
        actor_pin: "2222",
      },
    },
  );
  assert.equal(brokenVariantComplete.response.status, 409);
  assert.equal(brokenVariantComplete.data.error, "variant_required");
  assert.deepEqual(
    db.prepare(`
      SELECT status, accepted_by_employee_id, expense_transaction_id
      FROM procurements
      WHERE id = ?
    `).get(variantProcurementId),
    {
      status: "draft",
      accepted_by_employee_id: null,
      expense_transaction_id: null,
    },
  );
  assert.deepEqual(
    db.prepare(`
      SELECT stock, warehouse_stock, cost_price
      FROM products
      WHERE id = 'staff_variant_product'
    `).get(),
    variantParentBeforeComplete,
  );
  assert.equal(
    eventCount("procurement", variantProcurementId),
    1,
  );
  assert.equal(
    outboxCount("procurement.accepted"),
    acceptedEventsBeforeBrokenVariant,
  );

  console.log(
    "staff operations: one actor receives two separate document events",
  );
  const sameActorProcurement = await requestJson(
    "/api/admin/crm/procurements",
    {
      method: "POST",
      headers: { "Idempotency-Key": "staff-procurement-same-actor-1" },
      body: procurementBody({ notes: "Один сотрудник" }),
    },
  );
  assert.equal(sameActorProcurement.response.status, 200);
  const sameActorComplete = await requestJson(
    `/api/admin/crm/procurements/${sameActorProcurement.data.id}/complete`,
    {
      method: "POST",
      body: {
        actor_employee_id: "employee_a",
        actor_pin: "1111",
      },
    },
  );
  assert.equal(sameActorComplete.response.status, 200);
  assert.deepEqual(
    db
      .prepare(
        `
      SELECT employee_id, COUNT(*) AS count
      FROM staff_events
      WHERE entity_type = 'procurement' AND entity_id = ?
      GROUP BY employee_id
    `,
      )
      .get(sameActorProcurement.data.id),
    { employee_id: "employee_a", count: 2 },
  );

  console.log(
    "staff operations: failed procurement completion changes nothing",
  );
  const failingProcurementComplete = await requestJson(
    "/api/admin/crm/procurements",
    {
      method: "POST",
      headers: {
        "Idempotency-Key": "staff-procurement-complete-failure-1",
      },
      body: procurementBody({ notes: "Проверка отката принятия" }),
    },
  );
  assert.equal(failingProcurementComplete.response.status, 200);
  const failingProcurementCompleteId = failingProcurementComplete.data.id;
  const stockBeforeFailedProcurement = productStock();
  const eventBeforeFailedProcurement = eventCount(
    "procurement",
    failingProcurementCompleteId,
  );
  const outboxBeforeFailedProcurement = outboxCount();
  const cashBeforeFailedProcurement = db
    .prepare(
      `
      SELECT balance,
             (SELECT COUNT(*) FROM cash_transactions) AS transaction_count
      FROM cash_accounts
      WHERE id = 'acc_default'
    `,
    )
    .get();
  db.exec(`
    CREATE TRIGGER fail_procurement_accepted_outbox
    BEFORE INSERT ON internal_notification_outbox
    WHEN NEW.event_type = 'procurement.accepted'
    BEGIN
      SELECT RAISE(ABORT, 'test_outbox_failure');
    END;
  `);
  const failedProcurementComplete = await requestJson(
    `/api/admin/crm/procurements/${failingProcurementCompleteId}/complete`,
    {
      method: "POST",
      body: {
        actor_employee_id: "employee_b",
        actor_pin: "2222",
      },
    },
  );
  assert.equal(failedProcurementComplete.response.status, 500);
  assert.deepEqual(productStock(), stockBeforeFailedProcurement);
  assert.deepEqual(
    db
      .prepare(
        `
      SELECT status, accepted_by_employee_id, expense_transaction_id
      FROM procurements
      WHERE id = ?
    `,
      )
      .get(failingProcurementCompleteId),
    {
      status: "draft",
      accepted_by_employee_id: null,
      expense_transaction_id: null,
    },
  );
  assert.equal(
    eventCount("procurement", failingProcurementCompleteId),
    eventBeforeFailedProcurement,
  );
  assert.equal(outboxCount(), outboxBeforeFailedProcurement);
  assert.deepEqual(
    db
      .prepare(
        `
      SELECT balance,
             (SELECT COUNT(*) FROM cash_transactions) AS transaction_count
      FROM cash_accounts
      WHERE id = 'acc_default'
    `,
      )
      .get(),
    cashBeforeFailedProcurement,
  );
  db.exec("DROP TRIGGER fail_procurement_accepted_outbox");

  console.log("staff operations: outbox failure rolls back procurement");
  const procurementsBeforeFailure = db
    .prepare(
      `
    SELECT COUNT(*) AS count FROM procurements
  `,
    )
    .get().count;
  const eventsBeforeFailure = db
    .prepare(
      `
    SELECT COUNT(*) AS count FROM staff_events
  `,
    )
    .get().count;
  const outboxBeforeFailure = outboxCount();
  db.exec(`
    CREATE TRIGGER fail_procurement_created_outbox
    BEFORE INSERT ON internal_notification_outbox
    WHEN NEW.event_type = 'procurement.created'
    BEGIN
      SELECT RAISE(ABORT, 'test_outbox_failure');
    END;
  `);
  const failedProcurement = await requestJson("/api/admin/crm/procurements", {
    method: "POST",
    headers: { "Idempotency-Key": "staff-procurement-failure-1" },
    body: procurementBody({ notes: "Должна откатиться" }),
  });
  assert.equal(failedProcurement.response.status, 500);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM procurements").get().count,
    procurementsBeforeFailure,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM staff_events").get().count,
    eventsBeforeFailure,
  );
  assert.equal(outboxCount(), outboxBeforeFailure);
  assert.equal(
    db
      .prepare(
        `
      SELECT 1
      FROM staff_operation_idempotency
      WHERE key = 'staff-procurement-failure-1'
    `,
      )
      .get(),
    undefined,
  );
  db.exec("DROP TRIGGER fail_procurement_created_outbox");

  console.log(
    "staff operations: transfer creator, acceptor and inventory atomicity",
  );
  const transferWithoutIdempotency = await requestJson(
    "/api/admin/inventory/transfers",
    {
      method: "POST",
      body: transferBody(),
    },
  );
  assert.equal(transferWithoutIdempotency.response.status, 400);
  assert.equal(
    transferWithoutIdempotency.data.error,
    "idempotency_key_required",
  );
  const transferPinOnlyBody = transferBody();
  delete transferPinOnlyBody.actor_employee_id;
  const transferWithoutSelectedEmployee = await requestJson(
    "/api/admin/inventory/transfers",
    {
      method: "POST",
      headers: { "Idempotency-Key": "staff-transfer-pin-only" },
      body: transferPinOnlyBody,
    },
  );
  assert.equal(transferWithoutSelectedEmployee.response.status, 400);
  assert.equal(
    transferWithoutSelectedEmployee.data.error,
    "staff_employee_required",
  );
  const transferCreate = await requestJson("/api/admin/inventory/transfers", {
    method: "POST",
    headers: { "Idempotency-Key": "staff-transfer-create-1" },
    body: transferBody(),
  });
  assert.equal(transferCreate.response.status, 200);
  const transferId = transferCreate.data.id;
  assert.equal(transferCreate.data.created_by_employee_id, "employee_a");
  assert.equal(eventCount("stock_transfer", transferId, "transfer_created"), 1);

  const transferReplay = await requestJson("/api/admin/inventory/transfers", {
    method: "POST",
    headers: { "Idempotency-Key": "staff-transfer-create-1" },
    body: transferBody(),
  });
  assert.equal(transferReplay.response.status, 200);
  assert.equal(transferReplay.data.id, transferId);
  assert.equal(eventCount("stock_transfer", transferId), 1);

  console.log(
    "staff operations: transfer rechecks product variant mode on complete",
  );
  const transferWithChangedProductMode = await requestJson(
    "/api/admin/inventory/transfers",
    {
      method: "POST",
      headers: {
        "Idempotency-Key": "staff-transfer-product-mode-change-1",
      },
      body: transferBody({ comment: "Товар станет вариативным" }),
    },
  );
  assert.equal(transferWithChangedProductMode.response.status, 200);
  const changedModeTransferId = transferWithChangedProductMode.data.id;
  const stockBeforeChangedModeTransfer = productStock();
  const acceptedTransfersBeforeChangedMode = outboxCount("transfer.accepted");
  db.prepare(
    "UPDATE products SET has_variants = 1 WHERE id = 'staff_product'",
  ).run();
  const changedModeComplete = await requestJson(
    `/api/admin/inventory/transfers/${changedModeTransferId}/complete`,
    {
      method: "POST",
      body: {
        actor_employee_id: "employee_b",
        actor_pin: "2222",
      },
    },
  );
  assert.equal(changedModeComplete.response.status, 400);
  assert.equal(changedModeComplete.data.error, "variant_required");
  assert.deepEqual(productStock(), stockBeforeChangedModeTransfer);
  assert.equal(
    db.prepare(
      "SELECT status FROM stock_transfers WHERE id = ?",
    ).get(changedModeTransferId).status,
    "draft",
  );
  assert.equal(eventCount("stock_transfer", changedModeTransferId), 1);
  assert.equal(
    outboxCount("transfer.accepted"),
    acceptedTransfersBeforeChangedMode,
  );
  db.prepare(
    "UPDATE products SET has_variants = 0 WHERE id = 'staff_product'",
  ).run();

  const stockBeforeTransfer = productStock();
  const transferCompleteWithoutSelectedEmployee = await requestJson(
    `/api/admin/inventory/transfers/${transferId}/complete`,
    {
      method: "POST",
      body: { actor_pin: "2222" },
    },
  );
  assert.equal(transferCompleteWithoutSelectedEmployee.response.status, 400);
  assert.equal(
    transferCompleteWithoutSelectedEmployee.data.error,
    "staff_employee_required",
  );
  assert.deepEqual(productStock(), stockBeforeTransfer);
  const transferCompleteResults = await Promise.all([
    requestJson(`/api/admin/inventory/transfers/${transferId}/complete`, {
      method: "POST",
      body: {
        actor_employee_id: "employee_b",
        actor_pin: "2222",
      },
    }),
    requestJson(`/api/admin/inventory/transfers/${transferId}/complete`, {
      method: "POST",
      body: {
        actor_employee_id: "employee_b",
        actor_pin: "2222",
      },
    }),
  ]);
  assert.deepEqual(
    transferCompleteResults.map((item) => item.response.status).sort(),
    [200, 409],
  );
  assert.deepEqual(productStock(), {
    stock: stockBeforeTransfer.stock - 2,
    warehouse_stock: stockBeforeTransfer.warehouse_stock + 2,
  });
  const completedTransfer = db
    .prepare(
      `
    SELECT created_by_employee_id, completed_by_employee_id
    FROM stock_transfers
    WHERE id = ?
  `,
    )
    .get(transferId);
  assert.deepEqual(completedTransfer, {
    created_by_employee_id: "employee_a",
    completed_by_employee_id: "employee_b",
  });
  assert.equal(eventCount("stock_transfer", transferId), 2);

  console.log("staff operations: failed transfer completion changes nothing");
  const failingTransfer = await requestJson("/api/admin/inventory/transfers", {
    method: "POST",
    headers: { "Idempotency-Key": "staff-transfer-failure-1" },
    body: transferBody({ comment: "Проверка отката" }),
  });
  assert.equal(failingTransfer.response.status, 200);
  const failingTransferId = failingTransfer.data.id;
  const stockBeforeFailedTransfer = productStock();
  const eventBeforeFailedTransfer = eventCount(
    "stock_transfer",
    failingTransferId,
  );
  const outboxBeforeFailedTransfer = outboxCount();
  db.exec(`
    CREATE TRIGGER fail_transfer_accepted_outbox
    BEFORE INSERT ON internal_notification_outbox
    WHEN NEW.event_type = 'transfer.accepted'
    BEGIN
      SELECT RAISE(ABORT, 'test_outbox_failure');
    END;
  `);
  const failedTransferComplete = await requestJson(
    `/api/admin/inventory/transfers/${failingTransferId}/complete`,
    {
      method: "POST",
      body: {
        actor_employee_id: "employee_b",
        actor_pin: "2222",
      },
    },
  );
  assert.equal(failedTransferComplete.response.status, 500);
  assert.deepEqual(productStock(), stockBeforeFailedTransfer);
  assert.equal(
    db
      .prepare(
        `
      SELECT status
      FROM stock_transfers
      WHERE id = ?
    `,
      )
      .get(failingTransferId).status,
    "draft",
  );
  assert.equal(
    eventCount("stock_transfer", failingTransferId),
    eventBeforeFailedTransfer,
  );
  assert.equal(outboxCount(), outboxBeforeFailedTransfer);
  db.exec("DROP TRIGGER fail_transfer_accepted_outbox");

  console.log("staff operations: правка черновика требует подтверждения сотрудника");
  const editableDraft = await requestJson("/api/admin/inventory/transfers", {
    method: "POST",
    headers: { "Idempotency-Key": "staff-transfer-edit-1" },
    body: transferBody({ comment: "До правки" }),
  });
  assert.equal(editableDraft.response.status, 200);
  const editableDraftId = editableDraft.data.id;
  const eventsBeforeEdit = eventCount("stock_transfer", editableDraftId);
  const outboxBeforeEdit = outboxCount();

  const editWithoutActor = await requestJson(
    `/api/admin/inventory/transfers/${editableDraftId}`,
    {
      method: "PUT",
      body: { items: [{ product_id: "staff_product", quantity: 1 }] },
    },
  );
  assert.equal(editWithoutActor.response.status, 400);

  const editWithWrongPin = await requestJson(
    `/api/admin/inventory/transfers/${editableDraftId}`,
    {
      method: "PUT",
      body: {
        actor_employee_id: "employee_b",
        actor_pin: "9999",
        items: [{ product_id: "staff_product", quantity: 1 }],
      },
    },
  );
  assert.equal(editWithWrongPin.response.status, 401);
  assert.equal(editWithWrongPin.data.error, "invalid_staff_credentials");
  assert.equal(
    db
      .prepare("SELECT SUM(quantity) AS total FROM stock_transfer_items WHERE transfer_id = ?")
      .get(editableDraftId).total,
    2,
    "состав не меняется без подтверждения",
  );

  const editWithActor = await requestJson(
    `/api/admin/inventory/transfers/${editableDraftId}`,
    {
      method: "PUT",
      body: {
        actor_employee_id: "employee_b",
        actor_pin: "2222",
        comment: "После правки",
        items: [{ product_id: "staff_product", quantity: 1 }],
      },
    },
  );
  assert.equal(editWithActor.response.status, 200);
  const editedRow = db
    .prepare("SELECT * FROM stock_transfers WHERE id = ?")
    .get(editableDraftId);
  assert.equal(editedRow.updated_by_employee_id, "employee_b");
  // Плюс за документ остаётся у того, кто завёл заявку.
  assert.equal(editedRow.created_by_employee_id, "employee_a");
  assert.equal(editedRow.comment, "После правки");
  // Правка не документ: ни события, ни уведомления она не порождает.
  assert.equal(eventCount("stock_transfer", editableDraftId), eventsBeforeEdit);
  assert.equal(outboxCount(), outboxBeforeEdit);

  console.log("staff operations: cancelling a draft adds no positive event");
  const cancelledTransfer = await requestJson(
    "/api/admin/inventory/transfers",
    {
      method: "POST",
      headers: { "Idempotency-Key": "staff-transfer-cancel-1" },
      body: transferBody({ comment: "Отмена" }),
    },
  );
  assert.equal(cancelledTransfer.response.status, 200);
  const eventsBeforeCancel = eventCount(
    "stock_transfer",
    cancelledTransfer.data.id,
  );
  const rejectedCancel = await requestJson(
    `/api/admin/inventory/transfers/${cancelledTransfer.data.id}/cancel`,
    {
      method: "POST",
      body: {
        actor_employee_id: "employee_b",
        actor_pin: "9999",
      },
    },
  );
  assert.equal(rejectedCancel.response.status, 401);
  assert.equal(rejectedCancel.data.error, "invalid_staff_credentials");
  assert.equal(
    db
      .prepare("SELECT status FROM stock_transfers WHERE id = ?")
      .get(cancelledTransfer.data.id).status,
    "draft",
  );
  const cancelResult = await requestJson(
    `/api/admin/inventory/transfers/${cancelledTransfer.data.id}/cancel`,
    {
      method: "POST",
      body: {
        actor_employee_id: "employee_b",
        actor_pin: "2222",
      },
    },
  );
  assert.equal(cancelResult.response.status, 200);
  assert.equal(cancelResult.data.cancelled_by_employee_id, "employee_b");
  assert.match(String(cancelResult.data.cancelled_by || ""), /Борис/);
  // Событие создания остаётся: журнал неизменяемый. Рядом появляется отмена,
  // иначе в карточке сотрудника отменённая заявка навсегда числилась созданной.
  assert.equal(
    eventCount("stock_transfer", cancelledTransfer.data.id),
    eventsBeforeCancel + 1,
  );
  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS count FROM staff_events
      WHERE entity_id = ? AND event_type = 'transfer_cancelled'
    `).get(cancelledTransfer.data.id).count,
    1,
  );
  const repeatedCancel = await requestJson(
    `/api/admin/inventory/transfers/${cancelledTransfer.data.id}/cancel`,
    {
      method: "POST",
      body: {
        actor_employee_id: "employee_b",
        actor_pin: "2222",
      },
    },
  );
  assert.equal(repeatedCancel.response.status, 409);
  assert.equal(repeatedCancel.data.error, "invalid_status");

  console.log("staff-operations.test.js: ok");
} finally {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
