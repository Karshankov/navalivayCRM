# Прогресс аудита CRM-системы

**Дата начала:** 2026-10-09  
**Аналитик:** Hermes Agent  
**Статус:** В процессе — Этап 1: Инвентаризация проекта

---

## Изученные области

### 1. Общая структура проекта ✓✓

**Статус:** Завершено базовое изучение

**Корневая директория:** `/Users/pavelkarshankov/Documents/CRM-local/app/`

**Основные компоненты:**
- `frontend/` — клиентское приложение (Vue.js 3.5.18)
- `server/` — серверная часть (Node.js, Express)
- `docs/` — документация проекта
- `ops/` — скрипты развертывания и управления
- `uploads/` — загруженные файлы (аватары клиентов и др.)
- `shared/` — общие модули между frontend и backend

**Технологический стек (подтверждено):**

**Frontend:**
- Vue.js 3.5.18
- Vue Router 4.5.0
- Pinia 3.0.3 (state management)
- Vite 7.0.6 (сборщик)
- TypeScript 5.8.0
- UnoCSS 66.5.1
- Vee-Validate 4.15.1 (валидация форм)
- Headless UI + Heroicons
- Vitest 2.1.4 (тестирование)
- Node.js >=20.19.0 || >=22.12.0

**Backend:**
- Node.js (>=18.0.0)
- Express 4.19.2
- Better-SQLite3 9.6.0 (SQL база данных)
- bcryptjs 2.4.3 (хеширование паролей)
- jsonwebtoken 9.0.2 (JWT авторизация)
- Telegraf 4.16.3 (Telegram Bot API)
- Telegram 2.26.22 (Telegram userbot)
- Multer 1.4.5 (загрузка файлов)
- Sharp 0.34.5 (обработка изображений)
- express-rate-limit 7.3.1
- helmet 7.1.0 (безопасность)
- cors 2.8.5

**Архитектура:** Monorepo с npm workspaces

**Точки входа:**
- Frontend dev server: `npm run dev` (Vite, port 5173)
- Backend dev server: `server/dev-server.js`
- Backend production: `server/index.js`
- Telegram bot: `server/bot.js`
- Userbot: порт 8083

**Production deployment:**
- API: systemd `navalivay-server` (порт 8082)
- Telegram bot: PM2 `navalivay-bot`
- Userbot: PM2 `navalivay-userbot` (порт 8083)

### 2. Существующая документация

**Обнаруженные документы:**
- `AGENTS.md` — правила работы для AI-агентов
- `docs/` — директория с документацией (42 файла)
- `CRMDASHBOARD_REMOVAL_PLAN.md` — план удаления старого дашборда
- `implementation_plan.md` — план реализации
- `WARP.md` — специфичная документация

**Ключевые правила из AGENTS.md:**
- Строгий запрет прямых команд на production
- Использование только `./ops/prod.sh` для production операций
- Обязательное чтение `docs/development-workflow-for-agents.md` перед началом задачи
- Frontend design reference: `docs/frontend-design-reference-for-agents.md`
- Deployment: `docs/DEPLOY_REBUILD_RESTART.md`

**Документированные подсистемы:**
- Loyalty system (`docs/loyalty-rules.md`)
- Promo codes (`docs/promo-rules.md`)
- Wholesale (`docs/wholesale-rules.md`)
- Telegram Mini App (`docs/telegram-mini-app.md`)
- Timezone rules (`docs/timezone-rules.md`)
- Cash pacing (`docs/cash-pacing-rules.md`)
- Card payment limits (`docs/card-payment-limits-rules.md`)
- Inventory (`docs/inventory-rules.md`)
- Userbot logging (`docs/userbot-logging.md`)

**Cursor skills (перенесены в docs/):**
- CRM orders board (Kanban)
- Modal async pattern
- POS cashier system
- Profile and tabbar

**Claude memory:**
- Code review loop
- UX improver workflow

### 3. Тестирование

**Обнаруженные test suites (из server/package.json):**
- `test:telegram-auth` — Telegram miniapp аутентификация
- `test:referral` — реферальная система
- `test:staff` — управление персоналом
- `test:inventory` — инвентаризация
- `test:money` — округление денег
- `test:new-badge` — бейджи "новинка"
- `test:discounts` — скидки
- `test:dashboard-access` — доступ к дашборду
- Основной `test` скрипт включает 50+ тестовых файлов

**Тестируемые области:**
- Public order flow (smoke test)
- Pickup cells
- Wholesale
- Promo lifecycle & migration
- Loyalty system
- Cash accounts & pacing
- Low stock groups
- Total control groups
- Catalog discounts
- Storefront filters
- Top sales groups
- Category group completeness
- Product reviews (множество тестов)
- Review monthly draw
- Agreements
- Business bot & auto-notify
- Userbot (client & quick replies)
- CRM (kanban, search, polling, regressions)
- Product search service
- Cover image service
- Wheel audit

---

## Области для изучения

### Приоритет 1 (критично)
- [ ] База данных: schema, миграции, таблицы
- [ ] API маршруты: все endpoints в `server/routes/`
- [ ] Бизнес-логика заказов: создание, статусы, оплата
- [ ] Авторизация и права доступа
- [ ] Финансовые расчеты: прибыль, выручка, расходы

### Приоритет 2 (важно)
- [ ] Frontend: структура клиентского интерфейса
- [ ] Frontend: административная панель CRM
- [ ] Telegram Bot: интеграция и функции
- [ ] Userbot: назначение и работа
- [ ] Управление складом и остатками

### Приоритет 3 (дополнительно)
- [ ] Система лояльности
- [ ] Промокоды
- [ ] Оптовые продажи
- [ ] Отзывы клиентов
- [ ] Статистика и аналитика

---

## Подтвержденные факты

1. **Название проекта:** Navalivay (магазин с выдачей заказов)
2. **Архитектура:** Monorepo с разделением на frontend (Vue) и backend (Node.js/Express)
3. **База данных:** SQLite через better-sqlite3
4. **Авторизация:** JWT токены (jsonwebtoken)
5. **Telegram интеграция:** 
   - Bot через Telegraf
   - Userbot через telegram library
   - Telegram Mini App поддержка
6. **Production окружение:** 
   - API на порту 8082
   - Userbot на порту 8083
   - Три процесса: API (systemd), Bot (PM2), Userbot (PM2)
7. **Обработка изображений:** Sharp для аватаров и загрузок
8. **Файловые загрузки:** Multer + хранилище в `/uploads/`
9. **Безопасность:** helmet, cors, rate limiting
10. **Тестирование:** Vitest (frontend), node test scripts (backend)

---

## Обоснованные предположения

1. CRM включает два основных интерфейса:
   - Клиентский (оформление заказов)
   - Административный (управление заказами и магазином)
2. Система ведет учет:
   - Заказов и их статусов
   - Клиентов
   - Оплат (наличные + карта)
   - Товаров и остатков
   - Финансовых показателей
3. Интеграция с Telegram используется для:
   - Уведомлений клиентов
   - Возможно, для оформления заказов через бота
4. Userbot — отдельный сервис для расширенного взаимодействия с Telegram API

---

## Открытые вопросы

### Технические
1. Где находится файл базы данных SQLite?
2. Какие миграции уже применены?
3. Как организованы маршруты API?
4. Какая структура компонентов во frontend?
5. Есть ли переменные окружения (.env файлы)?

### Бизнес-логика
1. Как именно работает процесс оформления заказа?
2. Какие статусы заказов существуют и как они меняются?
3. Как рассчитывается прибыль?
4. Какие роли пользователей существуют в CRM?
5. Как работает система оплат (наличные/карта)?
6. Есть ли механизм резервирования товаров?
7. Как учитываются расходы и закупочная стоимость?

---

## Следующие шаги

1. Изучить структуру базы данных (migrations/, schema)
2. Прочитать все файлы в `server/routes/` для понимания API
3. Изучить структуру `frontend/src/views/` и `frontend/src/components/`
4. Найти и изучить основные модели данных
5. Прочитать ключевые документы из `docs/`
6. Восстановить flow оформления заказа от клиента до базы данных

---

**Последнее обновление:** 2026-10-09 16:05
