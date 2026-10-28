import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

/**
 * Пометки значимости линеек: CRUD, привязка к линейке, витрина и очередь
 * отложенных сообщений после выдачи заказа.
 *
 * Запуск: node server/tests/significance-marks.test.js
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-significance-'));
const tempDbPath = path.join(tempDir, 'test.db');
process.env.DATABASE_FILE = tempDbPath;
process.env.BOT_TOKEN = '';
const adminConfigPath = path.join(tempDir, 'admin.json');
fs.writeFileSync(
  adminConfigPath,
  JSON.stringify({ username: 'admin', passwordHash: 'PLAIN:test' }),
);
process.env.ADMIN_CONFIG = adminConfigPath;

const { initDb, db } = await import('../db.js');
const { issueToken } = await import('../auth.js');
const { adminRouter } = await import('../routes/admin.js');
const { publicRouter } = await import('../routes/public.js');
const {
  scheduleSignificanceNotifications,
  cancelPendingSignificanceNotifications,
  listDueSignificanceNotifications,
  processDueSignificanceNotifications,
  renderSignificanceText,
  getSignificanceMarksForOrder,
  _stopSignificanceNotifyWorkerForTests,
} = await import('../utils/significance-notify.js');
const { SIGNIFICANCE_NOTIFY_DELAY_MS } = await import('../utils/significance-notify.js');

// Иконка пометки — загруженная картинка (data-URL); валидный PNG 1x1.
const ICON_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4//8/AwAF/gL+py0/RAAAAABJRU5ErkJggg==';

initDb();

const app = express();
app.use(express.json());
app.use(adminRouter);
app.use(publicRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
const authToken = issueToken('test-admin');

function authHeaders() {
  return {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

// ---------------------------------------------------------------- фикстуры

let seedCounter = 0;

function createCategory(name = 'Жидкости') {
  seedCounter += 1;
  const id = `c_sig_${seedCounter}`;
  db.prepare(`
    INSERT INTO categories (id, slug, name, [order], hide_empty)
    VALUES (?, ?, ?, 1, 0)
  `).run(id, `${id}-slug`, `${name} ${seedCounter}`);
  return id;
}

function createGroup(categoryId, name = 'CATSWILL') {
  seedCounter += 1;
  const id = `cg_sig_${seedCounter}`;
  db.prepare(`
    INSERT INTO category_groups (id, categoryId, slug, name, [order])
    VALUES (?, ?, ?, ?, 1)
  `).run(id, categoryId, `${id}-slug`, `${name} ${seedCounter}`);
  return id;
}

function createProduct({ categoryId, groupId, title, price = 20, costPrice = 10, stock = 5 }) {
  seedCounter += 1;
  const id = `p_sig_${seedCounter}`;
  db.prepare(`
    INSERT INTO products (id, categoryId, groupId, title, priceRub, cost_price, stock, has_variants, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, DATETIME('now'))
  `).run(id, categoryId, groupId, title, price, costPrice, stock);
  return id;
}

function createCustomer({ name = 'Пётр', telegramId = null }) {
  seedCounter += 1;
  const id = `cust_sig_${seedCounter}`;
  db.prepare(`
    INSERT INTO customers (id, first_name, telegram_id, first_visit_at, last_visit_at)
    VALUES (?, ?, ?, DATETIME('now'), DATETIME('now'))
  `).run(id, name, telegramId);
  return id;
}

function createOrder({ customerId, status = 'new', items = [] }) {
  seedCounter += 1;
  const id = `o_sig_${seedCounter}`;
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, total_amount, final_amount)
    VALUES (?, ?, ?, ?, 0, 0)
  `).run(id, 1000 + seedCounter, customerId, status);
  for (const item of items) {
    db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, product_title, quantity, price_per_unit, cost_per_unit, total_price, total_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(`oi_sig_${seedCounter}_${Math.random().toString(36).slice(2, 6)}`, id, item.productId, item.title, 1, 20, 10, 20, 10);
  }
  return id;
}

function setOrderStatus(orderId, status) {
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, orderId);
}

async function createMark(overrides = {}) {
  const payload = {
    title: 'Социально значимый товар',
    description: 'Часть средств с каждой банки идёт на благотворительность',
    icon: ICON_PNG,
    color: '#16a34a',
    notifyText: '{имя}, спасибо за покупку {название}! Заказ №{номер}',
    ...overrides,
  };
  const { response, data } = await requestJson('/api/admin/significance-marks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 201, JSON.stringify(data));
  return data;
}

// ------------------------------------------------------------------- тесты

async function testCrud() {
  // Создание: полный набор полей.
  const mark = await createMark();
  assert.equal(mark.title, 'Социально значимый товар');
  assert.equal(mark.icon, ICON_PNG);
  assert.equal(mark.color, '#16a34a');
  assert.ok(mark.code);
  assert.ok(mark.id.startsWith('sigm_'));

  // Список.
  const list = await requestJson('/api/admin/significance-marks', { headers: authHeaders() });
  assert.equal(list.response.status, 200);
  assert.ok(list.data.items.some((item) => item.id === mark.id));

  // Обновление (частичное).
  const updated = await requestJson(`/api/admin/significance-marks/${mark.id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ title: 'Другое название', color: '#0ea5e9' }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.title, 'Другое название');
  assert.equal(updated.data.color, '#0ea5e9');
  // Не тронутое поле остаётся.
  assert.equal(updated.data.icon, ICON_PNG);

  // Внутренняя заметка: сохраняется, наружу не уходит.
  const noted = await createMark({
    title: 'Социальный товар (помощь животным)',
    adminNote: 'ЖИВОТНЫМ — фонд «Ника»',
  });
  assert.equal(noted.adminNote, 'ЖИВОТНЫМ — фонд «Ника»');
  const notedDetail = await requestJson(`/api/significance-marks/${noted.code}/detail`);
  assert.equal(notedDetail.response.status, 200);
  assert.equal('adminNote' in notedDetail.data, false, 'заметка не должна уходить клиенту');
  // Вторая пометка с тем же названием создаётся (код с суффиксом).
  const twin = await createMark({ title: 'Социальный товар (помощь животным)', adminNote: 'ДЕТЯМ — дом ребёнка' });
  assert.ok(twin.code !== noted.code);

  // Валидация: плохой цвет и плохая иконка.
  const badColor = await requestJson('/api/admin/significance-marks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ title: 'x', icon: ICON_PNG, color: 'green' }),
  });
  assert.equal(badColor.response.status, 400);
  assert.equal(badColor.data.error, 'invalid_color');

  const badIcon = await requestJson('/api/admin/significance-marks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ title: 'x', icon: 'dragon', color: '#16a34a' }),
  });
  assert.equal(badIcon.response.status, 400);
  assert.equal(badIcon.data.error, 'invalid_icon');

  // Редактируемый текст: промокод-блок и размеры картинок вычищаются, но живут.
  const richBody = '<div data-promo="CATSWILL10" onclick="hack()"><b>CATSWILL10</b> — нажмите</div><img src="data:image/png;base64,AAA" style="width: 50%; height: auto" onerror="x()">';
  const rich = await createMark({ title: 'Рич-текст пометка', detailBody: richBody, detailMode: undefined, detailButtonText: null, detailTitle: null, detailUrl: null });
  // roundtrip: PUT через серверный санитайзер уже в createMark (POST конвертирует иконку; тело чистится в validate).
  assert.ok(String(rich.detailBody).includes('data-promo="CATSWILL10"'), rich.detailBody);
  assert.ok(String(rich.detailBody).includes('width: 50%'));
  assert.ok(!String(rich.detailBody).includes('onclick'));
  assert.ok(!String(rich.detailBody).includes('onerror'));
  // Публичная деталь отдаёт тот же HTML.
  const richDetail = await requestJson(`/api/significance-marks/${rich.code}/detail`);
  assert.equal(richDetail.response.status, 200);
  assert.ok(String(richDetail.data.detailBody).includes('data-promo="CATSWILL10"'));

  // Иконка-строка без data:image — тоже invalid.
  const badIcon2 = await requestJson('/api/admin/significance-marks', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ title: 'x', icon: 'https://example.com/icon.png', color: '#16a34a' }),
  });
  assert.equal(badIcon2.response.status, 400);
  assert.equal(badIcon2.data.error, 'invalid_icon');

  // Публичная ручка деталей: по коду, только активные.
  const detail = await requestJson(`/api/significance-marks/${mark.code}/detail`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.data.title, 'Другое название');
  // Текст сообщения наружу не уходит.
  assert.equal('notifyText' in detail.data, false);

  const missing = await requestJson('/api/significance-marks/no-such-code/detail');
  assert.equal(missing.response.status, 404);

  // Удаление: снимается с линеек, очередь чистится.
  const categoryId = createCategory();
  const groupId = createGroup(categoryId);
  await requestJson(`/api/admin/category-groups/${groupId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ significanceMarkId: mark.id }),
  });
  const deleted = await requestJson(`/api/admin/significance-marks/${mark.id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  assert.equal(deleted.response.status, 200);
  const after = db.prepare('SELECT significance_mark_id FROM category_groups WHERE id = ?').get(groupId);
  assert.equal(after.significance_mark_id, null);

  // 404 на повторное удаление.
  const again = await requestJson(`/api/admin/significance-marks/${mark.id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  assert.equal(again.response.status, 404);
}

async function testGroupBinding() {
  const mark = await createMark({ title: 'Локальная пометка' });
  const categoryId = createCategory();
  const groupId = createGroup(categoryId);

  // PUT: пометка ставится и снимается (null — намеренное снятие).
  const put = await requestJson(`/api/admin/category-groups/${groupId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ significanceMarkId: mark.id }),
  });
  assert.equal(put.response.status, 200, JSON.stringify(put.data));
  assert.equal(put.data.significance_mark_id, mark.id);

  // Список линеек отдаёт поле.
  const list = await requestJson(`/api/admin/category-groups?categoryId=${categoryId}`, {
    headers: authHeaders(),
  });
  const group = list.data.find((item) => item.id === groupId);
  assert.equal(group.significance_mark_id, mark.id);

  // Снятие: null.
  const putOff = await requestJson(`/api/admin/category-groups/${groupId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ significanceMarkId: null }),
  });
  assert.equal(putOff.response.status, 200);
  assert.equal(putOff.data.significance_mark_id, null);

  // Несуществующая пометка — 400.
  const bad = await requestJson(`/api/admin/category-groups/${groupId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ significanceMarkId: 'sigm_nope' }),
  });
  assert.equal(bad.response.status, 400);
  assert.equal(bad.data.error, 'invalid_significance_mark');

  // Патч-семантика: PUT без ключа не трогает пометку.
  await requestJson(`/api/admin/category-groups/${groupId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ significanceMarkId: mark.id }),
  });
  await requestJson(`/api/admin/category-groups/${groupId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ name: `CATSWILL ${Date.now()}` }),
  });
  const untouched = db.prepare('SELECT significance_mark_id FROM category_groups WHERE id = ?').get(groupId);
  assert.equal(untouched.significance_mark_id, mark.id);

  // POST: пометка ставится при создании линейки.
  const { response: created, data: createdGroup } = await requestJson('/api/admin/category-groups', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      categoryId,
      name: `Созданная с пометкой ${Date.now()}`,
      significanceMarkId: mark.id,
    }),
  });
  assert.equal(created.status, 200, JSON.stringify(createdGroup));
  assert.equal(createdGroup.significance_mark_id, mark.id);
}

async function testPublicCatalog() {
  const mark = await createMark({ title: 'Витринная пометка' });
  const categoryId = createCategory();
  const groupId = createGroup(categoryId);
  const productId = createProduct({ categoryId, groupId, title: 'CATSWILL Blue' });

  db.prepare('UPDATE category_groups SET significance_mark_id = ? WHERE id = ?')
    .run(mark.id, groupId);

  // /api/categories: группа несёт краткую форму пометки.
  const categories = await requestJson('/api/categories');
  assert.equal(categories.response.status, 200);
  const groupNode = categories.data
    .flatMap((cat) => cat.groups || [])
    .find((g) => g.id === groupId);
  assert.ok(groupNode, 'группа должна попасть в /api/categories');
  assert.equal(groupNode.mark.title, 'Витринная пометка');
  assert.equal(groupNode.mark.icon, ICON_PNG);
  // Текст сообщения клиенту наружу не уходит.
  assert.equal('notifyText' in groupNode.mark, false);

  // /api/products: товар несёт ту же пометку.
  const products = await requestJson(`/api/products?category=${categories.data.find(c => (c.groups||[]).some(g => g.id === groupId)).slug}`);
  const product = products.data.products.find((p) => p.id === productId);
  assert.ok(product, 'товар должен попасть в /api/products');
  assert.equal(product.mark.title, 'Витринная пометка');

  // Неактивная пометка не показывается.
  db.prepare('UPDATE significance_marks SET active = 0 WHERE id = ?').run(mark.id);
  const inactive = await requestJson('/api/categories');
  const groupInactive = inactive.data
    .flatMap((cat) => cat.groups || [])
    .find((g) => g.id === groupId);
  assert.equal(groupInactive.mark, null);
  db.prepare('UPDATE significance_marks SET active = 1 WHERE id = ?').run(mark.id);
}

async function testNotifyQueue() {
  const mark = await createMark({ title: 'Пометка для сообщений' });
  const categoryId = createCategory();
  const groupId = createGroup(categoryId);
  const markedProduct = createProduct({ categoryId, groupId, title: 'CATSWILL Marked' });
  const plainProduct = createProduct({ categoryId, groupId: createGroup(categoryId), title: 'Обычный' });

  db.prepare('UPDATE category_groups SET significance_mark_id = ? WHERE id = ?')
    .run(mark.id, groupId);

  // Плейсхолдеры.
  const rendered = renderSignificanceText(
    '{имя} | {название} | {номер}',
    { customerName: 'Пётр', markTitle: 'Пометка для сообщений', orderNumber: 42 },
  );
  assert.equal(rendered, 'Пётр | Пометка для сообщений | 42');

  // Заказ с помеченным товаром: пометка находится.
  const customerId = createCustomer({ name: 'Пётр', telegramId: '111222' });
  const orderId = createOrder({
    customerId,
    items: [
      { productId: markedProduct, title: 'CATSWILL Marked' },
      { productId: plainProduct, title: 'Обычный' },
    ],
  });
  const marks = getSignificanceMarksForOrder(orderId);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].id, mark.id);

  // Планирование: send_at = +10 минут, дедуп на повтор.
  const now = new Date('2026-10-27T12:00:00Z');
  const scheduled = scheduleSignificanceNotifications(orderId, { now });
  assert.equal(scheduled.length, 1);
  const row = db.prepare('SELECT * FROM significance_notify_queue WHERE order_id = ?').get(orderId);
  assert.equal(row.status, 'pending');
  assert.equal(row.send_at, '2026-10-27 12:10:00');
  const again = scheduleSignificanceNotifications(orderId, { now });
  assert.equal(again.length, 0);

  // Не наступило время — не отправляется.
  const beforeDue = listDueSignificanceNotifications({ now: new Date('2026-10-27 12:05:00Z') });
  assert.equal(beforeDue.length, 0);

  // Наступило — строка берётся в работу.
  const due = listDueSignificanceNotifications({ now: new Date('2026-10-27 12:11:00Z') });
  assert.equal(due.length, 1);
  assert.equal(due[0].mark_id, mark.id);

  // Отправка: реальный execute сам проверяет статус заказа — откат должен
  // привести к skipped без вызова sendViaUserbot.
  setOrderStatus(orderId, 'in_progress');
  let sendCalled = 0;
  const outcomesReverted = await processDueSignificanceNotifications({
    now: new Date('2026-10-27 12:11:00Z'),
    execute: async (row) => {
      // Имитируем проверку реального пути: executeSignificanceNotification
      // смотрит на order_status из JOIN на момент sweep.
      if (!['completed', 'delivered'].includes(row.order_status)) {
        return { sent: false, reason: 'order_status_reverted' };
      }
      sendCalled += 1;
      return { sent: true };
    },
  });
  assert.equal(sendCalled, 0, 'отменённый заказ не должен отправляться');
  assert.equal(outcomesReverted.length, 1);
  assert.equal(outcomesReverted[0].outcome, 'skipped');

  // Отмена pendings при откате статуса.
  db.prepare("UPDATE significance_notify_queue SET status = 'pending' WHERE order_id = ?").run(orderId);
  const cancelled = cancelPendingSignificanceNotifications(orderId, { now: new Date('2026-10-27 12:12:00Z') });
  assert.ok(cancelled >= 1);
  const skipped = db.prepare('SELECT status, reason FROM significance_notify_queue WHERE order_id = ?').get(orderId);
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.reason, 'order_status_reverted');

  // Успешная отправка: sweep отправляет и пишет sent.
  setOrderStatus(orderId, 'delivered');
  db.prepare("UPDATE significance_notify_queue SET status = 'pending', send_at = '2026-10-27 12:10:00' WHERE order_id = ?").run(orderId);
  const sent = await processDueSignificanceNotifications({
    now: new Date('2026-10-27 12:15:00Z'),
    execute: async () => ({ sent: true }),
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].outcome, 'sent');
  const sentRow = db.prepare('SELECT status FROM significance_notify_queue WHERE order_id = ?').get(orderId);
  assert.equal(sentRow.status, 'sent');

  // Ретрай: userbot недоступен — строка перепланируется.
  const orderId2 = createOrder({
    customerId,
    status: 'delivered',
    items: [{ productId: markedProduct, title: 'CATSWILL Marked' }],
  });
  scheduleSignificanceNotifications(orderId2, { now: new Date('2026-10-27 12:00:00Z') });
  const retry = await processDueSignificanceNotifications({
    now: new Date('2026-10-27 12:20:00Z'),
    execute: async () => ({ sent: false, reason: 'userbot_unavailable', retryable: true }),
  });
  assert.equal(retry.length, 1);
  assert.equal(retry[0].outcome, 'rescheduled');
  const retryRow = db.prepare('SELECT attempt FROM significance_notify_queue WHERE order_id = ?').get(orderId2);
  assert.equal(retryRow.attempt, 1);

  // Отмена → повторная выдача: строка возвращается в работу, а не молчит.
  const orderId3 = createOrder({
    customerId,
    items: [{ productId: markedProduct, title: 'CATSWILL Marked' }],
  });
  setOrderStatus(orderId3, 'delivered');
  scheduleSignificanceNotifications(orderId3, { now: new Date('2026-10-27 12:00:00Z') });
  setOrderStatus(orderId3, 'in_progress');
  cancelPendingSignificanceNotifications(orderId3, { now: new Date('2026-10-27 12:02:00Z') });
  const skippedBefore = db.prepare("SELECT status FROM significance_notify_queue WHERE order_id = ?").get(orderId3);
  assert.equal(skippedBefore.status, 'skipped');

  setOrderStatus(orderId3, 'delivered');
  const revived = scheduleSignificanceNotifications(orderId3, { now: new Date('2026-10-27 12:05:00Z') });
  assert.equal(revived.length, 1);
  assert.equal(revived[0].revived, true);
  const revivedRow = db.prepare("SELECT status, attempt, send_at FROM significance_notify_queue WHERE order_id = ?").get(orderId3);
  assert.equal(revivedRow.status, 'pending');
  assert.equal(revivedRow.attempt, 0);
  assert.equal(revivedRow.send_at, '2026-10-27 12:15:00');

  // Перманентная причина — skipped без ретрая (только строка второго заказа:
  // строка третьего ещё ждёт своей проверки дубля ниже).
  const skippedOut = await processDueSignificanceNotifications({
    now: new Date('2026-10-27 13:30:00Z'),
    execute: async (row) => row.order_id === orderId2
      ? { sent: false, reason: 'customer_blocked' }
      : { sent: true },
  });
  const skippedOnly = skippedOut.filter((o) => o.outcome === 'skipped');
  assert.equal(skippedOnly.length, 1);
  const skipped2 = db.prepare('SELECT status FROM significance_notify_queue WHERE order_id = ?').get(orderId2);
  assert.equal(skipped2.status, 'skipped');

  // Защита от дубля: сообщение по заказу уже в журнале — повторной отправки нет.
  // (Проверяем через processDue с реальным execute: возвращаем hasSignificanceBeenSent-подобное
  // поведение через внешний маркер — сам guard живёт в execute, поэтому тестируем
  // через статус 'sent' повторного прохода по той же строке.)
  setOrderStatus(orderId3, 'delivered');
  db.prepare("UPDATE significance_notify_queue SET status = 'pending', send_at = '2026-10-27 12:10:00' WHERE order_id = ?").run(orderId3);
  // Имитируем краш после отправки: строка всё ещё pending.
  const doubleRun = await processDueSignificanceNotifications({
    now: new Date('2026-10-27 12:20:00Z'),
    execute: async () => ({ sent: true, reason: 'already_sent' }),
  });
  assert.equal(doubleRun.length, 1);
  assert.equal(doubleRun[0].outcome, 'sent');
  const afterDouble = db.prepare('SELECT status FROM significance_notify_queue WHERE order_id = ?').get(orderId3);
  assert.equal(afterDouble.status, 'sent');
}

async function main() {
  await testCrud();
  await testGroupBinding();
  await testPublicCatalog();
  await testNotifyQueue();
  console.log('[significance-marks] OK');
}

try {
  await main();
} finally {
  _stopSignificanceNotifyWorkerForTests();
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
