/**
 * SSE для CRM (`/api/admin/crm/events`): живой канбан.
 *
 * Проверяем:
 *  - при коннекте немедленно приходит текущий summary (event: summary);
 *  - после мутации заказа в БД новое событие приходит без ожидания 15 с;
 *  - тикет одноразовый: повторное использование → 401;
 *  - без тикета → 401;
 *  - выдача тикета требует авторизацию.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navalivay-crm-events-'));
process.env.DATABASE_FILE = path.join(tempDir, 'test.db');
process.env.BOT_TOKEN = '';

const { initDb, db } = await import('../db.js');
const { issueToken } = await import('../auth.js');
const { crmOperationsRouter } = await import('../routes/crm-operations.js');

initDb();

const app = express();
app.use(express.json());
app.use(crmOperationsRouter);

const server = await new Promise((resolve) => {
  const instance = app.listen(0, () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const authToken = issueToken('test-admin');

async function getTicket() {
  const response = await fetch(`${baseUrl}/api/admin/crm/events/ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
  });
  assert.equal(response.status, 200, 'тикет должен выдаваться авторизованному');
  const data = await response.json();
  assert.ok(typeof data.ticket === 'string' && data.ticket.length > 0);
  return data.ticket;
}

/** Читает стрим, пока не соберёт нужное число summary-событий или таймаут. */
async function readSummaries(ticket, { count = 1, timeoutMs = 4000 }) {
  const controller = new AbortController();
  const collected = [];
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/api/admin/crm/events?ticket=${ticket}`, {
      signal: controller.signal,
    });
    assert.equal(response.status, 200, 'SSE-коннект должен быть 200');
    assert.ok(
      (response.headers.get('content-type') || '').includes('text/event-stream'),
      'SSE должен отдавать text/event-stream',
    );

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (collected.length < count) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Формат: "event: summary\ndata: {...}\n\n"
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const chunk of events) {
        const eventMatch = chunk.match(/^event: (.+)$/m);
        const dataMatch = chunk.match(/^data: (.+)$/m);
        if (eventMatch?.[1] === 'summary' && dataMatch) {
          collected.push(JSON.parse(dataMatch[1]));
        }
      }
    }
  } catch (error) {
    // AbortError по таймауту — штатный выход из ожидания.
    if (collected.length === 0) throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return collected;
}

function insertNewOrder() {
  const id = `ord_sse_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  db.prepare(`
    INSERT INTO orders (id, order_number, status, created_at, updated_at, archived)
    VALUES (?, ?, 'new', datetime('now'), datetime('now'), 0)
  `).run(id, `SSE${Math.floor(Math.random() * 100000)}`);
  return id;
}

// 1) Тикет без авторизации не выдаётся.
{
  const response = await fetch(`${baseUrl}/api/admin/crm/events/ticket`, { method: 'POST' });
  assert.equal(response.status, 401, 'тикет без авторизации должен быть 401');
}

// 2) Без тикета SSE не открывается.
{
  const response = await fetch(`${baseUrl}/api/admin/crm/events`);
  assert.equal(response.status, 401, 'SSE без тикета должен быть 401');
}

// 3) Коннект немедленно получает summary; новый заказ приходит событием ≤ 3 с
//    (тик хаба — 2.5 с) вместо ожидания 15-секундного polling-интервала.
{
  const ticket = await getTicket();

  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/admin/crm/events?ticket=${encodeURIComponent(ticket)}`, {
    signal: controller.signal,
  });
  assert.equal(response.status, 200);

  // Стрим открыт и получил начальное summary; теперь живое изменение:
  // новый заказ должен прийти событием тика хаба (~2.5 с), не ожидая
  // 15-секундного polling-интервала.
  const orderId = insertNewOrder();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const summaries = [];
  const deadline = Date.now() + 6000;

  while (summaries.length < 2 && Date.now() < deadline) {
    const { done, value } = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ done: false, value: null }), deadline - Date.now())),
    ]);
    if (done) break;
    if (!value) continue;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const chunk of events) {
      const dataMatch = chunk.match(/^data: (.+)$/m);
      const eventMatch = chunk.match(/^event: (.+)$/m);
      if (eventMatch?.[1] === 'summary' && dataMatch) {
        summaries.push(JSON.parse(dataMatch[1]));
      }
    }
  }
  controller.abort();

  assert.ok(summaries.length >= 1, 'первое summary должно приходить сразу при коннекте');
  assert.ok(summaries.length >= 2, `ожидались начальное и обновлённое события, пришло ${summaries.length}`);
  const lastSummary = summaries[summaries.length - 1];
  assert.ok(
    (lastSummary.newOrderIds || []).includes(orderId),
    'новый заказ должен появиться в summary по SSE',
  );
}

// 4) Тикет одноразовый: второй коннект по нему → 401.
{
  const ticket = await getTicket();
  const controller = new AbortController();
  const first = await fetch(`${baseUrl}/api/admin/crm/events?ticket=${ticket}`, {
    signal: controller.signal,
  });
  assert.equal(first.status, 200, 'первый коннект по тикету работает');
  controller.abort();

  const second = await fetch(`${baseUrl}/api/admin/crm/events?ticket=${ticket}`);
  assert.equal(second.status, 401, 'тикет не должен работать дважды');
}

// 5) Тикет с мусорным значением → 401.
{
  const response = await fetch(`${baseUrl}/api/admin/crm/events?ticket=not-a-real-ticket`);
  assert.equal(response.status, 401, 'мусорный тикет должен давать 401');
}

server.close();
console.log('[crm-events-sse.test] OK');
