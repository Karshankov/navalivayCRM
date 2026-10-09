# Userbot Structured Event Logging

## Overview

Userbot (`server/userbot/index.js`) logs all key events in a structured JSON format to stdout (PM2 logs). This allows easy filtering, grepping, and debugging across sessions.

Each line is a valid JSON object with at least `ev` (event type) and `ts` (ISO timestamp).

## Quick Filter

```bash
# Last 1000 lines, structured events only
./ops/prod.sh logs userbot | grep '{"ev"'

# Ещё один снимок последних строк
./ops/prod.sh logs userbot | grep '{"ev"'

# Filter by event type
./ops/prod.sh logs userbot | grep '"ev":"flood"'
./ops/prod.sh logs userbot | grep '"ev":"send"'
```

## Event Types

### `send` — Message send attempt/result

```json
{"ev":"send","ts":"2026-05-15T16:51:00.000Z","outcome":"sent","attempt":1,"chat_id":"123456","order_id":"order_abc","msg_id":9876}
{"ev":"send","ts":"2026-05-15T16:51:00.000Z","outcome":"failed","attempt":0,"chat_id":"123456","order_id":"order_abc","error":"entity_not_found_no_dialog"}
{"ev":"send","ts":"2026-05-15T16:51:00.000Z","outcome":"attempt","attempt":2,"chat_id":"123456","order_id":"order_abc"}
{"ev":"send","ts":"2026-05-15T16:51:00.000Z","outcome":"failed","attempt":2,"chat_id":"123456","order_id":"order_abc","error":"..."}
```

| Field | Values | Meaning |
|-------|--------|---------|
| `outcome` | `sent`, `failed`, `attempt` | Result or intermediary step |
| `attempt` | `1`, `2`, `3`, `0` | 1=GramJS cache, 2=stored access_hash, 3=prefetchDialogs, 0=all failed |
| `chat_id` | string | Telegram user ID |
| `order_id` | string or null | Order ID from request |
| `msg_id` | number | Telegram message ID (only on success) |
| `error` | string | Error description (only on failure) |

### `flood` — FloodWait rate limit

```json
{"ev":"flood","ts":"2026-05-15T16:51:00.000Z","chat_id":"123456","seconds":30,"capped":30,"order_id":"order_abc"}
```

| Field | Meaning |
|-------|---------|
| `seconds` | Raw FloodWait seconds from Telegram |
| `capped` | Capped value (`FLOOD_WAIT_CAP_SEC = 1800`) |

When flood hits, `floodWaitUntil` is set globally, blocking ALL `send-message` requests until expiry.

### `blocked` — CRM block prevented send

```json
{"ev":"blocked","ts":"...","chat_id":"123456","order_id":"order_abc"}
```

Fired when the customer has an active CRM block. Userbot returns 403 without sending.

### `resolve` — /resolve-username result

```json
{"ev":"resolve","ts":"...","username":"someuser","outcome":"ok","telegram_id":"123456"}
{"ev":"resolve","ts":"...","username":"someuser","outcome":"not_found"}
```

Currently `RESOLVE_USERNAME_ENABLED = true`. Endpoint сверяет найденный аккаунт
с ожидаемым Telegram ID и не сохраняет entity при несовпадении.

### `session_dead` — Telegram session invalidated

```json
{"ev":"session_dead","ts":"...","chat_id":"123456","error":"AUTH_KEY_UNREGISTERED"}
```

Session needs to be re-created: delete `data/userbot.session`, re-run login.

### `send_error` — Non-Flood, non-session error in send-message

```json
{"ev":"send_error","ts":"...","chat_id":"123456","error":"...","order_id":"order_abc"}
```

## Send Attempt Chain

The userbot tries 3 ways to find a recipient before giving up:

1. **Attempt 1**: `client.sendMessage(BigInt(chatId))` — entity in GramJS in-memory cache
2. **Attempt 2**: `Api.InputPeerUser` from stored `access_hash` in `userbot_entities` table
3. **Attempt 3**: `prefetchDialogs()` + retry — refreshes dialog cache from Telegram

If all 3 fail: → `entity_not_found_no_dialog` (no dialog exists, message not sent).

Attempt 4 (`contacts.resolveUsername`) was removed — was causing FloodWait cascade that blocked ALL sends.

## Rate Limits

| Guard | Scope | Details |
|-------|-------|---------|
| `floodWaitUntil` | Global (send-message) | Set on any FloodWait from send-message. Blocks all sends until expiry. |
| `RESOLVE_USERNAME_ENABLED` | resolve-username only | `true`; при новом FloodWait выключается вручную, не блокируя обычные отправки. |
| `FLOOD_WAIT_CAP_SEC` | 1800s (30 min) | Caps any FloodWait to prevent multi-hour blocks. |

## Logged in parallel to bot_message_log DB

Events also logged into `bot_message_log` table (via `stmtInsertLog`) with:
- `outcome`: `sent`, `failed`
- `source`: `userbot`
- `via_attempt`: which attempt succeeded (1-3)
- `order_id`, `auto` flags in `meta` JSON

## Frontend event log

Auto-notify skips (`new_customer_no_dialog`, `customer_blocked`, etc.) are logged to `bot_message_log` from `server/utils/auto-notify.js`. The userbot JSON events cover the actual send attempt (after eligibility passes).

## ResolveUsername Ban Incident (15.05.2026 — закрыт 16.05.2026)

> **Статус:** разбан подтверждён 16.05.2026 ~18:18 (Минск). Тест `@nvl_vapebot` → `outcome:"ok"`, реальные резолвы при создании заказов идут без FLOOD. Прошло ~25 часов от инцидента (15.05 ~17:00 → 16.05 ~18:18). `RESOLVE_USERNAME_ENABLED = true`.

### Как это произошло

**Telegram API `contacts.ResolveUsername`** — единственный способ отправить сообщение пользователю, с которым у менеджера нет диалога. Он принимает `@username` и возвращает `access_hash`, после чего можно слать через `InputPeerUser`. Это нужно для авто-уведомлений новым клиентам, которые только создали заказ через MiniApp и ни разу не писали менеджеру.

**15.05.2026** в попытке решить проблему entity_not_found, разработчик добавил **проактивный резолв 200 username'ов** при старте юзербота (batch seed). Telegram расценил это как спам-активность и наложил FloodWait на `contacts.ResolveUsername` на аккаунте @Rez0nsky. Длительность: ~21 час (типичная блокировка на нейросети-эвристике). Возвращаемая ошибка: `FLOOD_WAIT_77694` (примерно 21 час).

**Проблема:** FloodWait на resolveUsername НЕ изолирован в Telegram — в GramJS он выглядит как общая ошибка. Userbot устанавливал глобальный `floodWaitUntil`, который БЛОКИРОВАЛ ВСЕ `sendMessage`, даже те, что не требуют resolveUsername (для клиентов с уже закэшированной entity).

### Цикл катастрофы (до исправления)

```
1. Менеджер меняет статус → auto-notify запускается
2. send-message не находит entity → attempt 1-3 failing
3. attempt 4: resolveUsername(@username) → FLOOD от Telegram
4. userbot выставляет floodWaitUntil на 30 мин (cap)
5. Все send-message блокируются (даже для клиентов в кэше)
6. Через 30 мин floodWaitUntil истекает
7. Очередное auto-notify → снова attempt 4 → снова FLOOD
8. → бесконечный цикл
```

Каждые 30 минут — блокировка на 30 минут. Авто-уведомления НЕ работали вообще для всех клиентов, даже для постоянных с entity в кэше.

### Что было сделано (лечение)

1. **Удалена attempt 4** из send-message handler (15.05.2026 17:00)
   - resolveUsername больше не вызывается при отправке
   - sendMessage теперь использует только 1 (cache) → 2 (access_hash) → 3 (prefetch)
   - Разрыв цикла: send-message больше не триггерит FloodWait

2. **/resolve-username endpoint decoupled**
   - Ранее: при FloodWait выставлял глобальный `floodWaitUntil`, блокируя send-message
   - Теперь: возвращает 429 без изменения `floodWaitUntil`
   - Только resolveUsername блокируется сам для себя, send-message не страдает

3. **RESOLVE_USERNAME_ENABLED = false**
   - Все вызовы contacts.ResolveUsername отключены до ручного включения
   - Флаг в `server/userbot/index.js` (глобальная переменная module-level)
   - Даже если кто-то дёрнет /resolve-username — вернёт 503 без обращения к Telegram

4. **FLOOD_WAIT_CAP_SEC = 1800**
   - Кап в 30 минут защищает от повторных многотысячных FloodWait
   - Применяется в send-message outer catch и warmupMessageCounts

### Как разбанить и включить (исторически — для следующего инцидента)

> Текущее состояние: `RESOLVE_USERNAME_ENABLED = true` с 16.05.2026. Раздел оставлен как чек-лист на случай повторного бана.

```bash
# 1. Изменить флаг в server/userbot/index.js
#    RESOLVE_USERNAME_ENABLED = false → true (около строки 98)

# 2. Перезапустить userbot
ssh NavalivayNew "cd /var/www/NAVALIVAY && ./ops/prod.sh restart userbot"

# 3. Проверить, что всё работает
./ops/prod.sh logs userbot | grep '{"ev":"resolve"'
# Должен появиться {"ev":"resolve","outcome":"ok",...}

# 4. Создать тестовый заказ на новом клиенте (без диалога) и проверить
#    авто-уведомление. Если снова FLOOD — выключить обратно и ждать ещё.
```

### Когда разбан

Telegram обычно снимает rate-limit на resolveUsername через 24-48 часов для редко используемых функций. @Rez0nsky — аккаунт с Telegram Premium (менеджер Константин), что даёт чуть более мягкие лимиты, но не immunity.

Ожидаемое время: ~17.05.2026 (через ~2 дня от 15.05.2026).

**Не пытаться проверить раньше!** Каждый вызов resolveUsername в период блокировки:
- Ест лимит пропускной способности аккаунта
- Может продлить блокировку (Telegram видит «продолжает спамить»)
- Рискует перевести лёгкий FloodWait в постоянный бан resolveUsername для аккаунта

### Как работает без resolveUsername (сейчас)

967 entity в кэше GramJS из userbot_entities + seed при старте.
~791 диалог в кэше (топ-700 + 91 архивных).
Все клиенты, кто когда-либо писал менеджеру или был отрезолвлен ранее — обслуживаются через attempt 1-3.
Автоуведомления разрешены сразу после успешной реферальной авторизации, даже
если у клиента ещё нет выданных заказов. Получатель всегда выбирается по
Telegram ID. Актуальный username используется только для безопасной подготовки
`access_hash`; найденный через username Telegram ID обязан совпасть с ID клиента.

Если обязательная авторизация выключена, сохраняется старый порог: до первого
выданного заказа автоматические сообщения не отправляются. Общий бан запрещает
сообщения, отдельный запрет приглашать на сообщения не влияет.
