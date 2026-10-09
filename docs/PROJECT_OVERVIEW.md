# Обзор проекта CRM Navalivay

**Дата создания:** 2026-10-09  
**Статус документа:** Предварительный (в процессе анализа)

---

## 1. Общее описание

**Navalivay** — CRM-система для онлайн-магазина с пунктом выдачи заказов. Система объединяет клиентский интерфейс для оформления заказов и административную панель для управления операциями магазина.

### Основные функции

**Для клиентов:**
- Просмотр каталога товаров по категориям
- Оформление заказов через Telegram Mini App
- Система лояльности (бонусы за покупки)
- Промокоды и специальные предложения
- Оптовые продажи (wholesale) по специальным ссылкам
- История заказов
- Колесо фортуны (wheel)
- Отзывы на товары

**Для персонала магазина (CRM):**
- Kanban-доска для управления заказами
- Управление клиентами и блокировки
- Учет финансов (касса, прибыль, расходы)
- Управление складом и остатками
- POS-система для продаж в магазине
- Система лимитов оплаты картой
- План пробития наличных средств
- Управление персоналом и смен
- Статистика и аналитика

---

## 2. Архитектура проекта

### Тип архитектуры
Monorepo с разделением на frontend и backend

### Основные компоненты

```
app/
├── frontend/          # Vue.js клиентское приложение
│   ├── src/
│   │   ├── views/     # Страницы (клиент + админ)
│   │   ├── components/
│   │   ├── stores/    # Pinia state management
│   │   ├── router/    # Vue Router
│   │   └── utils/
│   └── public/
├── server/            # Node.js backend
│   ├── routes/        # API маршруты
│   ├── migrations/    # Миграции БД
│   ├── utils/         # Утилиты и бизнес-логика
│   ├── services/      # Сервисы
│   ├── tests/         # Тесты
│   ├── bot.js         # Telegram Bot
│   └── userbot/       # Telegram Userbot
├── docs/              # Документация
├── ops/               # Скрипты деплоя
└── uploads/           # Загруженные файлы
```

---

## 3. Технологический стек

### Frontend
- **Фреймворк:** Vue.js 3.5.18 (Composition API)
- **Роутинг:** Vue Router 4.5.0
- **State Management:** Pinia 3.0.3
- **Сборщик:** Vite 7.0.6
- **Язык:** TypeScript 5.8.0
- **CSS:** UnoCSS 66.5.1 (utility-first)
- **UI компоненты:** Headless UI, Heroicons
- **Валидация форм:** Vee-Validate 4.15.1 + Zod 3.24.0
- **Утилиты:** VueUse 13.9.0
- **Карусели:** Embla Carousel 8.6.0
- **Тестирование:** Vitest 2.1.4, Happy DOM

### Backend
- **Runtime:** Node.js >=18.0.0
- **Фреймворк:** Express 4.19.2
- **База данных:** SQLite 3 (Better-SQLite3 9.6.0)
- **Аутентификация:** JWT (jsonwebtoken 9.0.2), bcryptjs 2.4.3
- **Telegram:** 
  - Telegraf 4.16.3 (Bot API)
  - Telegram 2.26.22 (MTProto Userbot)
- **Файлы:** 
  - Multer 1.4.5 (загрузка)
  - Sharp 0.34.5 (обработка изображений)
- **Безопасность:** Helmet 7.1.0, CORS, express-rate-limit 7.3.1
- **Утилиты:** dotenv, slugify, morgan (логирование)

### База данных
- **Тип:** SQLite 3
- **Режим журналирования:** WAL (Write-Ahead Logging)
- **Путь:** `server/data/navalivay.db`
- **Миграции:** 70+ файлов миграций
- **Foreign keys:** Включены

### Инфраструктура
- **Менеджер процессов:** PM2 (bot, userbot)
- **Системный сервис:** systemd (API)
- **Production порты:**
  - API: 8082
  - Userbot: 8083

---

## 4. Основные подсистемы

### 4.1 Каталог товаров
- Категории (categories)
- Группы категорий (category_groups) с иерархией
- Товары (products)
- Варианты товаров (product_variants) — цвета, крепость и т.д.
- Изображения товаров
- Кросс-селлинг
- Бейджи ("новинка", "топ продаж")
- Управление остатками (stock)
- Минимальные остатки (min_stock)
- Закупочная цена (cost_price)

### 4.2 Заказы (Orders)
- **Таблица:** `orders`
- **Статусы:** new → accepted → issued → delivered (и другие)
- **Поля заказа:**
  - order_number (уникальный номер)
  - customer_id
  - employee_id (кто обработал)
  - status
  - total_amount, discount_amount, final_amount
  - profit (прибыль)
  - payment_method (cash/card)
  - payment_status
  - delivery_type (pickup/delivery)
  - created_at, completed_at
  - archived (для архивации старых заказов)
  - stock_deducted (списаны ли остатки)
  
- **Позиции заказа:** `order_items`
  - product_id, variant_id
  - quantity, price_per_unit, cost_per_unit
  - discount_amount
  - total_price, total_cost
  - display_title (отображаемое название)
  - catalog_price (оригинальная цена из каталога)

- **История статусов:** `order_status_history`

### 4.3 Клиенты (Customers)
- **Таблица:** `customers`
- **Идентификация:** telegram_id, telegram_username
- **Данные:**
  - first_name, last_name, phone
  - customer_photo (аватар из Telegram)
  - first_visit_at, last_order_at
  - total_orders, total_spent
  - notes (заметки менеджера)
  - deleted_at (мягкое удаление)
  
- **Блокировки:** `customer_blocks`
  - block_type (delivery, referral)
  - reason, blocked_by
  - block_until (временная блокировка)
  - pending/active статус

- **Заметки:** `pending_customer_notes` (отложенные заметки до первого заказа)

### 4.4 Система лояльности
- **Таблицы:** 
  - `loyalty_categories` (liquids, disposables, devices)
  - `loyalty_rules` (правила начисления)
  - `loyalty_customer_progress` (прогресс клиента)
  - `loyalty_bonuses` (доступные бонусы)
  - `loyalty_usage` (использованные бонусы)
  
- **Правила:**
  - Бонусы начисляются по категориям
  - Один заказ = максимум один бонус на категорию
  - Промокоды блокируют лояльность
  - Опт блокирует лояльность
  - Бонусы не начисляются на товары со скидкой

### 4.5 Промокоды
- **Таблица:** `promo_codes`
- **Типы скидок:** fixed, percent
- **Поля:**
  - code, discount_value
  - min_order_amount, max_uses
  - has_gift (флаг подарка)
  - customer_description, manager_description
  - valid_from_date, duration_days
  - customer_telegram_id (привязка к клиенту для колеса)
  
- **Использование:** `promo_usage`

### 4.6 Оптовые продажи (Wholesale)
- **Таблицы:**
  - `wholesale_tiers` (100, 250, 500, 1000 BYN)
  - `wholesale_links` (секретные ссылки)
  - `category_group_wholesale_prices` (цены по группам)
  
- **Правила:**
  - Доступ по секретной ссылке
  - Цены на уровне групп категорий
  - Минимальная сумма заказа
  - Только gift-промокоды
  - Только через Telegram Mini App

### 4.7 Финансы и касса
- **Счета:** `cash_accounts`
- **Транзакции:** `cash_transactions`
  - type: income, expense, order_payment, refund
  - amount, description
  - order_id, employee_id
  
- **План пробития:** `cash_pacing_*` таблицы
  - Месячный план наличных
  - Ежедневный факт
  - Автоперерасчет

- **Лимиты карт:** `card_payment_*` таблицы
  - Общие дневные/месячные лимиты
  - Персональные лимиты клиентов
  - Кулдаун 10 дней
  - Резервирование при создании заказа

### 4.8 Персонал (Staff)
- **Таблица:** `employees`
  - username, password_hash
  - first_name, last_name, position
  - active
  
- **Смены:** `staff_shifts`
- **Действия:** `staff_activity_log`
- **Внутренние уведомления:** `internal_notifications`

### 4.9 Склад и инвентаризация
- **Остатки:** поле `stock` в `products`
- **Списание:** автоматическое при выдаче заказа (stock_deducted)
- **Закупки:** `procurements`, `procurement_items`
- **Списания:** `write_offs`, `writeoff_items`
- **Низкие остатки:** `low_stock_groups`
- **Локации:** `inventory_locations` (розница/склад)
- **Ячейки выдачи:** `pickup_cells`

### 4.10 Telegram интеграция
- **Bot:** `server/bot.js`
  - Уведомления клиентам
  - Команды
  - Menu button для Mini App
  
- **Userbot:** `server/userbot/`
  - Отправка сообщений через MTProto
  - Обход лимитов Bot API
  - Логирование: `userbot_send_log`
  - Кеш пользователей: `userbot_user_cache`
  
- **Business Bot:** 
  - Quick replies (быстрые ответы)
  - Шаблоны статусов
  - Verification codes
  - Business connections

### 4.11 Отзывы (Product Reviews)
- **Таблицы:**
  - `product_reviews`
  - `review_quick_tags`
  - `customer_review_preferences`
  
- **Месячный розыгрыш:** `review_monthly_draws`

### 4.12 Колесо фортуны (Wheel)
- **Таблицы:**
  - `wheel_prize_templates` (шаблоны призов)
  - `wheel_spins` (вращения)
  - `wheel_audit_log` (аудит)

### 4.13 POS-продажи
- **Таблицы:**
  - `pos_customers` (клиенты магазина)
  - `pos_sales` (продажи)
  - `pos_sale_items` (позиции)

### 4.14 Реферальная система
- **Таблицы:**
  - `referral_authorizations`
  - `referral_outcomes`
  - `invite_bans`
  - `staff_access_grants`
  - `disallowed_inviter_usernames`

### 4.15 Другие подсистемы
- **Баннеры:** `banners` (главная страница)
- **Настройки:** `settings` (key-value)
- **Шаблоны сообщений:** `message_templates`
- **Соглашения:** `agreements`, `agreement_acceptances`
- **Фильтры витрины:** `storefront_filter_profiles`
- **Скидки каталога:** `catalog_discounts`
- **Логи посещений:** `visit_logs`
- **Кеш миниатюр:** `image_thumbnail_cache`
- **Поиск товаров:** `product_search_index`

---

## 5. API маршруты

### Public API (`/api/*`)
**Файл:** `server/routes/public.js`

Основные endpoint'ы для клиентов:
- `GET /api/settings` — настройки приложения
- `GET /api/categories` — список категорий
- `GET /api/category/:slug` — товары категории
- `GET /api/products/:id` — детали товара
- `POST /api/orders` — создание заказа
- `GET /api/orders/:id` — информация о заказе
- `PATCH /api/orders/:id` — редактирование заказа
- `POST /api/promo/validate` — валидация промокода
- `GET /api/customer/photo` — аватар клиента
- `GET /api/customer/orders` — история заказов
- `POST /api/reviews` — отправка отзыва
- Wholesale endpoints
- Card payment endpoints
- Loyalty endpoints
- Wheel endpoints

**Авторизация:** Telegram Mini App initData

### Admin API (`/api/admin/*`)
**Файлы:** 
- `server/routes/admin.js` — основной CRUD
- `server/routes/crm.js` — операции CRM
- `server/routes/crm-operations.js` — действия с заказами
- `server/routes/crm-finance.js` — финансовая отчетность

**Авторизация:** JWT токен (username/password)

Основные группы:
- `/api/admin/categories/*` — управление категориями
- `/api/admin/products/*` — управление товарами
- `/api/admin/crm/orders/*` — заказы
- `/api/admin/crm/customers/*` — клиенты
- `/api/admin/crm/finance/*` — финансы
- `/api/admin/crm/staff/*` — персонал
- `/api/admin/crm/inventory/*` — склад

### Остальные маршруты
- `server/routes/loyalty.js` — управление лояльностью
- `server/routes/promo.js` — управление промокодами
- `server/routes/pos.js` — POS-система
- `server/routes/staff.js` — управление персоналом
- `server/routes/wheel.js` — колесо фортуны

---

## 6. Frontend структура

### Клиентские страницы
- `/` — HomeView (главная, баннеры, категории)
- `/category/:slug` — CategoryView (товары категории)
- `/p/:id` — ProductView (карточка товара)
- `/checkout` — CheckoutView (оформление заказа)
- `/my-order` — MyOrderView (активный заказ)
- `/profile` — ProfileView (профиль, лояльность)
- `/profile/orders` — OrderHistoryView (история)
- `/profile/orders/:id` — OrderDetailView (детали заказа)
- `/wheel` — WheelView (колесо фортуны)
- `/opt/:code/:secret` — WholesaleEntryView (вход в опт)

### Административные страницы
- `/admin` — AdminView (вход в CRM)
- `/admin/crm/orders` — CrmOrders (Kanban доска)
- `/admin/crm/orders/archive` — CrmOrdersArchive
- `/admin/crm/orders/:id` — CrmOrderDetail
- `/admin/crm/customers` — CrmCustomers
- `/admin/crm/customers/:id` — CrmCustomerDetail
- `/admin/crm/finance` — CrmFinance
- `/admin/crm/finance/cash-pacing` — CrmCashPacing
- `/admin/crm/pos` — POS-система
- `/admin/crm/staff` — управление персоналом
- Loyalty, Promo, Wholesale админки

### State Management (Pinia)
Основные stores:
- `admin.ts` — авторизация админа
- `cart.ts` — корзина
- `customer.ts` — данные клиента
- `orders.ts` — заказы
- `wholesale.ts` — оптовый режим
- `loyalty.ts` — лояльность
- `wheel.ts` — колесо

---

## 7. Бизнес-правила

### Временные зоны
- **Все даты:** Europe/Minsk (UTC+3)
- Бизнес-день начинается в 00:00 по Минску
- Documented in: `docs/timezone-rules.md`

### Приоритеты скидок
1. Оптовая цена (если wholesale активен)
2. Промокод (блокирует лояльность)
3. Скидка лояльности (блокируется промокодом и оптом)
4. CRM-скидка на заказ (не блокирует лояльность)

### Округление денег
- Все суммы округляются до 2 знаков
- Используется `roundMoney()` из `server/utils/money.js`
- Миграция: `round_money_columns.js`

### Учет прибыли
```
profit = final_amount - total_cost - discount_loyalty
```
- `final_amount` — сумма к оплате
- `total_cost` — сумма закупочных цен
- `discount_loyalty` — скидка лояльности (не учитывает CRM-скидку)

### Остатки товаров
- Списываются при переводе в статус "issued" или "delivered"
- Возвращаются при отмене заказа
- Флаг `stock_deducted` отслеживает состояние

---

## 8. Безопасность

### Авторизация
- **Клиенты:** Telegram Mini App initData (HMAC-SHA256)
- **Админы:** JWT токены (username + bcrypt password)
- **Реферальная система:** опциональная авторизация по приглашениям

### Rate Limiting
- Public read: 120 req/min
- Public mutations: 40 req/min
- Express-rate-limit middleware

### Валидация
- **Frontend:** Vee-Validate + Zod schemas
- **Backend:** всегда окончательный источник истины

### Безопасные практики
- Foreign keys включены
- Транзакции для критических операций
- Helmet для HTTP заголовков
- CORS настроен
- Secrets в .env (не в репозитории)

---

## 9. Тестирование

### Frontend тесты
- **Фреймворк:** Vitest
- **Окружение:** Happy DOM
- Компонентные тесты в `__tests__/` папках

### Backend тесты
- **Локация:** `server/tests/`
- **Запуск:** `npm test`
- **Количество:** 50+ тестовых файлов

### Тестируемые области
- Telegram auth (adversarial)
- Referral system
- Staff management
- Inventory
- Money rounding
- Product reviews (множество тестов)
- CRM operations
- Wholesale
- Promo codes
- Loyalty
- Cash pacing
- Card payments
- Wheel

### Test scripts в package.json
```json
"test": "npm --prefix frontend run test:unit && npm --prefix server run test"
"test:telegram-auth"
"test:referral"
"test:staff"
"test:inventory"
"test:money"
```

---

## 10. Deployment

### Production окружение
- **Сервер:** VPS
- **Процессы:**
  - API: systemd service `navalivay-server` (порт 8082)
  - Bot: PM2 `navalivay-bot`
  - Userbot: PM2 `navalivay-userbot` (порт 8083)

### Скрипты деплоя
- **Файл:** `ops/prod.sh`
- **Команды:**
  - `./ops/prod.sh doctor` — диагностика
  - `./ops/prod.sh plan <SHA>` — план деплоя
  - `./ops/prod.sh deploy <SHA>` — деплой
  - `./ops/prod.sh restart api|bot|userbot` — рестарт
  - `./ops/prod.sh logs api|bot|userbot` — логи

### Правило безопасности
**Запрещены** прямые команды на production без использования `ops/prod.sh`

### Документация деплоя
- `docs/DEPLOY_REBUILD_RESTART.md` — единственный источник истины
- `docs/prod-hotfix-playbook.md` — hotfix workflow

---

## 11. Workflow разработки

### Обязательный порядок
Документ: `docs/development-workflow-for-agents.md`

**Этапы:**
1. Сбор контекста (изучение кода, тестов, документации)
2. Определение уровня риска (малый/обычный/высокий)
3. Предварительный UX-разбор (для UI изменений)
4. Реализация + целевые тесты
5. Параллельные проверки (UX + code review)
6. Пакетное исправление замечаний
7. Финальная сборка и полные тесты

### Уровни риска
- **Малый:** текст, CSS, отступы без логики
- **Обычный:** модалки, формы, новые кнопки
- **Высокий:** авторизация, заказы, деньги, остатки, блокировки, миграции

### Code review
- Запускать `code-reviewer` для среднего и высокого риска
- Повторять до 0 подтвержденных замечаний

### UX review
- Запускать `ux-improver` после UI изменений
- Проверять мобильные размеры и Telegram Mini App

---

## 12. Известные особенности

### Telegram Mini App
- Обязательное условие для wholesale checkout
- Compact mode поддержка
- Avatar caching на диске
- Documented in: `docs/telegram-mini-app.md`

### Userbot ban incident
- Инцидент 15.05.2026: бан resolveUsername
- FloodWait-цикл
- Documented in: `docs/userbot-logging.md`

### Modal async pattern
- Anti-pattern: loading flag блокирует закрытие
- Fix: закрывать модалку в try блоке
- Documented in: `docs/cursor-skill-modal-async-pattern.md`

### Frontend design reference
- Только для клиентского UI, не для CRM
- Documented in: `docs/frontend-design-reference-for-agents.md`

---

## 13. Что требует дальнейшего изучения

### Приоритет 1 (критично)
- [ ] Детальная схема всех таблиц БД
- [ ] Полный список API endpoints с параметрами
- [ ] Подробные flow заказов (создание, статусы, оплата)
- [ ] Права доступа и роли пользователей
- [ ] Формулы расчета прибыли и финансов

### Приоритет 2 (важно)
- [ ] Детальная структура frontend компонентов
- [ ] Механизм синхронизации данных
- [ ] Обработка ошибок и retry логика
- [ ] Полный lifecycle loyalty bonuses
- [ ] Inventory transfer механизм

### Приоритет 3 (дополнительно)
- [ ] Wheel rarity и prize pools
- [ ] Review QA режимы
- [ ] Staff activity logging детали
- [ ] Agreements lifecycle
- [ ] Storefront filters implementation

---

## 14. Контакты и ресурсы

### Репозиторий
- Локальный путь: `/Users/pavelkarshankov/Documents/CRM-local/app/`

### Документация
- Основная: `app/docs/`
- Workflow: `app/AGENTS.md`
- Skills: `app/.cursor/skills/`

### Команды разработки
```bash
# Development
npm run dev              # Запуск frontend + backend
npm run dev:frontend     # Только frontend (port 5173)
npm run dev:server       # Только backend (port 8082)

# Build
npm run build            # Production build

# Testing
npm test                 # Все тесты
npm run test:unit        # Frontend тесты

# Linting
npm run lint
```

---

**Примечание:** Этот документ будет обновляться по мере углубления анализа проекта.
