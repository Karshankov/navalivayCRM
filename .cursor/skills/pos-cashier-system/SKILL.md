# POS-система "Касса" (Fake CRM)

## Назначение

Система маскировки админ-панели под интерфейс кассира магазина. Экран блокировки выглядит как рабочее место кассира, но поле "Поиск товаров" на самом деле принимает пароль для входа в CRM. Проект работает только на самовывозе (без доставки).

## Архитектура

### База данных

Таблица `pos_sales` в SQLite:

```sql
CREATE TABLE pos_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_number TEXT NOT NULL,           -- Номер чека (POS-001, POS-002...)
  product_name TEXT NOT NULL,          -- Название товара (произвольное)
  price REAL NOT NULL,                 -- Цена продажи
  cost_price REAL,                     -- Себестоимость (NULL = отложенный чек)
  status TEXT DEFAULT 'completed',     -- 'completed' | 'pending'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
```

Миграция: `server/migrations/add_pos_sales.js`

### Backend API

Роутер: `server/routes/pos.js`

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/admin/pos/sales` | Список продаж (фильтр: `?status=pending`) |
| POST | `/api/admin/pos/sales` | Создать продажу |
| PATCH | `/api/admin/pos/sales/:id` | Обновить (дозаполнить себестоимость) |
| DELETE | `/api/admin/pos/sales/:id` | Удалить |

### Frontend

**Компоненты:**
- `frontend/src/components/admin/CashierLockScreen.vue` - экран кассира (замена AdminLoginScreen)
- `frontend/src/views/admin/crm/CrmPosSales.vue` - страница просмотра POS-продаж

**Store:** `frontend/src/stores/crm.ts`
- `posSales`, `pendingPosSales` - состояние
- `fetchPosSales()`, `fetchPendingPosSales()` - загрузка
- `createPosSale()`, `updatePosSale()`, `deletePosSale()` - CRUD

**Роутинг:** `/admin/crm/pos-sales` → "Продажи касса"

## Логика работы

### Экран кассира (CashierLockScreen)

1. **Скрытый вход**: поле "Поиск товаров" проверяет пароль при Enter
2. **Проверка возраста**: показывает дату "18 лет назад" для продажи алкоголя
3. **Создание чека**: название товара + цена + опционально себестоимость
4. **Отложенные чеки**: если себестоимость не указана, чек сохраняется как `pending`
5. **Дозаполнение**: модалка для ввода себестоимости отложенного чека

### Интеграция в статистику

В `server/routes/crm.js` (dashboard endpoints):
- Выручка включает `SUM(price)` из `pos_sales WHERE status='completed'`
- Прибыль включает `SUM(price - cost_price)` из `pos_sales WHERE status='completed'`

```javascript
// Пример из dashboard
const posStats = db.prepare(`
  SELECT 
    COALESCE(SUM(price), 0) as revenue,
    COALESCE(SUM(price - COALESCE(cost_price, 0)), 0) as profit
  FROM pos_sales 
  WHERE status = 'completed'
    AND created_at >= ? AND created_at < ?
`).get(start, end);
```

## Важные паттерны

### Синхронизация локального состояния

После создания отложенного чека нужно перезагрузить список:

```typescript
// CashierLockScreen.vue
async function submitPending() {
  await crmStore.createPosSale({ ... })
  await loadPendingSales() // Обязательно перезагрузить!
  successMessage.value = 'Чек отложен!'
}
```

### Валидация нулевой себестоимости

Кнопка "Провести" должна разрешать `cost_price = 0`:

```html
<!-- Неправильно: !pendingCostPrice блокирует 0 -->
<button :disabled="!pendingCostPrice || isSubmitting">

<!-- Правильно: проверяем пустую строку -->
<button :disabled="pendingCostPrice === '' || isSubmitting">
```

## Навигация

В `frontend/src/constants/adminNavigation.ts`:

```typescript
{
  name: 'Продажи касса',
  to: '/admin/crm/pos-sales',
  icon: BanknotesIcon
}
```

## Файлы системы

```
server/
├── migrations/add_pos_sales.js    # Миграция БД
├── routes/pos.js                  # API роутер
└── routes/crm.js                  # Dashboard интеграция

frontend/src/
├── components/admin/
│   └── CashierLockScreen.vue      # Экран кассира
├── views/admin/crm/
│   └── CrmPosSales.vue            # Страница продаж
├── stores/crm.ts                  # Store методы
├── constants/adminNavigation.ts   # Навигация
└── router/index.ts                # Роут
```
