# Рулетка призов — архитектура

## Цель

Игровой механизм лояльности «Рулетка призов»: клиент копит «спины» от своих
покупок и крутит горизонтальную CSGO-style ленту. Все призы — это автоматически
сгенерированные промокоды (физических товаров нет). Опт получает свой
обособленный пул призов и набор настроек.

Документ описывает финальную схему данных, API, фронт-структуру и интеграцию с
существующими модулями (loyalty, promo, wholesale).

## Источник правды

- Figma `https://www.figma.com/design/qnO4j8yMvWutdkLlce7lqX/Untitled`
  - `1:120` — экран рулетки
  - `19:412` — главный экран магазина с виджетом
  - `1:292` — экран «как работает»
  - `1:178` — варианты редкостей (8 шт.)
- Проектные нормы: `docs/frontend-design-reference-for-agents.md`,
  `docs/loyalty-rules.md`, `docs/promo-rules.md`, `docs/wholesale-rules.md`,
  `docs/timezone-rules.md`, `docs/telegram-mini-app.md`.
- Промокоды: таблица `promo_codes` + `server/promo-code-service.js`.

## Бизнес-правила

### Спины

- Розница: 1 спин за каждые `WHEEL_RETAIL_BYN` (по умолчанию 40 BYN)
  по сумме `final_amount` доставленных заказов (`status IN ('delivered')`).
- Опт: 1 спин за каждые `WHEEL_WHOLESALE_BYN` (по умолчанию 200 BYN).
- Пороги настраиваются в CRM (`wheel_settings`).
- Учитываются заказы, доставленные **после** `wheel_settings.start_collecting_at`.
  Старые заказы спинов не дают.
- Нерастраченный остаток BYN копится по строке клиента
  (`wheel_customer_balances.accumulated_amount_byn`). При выдаче спина из
  остатка вычитается порог. Остаток никогда не сгорает.
- Спины бессрочные, копятся неограниченно.
- Опт и розница имеют отдельные пороги, но один общий счётчик спинов на
  клиента — потому что пользователь физически один. Признак опта запоминается
  на этапе выдачи приза (флаг `is_wholesale` в `wheel_spins`), но баланс спинов
  единый.
- Если у клиента активна и розничная, и оптовая идентичность, мы пользуемся
  параметром в запросе спина (`is_wholesale: boolean`) и набором призов с
  соответствующим флагом.

### Редкости

Справочник `wheel_rarities` (seed):

| code        | label        | sort | примечание                       |
|-------------|--------------|------|----------------------------------|
| `nothing`   | Ничего       | 0    | пустой слот, не выдаёт промокод  |
| `common`    | Обычный      | 1    | базовая ставка                   |
| `rare`      | Редкий       | 2    |                                  |
| `valuable`  | Ценный       | 3    |                                  |
| `epic`      | Эпический    | 4    | элитная (по умолчанию)           |
| `mythic`    | Мифический   | 5    | элитная (по умолчанию)           |
| `gold`      | Золотой      | 6    | элитная (по умолчанию)           |
| `legendary` | Легендарный  | 7    | элитная (по умолчанию)           |

Цвета (фон плашки, цвет текста) берутся из Figma и фиксируются в seed.
Палитра редкостей фронта смотрит на `wheel_rarities.bg_color` и `text_color`,
чтобы можно было поправить через CRM без релиза. Размер шрифта/типографика
плашек — в коде (Montserrat 10/14).

### Призы

Таблица `wheel_prizes`:

| поле                       | назначение                                              |
|----------------------------|---------------------------------------------------------|
| `id`                       | `wp_<ts>_<rand>`                                        |
| `rarity_code`              | FK на `wheel_rarities.code`                             |
| `title`                    | название приза в UI («Скидка 5 BYN на жидкости»)        |
| `description`              | подсказка клиенту, что даст промокод                    |
| `image_url`                | опциональная картинка/логотип (нужно для редкостей)     |
| `weight`                   | вес для weighted-random внутри своей редкости           |
| `max_total`                | сколько раз приз может быть выдан (`0` = бесконечно)    |
| `issued_count`             | счётчик выданных                                        |
| `is_for_retail` / `is_for_wholesale` | какой пул приза                               |
| `promo_template_id`        | FK на `promo_codes`. NULL для `nothing`                 |
| `promo_validity_days`      | срок жизни сгенерированного промокода (3-4 мес)         |
| `epic_pool_size`           | для эпической логики — сколько претендентов нужно       |
| `epic_pool_threshold_byn`  | минимальная прибыль с одного клиента для попадания      |
| `is_active`                | мягкий выкл                                             |
| `created_at`               | timestamp                                               |

Если `max_total > 0` и `issued_count >= max_total` — приз **остаётся** в UI
(в ленте, в статистике), но в weighted-random он попадает с весом 0. Это
сознательное требование заказчика: не подрывать веру клиента в систему.

Категории редкости разделены на «обычные» (`common`/`rare`/`valuable`) и
«элитные» (`epic`/`mythic`/`gold`/`legendary`). Какие именно редкости считать
элитными — глобально настраивается в `wheel_settings.elite_rarities_json`. По
умолчанию элита это топ-4 (epic, mythic, gold, legendary).

#### Эпический приз — non-random выдача

Цель: некоторые призы должны попадать только «лучшим клиентам» и предсказуемо.

1. Для каждого эпического приза в CRM настраивается `epic_pool_size = N`
   (по умолчанию 5) и `epic_pool_threshold_byn = T` (по умолчанию 300 BYN).
2. Бэк ведёт `wheel_epic_pools`. Запись активного пула содержит JSON-массив
   `qualified_customers_json` — клиентов, которые с момента релиза рулетки
   (или с момента последнего сброса пула) набрали `>= T` BYN прибыли по
   доставленным заказам (`orders.profit`).
3. Когда `qualified_customers_json.length >= N`, пул считается «зрелым».
4. Первый из этих N клиентов, кто крутит спин, гарантированно получает этот
   эпический приз — обычная weighted-логика для него на этом спине игнорируется.
5. После выдачи пул закрывается (`closed_at`). Если у приза `max_total = 1`,
   `is_active` ставится в 0. Иначе создаётся новый активный пул и выборка
   накапливается заново.

Считать прибыль клиента: суммируем `orders.profit` (сумма по строкам, уже есть
в БД, см. `server/routes/crm-finance.js` для референса) по
`status = 'delivered'` и `created_at >= max(start_collecting_at,
last_pool.closed_at)`.

### Pity-таймер

Если у клиента подряд `pity_threshold` (по умолчанию 3) спинов выпало `nothing`
— следующий спин гарантированно даёт «обычный» (weighted-random внутри
**не-эпических** не-`nothing` редкостей того же пула). Счётчик
`consecutive_nothing` хранится в `wheel_customer_balances`.

### Алгоритм спина (общий)

```text
1. atomic transaction:
   - lock row in wheel_customer_balances FOR UPDATE
   - if spins_available <= 0 -> 400 not_enough_spins
   - decrement spins_available
2. determine prize:
   a. find active epic pool (any) ready to release for this customer
      -> if found: prize = pool.prize, mark pool closed
   b. else if consecutive_nothing >= pity_threshold
      -> weighted random from non-elite, non-nothing rarities (current pool)
   c. else: weighted random from full pool (including nothing & elite,
      excluding prizes with max_total exhausted)
3. issue promo_code (if prize.promo_template_id):
   - generate unique code (`<template.prefix>-<rand6>`)
   - create new row in promo_codes (max_uses=1, valid_from_date=today,
     duration_days=prize.promo_validity_days, customer_description = prize.title)
4. update consecutive_nothing (reset to 0 if non-nothing, ++ otherwise)
5. update wheel_prizes.issued_count
6. insert wheel_spins row with seed_for_animation (rand 32-bit) for replay
7. return result
```

Транзакция обязательна — нельзя допустить race condition «два спина списали
один баланс». Используем `db.transaction(() => { ... })` better-sqlite3.

### Live-feed

Бегущая строка на главном экране рулетки.

- Источник: `wheel_spins WHERE prize.rarity_code != 'nothing'` среди реальных
  клиентов (`customer_id IS NOT NULL`).
- Сортировка: по `spun_at DESC LIMIT 30`.
- Поле для UI: `first_name`, `last_initial` (первая буква фамилии),
  `photo_url` (аватар Telegram, в SQL запросе берётся через
  `c.photo_url AS customer_photo` для совместимости с UI), `prize.title`,
  `rarity.code`,
  `relative_time` (например, `5 мин назад`, считается на фронте).
- Обновление: фронт долбит `GET /api/wheel/state` каждые 30 секунд, когда
  пользователь на странице рулетки.

## Схема БД

Миграция: `server/migrations/add_wheel_prizes.js`. ESM, паттерн как у
`add_loyalty_tables.js`.

```sql
CREATE TABLE wheel_rarities (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  bg_color TEXT NOT NULL,
  text_color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_elite INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE wheel_prizes (
  id TEXT PRIMARY KEY,
  rarity_code TEXT NOT NULL REFERENCES wheel_rarities(code),
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  weight REAL NOT NULL DEFAULT 1,
  max_total INTEGER NOT NULL DEFAULT 0, -- 0 = unlimited
  issued_count INTEGER NOT NULL DEFAULT 0,
  is_for_retail INTEGER NOT NULL DEFAULT 1,
  is_for_wholesale INTEGER NOT NULL DEFAULT 0,
  promo_template_id TEXT REFERENCES promo_codes(id) ON DELETE SET NULL,
  promo_validity_days INTEGER NOT NULL DEFAULT 90,
  epic_pool_size INTEGER NOT NULL DEFAULT 5,
  epic_pool_threshold_byn REAL NOT NULL DEFAULT 300,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
);
CREATE INDEX idx_wheel_prizes_rarity ON wheel_prizes(rarity_code);
CREATE INDEX idx_wheel_prizes_active ON wheel_prizes(is_active);

CREATE TABLE wheel_customer_balances (
  customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  spins_available INTEGER NOT NULL DEFAULT 0,
  accumulated_retail_byn REAL NOT NULL DEFAULT 0,
  accumulated_wholesale_byn REAL NOT NULL DEFAULT 0,
  consecutive_nothing INTEGER NOT NULL DEFAULT 0,
  last_synced_order_id TEXT,
  last_updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
);

CREATE TABLE wheel_spins (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  prize_id TEXT NOT NULL REFERENCES wheel_prizes(id),
  rarity_code TEXT NOT NULL,
  is_wholesale INTEGER NOT NULL DEFAULT 0,
  generated_promo_code_id TEXT REFERENCES promo_codes(id),
  generated_promo_code TEXT,
  promo_valid_until TEXT,
  is_epic_release INTEGER NOT NULL DEFAULT 0,
  is_pity_release INTEGER NOT NULL DEFAULT 0,
  seed_for_animation INTEGER NOT NULL,
  spun_at TEXT NOT NULL DEFAULT (DATETIME('now')),
  prize_used_at TEXT
);
CREATE INDEX idx_wheel_spins_customer ON wheel_spins(customer_id, spun_at DESC);
CREATE INDEX idx_wheel_spins_promo ON wheel_spins(generated_promo_code_id);
CREATE INDEX idx_wheel_spins_feed ON wheel_spins(spun_at DESC, rarity_code);

CREATE TABLE wheel_epic_pools (
  id TEXT PRIMARY KEY,
  prize_id TEXT NOT NULL REFERENCES wheel_prizes(id) ON DELETE CASCADE,
  pool_size INTEGER NOT NULL,
  threshold_byn REAL NOT NULL,
  qualified_customers_json TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  released_to_customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  opened_at TEXT NOT NULL DEFAULT (DATETIME('now')),
  closed_at TEXT
);
CREATE INDEX idx_wheel_epic_pools_prize ON wheel_epic_pools(prize_id, is_active);

CREATE TABLE wheel_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
);
```

`wheel_settings` хранит JSON-сериализованные значения как строки (паттерн из
`settings`). Базовый набор:

- `spin_byn_retail` (40)
- `spin_byn_wholesale` (200)
- `pity_threshold` (3)
- `default_promo_validity_days` (90)
- `feed_size` (30)
- `start_collecting_at` (ISO timestamp релиза)
- `elite_rarities_json` (`["epic","mythic","gold","legendary"]`)

## API

### Public (Telegram Mini App)

Все под `requireTelegramMiniAppAuth`. Учитывают wholesale-контекст через те же
заголовки (`x-wholesale-code`, `x-wholesale-secret`), что и остальные роуты.

- `GET /api/wheel/state`
  - returns `{ balance, prizes, feed, my_active_prizes, settings_summary }`.
  - `balance`: spins_available, accumulated_byn, threshold_byn, progress %.
  - `prizes`: список призов в порядке `sort_order`, с `effective_weight` и
    флагом `is_exhausted`. Эпические — отмечены, но без раскрытия пула.
  - `feed`: последние выигрыши (live feed).
  - `my_active_prizes`: спины клиента, у которых есть промокод и срок не истёк.
- `POST /api/wheel/spin`
  - body: `{ }` (idempotency через server-side lock на customer row)
  - 200: `{ prize, rarity, animation_seed, promo_code, promo_valid_until,
    spins_left, balance_progress }`
  - 400: `not_enough_spins`, `wheel_disabled`, `customer_not_found`.
- `GET /api/wheel/my-prizes?status=active|used|expired`
  - постраничный список выигрышей текущего клиента.

### Admin / CRM

Под `authMiddleware`.

- Призы:
  - `GET /api/admin/crm/wheel/prizes`
  - `POST /api/admin/crm/wheel/prizes`
  - `PUT /api/admin/crm/wheel/prizes/:id`
  - `DELETE /api/admin/crm/wheel/prizes/:id` — soft delete (is_active = 0).
- Настройки:
  - `GET /api/admin/crm/wheel/settings`
  - `PUT /api/admin/crm/wheel/settings`
- Дашборд / лог:
  - `GET /api/admin/crm/wheel/dashboard`
    - текущие пулы эпических, статистика выдачи, прогноз расходов.
  - `GET /api/admin/crm/wheel/spins?customer_id=&rarity=&from=&to=&limit=&offset=`

## Интеграции

- **Создание заказа.** В `server/routes/public.js` при доставке заказа
  (`status` переходит в `delivered`) вызывается
  `accrueWheelSpinsForOrder(orderId)`. Метод смотрит `final_amount` (или
  `total_amount` в зависимости от типа), увеличивает `accumulated_*_byn`, и
  пока остаток >= порога — выдаёт спин. Использует
  `wheel_customer_balances.last_synced_order_id`, чтобы исключить повторную
  выдачу.
- **Эпический пул.** Тот же hook после доставки: считаем
  `orders.profit` по клиенту, добавляем его в активные пулы каждого
  активного эпического приза, если порог преодолён.
- **Loyalty/Promo conflict.** Никаких — рулеточный промокод это обычный
  промокод. Если клиент применил его в чекауте, в этом заказе loyalty уже
  блокирована (по существующему правилу).
- **Wholesale.** Опт получает доступ к рулетке по флагу `is_wholesale` в
  спине. На фронте оптовик видит свои призы (с `is_for_wholesale = 1`).
  Wholesale identity определяется существующими утилитами
  (см. `server/utils/wholesale.js` и `loyalty.js` как референс).
- **Profit.** `orders.profit` вычисляется по существующему пути
  (см. `server/routes/crm-finance.js`). Не дублируем формулы, делаем
  отдельный helper `getCustomerProfitSince(customerId, sinceTimestamp)` в
  `server/wheel/wheel-service.js`.

## Фронт

### Маршруты

- `/wheel` — `WheelView.vue`
- `/wheel/how-it-works` — `WheelHowToView.vue`
- `/wheel/my-prizes` — `WheelMyPrizesView.vue`

Все три — под Mini App контекстом, не блокируются wholesale.

### Tab Bar

- Розница: `Главная / Каталог / Рулетка / Профиль` (4 таба, иконка дайс или
  колесо). Сейчас в `BottomTabBar.vue` есть `home / section-2 / section-3 /
  profile`. Заменяем `section-2` и `section-3` на каталог и рулетку.
  - Если каталога-страницы нет, оставляем home + wheel + profile + cart
    placeholder. Ловим решение пользователя в коде через 4 таба:
    `home / cart / wheel / profile`. Cart-кнопка пока ведёт в чекаут или
    открывает существующий корзинный bottom-sheet.
- Опт: возвращаем красный футер (сейчас он скрыт). Табы: `Главная / Корзина /
  Рулетка / Профиль`. Профиль для опта показывает заглушку (см. ниже).

### Главный экран

- `HomeView.vue` получает виджет `WheelHomeWidget.vue` — белая карточка с
  иконкой колеса, бейджом «N доступных спинов», CTA «Крутить» (ведёт на
  `/wheel`). Если у клиента 0 спинов — карточка показывает прогресс
  «X из Y BYN до следующего спина».

### `WheelView.vue`

Структура (по Figma `1:120`, адаптированная под наш дизайн-канон):

1. Стандартный header (Head компонент уже есть).
2. Красный гради
ентный hero (`linear-gradient(106.76deg, #F50302, #A90F0E)`)
   с центрированной горизонтальной лентой призов.
3. Лента призов `WheelStrip` (см. ниже) с центральной риской/маркером.
4. Под лентой — текст «Осталось N прокруток».
5. CTA «Крутить» — белая пилюля, поверх красного фона, как loyalty-CTA.
6. Прогресс-бар «X из 40 BYN до начисления спина».
7. Live-feed бегущая строка `WheelLiveFeed`.
8. Карточка «Мои активные призы N» (на белом, переход на
   `/wheel/my-prizes`).
9. Карточка «Как работает рулетка» (переход на `/wheel/how-it-works`).
10. BottomTabBar.

### `WheelStrip.vue`

CSGO-style лента:

- Горизонтальный flex с дублированием карточек (виртуально 200+ карточек:
  3 копии перемешанного пула достаточно для ровной анимации).
- Маркер по центру (вертикальная риска с белой стрелкой сверху и снизу).
- Анимация: после `POST /spin` бэк присылает результат и `animation_seed`.
  Фронт **сам** строит сегмент ленты для анимации (без раскрытия будущих
  спинов): берёт текущий пул призов, перемешивает с seed, добивает в нужное
  место карточку выигранного приза, затем `transform: translateX(-X)` с
  cubic-bezier `cubic-bezier(0.18, 0.94, 0.16, 1)` ~5.5 сек.
- Используем CSS transition + `requestAnimationFrame` для тонкой настройки
  ease-out без зависимостей. GSAP/anime.js не подключаем (лишний bundle).

### `WheelPrizeCard.vue`

Карточка приза в ленте:

- 140×156 px (как в Figma).
- Белая подложка, радиус 20px.
- Картинка приза или градиентная заливка цвета редкости.
- Цветная плашка снизу с лейблом редкости (стиль из `Frame 1948757...`).

### `WheelLiveFeed.vue`

Бегущая строка с аватаром, именем, призом, временем. CSS animation
`marquee` без JS-таймеров (производительно).

### Pinia store `stores/wheel.ts`

```ts
state:
  balance: { spins, accumulated, threshold, percent }
  prizes: WheelPrize[]
  feed: WheelFeedItem[]
  myPrizes: WheelMyPrize[]
  isSpinning: boolean
  lastResult: WheelSpinResult | null

actions:
  fetchState()
  spin()
  fetchMyPrizes()
```

## Тесты (бэк)

`server/tests/wheel-spin.test.js`:

- 10 000 прокруток с фиксированным seed, проверка распределения.
- Pity-таймер срабатывает после N подряд `nothing`.
- Приз с `max_total = 1` после первой выдачи имеет вес 0.
- `not_enough_spins` при пустом балансе.

`server/tests/wheel-epic.test.js`:

- 5 клиентов набирают порог → пул зрелый.
- Первый спинщик из этих 5 получает эпический приз.
- После выдачи `wheel_epic_pools.is_active = 0`, новый пул создаётся.
- Если `max_total = 1`, приз `is_active = 0`.

`server/tests/wheel-balance.test.js`:

- Доставленный заказ на 80 BYN розницы → 2 спина, 0 остатка.
- Заказ на 50 BYN → 1 спин, 10 BYN остатка.
- Заказ на 39 BYN → 0 спинов, 39 BYN остатка.
- Опт: 200 BYN порог, заказ на 250 BYN → 1 спин, 50 BYN остатка.

Тесты подключаются в `server/package.json` `scripts.test`.

## Миграция и rollout

1. Миграция создаёт таблицы и заполняет seed редкостей.
2. `wheel_settings.start_collecting_at` ставится в `DATETIME('now')` на момент
   первой инициализации (не учитываем историю).
3. Начисление спинов запускается из `markOrderDelivered` (где он есть) —
   подключение в одном месте.
4. Призы и эпическая логика создаются менеджером в CRM **после** релиза.

## Что НЕ делаем в этой итерации

- A/B тесты разных пулов.
- Реальную выдачу физических подарков (заказчик подтвердил: только промо).
- Продвинутые антифрод-механизмы. Сейчас полагаемся на то, что заказы
  уже модерируются в CRM (только `delivered` даёт спин и прибыль).
- Push-уведомления о выигрыше (потенциальный follow-up).

## Carry-over для эпических пулов (Q4)

Закрыто 17.05.2026. Реализовано в `spinWheelForCustomer` после закрытия
эпического пула.

**Поведение.** При выдаче эпического приза с `max_total > 1` (или `0`,
unlimited) внутри той же транзакции:

1. Закрытый пул → `is_active = 0`, `released_to_customer_id`,
   `closed_at`.
2. Если `wheel_prizes.is_active = 1` и `(max_total = 0 OR issued_count
   < max_total)` — берём `qualified_customers_json` старого пула,
   удаляем победителя, создаём новый активный пул со списком
   carry-over.
3. `pool_size` нового пула = длине carry-over списка. Это значит, что
   на следующем спине любого из этих клиентов сработает условие
   `list.length >= pool_size` и эпик выдастся гарантированно.
4. Если приз достиг `max_total` — деактивируется, новый пул не
   создаётся.
5. Если carry-over список пустой (например, изначально был
   `pool_size = 1`) — нового пула не создаём.

**Подтверждение по best practices.** Lottery jackpot rollover (Powerball,
California Super Lotto) и gacha pity carryover (Genshin, HSR, Arknights,
CZN) используют тот же паттерн: клиент, который преодолел порог
eligibility, остаётся в очереди до получения приза.

**Тесты.** `server/tests/wheel-epic.test.js`:

- `testEpicPoolReleasesToFirstSpinAfterThreshold`
- `testEpicPoolResetsWhenPrizeAllowsMultipleReleases`
  (max_total=0, carry-over после релиза)
- `testEpicMaxTotal3CarriesOverNonWinners`
  (max_total=3, три последовательных релиза, carry-over после каждого
  кроме последнего)
- `testEpicMaxTotal1NoCarryOver`
  (single-issue не переносится)

## Live-feed consent (Q6)

Закрыто 17.05.2026. Реализовано в БД, бэкенде, фронте и профиле.

**БД.** `customers.wheel_feed_consent INTEGER DEFAULT 0` +
`wheel_feed_consent_at TEXT`. Идемпотентная миграция.

**API.**

- `POST /api/wheel/feed-consent` — body `{ consent: boolean }`.
  Записывает выбор клиента (любой), стэмпит timestamp.
- `/api/wheel/state` — добавлено в payload:
  - `feed_consent` — текущее значение булевого консента.
  - `feed_consent_required` — true, если у клиента ещё не записан
    выбор (`wheel_feed_consent_at IS NULL`).

**SQL feed.** Запрос ленты выигрышей дополнен условием
`c.wheel_feed_consent = 1`. По умолчанию (свежая миграция) лента
пустая, пока клиенты не нажмут «Согласен».

**Фронт.**

- `WheelConsentModal.vue` показывается на `/wheel` если
  `feed_consent_required === true` И клиент не закрыл модалку в
  текущей сессии.
- Кнопки «Согласен» / «Не сейчас» оба фиксируют выбор. Закрытие через
  X не пишет ничего — модалка появится при следующем входе.
- В `ProfileView` (розница) добавлен переключатель «Лента рулетки» —
  использует тот же endpoint.

**Round 4 (17.05.2026).** Тумблер «Лента рулетки» теперь показывается
**всем клиентам** (включая опт), и `wheelStore.fetchState()` тоже
вызывается для всех. Раньше для опта fetch пропускался, и тумблер на
профиле показывал «выкл» даже если на сервере у клиента стоит
`wheel_feed_consent = 1` (после согласия в `WheelView`). Тап «выкл»
тогда тихо отзывал согласие. Теперь:

- `ProfileView.onMounted` всегда вызывает `wheelStore.fetchState()`
  (тернарник `wholesaleStore.isWholesale ? Promise.resolve() : ...`
  убран).
- `onToggleFeedConsent` обновляет `feedConsent` оптимистично и
  откатывает значение, если запрос упал (нет toast-surface на
  странице, console.warn остаётся).
- В `wholesale-profile-card` добавлен hint «Настройка ленты рулетки
  доступна ниже» — оптовик видит, что тумблер ниже его заглушки и
  понимает, что управление есть.

Это согласуется с тем, что опт реально крутит рулетку (флаг
`is_wholesale` в `wheel_spins`) и его выигрыши попадают в ленту, если
он дал consent. Архитектурно опт и розница имеют единый customer row,
поле `wheel_feed_consent` тоже общее — отдельной wholesale-копии
consent не существует.

**Юридический контекст.** Закон РБ о персональных данных требует
согласия для публикации имени и фотографии. До получения consent
клиент в ленте не виден.

**Тесты.** `server/tests/wheel-routes.test.js`:

- `testFeedExcludesCustomersWithoutConsent`
- `testFeedConsentRequiredFlagFlips` (accept и decline оба гасят
  модалку)

## Idempotency для spin (P1)

Добавлено 17.05.2026. Защищает от двойного списания спина при ретрае
на флакающей сети Mini App.

**БД.** `wheel_spins.idempotency_key TEXT` + UNIQUE partial index
`idx_wheel_spins_idempotency` на `(customer_id, idempotency_key) WHERE
idempotency_key IS NOT NULL`.

**API.** `POST /api/wheel/spin` принимает заголовок `Idempotency-Key`
длиной 16-128 символов:

1. Перед транзакцией: lookup в `wheel_spins` по
   `(customer_id, idempotency_key)`. Если найден — собрать тот же
   payload и вернуть с флагом `idempotent_replay: true`.
2. Если не найден — внутри транзакции `INSERT ... idempotency_key = ?`.
3. Race-кейс: два параллельных POST с тем же ключом проходят первую
   проверку, второй INSERT упирается в UNIQUE. Catch блока распознаёт
   это по `error.code` (SQLite UNIQUE-violation
   `SQLITE_CONSTRAINT_UNIQUE` или любой `SQLITE_CONSTRAINT*`) и
   возвращает реплей вместо 500.

**Round 4 (17.05.2026).** Раньше catch-ветка матчилась на
`error.message.includes("idx_wheel_spins_idempotency")`. Текст ошибки
better-sqlite3 для partial-index UNIQUE не стабилен — иногда
приходит column-form `UNIQUE constraint failed:
wheel_spins.customer_id, wheel_spins.idempotency_key` без имени
индекса. На таком сообщении `.includes(...)` не срабатывал, и
параллельный ретрай возвращал 500 вместо реплея. Сейчас:

- Предикат `isWheelIdempotencyConflict(error, key)` экспортируется
  из `server/routes/wheel.js` для тестируемости.
- Условие — `idempotencyKey` есть И `error.code` имеет префикс
  `SQLITE_CONSTRAINT` (включая `SQLITE_CONSTRAINT_UNIQUE` и
  `SQLITE_CONSTRAINT_PRIMARYKEY`).
- После предиката идёт второй lookup по `(customer_id,
  idempotency_key)`. Если запись нашлась — отдаём реплей. Если нет —
  это другой UNIQUE-конфликт, бросаем 500 (бьём в видимый bug, не
  маскируем).

Заголовок необязательный — старые клиенты работают без него. Сильно
рекомендуется для всех клиентов с retry-логикой.

**Фронт.** `useWheelStore().spin()` генерирует `crypto.randomUUID()`
для каждого вызова. Для каждого нового спина — новый ключ, для
ретрая того же спина — тот же ключ (на текущий момент мы делаем
один shot и не ретраим, но фронт уже готов к ретраям).

**Тесты.** `server/tests/wheel-routes.test.js`:

- `testSpinIsIdempotentByKey` (тот же ключ → тот же `spin_id`, баланс
  не списывается; новый ключ → новый спин, баланс списан)
- `testIdempotencyConflictPredicateMatchesAllShapes` — пин-тест
  предиката против column-form, index-form, generic
  `SQLITE_CONSTRAINT*` и not-SQLite ошибок.
- `testRealUniqueViolationOnIdempotencyKeyMatchesPredicate` — реальный
  UNIQUE-violation против partial-index должен иметь
  `error.code = SQLITE_CONSTRAINT*`. Ловит регрессию, если SQLite
  вдруг изменит формат ошибки.

## Структурированные логи (P3)

Добавлено 17.05.2026. См. `docs/wheel-logging.md` — полный список
событий и их формат.

**События.** Все строки имеют префикс `wheel_` в поле `ev`:

- `wheel_spin` — каждая прокрутка
- `wheel_epic_release`, `wheel_pool_created`, `wheel_pool_closed`
- `wheel_pity_release`, `wheel_pity_fallback`
- `wheel_consent_changed`
- `wheel_admin_action` (create_prize / update_prize / delete_prize /
  update_settings, с `actor_id` из jwt)

**Helper.** `logWheelEvent(ev, data)` в `wheel-service.js` —
обёрнутая в try/catch строка JSON. Никогда не блокирует ответ;
JSON-ошибки выводят tag-only fallback.

**Расположение.** События эмитятся ПОСЛЕ коммита транзакции — лог
соответствует строке в БД (нет логов от откатанных спинов).

**Фильтрация в журнале API.**

```bash
./ops/prod.sh logs api | grep '"ev":"wheel_'
./ops/prod.sh logs api | grep '"ev":"wheel_admin_action"'
```
