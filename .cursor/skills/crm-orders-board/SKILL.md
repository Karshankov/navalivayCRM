# CRM Доска заказов (Kanban Board)

## Назначение

Канбан-доска для управления заказами в CRM. Три колонки + кнопки для отмененных и выданных заказов. Проект работает только на самовывозе (без доставки).

## Архитектура

### База данных

Поля в таблице `orders` (SQLite):

```sql
-- Основные статусы: new, in_progress, completed, delivered, cancelled
-- Миграция: server/migrations/add_manager_action_fields.js
ALTER TABLE orders ADD COLUMN needs_manager_action INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN manager_action_type TEXT;       -- 'modified' | 'cancelled_by_customer'
ALTER TABLE orders ADD COLUMN manager_action_note TEXT;
ALTER TABLE orders ADD COLUMN manager_action_resolved_at TEXT;
```

Архивация: заказы со статусом `delivered` архивируются через 24ч (`archived = 1`). Основной эндпоинт `/orders` фильтрует `archived = 0`.

### Backend API

Роутер: `server/routes/crm-operations.js`

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/admin/crm/orders` | Активные заказы (archived=0) |
| GET | `/api/admin/crm/orders/delivered` | Выданные заказы (все, включая архивные) |
| GET | `/api/admin/crm/orders/:id` | Детали заказа |
| GET | `/api/admin/crm/orders/:id/history` | История статусов заказа |
| PATCH | `/api/admin/crm/orders/:id` | Обновить заказ |
| POST | `/api/admin/crm/orders/:id/resolve-action` | Подтвердить действие менеджера |

**ВАЖНО**: Роут `/orders/delivered` ДОЛЖЕН быть определен ПЕРЕД `/orders/:id`, иначе Express парсит "delivered" как id.

#### Эндпоинт delivered - серверная пагинация и статистика

```
GET /api/admin/crm/orders/delivered?page=1&limit=30&period=today&search=текст
```

Параметры:
- `page` - номер страницы (default: 1)
- `limit` - заказов на страницу (default: 30)
- `period` - фильтр: `today`, `week`, `month`, `all` (default: all)
- `search` - поиск по номеру заказа или имени клиента

Ответ содержит:
- `orders` - массив заказов текущей страницы
- `stats` - статистика по ВСЕМ заказам периода (totalCount, totalAmount, deliveryCount, deliveryAmount, pickupCount, pickupAmount)
- `pagination` - { page, limit, total, totalPages }

Статистика считается отдельным SQL-запросом по всем заказам периода, не только по текущей странице.

### Frontend

**Компоненты:**
- `frontend/src/views/admin/crm/CrmOrders.vue` - канбан-доска
- `frontend/src/views/admin/crm/CrmOrderDetail.vue` - детали заказа

**Store:** `frontend/src/stores/crm.ts`
- `orders` - активные заказы
- `deliveredOrders` - выданные заказы (постраничная загрузка)
- `deliveredStats` - серверная статистика по всем заказам периода
- `deliveredPagination` - пагинация выданных заказов
- `actionRequiredCount`, `unseenActionIds` - счетчики для уведомлений
- `fetchDeliveredOrders(params)` - при `page > 1` дописывает к существующим
- `resolveManagerAction(id)` - подтвердить действие менеджера
- `fetchOrderHistory(id)` - история статусов

## Структура канбан-доски

### Три колонки

```typescript
const kanbanConfig = [
  { key: 'action_required', title: 'Требует действий', filter: (o) => o.needs_manager_action === 1 },
  { key: 'new', title: 'Новые', filter: (o) => !o.needs_manager_action && o.status === 'new' },
  { key: 'assembled', title: 'Собран', filter: (o) => !o.needs_manager_action && o.status === 'in_progress' },
];
```

### Кнопки (без бейджей с цифрами)

- **Отмененные** - модалка со списком отмененных заказов
- **Выданные** (запаролено через `profitUnlocked`) - модалка "Статистика заказов"

### Drag-and-drop

- Заказы с `needs_manager_action` нельзя перетаскивать
- Перетаскивание разрешено только из "Новые" в "Собран"

## Модалка "Статистика заказов"

- Заголовок: "Статистика заказов"
- Защищена паролем прибыли (`profitUnlocked`)
- Фильтры периода: Сегодня / 7 дней / 30 дней / За всё время
- Поиск по номеру или клиенту (debounce 400ms)
- Статистика: 2 карточки (Всего заказов + Выручка) - берется из `deliveredStats` (серверная)
- Таблица: №, Клиент, Сумма, Завершён, Действия
- Кнопка "Загрузить ещё (X из Y)" для постраничной загрузки
- Данные загружаются ТОЛЬКО при открытии модалки (не в onMounted)
- Нет информации о типе доставки (проект только самовывоз)

## Колонка "Требует действий менеджера"

Заказы попадают сюда когда клиент:
- Изменил заказ (`manager_action_type = 'modified'`)
- Отменил заказ (`manager_action_type = 'cancelled_by_customer'`)

Визуальное оформление:
- Красная обводка для отмененных, оранжевая для измененных
- Бейдж с типом действия
- Отображение `manager_action_note`
- Кнопки "Принять изменения" / "Разобрать"

При resolve:
- Для modified: сброс статуса в 'new', возможный возврат товара на склад
- Для cancelled: просто очистка флага

## Уведомления

Polling каждые 15 секунд проверяет новые заказы, требующие действий:
- Browser notification
- Звуковое уведомление
- Toast-уведомление
- Бейдж в заголовке колонки

## Важные паттерны

### Серверная фильтрация вместо клиентской

Фильтры периода и поиск в модалке "Статистика заказов" работают через серверные параметры, а не клиентскую фильтрацию. Это обеспечивает точные подсчеты при любом количестве заказов.

```typescript
// Вотчер на смену фильтра
watch(() => deliveredFilter.value, (newFilter) => {
  if (deliveredModalOpen.value) {
    void crmStore.fetchDeliveredOrders({ limit: 30, period: newFilter, search: ... });
  }
});
```

### Постраничная загрузка ("Загрузить ещё")

```typescript
// Store: при page > 1 дописывает к существующим
if (params?.page && params.page > 1) {
  deliveredOrders.value = [...deliveredOrders.value, ...response.orders];
} else {
  deliveredOrders.value = response.orders;
}
```

### Ленивая загрузка данных

Выданные заказы НЕ загружаются в `onMounted`. Запрос идет только при открытии модалки через `openDeliveredModal()`.

## Файлы системы

```
server/
├── migrations/add_manager_action_fields.js  # Миграция: needs_manager_action и др.
├── routes/crm-operations.js                 # API заказов (CRUD + delivered + resolve)
└── db.js                                    # Подключение миграций

frontend/src/
├── views/admin/crm/
│   ├── CrmOrders.vue                        # Канбан-доска + модалки
│   └── CrmOrderDetail.vue                   # Детали заказа + баннер action
├── stores/crm.ts                            # Store: orders, delivered, stats, pagination
└── constants/adminNavigation.ts             # Навигация
```
