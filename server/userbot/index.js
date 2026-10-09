/**
 * Userbot main process. Запускается через PM2 как `navalivay-userbot`.
 *
 * Делает три вещи:
 *   1. Подключается к Telegram через MTProto со стороны аккаунта менеджера
 *      (StringSession из data/userbot.session).
 *   2. Слушает входящие сообщения (NewMessage event) от клиентов и
 *      логирует их в bot_message_log direction='in' — это даёт точную
 *      картину «кто из клиентов активен», что использует pre-check
 *      24-часового окна для Business mode (там это всё ещё нужно как
 *      fallback, если userbot вдруг недоступен).
 *   3. Поднимает локальный HTTP API (127.0.0.1:8083) для приёма команд
 *      от api-процесса: «отправь сообщение этому chat_id». api зовёт его
 *      через server/utils/userbot-client.js при смене статуса заказа.
 *
 * Безопасность:
 *   - HTTP API слушает строго на 127.0.0.1 — никого с интернета не пускает.
 *   - Доп. защита: shared secret в заголовке X-Userbot-Secret (env).
 *
 * Failure mode:
 *   - Если процесс упал — api-process, не получив ответ за таймаут,
 *     фоллбэкается на Business mode (старый путь). Сообщение всё равно
 *     попробует уйти.
 */
import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import { Api } from 'telegram';
import { NewMessage } from 'telegram/events/index.js';
import { createClient, loadSavedSession, redactSecrets } from './client.js';
import { createRateLimiter } from './rate-limiter.js';
import {
  findQuickReply,
  listQuickReplies,
  sendQuickReply,
} from './quick-replies.js';
import { db } from '../db.js';
import { buildUserbotSendOptions } from './message-format.js';

const PORT = Number(process.env.USERBOT_HTTP_PORT || 8083);
const SHARED_SECRET = (process.env.USERBOT_SECRET || '').trim();
const IS_PRODUCTION = (process.env.NODE_ENV || '').toLowerCase() === 'production';

// Defense-in-depth: на проде требуем USERBOT_SECRET. На localhost-only listen
// риск всё равно низкий, но если кто-то получит локальный RCE на api или
// произойдёт SSRF-подобная атака изнутри сервера, секрет — единственная
// преграда между "пишет в Telegram от лица менеджера" и "не пишет".
if (IS_PRODUCTION && !SHARED_SECRET) {
  console.error(
    '[userbot] USERBOT_SECRET не задан в production — обязателен. ' +
      'Сгенерируй: `openssl rand -hex 32` и положи в server/.env',
  );
  process.exit(1);
}

// Лимит безопасности: не больше N исходящих в секунду, чтобы не словить
// FloodWait от Telegram и не привлекать внимания anti-spam систем.
const MAX_SENDS_PER_SECOND = 1;

const sessionString = loadSavedSession();
if (!sessionString) {
  console.error(
    '[userbot] файл сессии пустой — сначала запусти `node server/userbot/login.js` ' +
      'и пройди SMS-авторизацию.',
  );
  process.exit(1);
}

const client = createClient(sessionString);
let myUserId = null;

await client.connect();
const me = await client.getMe();
myUserId = String(me?.id);
console.log(`[userbot] подключён как @${me?.username || me?.firstName} (id=${myUserId})`);

// ---------------------------------------------------------------------------
// State-переменные процесса: объявлены здесь, потому что prefetchDialogs
// (ниже) на них ссылается через замыкание. Если оставить объявления ниже
// — TDZ при первом вызове prefetchDialogs('startup'). Подробные комментарии
// у каждой — там, где переменная исторически жила (поиск по имени).
// ---------------------------------------------------------------------------
let sessionDead = false;
let sessionDeadReason = null;
const SESSION_DEAD_PATTERNS = [
  /AUTH_KEY_UNREGISTERED/i,
  /AUTH_KEY_DUPLICATED/i,
  /SESSION_REVOKED/i,
  /SESSION_EXPIRED/i,
  /USER_DEACTIVATED/i,
];
function looksLikeSessionDead(errorText) {
  if (!errorText) return false;
  const s = String(errorText);
  return SESSION_DEAD_PATTERNS.some((rx) => rx.test(s));
}
// FloodWait state: Telegram возвращает FLOOD_WAIT_X (X секунд) при превышении
// rate-limit. До истечения окна fast-fail все запросы — иначе Telegram
// эскалирует и может забанить аккаунт.
let floodWaitUntil = 0; // ms timestamp
// Кап на FloodWait: не блокируемся дольше 30 минут, даже если Telegram
// вернул 77К-секундный штраф. После капа userbot попробует снова —
// если штраф ещё активен, получит новый (меньший) FloodWait, а не
// моментальный бан. Предотвращает сценарий: батч → 21 час блокировки.
const FLOOD_WAIT_CAP_SEC = 1800; // 30 минут
// Разбан функции: Telegram снял rate-limit на contacts.resolveUsername
// 16.05.2026 (~24ч от инцидента 15.05.2026). Тест @nvl_vapebot прошёл
// успешно, реальные резолвы при создании заказов также работают без
// FLOOD. Если повторно прилетит постоянный FLOOD — переключить в false
// и ждать ещё, пока Telegram не остынет.
let RESOLVE_USERNAME_ENABLED = true;
// Shutdown guard: PM2 шлёт SIGTERM, потом kill_timeout → SIGKILL. Защита от
// двойного disconnect (GramJS на double-disconnect ловит unhandledRejection).
let shuttingDown = false;

// =============================================================================
// Структурированный логгер событий юзербота (JSON в stdout).
// Все ключевые события пишутся в едином формате — можно грепать:
//   ./ops/prod.sh logs userbot | grep '{"ev"'
// Поля: ev (event type), ts (ISO timestamp), и контекст под событие.
// =============================================================================
function logEvent(ev, data = {}) {
  const line = JSON.stringify({ ev, ts: new Date().toISOString(), ...data });
  console.log(line);
}

// ---------------------------------------------------------------------------
// Прогрев кэша диалогов — критично для auto-notify.
//
// Контекст бага: GramJS кэширует InputPeer (access_hash клиентов) в памяти
// процесса. StringSession сохраняет auth_key/dc_id, но НЕ entity-кэш.
// После рестарта userbot client.sendMessage(BigInt(userId)) падает с
// «Could not find the input entity» для всех клиентов, кроме тех, кто
// успел написать менеджеру первым (NewMessage event подгружает entity).
//
// Костя 10.05.2026: «отправили заказ #5788 готов к выдаче — клиенту
// не дошло, потом он сам забрал и сообщение о выдаче дошло». Между
// этими событиями был ручной send через OrderBotNotifier, который
// добавил клиента в кэш — потому второй auto-notify уже сработал.
//
// Решение: на старте подтягиваем последние N диалогов через
// getDialogs — GramJS внутри кладёт всех users/chats в entity cache.
// Запускаем в фоне, чтобы не задерживать HTTP listener (PM2 даст
// kill_timeout если старт > 10с). Через прокси getDialogs может
// занять 5-30 секунд в зависимости от пинга и количества диалогов.
//
// Лимит 500: у активного магазина обычно <500 живых клиентских
// диалогов, остальные — прокручены и редко получают авто-уведомления.
// Если такой давний клиент сделает заказ — auto-notify упадёт раз,
// потом клиент напишет (получит уведомление о статусе вручную) и
// после этого auto-notify будет работать.
// ---------------------------------------------------------------------------
// USERBOT_DIALOG_PREFETCH: сколько диалогов подтягивать на прогрев.
// Валидируем: NaN/<=0/слишком много → дефолт 3000. Cap=5000 защищает от
// опечатки (50000 = 5+ минут висения через прокси, FloodWait риск).
//
// Дефолт поднят с 1500 до 3000: в БД 2435 клиентов с telegram_id.
// Топ-3000 диалогов close-to гарантирует что все реальные клиенты
// магазина попадают в entity-кэш GramJS на старте. Оставшиеся
// (~500) подгрузятся через NewMessage event когда напишут менеджеру
// либо через entity seed из userbot_entities при старте до
// prefetchDialogs.
const DIALOG_PREFETCH_RAW = Number(process.env.USERBOT_DIALOG_PREFETCH);
const DIALOG_PREFETCH_LIMIT =
  Number.isFinite(DIALOG_PREFETCH_RAW) && DIALOG_PREFETCH_RAW > 0
    ? Math.min(DIALOG_PREFETCH_RAW, 5000)
    : 3000;

// Дедупликация in-flight prefetch: параллельные вызовы (стартовый +
// retry на entity-miss + setInterval) могли бы удвоить-утроить трафик
// через прокси и приблизить FloodWait. Возвращаем shared Promise.
let prefetchInFlight = null;

// Негативный кэш ненайденных получателей.
//
// Прогрев диалогов стоит дорого: 3000+ диалогов и почти гарантированный
// FloodWait от Telegram. Если клиента там уже искали и не нашли, повторный
// прогрев ради него ничего не изменит — access_hash появится только когда
// клиент сам напишет, а этот момент мы ловим через rememberEntity и сразу
// снимаем отметку. Держим в памяти: после рестарта проверим заново.
const ENTITY_MISS_TTL_MS = 24 * 60 * 60 * 1000;
const entityMissUntil = new Map();

function isKnownEntityMiss(chatId) {
  const until = entityMissUntil.get(String(chatId));
  if (!until) return false;
  if (until <= Date.now()) {
    entityMissUntil.delete(String(chatId));
    return false;
  }
  return true;
}

function markEntityMiss(chatId) {
  entityMissUntil.set(String(chatId), Date.now() + ENTITY_MISS_TTL_MS);
}

function clearEntityMiss(chatId) {
  entityMissUntil.delete(String(chatId));
}

async function prefetchDialogs(reason = 'startup') {
  // Не прогреваем когда:
  //  - идёт shutdown (избегаем лога после httpServer.close и гонки с disconnect)
  //  - сессия мёртвая (Telegram отозвал — getDialogs всё равно упадёт)
  //  - активен FloodWait (любой RPC сейчас усугубит penalty от Telegram)
  if (shuttingDown || sessionDead) return 0;
  if (floodWaitUntil > Date.now()) {
    console.log(
      `[userbot] прогрев пропущен (${reason}): активен FloodWait до ${new Date(floodWaitUntil).toISOString()}`,
    );
    return 0;
  }
  if (prefetchInFlight) return prefetchInFlight;
  // .finally цепочкой — критично! Если бы мы повесили .finally отдельно
  // (на возвращённый IIFE-promise), `prefetchInFlight` хранил бы
  // оригинальный promise, и микротаск его resolve мог стартовать ДО
  // setter'а `prefetchInFlight=null`. Узкое окно, но реальное:
  // параллельный entity-miss retry увидел бы prefetchInFlight===null
  // и запустил второй getDialogs → удвоение трафика через прокси,
  // ровно та регрессия от которой защищались.
  //
  // Цепочкой `.finally(() => { ... = null })` делаем, что:
  //  1) prefetchInFlight указывает на .finally-promise,
  //  2) этот promise резолвится только ПОСЛЕ того, как нулящий callback
  //     отработал — следовательно any `await prefetchInFlight` гарантирует
  //     prefetchInFlight===null к моменту возврата управления caller'у.
  prefetchInFlight = (async () => {
    try {
      const t0 = Date.now();
      // Полный обход через iterDialogs (async generator) — пагинирует под
      // капотом и корректно обрабатывает pinned-диалоги. Заодно
      // сохраняем access_hash каждого user-диалога в userbot_entities,
      // чтобы переживать рестарт userbot и помогать когда iterDialogs
      // упирается в server-side cap (у Кости отдаёт ~500, реально клиентов
      // больше — каждый новый клиент добавится через NewMessage event).
      let mainCount = 0;
      for await (const dialog of client.iterDialogs({ limit: DIALOG_PREFETCH_LIMIT })) {
        mainCount += 1;
        if (dialog?.entity) {
          rememberEntity(dialog.entity, 'prefetch', dialog.message?.id);
        }
      }
      let archivedCount = 0;
      try {
        for await (const dialog of client.iterDialogs({
          limit: DIALOG_PREFETCH_LIMIT,
          archived: true,
        })) {
          archivedCount += 1;
          if (dialog?.entity) {
            rememberEntity(dialog.entity, 'prefetch_archived', dialog.message?.id);
          }
        }
      } catch (archErr) {
        // Архив может быть пустой/недоступный — не ронять весь прогрев.
        console.warn(
          '[userbot] архивные диалоги не подтянулись:',
          redactSecrets(archErr?.message || archErr),
        );
      }
      const total = mainCount + archivedCount;
      const elapsed = Date.now() - t0;
      console.log(
        `[userbot] прогрет кэш диалогов (${reason}): ${mainCount} основных + ${archivedCount} архивных = ${total} за ${elapsed}мс`,
      );
      return total;
    } catch (err) {
      const errText = redactSecrets(err?.message || err);
      console.error(`[userbot] прогрев кэша диалогов упал (${reason}):`, errText);
      // Если getDialogs упал из-за отозванной сессии — пометить
      // sessionDead, чтобы /health начал отдавать ok=false и api не
      // тратил попытки на мёртвый userbot (см. логику ниже у
      // looksLikeSessionDead и SESSION_DEAD_PATTERNS).
      if (!sessionDead && looksLikeSessionDead(err?.errorMessage || err?.message || '')) {
        sessionDead = true;
        sessionDeadReason = errText;
        console.error(
          '[userbot] СЕССИЯ МЁРТВАЯ (определено при прогреве):',
          errText,
          '— /health будет возвращать ok=false. Останови процесс,',
          'удали data/userbot.session, пройди login заново.',
        );
      }
      return 0;
    }
  })().finally(() => {
    prefetchInFlight = null;
  });
  return prefetchInFlight;
}

// fire-and-forget: HTTP listener стартует параллельно, первые
// /send-message могут падать пока прогрев идёт — на такой фейл есть
// retry внутри /send-message (он подтянет тот же in-flight Promise).
const startupPrefetch = prefetchDialogs('startup');

// Периодический догрев каждые 30 минут: новые клиенты, написавшие
// менеджеру за день, попадают в кэш через NewMessage events. Но
// если процесс долго живёт, кто-то из старых может вытесниться
// (cap у GramJS внутри ~10к entities). Перезаливаем для надёжности.
const DIALOG_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const dialogRefreshTimer = setInterval(
  () => prefetchDialogs('periodic'),
  DIALOG_REFRESH_INTERVAL_MS,
);
// .unref() чтобы таймер не держал event loop при shutdown.
dialogRefreshTimer.unref?.();

// После стартового прогрева подгружаем entity-кэш из userbot_entities для
// клиентов, которые не попали в iterDialogs (Telegram-side cap ~500–1500
// диалогов для бизнес-аккаунтов). Это плавный обход: iterDialogs даёт
// access_hash для ~3000, а для остальных ~500 клиентов используем
// сохранённые access_hash из userbot_entities (накоплены через
// NewMessage events). Запускаем после первого prefetchDialogs('startup').
//
// Без этого прогрева клиенты, написавшие менеджеру до деплоя userbot
// или у которых давно не было диалога, выпадают из entity-кэша и ловят
// «Could not find input entity» при auto-notify.
startupPrefetch.then(async () => {
  try {
    // Вычитываем всех клиентов, у которых есть сохранённый access_hash
    // (они писали менеджеру, но их диалог мог не попасть в iterDialogs).
    const entities = db.prepare(
      `SELECT telegram_id, access_hash FROM userbot_entities`,
    ).all();
    if (!entities || entities.length === 0) return;

    // Батчим всех пользователей в один users.GetUsers — иначе 700+
    // последовательных API-вызовов вызывают FloodWait (грамджис спит
    // по 30с на каждом). GetUsers принимает массив InputUser
    // (не InputPeerUser, но поля те же: userId, accessHash).
    const batchPeers = [];
    for (const row of entities) {
      if (!row?.access_hash) continue;
      batchPeers.push(new Api.InputUser({
        userId: BigInt(row.telegram_id),
        accessHash: BigInt(row.access_hash),
      }));
    }

    if (batchPeers.length > 0) {
      try {
        await client.invoke(new Api.users.GetUsers({ id: batchPeers }));
        // GramJS автоматически кладёт полученные User-объекты во
        // внутренний entity-кэш — sendMessage(BigInt(userId))
        // находит entity.
        console.log(
          `[userbot] посеяно ${batchPeers.length} entity из userbot_entities (batch)`,
        );
      } catch (seedErr) {
        // Если access_hash устарел — Telegram возвращает пустой
        // массив для bad-записей, это не ошибка.
        console.warn(
          '[userbot] batch entity seed warning:',
          redactSecrets(seedErr?.message || seedErr),
        );
      }
    }

    // Снимаем флаг active с истёкших временных блокировок
    const expiredBlocks = db.prepare(`
      UPDATE customer_blocks SET active = 0
      WHERE active = 1
        AND block_until IS NOT NULL
        AND block_until <= DATETIME('now')
    `).run();
    if (expiredBlocks.changes > 0) {
      console.log(`[userbot] снято ${expiredBlocks.changes} истёкших блокировок`);
    }

    // После посева entity запускаем фоновый прогревальщик точного
    // количества сообщений для CRM-индикатора.
    warmupMessageCounts().catch((err) => {
      console.error('[userbot] warmupMessageCounts background error:', redactSecrets(err?.message || err));
    });
  } catch (err) {
    console.error('[userbot] DB entity seed error:', redactSecrets(err?.message || err));
  }
});

/**
 * Фоновый прогревальщик точного количества сообщений для CRM-индикатора.
 *
 * После старта userbot для каждого клиента из userbot_entities, у которого
 * ещё нет exact_message_count, вызываем getHistory(limit=1, offsetId=-1) —
 * это самый лёгкий RPC-запрос к Telegram. Ответ содержит поле `count` —
 * точное количество сообщений в чате. Сохраняем его в exact_message_count.
 *
 * Задержка 2 секунды между вызовами (Telegram rate limit ~30/min).
 * При FloodWait ждём предписанное время с множителем и повторяем тот же
 * клиент. Процесс лёгкий, не блокирует отправку сообщений и может быть
 * прерван в любой момент (shuttingDown / sessionDead).
 */
async function warmupMessageCounts() {
  try {
    const rows = db.prepare(
      `SELECT telegram_id, access_hash FROM userbot_entities
        WHERE exact_message_count IS NULL
        ORDER BY last_seen_at DESC
        LIMIT 2400`,
    ).all();
    if (!rows || rows.length === 0) {
      console.log('[userbot] warmupMessageCounts: все клиенты уже имеют exact_message_count');
      return;
    }
    console.log(`[userbot] warmupMessageCounts: начинаю прогрев ${rows.length} клиентов...`);

    let idx = 0;
    let done = 0;
    // entity_not_found — нормальная ситуация (диалога нет), не считаем как ошибку
    let entityNotFoundCount = 0;
    let realErrors = 0;

    while (idx < rows.length && !shuttingDown && !sessionDead) {
      const row = rows[idx];

      // Если активен глобальный FloodWait — ждём
      if (floodWaitUntil > Date.now()) {
        const waitMs = floodWaitUntil - Date.now();
        await new Promise((r) => setTimeout(r, Math.min(waitMs, 30000)));
        if (floodWaitUntil > Date.now()) continue;
      }

      try {
        // Строим InputPeerUser с access_hash из БД — иначе getHistory
        // падает с «Could not find input entity» для entity не в кэше.
        let peer;
        if (row.access_hash) {
          peer = new Api.InputPeerUser({
            userId: BigInt(row.telegram_id),
            accessHash: BigInt(row.access_hash),
          });
        } else {
          // Без access_hash — только если entity уже в кэше GramJS.
          peer = BigInt(row.telegram_id);
        }

        const result = await client.invoke(
          new Api.messages.GetHistory({
            peer,
            limit: 1,
            offsetId: -1,
          }),
        );
        // messages.ChannelMessages (каналы/супергруппы) имеет поле count —
        // точное количество сообщений. messages.Messages (личные чаты) —
        // только массив messages, без count. Для личных чатов считаем
        // messages.length (с limit=1 даст 0 или 1 — не точный счётчик,
        // но bot_message_log дополнит через GREATEST).
        const count = result?.count !== undefined
          ? Number(result.count)
          : Array.isArray(result?.messages)
            ? result.messages.length
            : 0;
        if (count >= 0) {
          db.prepare(
            `UPDATE userbot_entities SET exact_message_count = ? WHERE telegram_id = ?`,
          ).run(count, String(row.telegram_id));
          done++;
        }
        idx++;
      } catch (err) {
        const errText = redactSecrets(err?.errorMessage || err?.message || String(err));
        const m = errText.match(/FLOOD(?:_WAIT)?[_\s]+(\d+)/i);
        if (m) {
          const sec = Number(m[1]);
          const capped = Math.min(sec, FLOOD_WAIT_CAP_SEC);
          floodWaitUntil = Date.now() + capped * 1000;
          console.warn(
            `[userbot] warmupMessageCounts: FLOOD_WAIT ${sec}с (cap=${capped}с) на клиенте ${row.telegram_id}, жду...`,
          );
          await new Promise((r) => setTimeout(r, Math.min(sec * 1000, 30000)));
          continue;
        }

        // Entity not found = диалога нет или access_hash устарел.
        // Это не ошибка — просто у клиента нет чата с менеджером.
        if (errText.includes('Could not find the input entity')) {
          entityNotFoundCount++;
          idx++;
          continue;
        }

        realErrors++;
        console.warn(
          `[userbot] warmupMessageCounts: ошибка ${row.telegram_id}: ${errText}`,
        );
        idx++;
        if (realErrors > 20) {
          console.warn(
            `[userbot] warmupMessageCounts: слишком много реальных ошибок (${realErrors}), останавливаюсь`,
          );
          break;
        }
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    console.log(
      `[userbot] warmupMessageCounts: завершён — ${done}/${rows.length} успешно, ` +
      `${entityNotFoundCount} нет диалога, ${realErrors} ошибок`,
    );
  } catch (err) {
    console.error('[userbot] warmupMessageCounts fatal:', redactSecrets(err?.message || err));
  }
}

// ---------------------------------------------------------------------------
// Кэшированные prepared statements: better-sqlite3 кэширует внутри по строке
// SQL, но создание Statement-объекта стоит ~0.1ms на каждый вызов prepare.
// При burst 100 входящих/сек это заметная нагрузка → ловим один раз на старте.
// ---------------------------------------------------------------------------
const stmtFindCustomer = db.prepare(`SELECT id FROM customers WHERE telegram_id = ?`);
const stmtCheckBlockForTgId = db.prepare(`
  SELECT cb.id FROM customer_blocks cb
  JOIN customers c ON c.id = cb.customer_id
  WHERE c.telegram_id = ?
    AND cb.active = 1
    AND (cb.block_until IS NULL OR cb.block_until > DATETIME('now'))
  LIMIT 1
`);
const stmtInsertLog = db.prepare(
  `INSERT INTO bot_message_log
     (business_connection_id, chat_id, customer_id, customer_telegram_id,
      direction, message_type, text, meta, created_at)
   VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, DATETIME('now'))`,
);

// Сохранение access_hash клиента: upsert по telegram_id. При INSERT
// заполняем first_seen_at и last_seen_at одинаковыми (см. DEFAULT в
// миграции). При UPDATE обновляем only last_seen_at + access_hash на
// случай если access_hash изменился (Telegram периодически их обновляет).
const stmtUpsertEntity = db.prepare(
  `INSERT INTO userbot_entities (telegram_id, access_hash, username, first_name, source, initial_message_count)
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(telegram_id) DO UPDATE SET
     access_hash = excluded.access_hash,
     username = COALESCE(excluded.username, userbot_entities.username),
     first_name = COALESCE(excluded.first_name, userbot_entities.first_name),
     initial_message_count = COALESCE(excluded.initial_message_count, userbot_entities.initial_message_count),
     last_seen_at = DATETIME('now')`,
);
const stmtGetEntityAccessHash = db.prepare(
  `SELECT access_hash FROM userbot_entities WHERE telegram_id = ?`,
);

// Извлекаем access_hash из объекта user (GramJS возвращает BigInt).
// Если у user нет access_hash — это бот, удалённый аккаунт или
// неполный entity, не сохраняем.
function rememberEntity(user, source, topMessage) {
  if (!user || user.accessHash === null || user.accessHash === undefined) return;
  const tgId = String(user.id);
  if (!/^[1-9]\d{0,18}$/.test(tgId)) return;
  // Клиент объявился: снимаем отметку, чтобы отправка сразу заработала.
  clearEntityMiss(tgId);
  const accessHash = String(user.accessHash);
  if (!accessHash || accessHash === '0') return;
  // topMessage — id последнего сообщения в диалоге (из dialog.message).
  // Telegram не переиспользует message id, поэтому для чата с N сообщениями
  // topMessage.id >= N. Сохраняем как initial_message_count — аппроксимацию
  // общего количества сообщений, которая точнее чем COUNT(bot_message_log)
  // для старых клиентов (пока exact_message_count не подгружен).
  const topMsgId = (topMessage !== null && topMessage !== undefined)
    ? Math.max(0, Number(topMessage))
    : null;
  try {
    stmtUpsertEntity.run(
      tgId,
      accessHash,
      user.username || null,
      user.firstName || null,
      source,
      topMsgId,
    );
  } catch (err) {
    console.error('[userbot] rememberEntity failed:', redactSecrets(err?.message || err));
  }
}

// ---------------------------------------------------------------------------
// Слушаем входящие сообщения и логируем активность клиентов в БД.
// ---------------------------------------------------------------------------
client.addEventHandler((event) => {
  try {
    const message = event.message;
    if (!message || !message.peerId) return;
    // Интересуют только private chats (пользователи), не каналы и не группы.
    const peerUserId = message.peerId?.userId;
    if (!peerUserId) return;
    const chatId = String(peerUserId);

    // out = сообщение от менеджера клиенту, in = от клиента менеджеру.
    const direction = message.out ? 'out' : 'in';
    // Сравнение через String(): myUserId уже строка (см. инициализацию выше),
    // senderId от GramJS приходит BigInt — без обёртки `===` всегда false и
    // эхо нашего же userbot-сообщения залогируется как «входящее».
    const senderId = message.senderId ? String(message.senderId) : null;
    if (direction === 'out' && senderId === myUserId) return;

    // Запоминаем entity клиента (для отправки без необходимости иметь
    // диалог в кэше GramJS). Делаем в любом direction — клиент пишет
    // нам ИЛИ менеджер только что написал клиенту: в обоих случаях
    // event приносит полный user-объект с актуальным access_hash.
    //
    // Для direction='in' sender — это клиент (то что нужно).
    // Для direction='out' sender — это менеджер (себя не сохраняем),
    // но peerId.userId — это клиент, и у event есть chat → достаём.
    let entityUser = null;
    if (direction === 'in') {
      entityUser = message.sender || message._sender;
    } else {
      // out: peerId — это id клиента, sender — менеджер. Берём peer.
      entityUser = message.chat || message._chat;
    }
    if (entityUser) {
      rememberEntity(entityUser, 'new_message');
    }

    // Выполняем БД-вставку через setImmediate, чтобы не блокировать
    // GramJS event loop при бурстах (better-sqlite3 синхронный → каждый
    // INSERT держит loop ~0.5ms; 100 messages/sec = 50ms простоя).
    setImmediate(() => {
      try {
        const customer = stmtFindCustomer.get(chatId);
        stmtInsertLog.run(
          chatId,
          customer?.id || null,
          chatId,
          direction,
          direction === 'in' ? 'incoming' : 'manual',
          message.message || null,
          JSON.stringify({ source: 'userbot', telegram_message_id: message.id }),
        );
      } catch (err) {
        console.error('[userbot] ошибка записи в журнал:', redactSecrets(err?.message || err));
      }
    });
  } catch (err) {
    console.error('[userbot] ошибка обработки события:', redactSecrets(err?.message || err));
  }
}, new NewMessage({}));

// ---------------------------------------------------------------------------
// Локальный HTTP API: принимает команды от api-процесса.
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '64kb' }));

// Constant-time сравнение секрета (защита от timing-side-channel,
// малореалистично на localhost, но дёшево).
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function checkSecret(req, res, next) {
  if (!SHARED_SECRET) return next(); // dev-режим: на localhost секрет опционален
  const got = req.header('X-Userbot-Secret') || '';
  if (!safeEqual(got, SHARED_SECRET)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  next();
}

// Rate-limiter: гарантирует строгую очередь даже при N параллельных запросах.
// Реализация — в server/userbot/rate-limiter.js (там же подробный комментарий
// про race до фикса). Извлекли в отдельный файл, чтобы покрыть юнит-тестами
// без поднятия реального MTProto/HTTP — импорт index.js стартует процесс.
const rateLimitedDelay = createRateLimiter({ maxPerSecond: MAX_SENDS_PER_SECOND });

// Объявления sessionDead/SESSION_DEAD_PATTERNS/looksLikeSessionDead подняты
// выше (после client.connect() + getMe()) — prefetchDialogs на них ссылается.
// Контекст по «когда сессия мёртвая» см. там же.

// Проактивный резолв entity для verified клиента. api-процесс дёргает при
// создании заказа — к моменту первой смены статуса entity уже в кэше GramJS
// и auto-notify уходит через attempt 1 без задержек resolveUsername.
app.post('/resolve-username', checkSecret, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim().replace(/^@/, '');
    const expectedTelegramId = parseUserChatId(req.body?.expected_telegram_id);
    if (!username) {
      return res.status(400).json({ ok: false, error: 'username_required' });
    }
    if (req.body?.expected_telegram_id && !expectedTelegramId) {
      return res.status(400).json({ ok: false, error: 'expected_telegram_id_invalid' });
    }
    // Гард остаётся даже после разбана 16.05.2026: если Telegram снова
    // прилетит с FloodWait на resolveUsername, флаг можно дёрнуть в false
    // без перезапуска (через окружение/правку файла) — endpoint вернёт 503.
    if (!RESOLVE_USERNAME_ENABLED) {
      return res.status(503).json({ ok: false, error: 'resolve_disabled' });
    }
    // FloodWait guard — не дёргаем Telegram пока идёт окно ожидания.
    if (floodWaitUntil > Date.now()) {
      const retryAfter = Math.ceil((floodWaitUntil - Date.now()) / 1000);
      return res.status(429).json({
        ok: false, error: 'flood_wait', retry_after_seconds: retryAfter,
      });
    }
    if (!client.connected) {
      return res.status(503).json({ ok: false, error: 'disconnected' });
    }
    await rateLimitedDelay();

    const result = await client.invoke(
      new Api.contacts.ResolveUsername({ username }),
    );
    if (result?.users && result.users.length > 0) {
      const resolvedId = result.users[0]?.id
        ? String(result.users[0].id)
        : null;
      if (expectedTelegramId && resolvedId !== expectedTelegramId) {
        logEvent('resolve', {
          username,
          outcome: 'telegram_id_mismatch',
          telegram_id: resolvedId,
          expected_telegram_id: expectedTelegramId,
        });
        return res.status(409).json({
          ok: false,
          error: 'telegram_id_mismatch',
          telegram_id: resolvedId,
        });
      }
      for (const user of result.users) {
        rememberEntity(user, 'proactive_order_create');
      }
      logEvent('resolve', { username, outcome: 'ok', telegram_id: resolvedId });
      return res.json({ ok: true, telegram_id: resolvedId });
    }
    logEvent('resolve', { username, outcome: 'not_found' });
    res.json({ ok: false, error: 'username_not_found' });
  } catch (err) {
    const errText = err?.errorMessage || err?.message || String(err);
    // FloodWait — возвращаем 429, но НЕ выставляем floodWaitUntil.
    // Этот endpoint дёргается из API fire-and-forget при создании заказа.
    // Если выставить floodWaitUntil — блокируется ВЕСЬ send-message
    // (даже для клиентов с entity в кэше). Caller (resolveUsernameViaUserbot)
    // обрабатывает 429 gracefully через .catch(() => {}).
    let fwSec = 0;
    if (typeof err?.seconds === 'number' && err.seconds > 0) {
      fwSec = err.seconds;
    } else {
      const m = errText.match(/FLOOD(?:_WAIT)?[_\s]+(\d+)/i);
      if (m) fwSec = Number(m[1]);
    }
    if (fwSec > 0) {
      return res.status(429).json({
        ok: false, error: 'flood_wait', retry_after_seconds: fwSec,
      });
    }
    console.warn('[userbot] resolve-username error:', redactSecrets(errText));
    res.status(502).json({ ok: false, error: 'resolve_failed' });
  }
});

app.get('/health', (req, res) => {
  res.json({
    ok: !sessionDead,
    me: myUserId,
    connected: client.connected && !sessionDead,
    session_dead: sessionDead || undefined,
    session_dead_reason: sessionDeadReason || undefined,
  });
});

// Валидация chat_id: только положительный целый числовой Telegram user ID.
// Defense-in-depth от вектора, когда кто-то с локальным RCE на api-процесс
// пытается через userbot HTTP отправить сообщение в канал/группу или в
// диалог с самим собой через подмену chat_id. Userbot предназначен только
// для общения с клиентами — это всегда положительный user_id.
//
// Telegram user IDs — целые до ~2^41 (документация Telegram), укладываются
// в обычный Number, но из-за будущего расширения принимаем строкой и
// конвертируем в BigInt только после проверки формата.
function parseUserChatId(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!/^[1-9]\d{0,18}$/.test(s)) return null; // только положительные, без ведущих нулей
  return s;
}

async function getKnownRecipientPeer(chatId) {
  try {
    return await client.getInputEntity(BigInt(chatId));
  } catch {
    // Пробуем сохранённый access_hash: он появляется только после реального
    // диалога клиента с менеджером, поэтому холодной рассылки здесь нет.
  }
  const stored = stmtGetEntityAccessHash.get(chatId);
  if (stored?.access_hash) {
    return new Api.InputPeerUser({
      userId: BigInt(chatId),
      accessHash: BigInt(stored.access_hash),
    });
  }
  if (isKnownEntityMiss(chatId)) return null;
  await prefetchDialogs(`quick-reply-entity-miss-${chatId}`);
  try {
    const peer = await client.getInputEntity(BigInt(chatId));
    clearEntityMiss(chatId);
    return peer;
  } catch {
    markEntityMiss(chatId);
    return null;
  }
}

app.get('/quick-replies', checkSecret, async (_req, res) => {
  try {
    if (!client.connected || sessionDead) {
      return res.status(503).json({ ok: false, error: 'disconnected' });
    }
    const quickReplies = await listQuickReplies(client);
    return res.json({ ok: true, quick_replies: quickReplies });
  } catch (err) {
    const errorText = redactSecrets(err?.errorMessage || err?.message || err);
    if (looksLikeSessionDead(errorText)) {
      sessionDead = true;
      sessionDeadReason = errorText;
      logEvent('session_dead', { source: 'quick_replies_list', error: errorText });
    }
    console.error('[userbot] quick-replies list error:', errorText);
    return res.status(502).json({ ok: false, error: 'quick_replies_failed' });
  }
});

app.post('/send-quick-reply', checkSecret, async (req, res) => {
  const chatId = parseUserChatId(req.body?.chat_id);
  const shortcutName = String(req.body?.shortcut || '').trim();
  const idempotencyKey = String(req.body?.idempotency_key || '').trim();
  if (!chatId || !shortcutName || !idempotencyKey || idempotencyKey.length > 200) {
    return res.status(400).json({ ok: false, error: 'invalid_payload' });
  }
  if (floodWaitUntil > Date.now()) {
    return res.status(429).json({
      ok: false,
      error: 'flood_wait',
      retry_after_seconds: Math.ceil((floodWaitUntil - Date.now()) / 1000),
    });
  }
  if (!client.connected || sessionDead) {
    return res.status(503).json({ ok: false, error: 'disconnected' });
  }
  if (stmtCheckBlockForTgId.get(chatId)) {
    logEvent('blocked', { chat_id: chatId, quick_reply: shortcutName, auto: true });
    return res.status(403).json({ ok: false, error: 'customer_blocked' });
  }

  try {
    await rateLimitedDelay();
    const peer = await getKnownRecipientPeer(chatId);
    if (!peer) {
      return res.status(422).json({ ok: false, error: 'entity_not_found_no_dialog' });
    }
    const shortcuts = await listQuickReplies(client);
    const shortcut = findQuickReply(shortcuts, shortcutName);
    if (!shortcut) {
      logEvent('quick_reply', { outcome: 'not_found', shortcut: shortcutName });
      return res.status(404).json({ ok: false, error: 'quick_reply_not_found' });
    }
    const result = await sendQuickReply({
      client,
      peer,
      shortcut,
      idempotencyKey,
    });
    logEvent('quick_reply', {
      outcome: 'sent',
      chat_id: chatId,
      shortcut: shortcut.name,
      message_ids: result.messageIds,
    });
    // Telegram уже принял сообщение: ошибка локального журнала не должна
    // превращать успех в 502 и провоцировать повторную отправку.
    res.json({ ok: true, shortcut: shortcut.name, telegram_message_ids: result.messageIds });
    setImmediate(() => {
      try {
        const customer = stmtFindCustomer.get(chatId);
        stmtInsertLog.run(
          chatId,
          customer?.id || null,
          chatId,
          'out',
          'quick_reply',
          `/${shortcut.name}`,
          JSON.stringify({
            source: 'userbot',
            outcome: 'sent',
            auto: true,
            shortcut: shortcut.name,
            telegram_message_ids: result.messageIds,
          }),
        );
      } catch (logError) {
        console.error('[userbot] quick-reply log error:', redactSecrets(logError?.message || logError));
      }
    });
    return;
  } catch (err) {
    const rawError = err?.errorMessage || err?.message || String(err);
    const floodMatch = rawError.match(/FLOOD(?:_WAIT)?[_\s]+(\d+)/i);
    const floodSeconds = Number(err?.seconds || floodMatch?.[1] || 0);
    if (floodSeconds > 0) {
      floodWaitUntil = Date.now() + Math.min(floodSeconds, FLOOD_WAIT_CAP_SEC) * 1000;
      return res.status(429).json({
        ok: false,
        error: 'flood_wait',
        retry_after_seconds: floodSeconds,
      });
    }
    if (looksLikeSessionDead(rawError)) {
      sessionDead = true;
      sessionDeadReason = redactSecrets(rawError);
      logEvent('session_dead', { source: 'send_quick_reply', error: sessionDeadReason });
      return res.status(503).json({ ok: false, error: 'session_dead' });
    }
    logEvent('quick_reply', {
      outcome: 'failed',
      chat_id: chatId,
      shortcut: shortcutName,
      error: redactSecrets(rawError),
    });
    console.error('[userbot] sendQuickReply error:', redactSecrets(rawError));
    return res.status(502).json({ ok: false, error: 'quick_reply_send_failed' });
  }
});

// Лимит длины: Telegram режет на 4096, если прислать больше — ошибка
// MESSAGE_TOO_LONG. Отрезать самим, чтобы не тратить попытку.
const MAX_TEXT_LEN = 4096;

// floodWaitUntil объявлен выше (около prefetchDialogs) — prefetchDialogs
// тоже его читает, чтобы не дёргать getDialogs во время FLOOD_WAIT окна.
// GramJS бросает err с .seconds или строкой FLOOD_WAIT_N.

app.post('/send-message', checkSecret, async (req, res) => {
  try {
    const chatId = parseUserChatId(req.body?.chat_id);
    const text = String(req.body?.text || '').trim();
    if (!chatId || !text) {
      return res.status(400).json({ ok: false, error: 'chat_id_and_text_required' });
    }
    if (text.length > MAX_TEXT_LEN) {
      return res.status(400).json({ ok: false, error: 'text_too_long' });
    }
    let sendOptions;
    try {
      sendOptions = buildUserbotSendOptions(text, req.body?.parse_mode);
    } catch (error) {
      const errorCode = error?.code === 'invalid_parse_mode'
        ? 'invalid_parse_mode'
        : 'invalid_html';
      return res.status(400).json({ ok: false, error: errorCode });
    }
    // Активный FloodWait — не дёргаем Telegram. auto-notify по 429 пометит
    // как unreachable и пойдёт в business-mode fallback.
    if (floodWaitUntil > Date.now()) {
      const retryAfter = Math.ceil((floodWaitUntil - Date.now()) / 1000);
      return res.status(429).json({
        ok: false,
        error: 'flood_wait',
        retry_after_seconds: retryAfter,
      });
    }
    // MTProto-соединение могло порваться (proxy down, DC switch). GramJS
    // делает autoReconnect, но в окне реконнекта sendMessage может зависнуть
    // или выпасть с ошибкой. Лучше fast-fail с 503 — auto-notify пойдёт в
    // business-mode (там может пройти) либо будет видно «не дошло» в UI.
    if (!client.connected) {
      return res.status(503).json({ ok: false, error: 'disconnected' });
    }
    await rateLimitedDelay();

    // Defense-in-depth: проверка CRM-блока перед отправкой. Даже если
    // auto-notify / send-custom пропустили блок (баг, race condition),
    // userbot не отправит сообщение заблокированному клиенту.
    // Проверяем только если chat_id соответствует числовому telegram_id
    // (для клиентов, а не групп/каналов).
    const blockRow = stmtCheckBlockForTgId.get(chatId);
    if (blockRow) {
      logEvent('blocked', { chat_id: chatId, order_id: req.body?.order_id || null, auto: req.body?.auto === true });
      return res.status(403).json({ ok: false, error: 'customer_blocked' });
    }

    // sendMessage: пишем ТОЛЬКО клиентам, с которыми у менеджера есть
    // реальный диалог в Telegram. Костя 11.05.2026: «снёс диалог —
    // не пишет ✓, Диане/Valeria — пишет (но iterDialogs их не отдаёт,
    // потому что Telegram режет ответ для бизнес-аккаунта с большой
    // базой контактов)».
    //
    // Цепочка попыток:
    //   1. sendMessage(BigInt(chatId)) — если entity в кэше GramJS.
    //   2. InputPeerUser из userbot_entities в БД — если клиент когда-то
    //      писал менеджеру (мы поймали access_hash в NewMessage handler).
    //   3. prefetchDialogs + retry — последний шанс через iterDialogs.
    //
    // Если все три упали — диалога с клиентом нет. НЕ пишем.
    // Защита аккаунта менеджера от банов за холодные сообщения.
    //
    // resolveUsername (4-я попытка) БЫЛА удалена 13.05.2026: Telegram API
    // contacts.ResolveUsername отдаёт access_hash для любого публичного
    // @username и позволяет отправить сообщение даже при отсутствии
    // диалога у менеджера (@rk0ff кейс). Это противоречит защите от
    // холодных рассылок — пишем только тем, с кем есть реальный диалог
    // в Telegram менеджера. Клиенты с existing диалогом, попавшие за
    // top-3000 iterDialogs, подхватываются через NewMessage events или
    // entity seed из userbot_entities при старте.
    const ENTITY_NOT_FOUND_RX = /Could not find the input entity/i;

    // viaAttempt: какая попытка отправки сработала.
    //   1 — sendMessage по ID (entity в GramJS кэше)
    //   2 — InputPeerUser из сохранённого access_hash (может не дойти из-за
    //       приватности получателя: «Кто может писать: только контакты»)
    //   3 — prefetchDialogs + retry
    //   0 — ни одна не сработала (entity_not_found_no_dialog)
    let result;
    let viaAttempt = 0;
    try {
      result = await client.sendMessage(BigInt(chatId), sendOptions);
      viaAttempt = 1; // прямая отправка — entity был в кэше
      const c1 = req.body?.order_id ? { order_id: req.body.order_id } : {};
      logEvent('send', { outcome: 'sent', attempt: 1, chat_id: chatId, ...c1 });
    } catch (firstErr) {
      const firstMsg = firstErr?.errorMessage || firstErr?.message || String(firstErr);
      if (!ENTITY_NOT_FOUND_RX.test(firstMsg)) throw firstErr;

      // Попытка 2: достать access_hash из БД и слать через InputPeerUser.
      // Этот путь работает если клиент когда-либо писал менеджеру: при
      // NewMessage event мы поймали и сохранили его entity. Telegram
      // принимает InputPeerUser напрямую, не требуя свежего диалога в
      // getDialogs.
      const stored = stmtGetEntityAccessHash.get(chatId);
      if (stored?.access_hash) {
        try {
          const inputPeer = new Api.InputPeerUser({
            userId: BigInt(chatId),
            accessHash: BigInt(stored.access_hash),
          });
          logEvent('send', { outcome: 'attempt', attempt: 2, chat_id: chatId, order_id: req.body?.order_id || null });
          result = await client.sendMessage(inputPeer, sendOptions);
          viaAttempt = 2; // отправка через сохранённый access_hash
        } catch (storedErr) {
          const storedMsg =
            storedErr?.errorMessage || storedErr?.message || String(storedErr);
          logEvent('send', { outcome: 'failed', attempt: 2, chat_id: chatId, error: storedMsg, order_id: req.body?.order_id || null });
          // Не пробрасываем — попробуем третью попытку через prefetch.
        }
      }

      // Попытка 3: прогрев диалогов и retry. Помогает если клиент был в
      // кэше GramJS, но вытеснен LRU.
      // Клиента уже искали прогревом и не нашли: повторный прогрев ничего не
      // изменит, а FloodWait от него тормозит отправку всем остальным.
      if (!result && !isKnownEntityMiss(chatId)) {
        logEvent('send', { outcome: 'attempt', attempt: 3, chat_id: chatId, order_id: req.body?.order_id || null });
        await prefetchDialogs(`entity-miss-${chatId}`);
        try {
          result = await client.sendMessage(BigInt(chatId), sendOptions);
          viaAttempt = 3; // после prefetchDialogs — entity найден
          clearEntityMiss(chatId);
        } catch (retryErr) {
          const retryMsg = retryErr?.errorMessage || retryErr?.message || String(retryErr);
          if (!ENTITY_NOT_FOUND_RX.test(retryMsg)) throw retryErr;
          // entity всё ещё не найден — диалога с клиентом нет в Telegram менеджера.
          // Не пишем — защита от холодных рассылок.
          markEntityMiss(chatId);
        }
      }
    }
    // Попытка 4 (resolveUsername) УДАЛЕНА 15.05.2026 17:00.
    // Причина: Telegram заблокировал contacts.resolveUsername на аккаунте
    // @Rez0nsky после батча из 200 вызовов. Каждый вызов в attempt 4
    // возвращал FLOOD → выставлял floodWaitUntil → блокировал ВООБЩЕ ВСЕ
    // отправки (даже для клиентов с entity в кэше). Проактивный резолв
    // теперь делается при СОЗДАНИИ заказа через /resolve-username endpoint
    // (с собственным FloodWait guard), а не во время auto-notify.
    //
    // ДО УДАЛЕНИЯ: contacts.resolveUsername отдаёт access_hash для любого
    // публичного @username и позволяет написать даже без диалога. Раньше
    // было удалено из-за @rk0ff-кейса (холодная рассылка), здесь
    // verified=true защищал от этого: resolveUsername вызывался только для
    // клиентов с total_orders>0 или bot_verified_at. УДАЛЕНО 15.05.2026.
    if (!result) {
      logEvent('send', { outcome: 'failed', attempt: 0, chat_id: chatId, error: 'entity_not_found_no_dialog', order_id: req.body?.order_id || null });
      res.status(200).json({ ok: false, error: 'entity_not_found_no_dialog' });
      const isAuto = req.body?.auto === true;
      setImmediate(() => {
        try {
          const customer = stmtFindCustomer.get(String(chatId));
          stmtInsertLog.run(
            String(chatId),
            customer?.id || null,
            String(chatId),
            'out',
            'manual',
            text,
            JSON.stringify({
              source: 'userbot',
              outcome: 'failed',
              error: 'entity_not_found_no_dialog',
              order_id: req.body?.order_id || null,
              auto: isAuto,
            }),
          );
        } catch (logErr) {
          console.error('[userbot] failed to log failure:', logErr?.message);
        }
      });
      return;
    }

    const messageId = Number(result.id);

    // Отвечаем сразу, журналим асинхронно через setImmediate — caller
    // не ждёт INSERT, освобождаем event loop для следующего запроса.
    res.json({ ok: true, telegram_message_id: messageId });
    const evCtx = { chat_id: chatId, attempt: viaAttempt, order_id: req.body?.order_id || null };
    if (messageId) evCtx.msg_id = messageId;
    logEvent('send', { outcome: 'sent', ...evCtx });
    // `auto` — признак того, что отправку запустил auto-notify (а не ручной
    // /bot/send-custom). Фронт CRM выбирает по нему последнюю запись для
    // плашки «не удалось отправить» на карточке заказа: без флага manual-
    // отправки путались бы с авто-уведомлениями (см. crm-operations.js).
    const isAuto = req.body?.auto === true;
    setImmediate(() => {
      try {
        const customer = stmtFindCustomer.get(String(chatId));
        stmtInsertLog.run(
          String(chatId),
          customer?.id || null,
          String(chatId),
          'out',
          'manual',
          text,
          JSON.stringify({
            source: 'userbot',
            outcome: 'sent',
            telegram_message_id: messageId,
            via_attempt: viaAttempt,
            order_id: req.body?.order_id || null,
            auto: isAuto,
          }),
        );
      } catch (logErr) {
        console.error('[userbot] failed to log success:', logErr?.message);
      }
    });
    return;
  } catch (err) {
    const rawError = err?.errorMessage || err?.message || String(err);
    const errorText = redactSecrets(rawError);
    console.error('[userbot] sendMessage error:', errorText);

    // Detect FloodWait: Telegram анти-спам. Семантика разная у GramJS-
    // версий, ловим оба варианта (err.seconds или строка FLOOD_WAIT_N).
    let floodWaitSec = 0;
    if (typeof err?.seconds === 'number' && err.seconds > 0) {
      floodWaitSec = err.seconds;
    } else {
      const m = rawError.match(/FLOOD(?:_WAIT)?[_\s]+(\d+)/i);
      if (m) floodWaitSec = Number(m[1]);
    }
    if (floodWaitSec > 0) {
      const capped = Math.min(floodWaitSec, FLOOD_WAIT_CAP_SEC);
      floodWaitUntil = Date.now() + capped * 1000;
      const ctx = { chat_id: chatId, seconds: floodWaitSec, capped, order_id: req.body?.order_id || null };
      logEvent('flood', ctx);
      console.warn(`[userbot] FLOOD_WAIT ${floodWaitSec}s (cap=${capped}s)`);
    }

    // Detect dead session: после первого AUTH_KEY_UNREGISTERED помечаем
    // сессию как мёртвую — /health начнёт возвращать ok=false, и api-
    // процесс перестанет дёргать userbot до его перезапуска с новой
    // сессией (см. docs/userbot-mtproto.md «Если Telegram разлогинит»).
    if (!sessionDead && looksLikeSessionDead(rawError)) {
      sessionDead = true;
      sessionDeadReason = errorText;
      logEvent('session_dead', { chat_id: chatId, error: errorText });
      console.error(
        '[userbot] СЕССИЯ МЁРТВАЯ:',
        errorText,
        '— /health будет возвращать ok=false. ',
        'Останови процесс, удали data/userbot.session, пройди login заново.',
      );
    }
    // Логируем неудачу — пусть в журнале админки видно что попытка была.
    // setImmediate, чтобы не блокировать ответ HTTP клиенту.
    const isAuto = req.body?.auto === true;
    setImmediate(() => {
      try {
        const chatId = String(req.body?.chat_id || '');
        const customer = stmtFindCustomer.get(chatId);
        stmtInsertLog.run(
          chatId,
          customer?.id || null,
          chatId,
          'out',
          'manual',
          String(req.body?.text || ''),
          JSON.stringify({
            source: 'userbot',
            outcome: 'failed',
            error: errorText,
            flood_wait_seconds: floodWaitSec || undefined,
            order_id: req.body?.order_id || null,
            auto: isAuto,
          }),
        );
      } catch (logErr) {
        console.error('[userbot] failed to log failure:', logErr?.message);
      }
    });

    // FloodWait → 429 (auto-notify обработает как unreachable).
    // Сессия мёртвая → 503 (userbot нерабочий до restart, business-mode fallback).
    // Прочее → 502 (общая ошибка).
    if (floodWaitSec > 0) {
      return res.status(429).json({
        ok: false,
        error: 'flood_wait',
        retry_after_seconds: floodWaitSec,
      });
    }
    if (sessionDead) {
      return res.status(503).json({ ok: false, error: 'session_dead' });
    }
    res.status(502).json({ ok: false, error: errorText });
  }
});

const httpServer = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[userbot] HTTP API listens on 127.0.0.1:${PORT}`);
});

// ---------------------------------------------------------------------------
// Self-watchdog: страхует от залипания GramJS update-loop.
//
// Контекст инцидента 20.05.2026: после флапа MTProto GramJS успешно
// «реконнектнулся» (Started reconnecting → Handling reconnect!), но
// _updateLoop повис с бесконечными `Error: TIMEOUT` от getDifference.
// Процесс PM2 видел как online, /health отдавал connected=false, никто
// сам процесс не убивал — зависание длилось ~3 часа, пока его не
// заметили вручную. Внешний cron-watchdog (ops/userbot-watchdog.sh)
// в тот момент не был зарегистрирован в crontab.
//
// Этот in-process watchdog независим от внешнего cron: каждые 60 секунд
// проверяет client.connected и sessionDead. Если соединение мёртвое
// дольше CONNECTION_DEAD_AFTER_MS — инициирует graceful shutdown,
// PM2 поднимет процесс заново (autorestart=true).
//
// Защита in-depth: даже если cron слетит снова, процесс сам себя
// подлечит максимум через 6 минут вместо неопределённого зависания.
// ---------------------------------------------------------------------------
const SELF_WATCHDOG_INTERVAL_MS = 60 * 1000;
const CONNECTION_DEAD_AFTER_MS = 5 * 60 * 1000; // 5 минут подряд connected=false → exit
let connectionDeadSince = 0;
const selfWatchdogTimer = setInterval(() => {
  if (shuttingDown) return;
  // Сессия отозвана — спокойно выходим, /health уже отдаёт ok=false,
  // PM2 поднимет, но без валидной сессии оно опять упадёт. Это лучше
  // чем висеть молча: оператор увидит цикл рестартов в pm2 status.
  if (sessionDead) {
    console.error('[userbot][self-watchdog] session_dead → exit для PM2-рестарта');
    logEvent('self_watchdog_exit', { reason: 'session_dead' });
    shutdown('self-watchdog-session-dead').catch(() => process.exit(1));
    return;
  }
  const now = Date.now();
  if (client.connected) {
    connectionDeadSince = 0;
    return;
  }
  // FloodWait — не считаем мёртвым соединением. GramJS внутри ждёт окно
  // и client.connected может быть false по архитектуре, без зависания.
  if (floodWaitUntil > now) {
    connectionDeadSince = 0;
    return;
  }
  if (connectionDeadSince === 0) {
    connectionDeadSince = now;
    console.warn('[userbot][self-watchdog] client.connected=false, начинаю отсчёт');
    return;
  }
  const deadFor = now - connectionDeadSince;
  if (deadFor >= CONNECTION_DEAD_AFTER_MS) {
    console.error(
      `[userbot][self-watchdog] client.connected=false уже ${Math.round(deadFor / 1000)}с → exit для PM2-рестарта`,
    );
    logEvent('self_watchdog_exit', {
      reason: 'connection_dead',
      dead_for_ms: deadFor,
    });
    shutdown('self-watchdog-connection-dead').catch(() => process.exit(1));
  }
}, SELF_WATCHDOG_INTERVAL_MS);
selfWatchdogTimer.unref?.();

// Корректный shutdown по SIGTERM (PM2 reload) и SIGINT (Ctrl+C).
//
// Защита от двойного вызова: PM2 шлёт SIGTERM, потом через kill_timeout
// (по умолчанию 1.6с) — SIGKILL. Если первая попытка disconnect долгая,
// а второй сигнал прилетает — игнорируем, чтобы не плодить параллельные
// disconnect()-вызовы (GramJS на double-disconnect ловит unhandled rejection).
// shuttingDown объявлен выше (рядом с prefetchDialogs) — он там нужен,
// чтобы prefetchDialogs ранним выходом избегал гонок при shutdown.
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[userbot] shutdown by ${signal}...`);
  // 1) Закрываем HTTP listener — новых /send-message не примем, текущие
  //    дорабатывают (их обычно <1с, кроме залипшего FloodWait).
  try {
    await new Promise((resolve) => httpServer.close(() => resolve()));
  } catch (err) {
    console.error('[userbot] http close error:', redactSecrets(err?.message || err));
  }
  // 2) Отключаемся от Telegram. Жёсткий timeout 5с: GramJS иногда залипает
  //    на disconnect, если соединение висит — нет смысла блокировать PM2,
  //    он всё равно через kill_timeout отправит SIGKILL.
  try {
    await Promise.race([
      client.disconnect(),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch (err) {
    console.error('[userbot] disconnect error:', redactSecrets(err?.message || err));
  }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Diagnostic guards: если рантайм-ошибка долетела сюда — её причина важна
// для дебага. Не перезапускаем сами, PM2 это сделает (autorestart=true).
process.on('uncaughtException', (err) => {
  console.error('[userbot] uncaughtException:', redactSecrets(err?.stack || err));
  // В неопределённом состоянии оставаться хуже, чем потерять секунду на
  // PM2-перезапуск — инициируем shutdown.
  shutdown('uncaughtException').catch(() => process.exit(1));
});
process.on('unhandledRejection', (reason) => {
  console.error('[userbot] unhandledRejection:', redactSecrets(reason?.stack || reason));
  // Promise rejection обычно менее опасен, чем uncaught throw — логируем
  // и продолжаем работу. Если их штормит, PM2 max_restarts отловит.
});
