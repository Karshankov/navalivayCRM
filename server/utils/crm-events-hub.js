import crypto from 'node:crypto';
import { buildCrmOrderPollSummary } from './crm-order-polling.js';

/**
 * SSE-хаб для CRM: живой канбан вместо 15-секундного polling.
 *
 * Клиент (EventSource) подключается к `GET /api/admin/crm/events?ticket=...`
 * (тикет выдаётся обычным POST-запросом — EventSource не умеет заголовки
 * авторизации). Хаб держит Set открытых ответов и раз в 2.5 с пересчитывает
 * poll-summary — те же дешёвые агрегатные запросы, которые сейчас выполняет
 * каждая CRM-вкладка каждые 15 секунд. При изменении summary рассылает его
 * всем подписчикам как `event: summary`; без изменений ничего не шлёт.
 *
 * Один серверный тик в 2.5 с дешевле, чем N вкладок × запрос каждые 15 с:
 * суммарная нагрузка падает, а лаг появления нового заказа — до 2.5 с.
 * Тик и heartbeat работают только пока есть хотя бы один подписчик.
 *
 * Heartbeat — именно `event: ping`, а не комментарий `: ping`: EventSource
 * генерирует addEventListener('ping') и это позволяет клиенту видеть активность
 * сервера. Комментарий-keepalive от клиента незаметен, и полумёртвое
 * (полузакрытое) соединение выглядит живым, пока клиент не начнёт свой
 * watchdog-таймаут.
 */

const TICK_INTERVAL_MS = 2500;
const HEARTBEAT_INTERVAL_MS = 25000;

/** Активные SSE-подписки (response объекты Express). */
const clients = new Set();

let tickTimer = null;
let heartbeatTimer = null;

/** Последний отправленный summary: сравнение решает, рассылать ли снова. */
let lastSentSummary = null;

function summariesEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = [
    'newOrderIds',
    'actionRequiredIds',
    'newCardRequestIds',
    'latestOrderActivityAt',
    'pendingReviewCount',
  ];
  for (const key of keys) {
    const av = a[key];
    const bv = b[key];
    const aJson = Array.isArray(av) ? av.join(',') : av;
    const bJson = Array.isArray(bv) ? bv.join(',') : bv;
    if (aJson !== bJson) return false;
  }
  const aDraw = a.latestMonthlyDraw;
  const bDraw = b.latestMonthlyDraw;
  if (JSON.stringify(aDraw || null) !== JSON.stringify(bDraw || null)) return false;
  return true;
}

function writeSseEvent(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function broadcastSummary(summary) {
  for (const res of clients) {
    try {
      writeSseEvent(res, 'summary', summary);
    } catch (error) {
      // Мёртвое соединение: close-обработчик уберёт его из Set.
      console.error('[crm-events] write to client failed:', error?.message || error);
    }
  }
}

function tick(db) {
  let summary;
  try {
    summary = buildCrmOrderPollSummary({ db });
  } catch (error) {
    console.error('[crm-events] poll summary tick failed:', error?.message || error);
    return;
  }

  if (!summariesEqual(summary, lastSentSummary)) {
    lastSentSummary = summary;
    broadcastSummary(summary);
  }
}

function ensureTimers(db) {
  if (clients.size === 0) {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    return;
  }

  if (!tickTimer) {
    tickTimer = setInterval(() => tick(db), TICK_INTERVAL_MS);
    // Таймеры не должны держать процесс живым (graceful shutdown).
    tickTimer.unref?.();
  }
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      for (const res of clients) {
        try {
          // Именованное событие ping: доходит до клиента как событие
          // (клиентский watchdog отличает живое соединение от зомби),
          // держит соединение через прокси и не мешает summary.
          writeSseEvent(res, 'ping', Date.now());
        } catch {
          /* close-обработчик уберёт */
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();
  }
}

/**
 * Зарегистрировать SSE-подписку. Немедленно шлёт текущий summary (первичная
 * синхронизация вместо первого poll) и следит за разрывом соединения.
 */
export function addCrmEventsClient(db, res) {
  res.on('close', () => {
    clients.delete(res);
    ensureTimers(db);
  });

  clients.add(res);
  ensureTimers(db);

  // Первое сообщение: клиент стартует с актуальным состоянием, а не с пустым.
  try {
    const summary = buildCrmOrderPollSummary({ db });
    lastSentSummary = summary;
    writeSseEvent(res, 'summary', summary);
    // Сразу пинг, чтобы watchdog клиента начал отсчёт от момента коннекта.
    writeSseEvent(res, 'ping', Date.now());
  } catch (error) {
    console.error('[crm-events] initial summary failed:', error?.message || error);
  }
}

export function crmEventsClientCount() {
  return clients.size;
}

// ============ Одноразовые тикеты для EventSource ============
//
// EventSource не умеет передавать заголовки Authorization/X-Staff-Token, а
// кассирский/сотруднический вход по ПИН живёт только в памяти страницы. Поэтому
// клиент сначала делает POST /events/ticket (обычный fetch с заголовками),
// получает одноразовый тикет и открывает EventSource с ним в query.

const TICKET_TTL_MS = 30000;
const tickets = new Map(); // ticket -> { expiresAt: number }

function pruneTickets(now = Date.now()) {
  for (const [ticket, meta] of tickets) {
    if (meta.expiresAt <= now) {
      tickets.delete(ticket);
    }
  }
}

export function createCrmEventsTicket() {
  pruneTickets();
  const ticket = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
  tickets.set(ticket, { expiresAt: Date.now() + TICKET_TTL_MS });
  return { ticket, expiresInMs: TICKET_TTL_MS };
}

/**
 * Активировать тикет: одноразовый — повторное использование отклоняется,
 * включая попытку в ту же миллисекунду.
 */
export function consumeCrmEventsTicket(ticket) {
  if (typeof ticket !== 'string' || !ticket) return false;
  const meta = tickets.get(ticket);
  if (!meta) return false;
  tickets.delete(ticket);
  return meta.expiresAt > Date.now();
}
