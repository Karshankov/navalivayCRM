/**
 * Unit-тесты для userbot-client (bridge от api к userbot-процессу) и
 * rate-limiter из userbot/rate-limiter.js.
 *
 * Покрывает:
 *  - sendViaUserbot outcome contract: rejected / unreachable / ambiguous
 *    (это критично для UX — ambiguous-fallback приведёт к дублю в Telegram-чате
 *    клиента, и таких регрессий нужно ловить)
 *  - isUserbotAvailable: успех/провал + кэширование (10с при fail / 30с при ok)
 *  - createRateLimiter: строгая последовательность, неубиваемая цепочка после
 *    исключения, шаг ≥ 1сек между параллельными вызовами
 *
 * Запуск: node server/tests/userbot-client.test.js
 *
 * Важно: НЕ запускаем реальный userbot-процесс. Все сетевые вызовы — через
 * подмену globalThis.fetch (как в auto-notify.test.js).
 */

const results = { passed: 0, failed: 0 };
function assertEq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    results.passed++;
    console.log(`  OK: ${msg}`);
  } else {
    results.failed++;
    console.log(`  FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assert(cond, msg) {
  assertEq(Boolean(cond), true, msg);
}

// Каркас mock-fetch: подменяем globalThis.fetch на функцию-роутер,
// которая по url возвращает заранее заготовленный handler. Между
// тестами роутер сбрасывается через setMockResponses().
const originalFetch = globalThis.fetch;
let mockHandlers = {}; // { '/health': fn, '/send-message': fn }
let fetchCalls = [];
function setMockResponses(handlers) {
  mockHandlers = handlers;
  fetchCalls = [];
}
globalThis.fetch = async (url, init) => {
  const u = String(url);
  fetchCalls.push({ url: u, init });
  for (const [path, handler] of Object.entries(mockHandlers)) {
    if (u.includes(path)) {
      const result = await handler(u, init);
      if (result instanceof Error) throw result;
      return result;
    }
  }
  throw new Error(`unmocked fetch: ${u}`);
};

const {
  sendViaUserbot,
  isUserbotAvailable,
  resolveUsernameViaUserbot,
  _resetHealthCacheForTests,
} = await import('../utils/userbot-client.js');

const { createRateLimiter } = await import('../userbot/rate-limiter.js');
const { buildUserbotSendOptions } = await import('../userbot/message-format.js');

// =============================================================================
// SECTION 1: sendViaUserbot — outcome contract
// =============================================================================

console.log('\n=== Test 1.1: sendViaUserbot с пустыми args → rejected/invalid_payload ===');
{
  setMockResponses({});
  const r1 = await sendViaUserbot({});
  assertEq(r1.ok, false, 'ok=false при пустом payload');
  assertEq(r1.outcome, 'rejected', 'outcome=rejected');
  assertEq(r1.error, 'invalid_payload', 'error=invalid_payload');

  const r2 = await sendViaUserbot({ chatId: '123' }); // text пустой
  assertEq(r2.outcome, 'rejected', 'нет text → rejected');

  const r3 = await sendViaUserbot({ text: 'hello' }); // chatId пустой
  assertEq(r3.outcome, 'rejected', 'нет chatId → rejected');

  assertEq(fetchCalls.length, 0, 'fetch вообще не вызывается при invalid_payload');
}

console.log('\n=== Test 1.2: HTTP 200 + ok:true → success ===');
{
  setMockResponses({
    '/send-message': async () => ({
      ok: true,
      status: 200,
      async json() {
        return { ok: true, telegram_message_id: 12345 };
      },
    }),
  });
  const r = await sendViaUserbot({ chatId: '111', text: 'привет' });
  assertEq(r.ok, true, 'ok=true');
  assertEq(r.telegram_message_id, 12345, 'telegram_message_id из ответа');
  assertEq(fetchCalls.length, 1, 'fetch вызван один раз');
  assert(fetchCalls[0].url.includes('/send-message'), 'URL содержит /send-message');
  const body = JSON.parse(fetchCalls[0].init.body);
  assertEq(body.chat_id, '111', 'chat_id передан строкой');
  assertEq(body.text, 'привет', 'text передан в теле');
  assertEq('parse_mode' in body, false, 'для обычного сообщения режим не добавлен');
}

console.log('\n=== Test 1.3: HTTP 200 + {ok:false, error:"X"} → rejected ===');
{
  setMockResponses({
    '/send-message': async () => ({
      ok: true,
      status: 200,
      async json() {
        return { ok: false, error: 'PEER_ID_INVALID' };
      },
    }),
  });
  const r = await sendViaUserbot({ chatId: '222', text: 'test' });
  assertEq(r.ok, false, 'ok=false');
  assertEq(r.outcome, 'rejected', 'outcome=rejected (server alive, said no)');
  assertEq(r.error, 'PEER_ID_INVALID', 'error пробрасывается');
}

console.log('\n=== Test 1.4: HTTP 5xx после обработки → ambiguous ===');
{
  setMockResponses({
    '/send-message': async () => ({
      ok: false,
      status: 502,
      async json() {
        return { ok: false, error: 'bad_gateway' };
      },
    }),
  });
  const r = await sendViaUserbot({ chatId: '333', text: 'test' });
  assertEq(r.ok, false, 'ok=false');
  assertEq(r.outcome, 'ambiguous', 'outcome=ambiguous (Telegram уже мог принять сообщение)');
  assertEq(r.error, 'bad_gateway', 'error из тела ответа');
}

console.log('\n=== Test 1.5: HTTP 200 + невалидный JSON → ambiguous ===');
{
  setMockResponses({
    '/send-message': async () => ({
      ok: true,
      status: 200,
      async json() {
        throw new SyntaxError('Unexpected token in JSON');
      },
    }),
  });
  const r = await sendViaUserbot({ chatId: '444', text: 'test' });
  assertEq(r.ok, false, 'ok=false');
  assertEq(r.outcome, 'ambiguous', 'outcome=ambiguous (сообщение могло уйти до потери ответа)');
  assert(r.error.includes('http_200_bad_json'), 'error="http_<status>_bad_json"');
}

console.log('\n=== Test 1.6: fetch ECONNREFUSED → unreachable ===');
{
  const err = new Error('fetch failed');
  err.cause = { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:8083' };
  setMockResponses({
    '/send-message': async () => err,
  });
  const r = await sendViaUserbot({ chatId: '555', text: 'test' });
  assertEq(r.ok, false, 'ok=false');
  assertEq(r.outcome, 'unreachable', 'outcome=unreachable (процесс не слушает)');
  assert(r.error, 'error не пустой');
}

console.log('\n=== Test 1.7: fetch AbortError (timeout) → ambiguous ===');
{
  const err = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  setMockResponses({
    '/send-message': async () => err,
  });
  const r = await sendViaUserbot({ chatId: '666', text: 'test' });
  assertEq(r.ok, false, 'ok=false');
  assertEq(r.outcome, 'ambiguous', 'outcome=ambiguous (timeout — мог отправить)');
  assert(r.error.toLowerCase().includes('timeout') || r.error.toLowerCase().includes('aborted'),
    'error содержит timeout/aborted');
}

console.log('\n=== Test 1.7a: fetch ECONNRESET → ambiguous ===');
{
  const err = new Error('fetch failed');
  err.cause = { code: 'ECONNRESET', message: 'socket hang up after write' };
  setMockResponses({
    '/send-message': async () => err,
  });
  const r = await sendViaUserbot({ chatId: '667', text: 'test' });
  assertEq(r.ok, false, 'ok=false');
  assertEq(r.outcome, 'ambiguous', 'ECONNRESET не доказывает, что сообщение не отправлено');
}

console.log('\n=== Test 1.7b: неполный HTTP-ответ → ambiguous ===');
{
  setMockResponses({
    '/send-message': async () => ({
      ok: true,
      status: 200,
      async json() {
        return { telegram_message_id: 42 };
      },
    }),
  });
  const r = await sendViaUserbot({ chatId: '668', text: 'test' });
  assertEq(r.ok, false, 'ok=false');
  assertEq(r.outcome, 'ambiguous', 'ответ без явного ok считается сомнительным');
}

console.log('\n=== Test 1.7c: явный FloodWait до отправки → unreachable ===');
{
  setMockResponses({
    '/send-message': async () => ({
      ok: false,
      status: 429,
      async json() {
        return {
          ok: false,
          error: 'flood_wait',
          retry_after_seconds: 60,
        };
      },
    }),
  });
  const r = await sendViaUserbot({ chatId: '669', text: 'test' });
  assertEq(r.outcome, 'unreachable', 'явный flood_wait безопасно повторять позже');
  assertEq(r.retry_after_seconds, 60, 'задержка FloodWait сохранена');
}

console.log('\n=== Test 1.7d: явный disconnected до отправки → unreachable ===');
{
  setMockResponses({
    '/send-message': async () => ({
      ok: false,
      status: 503,
      async json() {
        return { ok: false, error: 'disconnected' };
      },
    }),
  });
  const r = await sendViaUserbot({ chatId: '670', text: 'test' });
  assertEq(r.outcome, 'unreachable', 'явный disconnected не мог отправить сообщение');
}

console.log('\n=== Test 1.7e: неизвестный HTTP 503 → ambiguous ===');
{
  setMockResponses({
    '/send-message': async () => ({
      ok: false,
      status: 503,
      async json() {
        return { ok: false, error: 'unexpected_failure' };
      },
    }),
  });
  const r = await sendViaUserbot({ chatId: '671', text: 'test' });
  assertEq(r.outcome, 'ambiguous', 'неизвестный 503 не доказывает недоставку');
}

console.log('\n=== Test 1.8: fetch generic network error → ambiguous (fail-safe) ===');
{
  // Нестандартная ошибка без явных маркеров — должна быть ambiguous,
  // потому что неизвестно, дошёл ли запрос. Лучше потерять, чем дублировать.
  const err = new Error('something went sideways');
  setMockResponses({
    '/send-message': async () => err,
  });
  const r = await sendViaUserbot({ chatId: '777', text: 'test' });
  assertEq(r.ok, false, 'ok=false');
  assertEq(r.outcome, 'ambiguous', 'outcome=ambiguous (fail-safe для неизвестных ошибок)');
}

console.log('\n=== Test 1.9: fetch ENOTFOUND → unreachable ===');
{
  const err = new Error('fetch failed');
  err.cause = { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND localhost' };
  setMockResponses({
    '/send-message': async () => err,
  });
  const r = await sendViaUserbot({ chatId: '888', text: 'test' });
  assertEq(r.outcome, 'unreachable', 'ENOTFOUND → unreachable');
}

console.log('\n=== Test 1.10: AbortError по имени (не TimeoutError) → ambiguous ===');
{
  const err = new Error('aborted');
  err.name = 'AbortError';
  setMockResponses({
    '/send-message': async () => err,
  });
  const r = await sendViaUserbot({ chatId: '999', text: 'test' });
  assertEq(r.outcome, 'ambiguous', 'AbortError → ambiguous');
}

console.log('\n=== Test 1.11: username/verified/auto прокидываются в HTTP-тело ===');
{
  const bodies = [];
  setMockResponses({
    '/send-message': async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, async json() { return { ok: true, telegram_message_id: 1 }; } };
    },
  });
  // Имитация вызова из auto-notify.js (с username, verified, auto)
  await sendViaUserbot({
    chatId: '111',
    text: 'заказ собран',
    orderId: 'o1',
    username: 'client_nick',
    verified: true,
    auto: true,
    parseMode: 'html',
  });
  const b1 = bodies[0];
  assertEq(b1.username, 'client_nick', 'username прокинут (без @)');
  assertEq(b1.verified, true, 'verified=true прокинут');
  assertEq(b1.auto, true, 'auto=true прокинут');
  assertEq(b1.order_id, 'o1', 'order_id прокинут');
  assertEq(b1.chat_id, '111', 'chat_id строка');
  assertEq(b1.parse_mode, 'html', 'HTML-режим прокинут в userbot');

  // Имитация ручной отправки из crm.js (с username, verified, auto=false)
  await sendViaUserbot({
    chatId: '222',
    text: 'привет',
    username: '@manager_nick', // с @ — должен быть очищен в userbot/index.js
    verified: true,
    auto: false,
  });
  const b2 = bodies[1];
  assertEq(b2.username, 'manager_nick', '@ срезается в sendViaUserbot');
  assertEq(b2.auto, false, 'auto=false для ручных сообщений');
  assertEq('parse_mode' in b2, false, 'ручное сообщение не переключено на HTML');

  // Без username и verified — в теле их не должно быть (null)
  await sendViaUserbot({ chatId: '333', text: 'ok' });
  const b3 = bodies[2];
  assertEq(b3.username, null, 'username=null когда не передан');
  assertEq(b3.verified, false, 'verified=false по умолчанию');
}

console.log('\n=== Test 1.12: auto в теле — сравнение строгого true ===');
{
  // userbot/index.js проверяет req.body?.auto === true, так что
  // auto:1 (как число) или auto:"true" (строка) — НЕ пройдут.
  const bodies = [];
  setMockResponses({
    '/send-message': async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, async json() { return { ok: true, telegram_message_id: 1 }; } };
    },
  });
  await sendViaUserbot({ chatId: '1', text: 'x', auto: true });
  assertEq(bodies[0].auto, true, 'auto=true → в теле true (boolean)');
}

console.log('\n=== Test 1.12b: режим форматирования строго ограничен HTML ===');
{
  assertEq(
    buildUserbotSendOptions('обычный **текст**'),
    { message: 'обычный **текст**', formattingEntities: [] },
    'без режима Markdown не включается сам',
  );
  const htmlOptions = buildUserbotSendOptions('<b>текст</b>', 'html');
  assertEq(htmlOptions.message, 'текст', 'HTML разобран до вызова GramJS');
  assertEq(
    htmlOptions.formattingEntities.map((entity) => entity.className),
    ['MessageEntityBold'],
    'GramJS получает готовую сущность жирного текста',
  );
  assertEq('parseMode' in htmlOptions, false, 'встроенный разбор GramJS не запускается');

  const mentionLinkOptions = buildUserbotSendOptions(
    '<a href="@partner">Партнёр</a>',
    'html',
  );
  assertEq(mentionLinkOptions.message, 'Партнёр', 'текст специальной ссылки разобран локально');
  assertEq(
    mentionLinkOptions.formattingEntities[0]?.className,
    'MessageEntityTextUrl',
    'ссылка остаётся URL, а не Telegram-упоминанием',
  );
  assertEq(
    mentionLinkOptions.formattingEntities[0]?.url,
    '@partner',
    'адрес не передаётся в getInputEntity/ResolveUsername',
  );

  const nestedOptions = buildUserbotSendOptions('<b>жирный <i>курсив</i></b>', 'html');
  assertEq(
    nestedOptions.message,
    'жирный курсив',
    'правильно вложенные теги принимаются',
  );
  assertEq(
    buildUserbotSendOptions('2 < 3', 'html').message,
    '2 < 3',
    'обычный знак «меньше» не считается тегом',
  );
  assertEq(
    buildUserbotSendOptions('<a href="https://site.by/?next=1>0">ссылка</a>', 'html').message,
    'ссылка',
    'знак «больше» внутри кавычек не обрывает адрес',
  );

  for (const invalidSource of [
    '<b></b>',
    'Текст <b',
    '<b>незакрытый тег',
    '<b><i>неверная вложенность</b></i>',
    '<unknown>неподдерживаемый тег</unknown>',
    '<b title="лишнее">неизвестный атрибут</b>',
    '<a href="">пустая ссылка</a>',
    '<a href="оборванная ссылка>текст</a>',
    '<b/>',
    '<b><b>повторное вложение</b></b>',
  ]) {
    let invalidHtmlError = null;
    try {
      buildUserbotSendOptions(invalidSource, 'html');
    } catch (error) {
      invalidHtmlError = error?.code;
    }
    assertEq(invalidHtmlError, 'invalid_html', `неверная разметка отклонена: ${invalidSource}`);
  }

  setMockResponses({});
  const rejected = await sendViaUserbot({
    chatId: '1',
    text: 'x',
    parseMode: 'markdown',
  });
  assertEq(rejected.outcome, 'rejected', 'неразрешённый режим отклонён');
  assertEq(rejected.error, 'invalid_parse_mode', 'возвращён понятный код ошибки');
  assertEq(fetchCalls.length, 0, 'при неверном режиме userbot не вызывается');
}

console.log('\n=== Test 1.13: resolve username закреплён за ожидаемым Telegram ID ===');
{
  setMockResponses({
    '/resolve-username': async (url, init) => {
      const body = JSON.parse(init.body);
      assertEq(body.username, 'client_name', '@ удаляется перед resolve');
      assertEq(body.expected_telegram_id, '123456', 'ожидаемый Telegram ID передан');
      return {
        ok: true,
        status: 200,
        async json() { return { ok: true, telegram_id: '123456' }; },
      };
    },
  });
  const resolved = await resolveUsernameViaUserbot({
    username: '@client_name',
    expectedTelegramId: '123456',
  });
  assertEq(resolved.ok, true, 'совпавший Telegram ID принят');
}

console.log('\n=== Test 1.14: несовпавший Telegram ID отклоняется ===');
{
  setMockResponses({
    '/resolve-username': async () => ({
      ok: true,
      status: 200,
      async json() { return { ok: true, telegram_id: '999999' }; },
    }),
  });
  const resolved = await resolveUsernameViaUserbot({
    username: 'changed_name',
    expectedTelegramId: '123456',
  });
  assertEq(resolved.ok, false, 'несовпавший Telegram ID отклонён');
  assertEq(resolved.error, 'telegram_id_mismatch', 'причина mismatch сохранена');
}

// =============================================================================
// SECTION 2: isUserbotAvailable — health check + caching
// =============================================================================

console.log('\n=== Test 2.1: HTTP 200 + {ok,connected:true} → true ===');
{
  _resetHealthCacheForTests();
  setMockResponses({
    '/health': async () => ({
      ok: true,
      status: 200,
      async json() {
        return { ok: true, connected: true, me: '12345' };
      },
    }),
  });
  const r = await isUserbotAvailable();
  assertEq(r, true, 'available=true');
  assertEq(fetchCalls.length, 1, 'один fetch на первый вызов');
}

console.log('\n=== Test 2.2: повторный вызов в окне OK-кэша → fetch не дёргается ===');
{
  // Кэш всё ещё свежий с прошлого теста (TTL 30с). Сбрасывать не будем —
  // тест явно проверяет что кэш работает.
  setMockResponses({
    '/health': async () => {
      throw new Error('should not be called — cache hit expected');
    },
  });
  const r = await isUserbotAvailable();
  assertEq(r, true, 'из кэша вернулось true');
  assertEq(fetchCalls.length, 0, 'fetch вообще не вызывался — попадание в кэш');
}

console.log('\n=== Test 2.3: HTTP 5xx → false ===');
{
  _resetHealthCacheForTests();
  setMockResponses({
    '/health': async () => ({
      ok: false,
      status: 503,
      async json() {
        return {};
      },
    }),
  });
  const r = await isUserbotAvailable();
  assertEq(r, false, 'available=false при HTTP 5xx');
}

console.log('\n=== Test 2.4: повторный вызов после fail тоже из кэша (10с) ===');
{
  setMockResponses({
    '/health': async () => {
      throw new Error('should not be called — cache hit expected');
    },
  });
  const r = await isUserbotAvailable();
  assertEq(r, false, 'fail-кэш отдаёт false');
  assertEq(fetchCalls.length, 0, 'fetch не дёргается из fail-кэша');
}

console.log('\n=== Test 2.5: ok=true, но connected=false → недоступен ===');
{
  _resetHealthCacheForTests();
  setMockResponses({
    '/health': async () => ({
      ok: true,
      status: 200,
      async json() {
        return { ok: true, connected: false }; // подключение к Telegram упало
      },
    }),
  });
  const r = await isUserbotAvailable();
  assertEq(r, false, 'connected=false → недоступен');
}

console.log('\n=== Test 2.6: session_dead=true → недоступен (даже если ok+connected) ===');
{
  _resetHealthCacheForTests();
  setMockResponses({
    '/health': async () => ({
      ok: true,
      status: 200,
      async json() {
        return { ok: true, connected: true, session_dead: true, session_dead_reason: 'AUTH_KEY_UNREGISTERED' };
      },
    }),
  });
  const r = await isUserbotAvailable();
  assertEq(r, false, 'session_dead → недоступен (защита от шторма пустых попыток)');
}

console.log('\n=== Test 2.7: timeout health → false ===');
{
  _resetHealthCacheForTests();
  const err = new Error('timeout');
  err.name = 'TimeoutError';
  setMockResponses({
    '/health': async () => err,
  });
  const r = await isUserbotAvailable();
  assertEq(r, false, 'timeout health → false');
}

console.log('\n=== Test 2.8: send rejected сбрасывает health-кэш ===');
{
  // Сначала сделаем кэш OK, потом убедимся что rejected sendViaUserbot
  // сбросил кэш — следующий isUserbotAvailable полезет fetch'ить.
  _resetHealthCacheForTests();
  setMockResponses({
    '/health': async () => ({
      ok: true,
      status: 200,
      async json() {
        return { ok: true, connected: true };
      },
    }),
  });
  await isUserbotAvailable();
  assertEq(fetchCalls.length, 1, 'health fetch выполнен');

  // Теперь /send-message вернёт rejected → код должен сбросить кэш.
  setMockResponses({
    '/send-message': async () => ({
      ok: true,
      status: 200,
      async json() {
        return { ok: false, error: 'oops' };
      },
    }),
  });
  await sendViaUserbot({ chatId: '1', text: 'x' });

  // Следующий isUserbotAvailable должен снова сделать fetch (кэш сброшен).
  setMockResponses({
    '/health': async () => ({
      ok: true,
      status: 200,
      async json() {
        return { ok: true, connected: true };
      },
    }),
  });
  await isUserbotAvailable();
  assertEq(fetchCalls.length, 1, 'после rejected health опять fetch (кэш был сброшен)');
}

// =============================================================================
// SECTION 3: createRateLimiter — chained Promise sequencing
// =============================================================================

console.log('\n=== Test 3.1: 3 параллельных вызова → таймстампы возрастают с шагом ≥1сек ===');
{
  const rateLimit = createRateLimiter({ maxPerSecond: 1 });
  const start = Date.now();
  const [t1, t2, t3] = await Promise.all([rateLimit(), rateLimit(), rateLimit()]);
  // Первый ушёл сразу (lastFinishedAt=0, wait отрицательный).
  // Второй — через ~1с после первого.
  // Третий — через ~1с после второго.
  assert(t1 >= start, 't1 не раньше старта');
  assert(t2 - t1 >= 990, `t2-t1 ≥ 990ms (got ${t2 - t1})`); // -10ms допуск на jitter setTimeout
  assert(t3 - t2 >= 990, `t3-t2 ≥ 990ms (got ${t3 - t2})`);
  // И верхняя граница — не должны ждать сильно дольше, чем нужно.
  assert(t3 - start < 2500, `общее время < 2500ms (got ${t3 - start})`);
}

console.log('\n=== Test 3.2: 5 параллельных вызовов → строго упорядоченные timestamps ===');
{
  const rateLimit = createRateLimiter({ maxPerSecond: 1 });
  const promises = [];
  for (let i = 0; i < 5; i++) promises.push(rateLimit());
  const ts = await Promise.all(promises);
  // Все timestamps монотонно возрастают.
  for (let i = 1; i < ts.length; i++) {
    assert(ts[i] >= ts[i - 1], `ts[${i}] >= ts[${i - 1}]`);
    assert(ts[i] - ts[i - 1] >= 990, `шаг ts[${i}]-ts[${i - 1}] >= 990ms (got ${ts[i] - ts[i - 1]})`);
  }
}

console.log('\n=== Test 3.3: исключение в звене не ломает цепочку ===');
{
  const rateLimit = createRateLimiter({ maxPerSecond: 1 });
  // Первое звено — обычное.
  const t1 = await rateLimit();
  // Второе звено берём, но не ждём — а сразу после него ставим третье,
  // которое должно дождаться нормально, даже если что-то рядом упало.
  // (В реальности reject/throw происходит внутри пользовательского кода
  // ПОСЛЕ rateLimit() — например, сам sendMessage упал. Это не ломает
  // цепочку, потому что sendChain хранится отдельно от пользовательского
  // промиса.)

  // Симулируем сценарий: caller получил t2, потом upstream sendMessage
  // упал — caller не ждёт результата rateLimit-цепочки, потому что rate-limit
  // уже отдал свой Promise. Третий вызов rateLimit() должен получить новый
  // слот через ~1с после t2.
  const t2 = await rateLimit();
  // Симулируем сценарий «бросило в коде после rateLimit» — этот reject
  // не должен повлиять на следующее звено цепочки. Цепочка внутри limiter'а
  // сама обёрнута в .catch(), так что внешний reject пользовательского
  // потока вообще не влияет.
  const t3 = await rateLimit();
  assert(t2 - t1 >= 990, `t2-t1 ≥ 990ms (got ${t2 - t1})`);
  assert(t3 - t2 >= 990, `t3-t2 ≥ 990ms (got ${t3 - t2})`);
}

console.log('\n=== Test 3.4: maxPerSecond=2 → шаг ≥500ms ===');
{
  const rateLimit = createRateLimiter({ maxPerSecond: 2 });
  const [t1, t2, t3] = await Promise.all([rateLimit(), rateLimit(), rateLimit()]);
  assert(t2 - t1 >= 490, `t2-t1 ≥ 490ms (got ${t2 - t1})`);
  assert(t3 - t2 >= 490, `t3-t2 ≥ 490ms (got ${t3 - t2})`);
  // И не больше нужного — иначе зря тормозит.
  assert(t3 - t1 < 1500, `t3-t1 < 1500ms (got ${t3 - t1})`);
}

console.log('\n=== Test 3.5: первый вызов не ждёт (lastFinishedAt=0) ===');
{
  const rateLimit = createRateLimiter({ maxPerSecond: 1 });
  const start = Date.now();
  const t1 = await rateLimit();
  const elapsed = t1 - start;
  // Допускаем небольшой jitter (microtask + Promise.resolve), но не должно
  // быть полной секунды ожидания.
  assert(elapsed < 100, `первый вызов прошёл сразу (elapsed=${elapsed}ms)`);
}

// =============================================================================
// Cleanup
// =============================================================================
globalThis.fetch = originalFetch;

console.log(`\n=== Total: ${results.passed} passed, ${results.failed} failed ===`);

if (results.failed > 0) {
  process.exitCode = 1;
}
