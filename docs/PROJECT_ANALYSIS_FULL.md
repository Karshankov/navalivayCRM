# Полный анализ проекта NAVALIVAY (CRM для онлайн-магазина с выдачей заказов)

**Дата анализа:** 2026-10-09
**Цель:** рабочий справочник для дальнейшей разработки — архитектура, все подсистемы, все страницы, функции и кнопки.

---

## 1. Общая картина

**NAVALIVAY** — CRM для онлайн-магазина (вейп- shop) с пунктом выдачи заказов, работающего **только на самовывозе**. Основной клиентский канал — **Telegram Mini App**. Система состоит из двух больших частей:

1. **Клиентский магазин** (Telegram Mini App): каталог, корзина, оформление заказа, промокоды, лояльность, опт, рулетка призов, отзывы, профиль.
2. **CRM для персонала**: канбан-доска заказов, клиенты, финансы, склад/закупки, POS-касса, сотрудники и смены, отзывы-модерация, промокоды/бонусы, рулетка.

### Ключевые цифры проекта

| Метрика | Значение |
|---|---|
| Монорепозиторий | `app/` (npm workspaces: frontend + server) |
| Frontend | Vue 3.5 + TypeScript + Vite 7 + Pinia + UnoCSS + Vue Router 4 |
| Backend | Node.js ≥18 + Express 4 + better-sqlite3 (SQLite, WAL) |
| Таблиц БД | 112 (реальных бизнес-таблиц ~90 + FTS5-индекс поиска) |
| Endpoint'ов API | ~319 (10 файлов маршрутов) |
| Миграций | ~80 файлов в `server/migrations/` |
| Тестов backend | 80 файлов (включая adversarial) |
| Тестов frontend | ~12 spec-файлов (Vitest + Happy DOM) |
| Заказов в БД | 16 051 (14 181 delivered, 1 859 cancelled, 11 in_progress) |
| Клиентов | 4 361 |
| Товаров / вариантов / линеек | 3 078 / 217 / 300 |
| Сотрудников | 5 |
| Git-ветка сейчас | `backup/pre-card-redesign-2026-10-09` (снапшот перед редизайном лимитов карт) |

### Запуск

```bash
npm run dev            # frontend (5173) + backend (8082) через scripts/dev.js
npm run dev:bot        # + Telegram-бот
npm run test           # все тесты
npm run lint / format
```

Production (запрещено трогать напрямую, только через `./ops/prod.sh`):
- API `:8082` — systemd `navalivay-server`
- Telegram-бот — PM2 `navalivay-bot`
- Userbot `:8083` — PM2 `navalivay-userbot`

---

## 2. Архитектура backend

### Точка входа: `server/server-main.js`

Порядок инициализации:
1. `initDb()` — таблицы + seed (миграции применяются автоматически).
2. `archiveOldDeliveredOrders()` + `scheduleArchiving()` — delivered-заказы архивируются через 24 ч (`archived=1`), ежедневная архивация в полночь.
3. Фоновые воркеры:
   - `scheduleReviewMonthlyDraw` — авто-розыгрыш отзывов, последний день месяца 21:00 по Минску;
   - `startAutoNotifyRetryWorker` — повтор авто-уведомлений при недоступности userbot;
   - `startReferralWelcomeNotificationWorker` — приветственные сообщения по рефералам;
   - `startInternalNotificationWorker` — внутренние уведомления персонала;
   - `startSalaryReminderScheduler` — напоминания о зарплате;
   - `startStaffShiftScheduler` — автозакрытие смен по плановому окончанию (21:15 у дневных, +12 ч у ночных).
4. Middleware: morgan (с санитизацией `telegram_id`/`telegram_username` в логах), json 50 МБ, cookie-parser, CORS, helmet (CSP off), `X-Robots-Tag: noindex`.
5. Static `/uploads` — **без кэша** (no-store).
6. Подключение маршрутов: public → admin → upload → crm → crm-operations → crm-finance → staff → pos → promo → loyalty → wheel.

### Файлы маршрутов (10 шт., ~20 тыс. строк)

| Файл | Строк | Endpoint'ов | Назначение |
|---|---|---|---|
| `routes/public.js` | 4253 | 34 | Клиентский API: каталог, заказы, промо-валидация, отзывы, опт, визиты |
| `routes/admin.js` | 3759 | 51 | CRUD админки: категории, группы, товары, баннеры, настройки, опт-ссылки |
| `routes/crm-operations.js` | 3701 | 27 | Канбан-заказы: выдача, отмена, resolve-action, ячейки хранения |
| `routes/crm.js` | 2714 | 99 | CRM: клиенты, блокировки, закупки, списания, POS, поиск, отзывы-CRM |
| `routes/staff.js` | 2843 | 47 | Сотрудники, ПИН, смены, задачи, ЗП, ручные отметки |
| `routes/crm-finance.js` | 1516 | 26 | Финансы: счета, транзакции, дашборд, лимиты карт |
| `routes/wheel.js` | 773 | 16 | Рулетка: спины, призы, настройки, аудит |
| `routes/loyalty.js` | 402 | 7 | Управление правилами лояльности |
| `routes/promo.js` | 495 | 6 | Управление промокодами |
| `routes/pos.js` | 458 | 6 | POS-продажи кассы |

**Важно (ловушка Express):** в `crm-operations.js` роут `/orders/delivered` обязан быть определён **до** `/orders/:id`, иначе "delivered" парсится как id.

### Ключевые модули бизнес-логики (`server/utils/`, 56 файлов)

- `money.js` — `roundMoney()` (2 знака), вся математика денег;
- `order-line-pricing.js` — расчёт позиции заказа (скидки, цена позиции);
- `loyalty.js` (в корне server, 850 строк) — начисление/применение бонусов;
- `promo-code-service.js` — жизненный цикл промокодов;
- `wholesale-service.js` — оптовые цены и тиры;
- `card-payment-service.js` + `card-payment-limits.js` — лимиты оплаты картой;
- `cash-pacing.js` — «План пробития»;
- `customer-blocks.js` — блокировки клиентов (delivery/referral);
- `group-parking.js` — парковка линеек (скрытие из витрины);
- `crm-kanban-board.js` — сборка колонок доски;
- `crm-order-polling.js` — polling новых заказов для CRM;
- `userbot-client.js` + `crm-telegram-outbound.js` — отправка сообщений через MTProto;
- `business-bot.js` + `telegram-business-api.js` — Telegram Business-бот (quick replies, статусы);
- `product-reviews.js`, `review-monthly-draw.js` — отзывы и розыгрыш;
- `staff-service.js` — смены, события сотрудников;
- `auto-notify.js` + `auto-notify-retry.js` — авто-уведомления клиента о статусах.

### Авторизация (два контура)

1. **Клиенты** — Telegram Mini App `initData`, проверка HMAC-SHA256 (`server/telegram-miniapp-auth.js`). Опт-checkout работает **только** с настоящим initData из Mini App.
2. **CRM/админ** — JWT (username + bcrypt-пароль, `server/config/admin.json`; сотрудники — ПИН + смены). Пароль прибыли и пароль раздела «Обзор» — отдельные хэши в `settings`.

Rate limits: public read 120 req/min, public mutations 40 req/min.

---

## 3. Схема данных (главные таблицы, 112 шт.)

### Каталог
- `categories` — категории (slug, обложка, hide_empty, display_mode, use_category_image);
- `category_groups` — линейки (иерархия `parent_id`, meta-поля, бейджи, `empty_since`, min_stock, парковка `parked_order`);
- `products` — товары: цены, `stock` (розница!), `warehouse_stock` (склад), `cost_price`, бейджи;
- `product_variants` — варианты (цвет, крепость, `color_image`, `color_display_mode`);
- `product_images`, `product_links`, `product_badges`, `catalog_discounts`;
- `category_cross_sells`, `category_group_wholesale_prices`, `category_group_supply_pauses`, `category_group_completeness_waivers`;
- `product_search_index*` — FTS5 (полно-текстовый поиск товаров);
- `image_thumbnail_cache` — кеш миниатюр (sharp).

### Заказы
- `orders` — статус (`new` / `in_progress` / `completed` / `delivered` / `cancelled`), суммы (`total_amount`, `discount_amount`, `final_amount`, `profit`), оплата (`payment_method` cash/card, `card_amount`, `cash_amount`, `payment_status`), `archived`, `stock_deducted`, `needs_manager_action` + `manager_action_type` (`modified` | `cancelled_by_customer`), `completed_at`, `order_number`, телефон/username клиента;
- `order_items` — позиция: `product_id`, `variant_id`, `quantity`, `price_per_unit`, `cost_per_unit`, `manual_discount_amount`, `catalog_price`, `display_*` поля (название/фото на момент заказа), `base_product_id`;
- `order_status_history` — история статусов;
- `order_pickup_cell_assignments` — ячейки выдачи (`pickup_cells`, настройка `pickup_cell_capacity`);
- `order_loyalty_redemptions` — применение бонусов к заказу.

### Клиенты
- `customers` — telegram_id/username, фото, `total_orders`, `total_spent`, notes, `deleted_at` (мягкое удаление);
- `customer_blocks` / `pending_customer_bans` — блокировки (delivery/referral), причина, до даты;
- `customer_notes` / `pending_customer_notes` — заметки менеджеров (отложенные до первого заказа);
- `customer_feedbacks`, `customer_invite_bans`, `customer_referrals`;
- реферальная система: `referral_auth_events`, `referral_auth_states`, `referral_disallowed_inviter_usernames`, `referral_welcome_notifications`, `pending_staff_access_grants`, `staff_access_grants`;
- `visit_logs` — логирование визитов (из router фронта).

### Лояльность и промо
- `loyalty_categories` (liquids / disposables / devices), `loyalty_rules`, `loyalty_category_mappings`, `loyalty_category_settings`;
- `customer_loyalty_balances`, `customer_loyalty_ledger` — прогресс и журнал;
- `promo_codes` — fixed/percent, min_order_amount, max_uses, `has_gift`, описания (customer/manager), валидность, привязка к клиенту рулетки;
- `promo_usage` — использования.

### Опт
- `wholesale_tiers` (100/250/500/1000 BYN), `wholesale_links` — секретные ссылки `/opt/:code/:secret`.

### Финансы
- `cash_accounts` — счета (Касса в магазине и доп.);
- `cash_transactions` — income / expense / order_payment / refund, связь с заказом и сотрудником;
- `cash_pacing_months` / `cash_pacing_items` / `cash_pacing_daily_facts` — «План пробития»: месяц → позиции плана → ежедневный факт Z-отчёта;
- лимиты карт: `card_payment_months`, `card_payment_day_adjustments`, `card_payment_accounts`, `card_payment_account_months`, `card_payment_operations`, `card_payment_tariffs`, `card_payment_limit_requests`, `card_payment_pending_accounts` + таблицы истории.

### Сотрудники
- `employees` — username, password_hash, position, active;
- `staff_sessions`, `staff_login_attempts`, `staff_events`, `staff_shifts`, `staff_shift_audit`, `staff_tasks`, `staff_task_history`, `staff_task_commands`, `staff_manual_marks` (+версии), `staff_monthly_salary_*`, `staff_operation_idempotency`;
- `internal_notification_*` — внутренние уведомления.

### Склад
- `procurements` + `procurement_items` — закупки (создатель/принявший, `warehouse_quantity`);
- `write_offs` + `writeoff_items` — списания;
- `stock_transfers` + `stock_transfer_items` — перемещения розница↔склад (черновик → оприходование);
- `low_stock_groups`, `inventory_locations`, `lost_and_found`.

### Отзывы
- `product_reviews`, `review_quick_tags`, `review_monthly_draws` / `review_monthly_draw_winners`, настройки QA.

### Рулетка
- `wheel_settings` (пороги: розница 40 BYN/спин, опт 200 BYN/спин, `start_collecting_at`);
- `wheel_rarities` (nothing/common/rare/valuable/epic/mythic/gold/legendary), `wheel_prizes`, `wheel_rarity_pools`, `wheel_epic_pools`, `wheel_spins`, `wheel_spin_audit`, `wheel_customer_balances`, `wheel_balance_ledger`.

### Прочее
- `banners`, `settings` (key-value: `profit_password_hash`, `pickup_cell_capacity`, `staff_tracking_enabled`, `manager_telegram`, `referral_authorization_enabled` и др.), `message_templates`, `agreements` + `agreement_acceptances`, `bot_message_log`, `bot_quick_replies`, `bot_status_templates`, `business_connections`, `userbot_entities`, `storefront_filter_profiles`, `pos_sales` (+items/customers).

---

## 4. Frontend: страницы и что на них

### 4.1 Клиентские маршруты (`router/index.ts`)

| Маршрут | View | Что внутри |
|---|---|---|
| `/` | HomeView | Баннеры (карусель Embla), категории, активный заказ, виджет рулетки, banner минимальной суммы, условия доставки |
| `/category/:slug` | CategoryView | Товары категории: фильтры (в т.ч. «Чаще берут», «Скидки», «Новинки»), линейки с обложками, корзинная панель |
| `/p/:id` | ProductView | Карточка товара: hero-фото, варианты (цвета с превью-модалкой), количество, cross-sell, отзывы линейки, кнопка «В корзину» |
| `/checkout` | CheckoutView (3149 строк) | Корзина, промокод («Промокод» → «Скидка по промокоду»), лояльность («Применить» / «Бонус уже выбран» / «Применено»), оплата «Картой»/«Наличными», «Оформить заказ», «Перейти к заказу», «Убрать» позицию, кнопка «Увеличить лимит» (карта), соглашения |
| `/my-order` | MyOrderView | Активный заказ клиента, агрегированная строка «Скидка» |
| `/profile` | ProfileView | Профиль, аватар Telegram (кеш на диске), история, бонусы лояльности по категориям, рулетка (баланс спинов) |
| `/profile/orders` | OrderHistoryView | История заказов |
| `/profile/orders/:orderId` | OrderDetailView | Детали заказа |
| `/wheel` | WheelView | Рулетка (CSGO-style лента), модалка результата |
| `/wheel/how-it-works` | WheelHowToView | Правила |
| `/wheel/my-prizes` | WheelMyPrizesView | Мои промокоды-призы |
| `/opt/:code/:secret` | WholesaleEntryView | Вход в опт по секретной ссылке |

Tab bar снизу — 4 вкладки (HomeView/CategoryView/ProfileView + корзина). Роутер логирует визиты в `POST /api/visits/log` (только для залогиненного Telegram-пользователя) и умеет один auto-reload при ошибке динамического импорта.

### 4.2 Админ-контур

**`/admin`** — AdminView (163 КБ!). Вход — «экран кассира» (маскировка: поле «Поиск товаров» принимает пароль CRM — `CashierLockScreen`). Табы верхнего уровня: **Обзор / Товары / Категории / Баннеры / Настройки**:

- **Обзор** — статистика месяца, выбор метрики «Выручка / Прибыль / Заказов», «Статусы заказов», «Логистика и доставка», топ-линеек (по количеству/по прибыли), **запаролено** (ввод «Кода доступа», пароль хранится в settings);
- **Товары** — таблица товаров, форма товара (варианты, фото + сортировка фото, бейджи, скидки `ProductDiscountModal`), мин. остатки линейки, «Убрать из cross-sell», поиск;
- **Категории** — CRUD категорий и линеек, обложки, «Оптовые ссылки» (`AdminWholesaleLinksPanel`), оптовые цены групп, low-stock панели (`LowStockGroupsPanel`, `LowStockFlavorsModal`), панель «Полный контроль» (`TotalControlPanel`), незаполненные линейки (`IncompleteGroupsPanel`);
- **Баннеры** — CRUD баннеров (title, open_in_new_tab);
- **Настройки** — смена пароля администратора, лицензионный ключ, «Настройки менеджера» (manager_telegram, шаблоны), «Настройки доставки», авто-ответы бота, шаблоны блокировки/инвайт-банов, пароль прибыли.

**CRM-разделы** (сайдбар `AdminSidebar`, ссылки из `adminNavigation.ts`):

| Раздел | View | Функции и кнопки |
|---|---|---|
| **Заказы** `/admin/crm/orders` | CrmOrders (3375 строк) | Канбан 3 колонки: «Требует действий» / «Новые» / «Собран». Drag-and-drop только Новые→Собран. Кнопки-модалки: **«Отмененные заказы»**, **«Статистика заказов»** (запаролено паролем прибыли; фильтры Сегодня/7/30/Всё, поиск, пагинация «Загрузить ещё»), **«Ячейки хранения»** (карта ячеек, `pickup_cell_capacity`). Действия по заказу: «Выдать» (→ delivered, списание остатков, касса), «Отменить» («Да, отменить»), «Принять изменения» / «Разобрать» (resolve-action), заметка на клиента, блокировка клиента по @username, блокировка пригласившего / «Написать пригласившему», «Заказ оформлен с оплатой картой» (CardPaymentsModal), скидка на позицию («Нажмите для скидки»), создание заказа вручную (`OrderCreateModal`), уведомления (polling 15 с: browser notification + звук + toast + бейдж) |
| **Архив** `crm/orders/archive` | CrmOrdersArchive | Архив delivered-заказов |
| **Заказ** `crm/orders/:id` | CrmOrderDetail | Детали заказа, история статусов, редактирование позиций, «Скидка BYN» на заказ (карандаш) — генерирует loyalty marks, ручная скидка на позицию — НЕ генерирует, баннер manager action |
| **Клиенты** `crm/customers` | CrmCustomers | Поиск (имя/username/телефон/TG ID), фильтр периода новых, блокировки (`CustomerBlockModal` — причина, «Причина блокировки…»), заметки (`CustomerNoteModal`), инвайт-баны (`CustomerInviteBanModal` — «Запретить приглашать», «Перенести в запрет», «Заблокировать пригласившего»), «Удалить клиента», доступ сотрудников (`CustomerStaffAccessModal`) |
| **Клиент** `crm/customers/:id` | CrmCustomerDetail | Карточка: заказы, суммы, блокировки, заметки, рефералы, отзывы |
| **Сотрудники** `crm/employees` | CrmEmployees | ПИН (4 цифры, hash + отпечаток с `STAFF_PIN_PEPPER`), роли, смена (`StaffShiftBar` — открыть/закрыть; дневная до 21:15, ночная после 21:15 на 12 ч), аналитика (`StaffMetricStrip`, `StaffSparkline`, `StaffShiftHeatmap`), задачи (`StaffTasksModal`), ЗП (`staff_monthly_salary`), ручные отметки, «Отчёт по клиенту» |
| **Отзывы** `crm/reviews` | CrmReviews | Модерация, QA-режим, месячный розыгрыш |
| **Закупки** `crm/procurements` | CrmProcurements | Поставки: позиции, `warehouse_quantity`, оприходование с ПИН, черновики |
| **Финансы** `crm/finances` | CrmFinances | Счета («Касса в магазине» + доп.), транзакции («Добавить транзакцию», Приход/Расход, редактирование, «Удалить счёт»), «План пробития» (`CrmCashPacingPanel` — месяц, позиции, ежедневный факт, рекомендация), лимиты карт (`CardPaymentsModal` — резервы, «Увеличить лимит», кулдаун 10 дней) |
| **Списания** `crm/write-offs` | CrmWriteOffs | Учёт списаний товаров |
| **Продажи касса** `crm/pos-sales` | CrmPosSales | POS-продажи: completed/pending чеки, дозаполнение себестоимости, удаление, связь с клиентом POS |
| **Бонусы и промокоды** `crm/loyalty` | CrmLoyalty → BonusSystemTab + PromoCodesTab | Правила лояльности по категориям, CRUD промокодов (fixed/percent, gift, описания, валидность) |
| **Рулетка** `crm/wheel` | CrmWheel | Настройки порогов, редкости, пулы призов, аудит спинов |
| **Шаблоны сообщений** `crm/message-templates` | CrmMessageTemplates | Шаблоны статусов для уведомлений |

Все CRM-роуты защищены `beforeEnter: requireAdminAuth`. Мутации заказов дополнительно требуют **активной смены** (`staff_order_shift_restriction_enabled`).

### 4.3 Pinia-stores (10 530 строк)

| Store | Роль |
|---|---|
| `crm.ts` (5 535) | Ядро CRM: заказы, delivered+stats+пагинация, заказы-«требуют действий», POS, клиенты, финансы, пароль прибыли (`profitUnlocked`), пароль «Обзора», staff-заголовки (shift token), идемпотентность мутаций (`clientIdempotencyKey`), уведомления |
| `admin.ts` (2 108) | Авторизация админа, JWT, настройки, баннеры, категории, товары |
| `catalog.ts` (811) | Каталог клиента, фильтры витрины |
| `cart.ts` (404) | Корзина (localStorage) |
| `wheel.ts` (409), `loyalty.ts` (329), `wholesale.ts` (208) | Рулетка / лояльность / опт-режим |
| `user.ts`, `settings.ts` | Telegram-пользователь, настройки приложения |

---

## 5. Жизненный цикл заказа (главный поток)

```
Клиент (Mini App) → POST /api/orders (new)
   → авто-уведомление менеджеру + клиенту
CRM канбан «Новые»
   → drag в «Собран» (in_progress)          ← только этот DnD разрешён
   → ячейка хранения назначается автоматически (pickup_cells)
«Выдать» (issued/delivered)
   → списание stock (stock_deducted=1, только здесь)
   → completed_at фиксируется
   → касса: order_payment (card_amount → лимиты карт, cash_amount → касса)
   → выручка/прибыль приписываются сотруднику, выдавшему заказ
   → 24 ч → archived=1 (в «Архив»)
```

- **Клиент может изменить/отменить заказ** до сборки → `needs_manager_action=1`, заказ уходит в колонку «Требует действий» (красная обводка — отменён, оранжевая — изменён); менеджер жмёт «Принять изменения» (modified → возврат в new, возможен возврат товара) или «Разобрать» (сброс флага).
- **Отмена** → возврат остатков (если были списаны) + удаление из delivered-статистики дня + возврат резерва лимита карты.
- **Прибыль:** `profit = final_amount − total_cost − discount_loyalty`. CRM-скидка на заказ (`orders.discount_amount`) генерирует loyalty-метки и НЕ вычитается из прибыли повторно; ручная скидка на позицию меток не генерирует.

### Приоритет скидок
1. Оптовая цена (wholesale активен)
2. Промокод — **блокирует** лояльность
3. Лояльность — блокируется промокодом и оптом; ≤1 бонус на категорию; только явное действие клиента
4. CRM-скидка на заказ — не блокирует лояльность

---

## 6. Ключевые бизнес-правила (сжатая выжимка из docs/)

- **Часовой пояс:** всё бизнес-время — Europe/Minsk (UTC+3), бизнес-день с 00:00.
- **Остатки:** `stock` — розница (единственный источник для витрины), `warehouse_stock` — склад, недоступен покупателю; перемещения только черновик→оприходование целиком; средняя себестоимость = розница+склад.
- **Опт:** доступ только по секретной ссылке, тиры 100/250/500/1000 BYN, цены на уровне линейка, только gift-промокоды, только через настоящий Mini App, лояльность отключена.
- **Рулетка:** 1 спин / 40 BYN (розница) или / 200 BYN (опт) по delivered-заказам после `start_collecting_at`; остаток копится, не сгорает; призы = автогенерированные промокоды; 8 редкостей.
- **Сотрудники:** ПИН = 4 цифры, hash+отчет (pepper на prod обязателен), одна смена одновременно, дневная смена до 21:15 + ночная на 12 ч после 21:15, любое изменение заказа требует смены, выручка — выдавшему, атомарный аудит, идемпотентность операций.
- **План пробития:** один магазин/одна касса, план+факт+пересчёт, ежедневный итог Z-отчёта, округление до 2 знаков.
- **Лимиты карт:** общие дневные/месячные + персональные аккаунты, кулдаун 10 дней, резерв при создании заказа, mixed card+cash раздельный учёт, запросы «Увеличить лимит».
- **Userbot:** MTProto для обхода лимитов Bot API; структура JSON-логов `{"ev":...}`; **инцидент бана resolveUsername 15.05.2026** — читать `docs/userbot-logging.md` перед любыми изменениями.
- **POS-маскировка:** экран «кассира» скрывает вход в CRM; поиск = пароль.

---

## 7. Порядок разработки (обязателен, из AGENTS.md)

1. Собрать контекст (код, тесты, docs подсистемы).
2. Оценить риск: малый (текст/CSS) / обычный (модалки, кнопки) / высокий (**авторизация, заказы, деньги, остатки, блокировки, права, миграции, внешние сообщения** — составная задача берёт наивысший).
3. Предварительный UX-разбор только для новых/сильно изменённых сценариев.
4. Реализация + сначала только затронутые тесты.
5. Зафиксировать версию → параллельно UX-review и code-review (только чтение).
6. Исправить подтверждённые замечания одним пакетом, повторить только затронутую проверку.
7. Полная сборка + полный набор тестов — один раз в конце.

- Клиентский UI — по `docs/frontend-design-reference-for-agents.md` (клиентская часть ≠ CRM по визуальному языку).
- Production — только через `./ops/prod.sh doctor|plan|deploy|restart|logs`; источник истины — `docs/DEPLOY_REBUILD_RESTART.md`.
- Перед любыми правками userbot — `docs/userbot-logging.md`.
- Модалки: закрывать в try-блоке, не блокировать закрытие loading-флагом (`docs/cursor-skill-modal-async-pattern.md`).

---

## 8. Карта «что где искать» при задачах

| Задача | Смотреть в первую очередь |
|---|---|
| Каталог/витрина | `routes/public.js`, `stores/catalog.ts`, `CategoryView`, `storefront-filters.js`, `product-search-service.js` |
| Заказы клиента | `routes/public.js` (POST /api/orders), `CheckoutView`, `stores/cart.ts`, `order-line-pricing.js` |
| Канбан/выдача | `routes/crm-operations.js`, `CrmOrders.vue`, `stores/crm.ts`, `crm-kanban-board.js`, `pickup-cells.js` |
| Деньги/касса | `routes/crm-finance.js`, `CrmFinances.vue`, `cash-pacing.js`, `card-payment-service.js`, `money.js` |
| Лояльность/промо | `server/loyalty.js`, `promo-code-service.js`, `routes/loyalty.js`, `routes/promo.js`, BonusSystemTab/PromoCodesTab, `docs/loyalty-rules.md`, `docs/promo-rules.md` |
| Опт | `wholesale-service.js`, `WholesaleEntryView`, `stores/wholesale.ts`, `docs/wholesale-rules.md` |
| Сотрудники/смены | `routes/staff.js`, `staff-service.js`, `CrmEmployees.vue`, `docs/staff-management-rules.md` |
| Склад/закупки | `CrmProcurements.vue`, `AdminStockTransferModal`, `docs/inventory-rules.md` |
| Рулетка | `routes/wheel.js`, `WheelView.vue`, `docs/wheel-architecture.md` |
| Отзывы | `product-reviews.js`, `CrmReviews.vue`, `review-monthly-draw.js` |
| Telegram-уведомления | `bot.js`, `userbot/`, `crm-telegram-outbound.js`, `auto-notify.js` |
| Текущее состояние git | ветка `backup/pre-card-redesign-2026-10-09`, незакоммичены 4 docs-файла и диагностические скрипты |

---

## 9. Замечания по состоянию репозитория

- Рабочая ветка — **backup-снапшот перед редизайном лимитов карт**; последний коммит `9ce34db checkpoint: snapshot before card limits redesign`. Основная ветка — `master`.
- Незакоммичены: `docs/ANALYSIS_PROGRESS.md`, `docs/OPEN_QUESTIONS.md`, `docs/PROGRESS_REPORT.md`, `docs/PROJECT_OVERVIEW.md` (от прошлого аудита), плюс диагностические скрипты `server/scripts/diag-*.mjs`, `patch-order-9116-price.mjs`.
- `CRMDASHBOARD_REMOVAL_PLAN.md` — старый план удаления legacy-дашборда (сверить, что выполнен).
- В `server/data/` лежит живая копия БД (`navalivay.db` + WAL) и `userbot.session` — это локальная рабочая копия, **не production**.
- Крупные файлы-«монолиты» (`AdminView.vue` 163 КБ, `crm.ts` 5 535 строк, `CheckoutView.vue` 3 149, `CrmOrders.vue` 3 375) — при правках аккуратно, правки точечные.

---

*Документ — рабочий справочник. Дополнять при изменении подсистем.*
