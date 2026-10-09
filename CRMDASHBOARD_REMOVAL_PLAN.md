# План удаления CrmDashboard

## Проблема
Необходимо удалить весь код, связанный с CrmDashboard (дашборд с графиками, защищенный лицензионным ключом), при этом сохранив все остальные CRM-страницы нетронутыми.

## Текущее состояние

### Frontend

**Компонент CrmDashboard:**
- Файл: `frontend/src/views/admin/crm/CrmDashboard.vue`
- Статус: Существует, но не подключен к роутингу
- Функциональность: Отображает статистику (выручка, прибыль, заказы) с графиками за разные периоды (день/месяц/год), защищен паролем доступа

**Компонент BarChart:**
- Файл: `frontend/src/components/BarChart.vue`
- Использование: Только в `CrmDashboard.vue` (строка 117)
- Функциональность: Отрисовка bar chart для графиков

**Store (frontend/src/stores/crm.ts):**
```typescript
// Интерфейс на строках 207-235
export interface DashboardStats {
  period: string
  stats: {
    totalSales: number
    revenue: number
    profit: number
    averageCheck: number
    uniqueCustomers: number
  }
  topProducts: Array<{...}>
  ordersByStatus: Array<{...}>
  deliveryStats?: {...}
  pickupStats?: {...}
}

// Состояние на строках 262-310
const profitUnlocked = ref(...)
const verifyingProfitAccess = ref(false)
const dashboardStats = ref<DashboardStats | null>(null)
const loadingDashboard = ref(false)
const dashboardTimeseries = ref<Array<...>>([])
const loadingTimeseries = ref(false)

function fetchDashboard(period, offset) { ... } // строки 282-291
function fetchDashboardTimeseries(period, offset, year) { ... } // строки 297-310

// Экспорт на строках 956-969
return {
  // Profit access
  profitUnlocked,
  isProfitUnlocked,
  verifyingProfitAccess,
  lockProfitAccess,
  // Dashboard
  dashboardStats,
  loadingDashboard,
  fetchDashboard,
  dashboardTimeseries,
  loadingTimeseries,
  fetchDashboardTimeseries,
  ...
}
```

**AdminView.vue:**
- Импорты (строка 814): `const { dashboardStats, loadingDashboard, profitUnlocked, verifyingProfitAccess, dashboardTimeseries, loadingTimeseries } = storeToRefs(crmStore)`
- Dashboard UI (строки 13-200): Весь блок с графиками и метриками
- Вычисляемые свойства (строки 1121-1171): `overviewStats`, `profitMargin`, `overviewDeliveries`, `overviewStatuses`, `topGroupsByProfit`, и т.д.
- Chart helpers (строки 2072-2139): `chartData`, `formatChartValue`, `getBarHeight`, `getBarHeightPx`
- Функции загрузки (строки 1275-1381): `watch` для обновления dashboard, `submitOverviewAccess`, `submitProfitPassword`
- dataLoaded.dashboard (строки 1072-1078, используется в нескольких местах)

### Backend

**server/routes/crm.js:**
```javascript
// Endpoint для dashboard (строки 22-151)
crmRouter.get('/api/admin/crm/dashboard', authMiddleware, (req, res) => {
  // Возвращает статистику: выручка, прибыль, топ продукты, статусы заказов, доставка
})

// Endpoint для timeseries (строки 154-222)
crmRouter.get('/api/admin/crm/dashboard-timeseries', authMiddleware, (req, res) => {
  // Возвращает детализированные данные для графиков по дням/месяцам
})
```

### Документация

**docs/dashboard-chart-integration.md:**
- Описание интеграции данных графика дашборда
- Инструкции по расширению API
- TypeScript типы и примеры SQL-запросов

## Важно: Что НЕ удаляем

**Profit password механизм полностью сохраняется:**
- Используется не только для dashboard, но и для раздела "Настройки" (Settings)
- `frontend/src/stores/crm.ts`: функции `verifyProfitPassword`, состояния `profitUnlocked`, `verifyingProfitAccess`
- `server/routes/admin.js`: endpoints `/api/admin/settings/profit-password/verify` и `/api/admin/settings/profit-password`
- `server/db.js`: поле `profit_password_hash` в таблице settings
- `server/migrations/add_profit_password_setting.js`

**Другие CRM страницы остаются:**
- `/admin/crm/orders` — заказы
- `/admin/crm/customers` — клиенты
- `/admin/crm/procurements` — закупки
- `/admin/crm/finances` — финансы
- `/admin/crm/employees` — сотрудники
- `/admin/crm/write-offs` — списания
- `/admin/crm/message-templates` — шаблоны сообщений

## Предлагаемые изменения

### 1. Удалить файлы
- `frontend/src/views/admin/crm/CrmDashboard.vue`
- `frontend/src/components/BarChart.vue`
- `docs/dashboard-chart-integration.md`

### 2. Frontend Store (frontend/src/stores/crm.ts)

**Удалить:**
- Интерфейс `DashboardStats` (строки 207-235)
- Состояния: `dashboardStats`, `loadingDashboard`, `dashboardTimeseries`, `loadingTimeseries` (строки 278-295)
- Функции: `fetchDashboard` (строки 282-291), `fetchDashboardTimeseries` (строки 297-310)
- Экспорт этих элементов из `return` блока (строки 963-969)

**Сохранить:**
- Весь profit password механизм (строки 262-276, 635-660)
- Все остальные функции и состояния для CRM страниц

### 3. AdminView.vue

**Удалить:**

1. Из импортов `storeToRefs` (строка 814):
   - `dashboardStats`
   - `loadingDashboard`
   - `dashboardTimeseries`
   - `loadingTimeseries`
   - (Оставить `profitUnlocked`, `verifyingProfitAccess` - используются для Settings)

2. Dashboard UI блок (строки 13-200):
   - Весь `<template v-if="activeTab === 'dashboard'">` раздел с графиками

3. Состояния и переменные (строки 820-863):
   - `overviewPeriods`
   - `overviewPeriod`
   - `selectedMetric`
   - `selectedYear`
   - `overviewOffset`
   - `activeOverviewLabel`
   - `isAtCurrentOverview`
   - `overviewRangeLabel`
   - `currentMonthName`
   - `prevOverviewRange()`
   - `nextOverviewRange()`

4. Вычисляемые свойства (строки 1121-1171):
   - `overviewStats`
   - `profitMargin`
   - `overviewDeliveries`
   - `overviewStatuses`
   - `topGroupsByProfit`
   - `overviewStatusTotal`
   - `topGroupsMaxProfit`

5. Chart helpers (строки 2072-2139):
   - `hoveredBarIndex`
   - `chartData`
   - `formatChartValue()`
   - `getBarHeight()`
   - `getBarHeightPx()`

6. Функции загрузки данных:
   - `watch([overviewPeriod, overviewOffset, selectedYear, profitUnlocked], ...)` (строки 1275-1297)
   - Код загрузки dashboard в `onMounted` (строки 1299-1320)
   - `submitOverviewAccess()` (строки 1359-1381)
   - Части `submitProfitPassword()` связанные с dashboard (строки 1334-1357, оставить только общую логику верификации)
   
7. Из `dataLoaded` (строка 1072):
   - Ключ `'dashboard'` из типа `DataSliceKey`
   - Удалить `dashboard: false` из объекта (строка 1078)

8. Из функций загрузки:
   - Удалить dashboard проверки из `ensureTabData()` (строки 953-967)
   - Удалить dashboard из `loadInitialAdminData()` (строки 1017-1022)

9. CSS (строки 2143-2154):
   - Стили `.dash-fade-enter-active`, `.dash-fade-leave-active` и связанные

**Сохранить:**
- Всю логику profit password для Settings (строки 1383-1398, 1400-1457)
- `profitPassword`, `profitError`, `verifyingProfit` переменные (используются в Settings)
- Остальной функционал AdminView

### 4. Backend (server/routes/crm.js)

**Удалить:**
- Весь блок "DASHBOARD (Главная CRM)" (строки 19-151):
  - Endpoint `GET /api/admin/crm/dashboard`
  - Комментарии и helper функции внутри
- Весь блок "Dashboard Timeseries" (строки 153-222):
  - Endpoint `GET /api/admin/crm/dashboard-timeseries`

**Сохранить:**
- Все остальные CRM endpoints (employees, customers, orders, procurements, write-offs, message templates, etc.)

### 5. Router (frontend/src/router/index.ts)

**Изменений не требуется:**
- CrmDashboard не был добавлен в роутер
- Все существующие CRM роуты остаются без изменений

### 6. Navigation (frontend/src/constants/adminNavigation.ts)

**Изменений не требуется:**
- Dashboard остается в `adminTabs` как вкладка "Обзор"
- Но теперь он просто не будет показывать dashboard с графиками
- CRM links остаются без изменений

## Порядок выполнения

1. Удалить файлы компонентов (CrmDashboard.vue, BarChart.vue, документация)
2. Очистить backend endpoints (crm.js)
3. Очистить frontend store (crm.ts)
4. Очистить AdminView.vue (удалить UI, состояния, функции)
5. Проверить, что profit password механизм продолжает работать для Settings

## Риски и проверки

**После удаления проверить:**
1. Settings раздел с profit password все еще работает
2. Все CRM страницы (/admin/crm/*) доступны и работают
3. Нет ошибок в консоли браузера
4. AdminView открывается без ошибок
5. Вкладка "Обзор" (dashboard) либо показывает что-то простое, либо просто пустая (нужно решить что показывать)

**Важно:**
- Вкладка "dashboard" в AdminView останется в навигации, но теперь она не будет показывать графики
- Нужно решить, что показывать на этой вкладке после удаления (пустая страница, базовая статистика, или редирект на другую вкладку)
