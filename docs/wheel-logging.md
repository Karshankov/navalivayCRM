# Wheel — Structured Event Logging

## Overview

Все ключевые события рулетки (`server/wheel/wheel-service.js` и admin
endpoints в `server/routes/wheel.js`) логируются в виде структурированного
JSON в stdout. Journald сохраняет полные строки, благодаря чему мы
можем грепать ленту фильтром `'"ev":"wheel_'`.

Формат повторяет конвенцию userbot (см. `docs/userbot-logging.md`):

- одна строка — один валидный JSON
- обязательные поля: `ev`, `ts`
- `ev` начинается с префикса `wheel_`
- `ts` — ISO-таймстамп

## Quick filter

```bash
# Последние события рулетки
./ops/prod.sh logs api | grep '"ev":"wheel_'

# Только спины
./ops/prod.sh logs api | grep '"ev":"wheel_spin"'

# Только эпические выдачи
./ops/prod.sh logs api | grep '"ev":"wheel_epic_release"'

# Действия менеджеров за день
./ops/prod.sh logs api | grep '"ev":"wheel_admin_action"'
```

## Event types

### `wheel_spin` — каждая прокрутка

Эмитится один раз на каждый успешный спин (после коммита транзакции).

```json
{"ev":"wheel_spin","ts":"...","customer_id":"cust_1","spin_id":"ws_xxx","prize_id":"wp_yyy","rarity_code":"epic","is_epic":true,"is_pity":false,"is_wholesale":false,"seed":1234567}
```

| Поле | Значение |
|------|----------|
| `customer_id` | id клиента |
| `spin_id` | id записи в `wheel_spins` |
| `prize_id` | id выпавшего приза |
| `rarity_code` | редкость |
| `is_epic` | true если эпическая выдача |
| `is_pity` | true если pity-выдача |
| `is_wholesale` | true для оптового пула |
| `seed` | seed для воспроизведения анимации |

### `wheel_epic_release` — выдача эпика

```json
{"ev":"wheel_epic_release","ts":"...","customer_id":"cust_1","prize_id":"wp_legendary","rarity_code":"legendary","pool_id":"wep_xxx","carried_over_count":4}
```

`carried_over_count` — сколько клиентов перенеслось в новый carry-over
пул на этом релизе (Q4). 0 если carry-over не сработал (например,
`max_total = 1`).

### `wheel_pool_created` — создание эпического пула

Эмитится при первом призыве `ensureActiveEpicPool` для приза или при
carry-over после релиза.

```json
{"ev":"wheel_pool_created","ts":"...","pool_id":"wep_new","prize_id":"wp_yyy","pool_size":5,"threshold_byn":300,"qualified_count":0}
{"ev":"wheel_pool_created","ts":"...","pool_id":"wep_carry","prize_id":"wp_yyy","pool_size":4,"threshold_byn":300,"qualified_count":4,"reason":"carry_over","previous_pool_id":"wep_old"}
```

`reason: "carry_over"` означает что пул создан по Q4 после релиза. Без
`reason` — обычное создание пула при первом квалифицированном клиенте.

### `wheel_pool_closed` — закрытие пула после выдачи

```json
{"ev":"wheel_pool_closed","ts":"...","pool_id":"wep_xxx","prize_id":"wp_yyy","winner_id":"cust_1","carryover_size":4}
```

### `wheel_pity_release` — pity-выдача

```json
{"ev":"wheel_pity_release","ts":"...","customer_id":"cust_1","prize_id":"wp_common","rarity_code":"common","fallback_reason":null}
```

`fallback_reason` — если пришлось скатиться на secondary/tertiary
fallback внутри `pickPityPrize` (для отслеживания плохих
конфигураций). Возможные значения: `null`, `non_elite_pool_empty`,
`no_candidates`.

### `wheel_pity_fallback` — diagnostic

Эмитится одновременно с `wheel_pity_release`, когда сработал
fallback. Помогает отлаживать сетапы где pity-логика не находит
обычных призов.

```json
{"ev":"wheel_pity_fallback","ts":"...","customer_id":"cust_1","prize_id":"wp_x","fallback_reason":"non_elite_pool_empty"}
```

### `wheel_consent_changed` — изменение consent (Q6)

```json
{"ev":"wheel_consent_changed","ts":"...","customer_id":"cust_1","consent":true}
```

`consent: true` — клиент согласился на показ имени и фото в ленте.
`consent: false` — отказался либо на первой модалке, либо в
профиле.

### `wheel_admin_action` — действия менеджера

```json
{"ev":"wheel_admin_action","ts":"...","actor_id":"admin","action":"create_prize","entity_id":"wp_xxx","payload":{...}}
{"ev":"wheel_admin_action","ts":"...","actor_id":"admin","action":"update_prize","entity_id":"wp_xxx","payload":{...}}
{"ev":"wheel_admin_action","ts":"...","actor_id":"admin","action":"delete_prize","entity_id":"wp_xxx","payload":null}
{"ev":"wheel_admin_action","ts":"...","actor_id":"admin","action":"update_settings","entity_id":null,"payload":{...}}
```

| `action` | Эндпоинт |
|----------|----------|
| `create_prize` | `POST /api/admin/crm/wheel/prizes` |
| `update_prize` | `PUT /api/admin/crm/wheel/prizes/:id` |
| `delete_prize` | `DELETE /api/admin/crm/wheel/prizes/:id` (soft) |
| `update_settings` | `PUT /api/admin/crm/wheel/settings` |

`actor_id` берётся из `req.user.u || req.user.username`. На прод-сервере
это всегда `admin` (текущая модель аутентификации single-user). Если
позже добавим персональные учётки менеджеров — поле уже готово.

## Notes

- Логирование никогда не блокирует ответ. `logWheelEvent` обёрнут
  в `try/catch` — JSON.stringify может упасть на циклических ссылках.
- События эмитятся **после** коммита транзакции спина — мы не пишем
  лог для откатанных операций.
- Размер payload не лимитируется специально, но `JSON.stringify`
  обрезает наши конкретные структуры до пары килобайт. Если payload
  становится больше — это знак рефакторить, а не лимитировать.
